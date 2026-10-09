import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";
import type { PostSnapshot } from "./domain/types.ts";
import type { Provider } from "./providers/adapters.ts";

export type Connection = { id: string; provider: Provider; account_id: string; token: string; created_at: string };

export function createConnection(
  db: DatabaseSync,
  input: { id: string; provider: Provider; accountId: string; token: string },
  now: () => Date,
): { ok: true; connection: Connection } | { ok: false; code: "duplicate_connection" } {
  const createdAt = now().toISOString();
  const inserted = db
    .prepare("INSERT INTO connections (id, provider, account_id, token, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider, account_id) DO NOTHING")
    .run(input.id, input.provider, input.accountId, input.token, createdAt);
  if (inserted.changes === 0) return { ok: false, code: "duplicate_connection" };
  return { ok: true, connection: { id: input.id, provider: input.provider, account_id: input.accountId, token: input.token, created_at: createdAt } };
}

export function getConnection(db: DatabaseSync, id: string): Connection | undefined {
  return db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as Connection | undefined;
}

export type RunCounters = {
  attempts: number;
  pages: number;
  received: number;
  new_snapshots: number;
  duplicates: number;
  stale: number;
  invalid: number;
  waits_ms: number[];
};

export function startRun(db: DatabaseSync, connectionId: string, window: { since: string; until: string }, startedAt: Date): number {
  const result = db
    .prepare("INSERT INTO sync_runs (connection_id, window_since, window_until, status, started_at) VALUES (?, ?, ?, 'running', ?)")
    .run(connectionId, window.since, window.until, startedAt.toISOString());
  return Number(result.lastInsertRowid);
}

export function finishRun(
  db: DatabaseSync,
  runId: number,
  outcome: { status: "succeeded" | "failed" | "deferred"; error: string | null; retryAt: string | null; finishedAt: Date },
  counters: RunCounters,
): void {
  db.prepare(
    `UPDATE sync_runs SET status = ?, attempts = ?, pages = ?, received = ?, new_snapshots = ?, duplicates = ?, stale = ?, invalid = ?,
            waits_json = ?, retry_at = ?, error = ?, finished_at = ? WHERE id = ?`,
  ).run(
    outcome.status,
    counters.attempts,
    counters.pages,
    counters.received,
    counters.new_snapshots,
    counters.duplicates,
    counters.stale,
    counters.invalid,
    JSON.stringify(counters.waits_ms),
    outcome.retryAt,
    outcome.error,
    outcome.finishedAt.toISOString(),
    runId,
  );
}

type RunRow = {
  id: number;
  window_since: string;
  window_until: string;
  status: string;
  attempts: number;
  pages: number;
  received: number;
  new_snapshots: number;
  duplicates: number;
  stale: number;
  invalid: number;
  waits_json: string;
  retry_at: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export function runView(row: RunRow) {
  return {
    run_id: row.id,
    status: row.status,
    window: { since: row.window_since, until: row.window_until },
    attempts: row.attempts,
    pages: row.pages,
    received: row.received,
    new_snapshots: row.new_snapshots,
    duplicates: row.duplicates,
    stale: row.stale,
    invalid: row.invalid,
    waits_ms: JSON.parse(row.waits_json) as number[],
    retry_at: row.retry_at,
    error: row.error,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

export const getRun = (db: DatabaseSync, id: number) => runView(db.prepare("SELECT * FROM sync_runs WHERE id = ?").get(id) as RunRow);

/** Da mais nova para a mais antiga. */
export function listRuns(db: DatabaseSync, connectionId: string) {
  return (db.prepare("SELECT * FROM sync_runs WHERE connection_id = ? ORDER BY id DESC").all(connectionId) as RunRow[]).map(runView);
}

/**
 * Grava uma página de snapshots, tudo numa transação curta (nunca durante a rede).
 * - Snapshot repetido (mesma conexão + post + as_of) não entra de novo: conta como duplicado.
 * - Snapshot novo entra no histórico; só vira o número atual do post se for MAIS NOVO que o atual. Um mais antigo que
 *   chega atrasado fica no histórico (stale) e não substitui nada. Os totais somam `posts`, então nenhum post conta duas vezes.
 */
export function ingestPage(
  db: DatabaseSync,
  connectionId: string,
  runId: number,
  snapshots: PostSnapshot[],
  fetchedAt: Date,
): { new_snapshots: number; duplicates: number; stale: number } {
  return inTransaction(db, () => {
    const fetched = fetchedAt.toISOString();
    const insertSnapshot = db.prepare(
      `INSERT INTO metric_snapshots (connection_id, post_id, as_of, views, likes, comments, shares, fetched_at, sync_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connection_id, post_id, as_of) DO NOTHING`,
    );
    const upsertPost = db.prepare(
      `INSERT INTO posts (connection_id, post_id, published_at, views, likes, comments, shares, as_of, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_id, post_id) DO UPDATE SET
         published_at = excluded.published_at, views = excluded.views, likes = excluded.likes, comments = excluded.comments,
         shares = excluded.shares, as_of = excluded.as_of, fetched_at = excluded.fetched_at
       WHERE excluded.as_of > posts.as_of`,
    );
    let created = 0;
    let duplicates = 0;
    let stale = 0;
    for (const s of snapshots) {
      const inserted = insertSnapshot.run(connectionId, s.postId, s.asOf, s.views, s.likes, s.comments, s.shares, fetched, runId);
      if (inserted.changes === 0) {
        duplicates += 1;
        continue;
      }
      created += 1;
      const updated = upsertPost.run(connectionId, s.postId, s.publishedAt, s.views, s.likes, s.comments, s.shares, s.asOf, fetched);
      if (updated.changes === 0) stale += 1;
    }
    return { new_snapshots: created, duplicates, stale };
  });
}

export function metricsView(db: DatabaseSync, connection: Connection) {
  const posts = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM metric_snapshots s WHERE s.connection_id = p.connection_id AND s.post_id = p.post_id) AS snapshots
         FROM posts p WHERE p.connection_id = ? ORDER BY p.published_at, p.post_id`,
    )
    .all(connection.id) as Array<{
    post_id: string;
    published_at: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    as_of: string;
    fetched_at: string;
    snapshots: number;
  }>;
  const totals = posts.reduce(
    (sum, p) => ({ posts: sum.posts + 1, views: sum.views + p.views, likes: sum.likes + p.likes, comments: sum.comments + p.comments, shares: sum.shares + p.shares }),
    { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 },
  );
  return {
    connection: { id: connection.id, provider: connection.provider, account_id: connection.account_id },
    last_fetched_at: posts.reduce<string | null>((latest, p) => (latest === null || p.fetched_at > latest ? p.fetched_at : latest), null),
    totals,
    posts: posts.map((p) => ({
      post_id: p.post_id,
      published_at: p.published_at,
      as_of: p.as_of,
      fetched_at: p.fetched_at,
      snapshots: p.snapshots,
      metrics: { views: p.views, likes: p.likes, comments: p.comments, shares: p.shares },
    })),
  };
}
