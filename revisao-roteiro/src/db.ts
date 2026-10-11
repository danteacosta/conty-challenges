import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('awaiting_review', 'changes_requested', 'approved')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  approved_version INTEGER
);

-- Append-only: uma versão nova nunca sobrescreve nem apaga a anterior.
CREATE TABLE IF NOT EXISTS script_versions (
  script_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  content TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (script_id, number)
);

CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  reason TEXT NOT NULL,
  deadline_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  answered_by_version INTEGER
);
CREATE INDEX IF NOT EXISTS change_requests_script ON change_requests (script_id, id);

-- Um envio com id: o retry do mesmo envio devolve a versão original em vez de criar outra.
CREATE TABLE IF NOT EXISTS script_submissions (
  script_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  content TEXT NOT NULL,
  change_request_id INTEGER,
  version_number INTEGER NOT NULL,
  PRIMARY KEY (script_id, submission_id)
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  // Cancelamento de pedido de alteração (auditoria): o pedido original continua, só ganha quem, quando e por quê.
  const columns = db.prepare("PRAGMA table_info(change_requests)").all() as Array<{ name: string }>;
  for (const column of ["cancelled_at", "cancelled_by", "cancel_reason"]) {
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE change_requests ADD COLUMN ${column} TEXT`);
  }
  return db;
}

/** Transação que já toma o lock de escrita (BEGIN IMMEDIATE): ler o estado e mudá-lo viram um passo só, mesmo entre conexões. */
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
