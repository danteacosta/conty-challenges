import type { DatabaseSync } from "node:sqlite";
import { decide, type Failure, type Policy } from "./domain/retry.ts";
import { ProviderError, type MetricsProvider } from "./providers/port.ts";
import { KNOWN_KINDS, isSafeDetail, isSafeStatus, safeName } from "./providers/safe.ts";
import { activeCooldown, extendCooldown, finishRun, getRun, ingestPage, startRun, type Connection, type RunCounters } from "./store.ts";

export type SyncDeps = {
  provider: MetricsProvider;
  now: () => Date;
  /** Espera de verdade em produção; nos testes só anda o relógio. */
  sleep: (ms: number) => Promise<void>;
  policy: Policy;
  /** Teto de páginas por sincronização: um cursor que nunca acaba não vira laço infinito. */
  maxPages: number;
};

/**
 * O que vai para a resposta e para o histórico persistido quando uma sync falha: a categoria e um contexto seguro (o status HTTP e
 * de onde a falha veio, todos de listas fechadas), nunca o texto da mensagem. Mensagens de erro de adapters, de bibliotecas e de
 * rede podem carregar tokens, URLs com credenciais e trechos de corpo.
 */
export function safeFailure(error: unknown): string {
  try {
      return describeFailure(error);
    } catch {
      return "unexpected: Error"; // um erro cujo próprio acesso a name/kind lança não pode derrubar o registro da falha
    }
  }

  function describeFailure(error: unknown): string {
    if (error instanceof ProviderError && KNOWN_KINDS.has(error.kind)) {
      const status = isSafeStatus(error.status) ? ` (${error.status})` : "";
      const detail = isSafeDetail(error.detail) ? `: ${error.detail}` : "";
      return `${error.kind}${status}${detail}`;
    }
    const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
    return `unexpected: ${safeName(name)}`;
  }

  /**
   * O último instante que o banco sabe guardar e comparar como texto (ano de 4 dígitos). Um Retry-After que passa dele não é
   * encurtado em silêncio, o que autorizaria uma tentativa antes do prazo pedido: o cooldown fica neste limite, e a execução diz isso.
   */
  export const MAX_REPRESENTABLE_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

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
    const counters: RunCounters = { attempts: 0, pages: 0, received: 0, new_snapshots: 0, duplicates: 0, stale: 0, conflicts: 0, invalid: 0, waits_ms: [] };
    let terminal: Terminal = { status: "succeeded", error: null, retryAt: null };
    let cursor: string | null = null;
    const seenCursors = new Set<string>();

    try {
    pages: while (true) {
      if (counters.pages >= deps.maxPages) {
        terminal = { status: "failed", error: "too_many_pages", retryAt: null };
        break;
      }

      let attempt = 0;
      let page;
      while (true) {
        // O prazo de um Retry-After vale entre sincronizações, reinícios e conexões ao banco, e é lido antes de CADA chamada externa,
        // inclusive a repetição depois do backoff: outra sync pode ter gravado um prazo enquanto esta dormia. A rede fica fora de
        // transação, então não há atomicidade entre a leitura e a chamada (limite declarado no README).
        const cooling = activeCooldown(db, connection.id, deps.now());
        if (cooling) {
          terminal = { status: "deferred", error: "cooldown_active", retryAt: cooling };
          break pages;
        }
        attempt += 1;
        counters.attempts += 1;
        try {
          page = await deps.provider.fetchPosts({ account: connection.account_id, token: connection.token, since: window.since, until: window.until, cursor });
          break;
        } catch (error) {
          if (!(error instanceof ProviderError)) {
            terminal = { status: "failed", error: safeFailure(error), retryAt: null };
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
            const requestedAt = deps.now().getTime() + decision.retryAfterMs;
            const beyondLimit = requestedAt > MAX_REPRESENTABLE_MS;
            extendCooldown(db, connection.id, new Date(beyondLimit ? MAX_REPRESENTABLE_MS : requestedAt).toISOString());
            // O prazo devolvido é o EFETIVO (o maior entre o deste 429 e o que outra sync já tenha gravado).
            const effective = (db.prepare("SELECT cooldown_until FROM connections WHERE id = ?").get(connection.id) as { cooldown_until: string }).cooldown_until;
            terminal = { status: "deferred", error: `rate_limited: o provedor pediu para esperar ${decision.retryAfterMs} ms${beyondLimit ? ` (acima do máximo representável; cooldown fixado em ${new Date(MAX_REPRESENTABLE_MS).toISOString()})` : ""}`, retryAt: effective };
            break pages;
          }
          terminal = { status: "failed", error: safeFailure(error), retryAt: null };
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
      counters.conflicts += stored.conflicts;

      if (page.nextCursor === null) break;
      if (seenCursors.has(page.nextCursor)) {
        terminal = { status: "failed", error: "pagination_loop", retryAt: null };
        break;
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

  } catch (error) {
    // Nada que dê errado entre startRun e finishRun pode deixar a execução em "running" para sempre.
    terminal = { status: "failed", error: safeFailure(error), retryAt: null };
  }

  finishRun(db, runId, { ...terminal, finishedAt: deps.now() }, counters);
  return getRun(db, runId);
}
