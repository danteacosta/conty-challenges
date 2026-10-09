import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shipments (
  tracking_code TEXT PRIMARY KEY,
  carrier TEXT NOT NULL,
  creator_id TEXT,
  campaign_id TEXT,
  registered_at TEXT NOT NULL,
  -- Derivados do histórico (foldEvents), recalculados na mesma transação de cada ingestão.
  status TEXT,
  reason TEXT,
  started_at TEXT,
  delivered_at TEXT
);

-- Append-only: a mesma ocorrência (transportadora + código bruto + instante) entra uma vez só.
CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_code TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  raw_status TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  description TEXT,
  location TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (tracking_code, dedupe_key)
);
CREATE INDEX IF NOT EXISTS tracking_events_code ON tracking_events (tracking_code, occurred_at);

-- Um aviso por envio e tipo. claimed_at evita duas execuções avisarem ao mesmo tempo; notified_at marca o envio.
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_code TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  notified_at TEXT,
  -- Aviso que ficou obsoleto antes de ser enviado (ex.: a entrega, dentro do prazo, chegou depois): nunca é enviado.
  discarded_at TEXT,
  discard_reason TEXT,
  UNIQUE (tracking_code, kind)
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  // O lock vem antes de inspecionar o esquema: outra conexão deve reler as colunas após a migração.
  inTransaction(db, () => {
    db.exec(SCHEMA);
    addMissingColumns(db);
  });
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

/** Bancos criados antes das colunas de descarte (CREATE TABLE IF NOT EXISTS não as acrescenta). */
function addMissingColumns(db: DatabaseSync): void {
  const columns = (db.prepare("PRAGMA table_info(alerts)").all() as Array<{ name: string }>).map((c) => c.name);
  for (const column of ["discarded_at", "discard_reason"]) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE alerts ADD COLUMN ${column} TEXT`);
  }
}
