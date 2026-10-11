import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- As peças exigidas são DADO da campanha. A posição preserva a ordem em que a campanha as declarou.
CREATE TABLE IF NOT EXISTS campaign_required_pieces (
  campaign_id TEXT NOT NULL,
  piece_type TEXT NOT NULL CHECK (piece_type IN ('script', 'video', 'cover', 'caption')),
  position INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, piece_type)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- a aprovação EXPLÍCITA da entrega; o status (aprovada ou em revisão) é derivado das peças
  approved_at TEXT
);

-- Append-only: uma versão nova nunca sobrescreve a anterior, só passa a ser a atual (a de maior número).
CREATE TABLE IF NOT EXISTS piece_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL,
  piece_type TEXT NOT NULL CHECK (piece_type IN ('script', 'video', 'cover', 'caption')),
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  duration_seconds INTEGER,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'changes_requested')),
  change_reason TEXT,
  submitted_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (delivery_id, piece_type, number)
);

-- Um comentário pertence a UMA versão. Nada migra para a versão seguinte.
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  second INTEGER,
  text TEXT NOT NULL,
  author TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_version ON comments (version_id, second, id);

-- Um envio com id: o retry do mesmo envio devolve a versão original em vez de criar outra.
CREATE TABLE IF NOT EXISTS version_submissions (
  delivery_id TEXT NOT NULL,
  piece_type TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  url TEXT NOT NULL,
  duration_seconds INTEGER,
  version_number INTEGER NOT NULL,
  PRIMARY KEY (delivery_id, piece_type, submission_id)
);

-- Append-only: por que a entrega está como está (aprovada, desfeita por uma versão nova, restaurada).
CREATE TABLE IF NOT EXISTS delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('approved', 'invalidated', 'restored')),
  piece_type TEXT,
  version_number INTEGER,
  detail_json TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS delivery_events_delivery ON delivery_events (delivery_id, id);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  // Cópia de comentário (opcional, a pedido do revisor): guarda o comentário de origem e impede copiar duas vezes para a mesma versão.
  const columns = db.prepare("PRAGMA table_info(comments)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "copied_from_comment_id")) db.exec("ALTER TABLE comments ADD COLUMN copied_from_comment_id INTEGER");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS comments_copy_once ON comments (version_id, copied_from_comment_id) WHERE copied_from_comment_id IS NOT NULL");
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
