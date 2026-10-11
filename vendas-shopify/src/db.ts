import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  coupon_code TEXT NOT NULL UNIQUE,
  utm_handle TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL,
  financial_status TEXT NOT NULL,
  counted INTEGER NOT NULL,
  creator_id TEXT,
  attribution_json TEXT NOT NULL,
  created_at TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_creator ON orders (creator_id);

-- Append-only: um estorno nunca é apagado nem sobrescrito, só passa de pending para applied/clamped.
CREATE TABLE IF NOT EXISTS refunds (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  requested_cents INTEGER NOT NULL CHECK (requested_cents > 0),
  applied_cents INTEGER CHECK (applied_cents IS NULL OR applied_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'clamped')),
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_order ON refunds (order_id, seq);
`;

export function openDatabase(path = ":memory:", options: { busyTimeoutMs?: number } = {}): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = ${Math.trunc(options.busyTimeoutMs ?? 5000)}`);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/** Transação que já toma o lock de escrita (BEGIN IMMEDIATE): sem check-then-insert entre conexões. */
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

/**
 * Executa várias leituras como um retrato só do banco: em WAL, o BEGIN fixa o estado no primeiro SELECT, e uma escrita de outra
 * conexão no meio não é vista. A função tem de ser síncrona (sem `await`) para a transação não ficar aberta por cima de espera.
 */
export function readSnapshot<T>(db: DatabaseSync, read: () => T): T {
  db.exec("BEGIN");
  try {
    return read();
  } finally {
    db.exec("COMMIT");
  }
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

/** Contenção do SQLite (banco ocupado ou tabela travada), pelo código real do erro: `errcode` pode ser estendido, o primário são os 8 bits baixos. */
export function isContention(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, errcode } = error as { code?: unknown; errcode?: unknown };
  if (code !== "ERR_SQLITE_ERROR" || typeof errcode !== "number") return false;
  const primary = errcode & 0xff;
  return primary === SQLITE_BUSY || primary === SQLITE_LOCKED;
}
