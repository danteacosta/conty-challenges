import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  -- token fictício de uma conexão já autorizada; nunca é devolvido por nenhuma rota
  token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (provider, account_id)
);

-- O número atual de cada post: o ÚLTIMO snapshot (maior as_of). Os totais somam esta tabela, nunca os snapshots.
CREATE TABLE IF NOT EXISTS posts (
  connection_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  views INTEGER NOT NULL,
  likes INTEGER NOT NULL,
  comments INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (connection_id, post_id)
);

-- Append-only: o mesmo snapshot (conexão + post + as_of do provedor) entra uma vez só, venha de onde vier.
CREATE TABLE IF NOT EXISTS metric_snapshots (
  connection_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  views INTEGER NOT NULL,
  likes INTEGER NOT NULL,
  comments INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  sync_run_id INTEGER NOT NULL,
  PRIMARY KEY (connection_id, post_id, as_of)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  window_since TEXT NOT NULL,
  window_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'deferred')),
  attempts INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL DEFAULT 0,
  received INTEGER NOT NULL DEFAULT 0,
  new_snapshots INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0,
  waits_json TEXT NOT NULL DEFAULT '[]',
  retry_at TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS sync_runs_connection ON sync_runs (connection_id, id);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/** Transação que já toma o lock de escrita (BEGIN IMMEDIATE). Nunca é mantida durante rede ou espera. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
