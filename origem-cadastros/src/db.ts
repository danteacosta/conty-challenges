import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
-- Primeiro open do app: o primeiro registro vence e nunca é sobrescrito.
CREATE TABLE IF NOT EXISTS installs (
  install_id TEXT PRIMARY KEY,
  first_open_at TEXT NOT NULL
);

-- Log append-only de entregas de toque. A deduplicação por clique (cid) é regra de decisão,
-- então reenvios ficam visíveis na auditoria como duplicate_click.
CREATE TABLE IF NOT EXISTS touches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  install_id TEXT NOT NULL,
  cid TEXT NOT NULL,
  src TEXT NOT NULL CHECK (src IN ('campaign', 'referral')),
  ref TEXT NOT NULL,
  touched_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS touches_install ON touches (install_id, id);

-- A origem é decidida uma vez, no cadastro, e congelada junto com a evidência.
CREATE TABLE IF NOT EXISTS signups (
  user_id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  signed_up_at TEXT NOT NULL,
  origin_type TEXT NOT NULL,
  origin_ref TEXT,
  origin_reason TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  considered_up_to INTEGER NOT NULL
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/** Transação que já toma o lock de escrita (BEGIN IMMEDIATE). */
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
