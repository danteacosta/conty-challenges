import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Policy } from "./domain/retry.ts";
import { parseInstant } from "./instant.ts";
import { PROVIDERS, type Provider } from "./providers/adapters.ts";
import type { MetricsProvider } from "./providers/port.ts";
import { createConnection, getConnection, listRuns, metricsView, type Connection } from "./store.ts";
import { syncConnection } from "./sync.ts";

export type AppOptions = {
  db: DatabaseSync;
  /** Como falar com a rede de uma conexão. Em produção é o cliente HTTP; nos testes, o simulador. */
  providerFor: (connection: Connection) => MetricsProvider;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  policy: Policy;
  maxPages: number;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

export function createApp(options: AppOptions) {
  const { db, providerFor, now, sleep, policy, maxPages } = options;
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/connections", async (c) => {
    const body = await c.req.json().catch(() => null);
    const provider = text(body?.provider);
    const accountId = text(body?.account_id);
    const token = text(body?.token);
    if (!provider || !(PROVIDERS as readonly string[]).includes(provider)) return c.json({ error: "validation_error", field: "provider", supported: PROVIDERS }, 400);
    if (!accountId) return c.json({ error: "validation_error", field: "account_id" }, 400);
    if (!token) return c.json({ error: "validation_error", field: "token" }, 400);

    const created = createConnection(db, { id: crypto.randomUUID(), provider: provider as Provider, accountId, token }, now);
    if (!created.ok) return c.json({ error: created.code }, 409);
    const { id, created_at } = created.connection;
    // O token entra e nunca mais sai: nenhuma resposta o devolve.
    return c.json({ id, provider, account_id: accountId, has_token: true, created_at }, 201);
  });

  app.post("/connections/:id/sync", async (c) => {
    const connection = getConnection(db, c.req.param("id"));
    if (!connection) return c.json({ error: "connection_not_found" }, 404);

    const body = await c.req.json().catch(() => null);
    const since = parseInstant(body?.since);
    const until = parseInstant(body?.until);
    if (!since) return c.json({ error: "validation_error", field: "since", message: "since deve ser ISO-8601 com fuso, de uma data que existe" }, 400);
    if (!until) return c.json({ error: "validation_error", field: "until", message: "until deve ser ISO-8601 com fuso, de uma data que existe" }, 400);
    if (Date.parse(since) > Date.parse(until)) return c.json({ error: "validation_error", field: "since", message: "since não pode ser depois de until" }, 400);

    const run = await syncConnection(db, { provider: providerFor(connection), now, sleep, policy, maxPages }, connection, { since, until });
    const status = run.status === "succeeded" ? 200 : run.status === "deferred" ? 202 : 502;
    return c.json(run, status);
  });

  app.get("/connections/:id/metrics", (c) => {
    const connection = getConnection(db, c.req.param("id"));
    return connection ? c.json(metricsView(db, connection)) : c.json({ error: "connection_not_found" }, 404);
  });

  app.get("/connections/:id/syncs", (c) => {
    const connection = getConnection(db, c.req.param("id"));
    return connection ? c.json(listRuns(db, connection.id)) : c.json({ error: "connection_not_found" }, 404);
  });

  return app;
}
