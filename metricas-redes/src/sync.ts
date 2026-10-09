import type { DatabaseSync } from "node:sqlite";
import { decide, type Failure, type Policy } from "./domain/retry.ts";
import { ProviderError, type MetricsProvider } from "./providers/port.ts";
import { finishRun, getRun, ingestPage, startRun, type Connection, type RunCounters } from "./store.ts";

export type SyncDeps = {
  provider: MetricsProvider;
  now: () => Date;
  /** Espera de verdade em produção; nos testes só anda o relógio. */
  sleep: (ms: number) => Promise<void>;
  policy: Policy;
  /** Teto de páginas por sincronização: um cursor que nunca acaba não vira laço infinito. */
  maxPages: number;
};

type Terminal = { status: "succeeded" | "failed" | "deferred"; error: string | null; retryAt: string | null };

/**
 * Sincroniza as métricas de uma conexão numa janela de publicação [since, until].
 *
 * A rede e a espera acontecem FORA de qualquer transação; cada página é gravada numa transação curta e idempotente
 * (`ingestPage`). Por isso uma falha no meio guarda o que já chegou, e repetir a sync (ou rodar duas ao mesmo tempo, ou
 * com janelas que se sobrepõem) não conta nenhum snapshot duas vezes.
 */
export async function syncConnection(db: DatabaseSync, deps: SyncDeps, connection: Connection, window: { since: string; until: string }) {
  const runId = startRun(db, connection.id, window, deps.now());
  const counters: RunCounters = { attempts: 0, pages: 0, received: 0, new_snapshots: 0, duplicates: 0, stale: 0, invalid: 0, waits_ms: [] };
  let terminal: Terminal = { status: "succeeded", error: null, retryAt: null };
  let cursor: string | null = null;
  const seenCursors = new Set<string>();

  pages: while (true) {
    if (counters.pages >= deps.maxPages) {
      terminal = { status: "failed", error: "too_many_pages", retryAt: null };
      break;
    }

    let attempt = 0;
    let page;
    while (true) {
      attempt += 1;
      counters.attempts += 1;
      try {
        page = await deps.provider.fetchPosts({ account: connection.account_id, token: connection.token, since: window.since, until: window.until, cursor });
        break;
      } catch (error) {
        if (!(error instanceof ProviderError)) {
          terminal = { status: "failed", error: `unexpected: ${(error as Error).message}`, retryAt: null };
          break pages;
        }
        const failure: Failure = { kind: error.kind, retryAfterMs: error.retryAfterMs };
        const decision = decide(failure, attempt, deps.policy);
        if (decision.action === "retry") {
          counters.waits_ms.push(decision.waitMs);
          await deps.sleep(decision.waitMs);
          continue;
        }
        if (decision.action === "defer") {
          // O provedor pediu um prazo que passa do teto de espera (ou as tentativas acabaram): não esperamos além do teto e
          // não tentamos antes do que ele pediu. A sync termina adiada, com a hora em que vale tentar de novo.
          terminal = {
            status: "deferred",
            error: `rate_limited: o provedor pediu para esperar ${decision.retryAfterMs} ms`,
            retryAt: new Date(deps.now().getTime() + decision.retryAfterMs).toISOString(),
          };
          break pages;
        }
        terminal = { status: "failed", error: `${error.kind}: ${error.message}`, retryAt: null };
        break pages;
      }
    }

    const stored = ingestPage(db, connection.id, runId, page.items, deps.now());
    counters.pages += 1;
    counters.received += page.items.length;
    counters.invalid += page.invalid;
    counters.new_snapshots += stored.new_snapshots;
    counters.duplicates += stored.duplicates;
    counters.stale += stored.stale;

    if (page.nextCursor === null) break;
    if (seenCursors.has(page.nextCursor)) {
      terminal = { status: "failed", error: "pagination_loop", retryAt: null };
      break;
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  finishRun(db, runId, { ...terminal, finishedAt: deps.now() }, counters);
  return getRun(db, runId);
}
