import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";
import { deliveryStatus, pendingPieces, type DeliveryStatus, type Pending, type PieceView } from "./domain/approval.ts";
import { PIECE_TYPES, type PieceType } from "./domain/pieces.ts";
import { nextVersionState, type VersionAction, type VersionState } from "./domain/versions.ts";

type DeliveryRow = { id: string; campaign_id: string; created_at: string; approved_at: string | null };
type VersionRow = {
  id: number;
  delivery_id: string;
  piece_type: PieceType;
  number: number;
  url: string;
  duration_seconds: number | null;
  state: VersionState;
  change_reason: string | null;
  submitted_at: string;
  decided_at: string | null;
};
type CommentRow = { id: number; version_id: number; second: number | null; text: string; author: string | null; created_at: string };

export type FailureCode = "not_found" | "version_superseded" | "version_not_pending" | "pieces_pending" | "validation_error";
export type Failure = { ok: false; code: FailureCode; [detail: string]: unknown };
const fail = (code: FailureCode, detail: Record<string, unknown> = {}): Failure => ({ ok: false, code, ...detail });

// ---------- campanhas

export function createCampaign(db: DatabaseSync, input: { id: string; required: PieceType[] }, now: () => Date) {
  return inTransaction(db, () => {
    db.prepare("INSERT INTO campaigns (id, created_at) VALUES (?, ?)").run(input.id, now().toISOString());
    const insert = db.prepare("INSERT INTO campaign_required_pieces (campaign_id, piece_type, position) VALUES (?, ?, ?)");
    input.required.forEach((piece, position) => insert.run(input.id, piece, position));
    return { id: input.id, required_pieces: input.required };
  });
}

export function requiredPieces(db: DatabaseSync, campaignId: string): PieceType[] {
  return (db.prepare("SELECT piece_type FROM campaign_required_pieces WHERE campaign_id = ? ORDER BY position").all(campaignId) as Array<{ piece_type: PieceType }>).map((r) => r.piece_type);
}

export function getCampaign(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(id) as { id: string } | undefined;
  return row ? { id: row.id, required_pieces: requiredPieces(db, id) } : null;
}

// ---------- leitura de uma entrega

const findDelivery = (db: DatabaseSync, id: string) => db.prepare("SELECT * FROM deliveries WHERE id = ?").get(id) as DeliveryRow | undefined;

function currentVersions(db: DatabaseSync, deliveryId: string): Map<PieceType, VersionRow> {
  const rows = db
    .prepare(
      `SELECT v.* FROM piece_versions v
        WHERE v.delivery_id = ? AND v.number = (SELECT MAX(number) FROM piece_versions WHERE delivery_id = v.delivery_id AND piece_type = v.piece_type)`,
    )
    .all(deliveryId) as VersionRow[];
  return new Map(rows.map((row) => [row.piece_type, row]));
}

/** As peças da entrega vistas pela regra: exigida ou não, e o estado da versão ATUAL (null = nenhuma versão). */
function pieceViews(db: DatabaseSync, delivery: DeliveryRow): PieceView[] {
  const required = requiredPieces(db, delivery.campaign_id);
  const current = currentVersions(db, delivery.id);
  const ordered = [...required, ...PIECE_TYPES.filter((type) => !required.includes(type))];
  return ordered.map((type) => ({ type, required: required.includes(type), currentState: current.get(type)?.state ?? null }));
}

const statusOf = (db: DatabaseSync, delivery: DeliveryRow): DeliveryStatus =>
  deliveryStatus({ explicitlyApproved: delivery.approved_at !== null, pieces: pieceViews(db, delivery) });

function versionView(row: VersionRow, isCurrent: boolean, commentsCount: number) {
  return {
    number: row.number,
    url: row.url,
    duration_seconds: row.duration_seconds,
    state: row.state,
    superseded: !isCurrent,
    change_reason: row.change_reason,
    submitted_at: row.submitted_at,
    decided_at: row.decided_at,
    comments_count: commentsCount,
  };
}

function deliveryView(db: DatabaseSync, delivery: DeliveryRow) {
  const required = requiredPieces(db, delivery.campaign_id);
  const views = pieceViews(db, delivery);
  const status = deliveryStatus({ explicitlyApproved: delivery.approved_at !== null, pieces: views });
  const current = currentVersions(db, delivery.id);

  const pending: Array<Pending & { current_version?: number }> = pendingPieces(views).map((p) => {
    const version = current.get(p.piece);
    return version ? { ...p, current_version: version.number } : p;
  });

  const pieces = Object.fromEntries(
    PIECE_TYPES.map((type) => {
      const versions = db
        .prepare(
          `SELECT v.*, (SELECT COUNT(*) FROM comments c WHERE c.version_id = v.id) AS comments_count
             FROM piece_versions v WHERE v.delivery_id = ? AND v.piece_type = ? ORDER BY v.number`,
        )
        .all(delivery.id, type) as Array<VersionRow & { comments_count: number }>;
      const currentVersion = current.get(type);
      return [
        type,
        {
          required: required.includes(type),
          current_version: currentVersion?.number ?? null,
          current_state: currentVersion?.state ?? null,
          versions: versions.map((v) => versionView(v, v.number === currentVersion?.number, v.comments_count)),
        },
      ];
    }),
  ) as Record<PieceType, { required: boolean; current_version: number | null; current_state: VersionState | null; versions: ReturnType<typeof versionView>[] }>;

  const events = (db.prepare("SELECT * FROM delivery_events WHERE delivery_id = ? ORDER BY id").all(delivery.id) as Array<{
    kind: "approved" | "invalidated" | "restored";
    piece_type: PieceType | null;
    version_number: number | null;
    detail_json: string;
    at: string;
  }>).map((e) => ({ kind: e.kind, at: e.at, piece: e.piece_type, version: e.version_number, detail: JSON.parse(e.detail_json) as Record<string, unknown> }));

  return {
    id: delivery.id,
    campaign_id: delivery.campaign_id,
    required_pieces: required,
    status,
    approval: { approved_at: delivery.approved_at, invalidated: status === "in_review" },
    pending,
    pieces,
    events,
  };
}

export type DeliveryView = ReturnType<typeof deliveryView>;

export function createDelivery(db: DatabaseSync, input: { id: string; campaignId: string }, now: () => Date) {
  return inTransaction(db, () => {
    if (!getCampaign(db, input.campaignId)) return fail("not_found", { what: "campaign" });
    db.prepare("INSERT INTO deliveries (id, campaign_id, created_at) VALUES (?, ?, ?)").run(input.id, input.campaignId, now().toISOString());
    return { ok: true as const, view: deliveryView(db, findDelivery(db, input.id) as DeliveryRow) };
  });
}

export function getDelivery(db: DatabaseSync, id: string): { ok: true; view: DeliveryView } | Failure {
  const delivery = findDelivery(db, id);
  return delivery ? { ok: true, view: deliveryView(db, delivery) } : fail("not_found", { what: "delivery" });
}

// ---------- versões

const findVersion = (db: DatabaseSync, deliveryId: string, piece: PieceType, number: number) =>
  db.prepare("SELECT * FROM piece_versions WHERE delivery_id = ? AND piece_type = ? AND number = ?").get(deliveryId, piece, number) as VersionRow | undefined;

const currentNumber = (db: DatabaseSync, deliveryId: string, piece: PieceType) =>
  (db.prepare("SELECT MAX(number) AS n FROM piece_versions WHERE delivery_id = ? AND piece_type = ?").get(deliveryId, piece) as { n: number | null }).n;

function logEvent(db: DatabaseSync, deliveryId: string, kind: "approved" | "invalidated" | "restored", piece: PieceType | null, version: number | null, detail: Record<string, unknown>, at: Date) {
  db.prepare("INSERT INTO delivery_events (delivery_id, kind, piece_type, version_number, detail_json, at) VALUES (?, ?, ?, ?, ?, ?)").run(
    deliveryId,
    kind,
    piece,
    version,
    JSON.stringify(detail),
    at.toISOString(),
  );
}

/** Uma versão nova vira a atual (a de maior número) e a anterior continua legível. Se desfaz a aprovação da entrega, isso vai para o log. */
export function submitVersion(db: DatabaseSync, input: { deliveryId: string; piece: PieceType; url: string; durationSeconds: number | null }, now: () => Date) {
  return inTransaction(db, () => {
    const delivery = findDelivery(db, input.deliveryId);
    if (!delivery) return fail("not_found", { what: "delivery" });

    const before = statusOf(db, delivery);
    const number = (currentNumber(db, input.deliveryId, input.piece) ?? 0) + 1;
    const at = now();
    db.prepare("INSERT INTO piece_versions (delivery_id, piece_type, number, url, duration_seconds, state, submitted_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").run(
      input.deliveryId,
      input.piece,
      number,
      input.url,
      input.durationSeconds,
      at.toISOString(),
    );
    const after = statusOf(db, delivery);
    if (before === "approved" && after === "in_review") {
      logEvent(db, input.deliveryId, "invalidated", input.piece, number, { reason: "new_version_of_required_piece" }, at);
    }
    const row = findVersion(db, input.deliveryId, input.piece, number) as VersionRow;
    return { ok: true as const, version: versionView(row, true, 0), deliveryStatus: after };
  });
}

/** Aprova ou pede alteração da versão ATUAL. Aprovar a versão nova de uma entrega desfeita devolve a aprovação (e registra). */
export function decideVersion(
  db: DatabaseSync,
  input: { deliveryId: string; piece: PieceType; number: number; action: VersionAction; reason?: string },
  now: () => Date,
) {
  return inTransaction(db, () => {
    const delivery = findDelivery(db, input.deliveryId);
    if (!delivery) return fail("not_found", { what: "delivery" });
    const version = findVersion(db, input.deliveryId, input.piece, input.number);
    if (!version) return fail("not_found", { what: "version" });

    const current = currentNumber(db, input.deliveryId, input.piece) as number;
    const commentsCount = (db.prepare("SELECT COUNT(*) AS n FROM comments WHERE version_id = ?").get(version.id) as { n: number }).n;
    // repetir a aprovação de uma versão já aprovada é inofensivo
    if (input.action === "approve" && version.state === "approved") {
      return { ok: true as const, version: versionView(version, version.number === current, commentsCount), deliveryStatus: statusOf(db, delivery) };
    }
    if (version.number !== current) return fail("version_superseded", { current_version: current });
    const target = nextVersionState(version.state, input.action);
    if (target === null) return fail("version_not_pending", { state: version.state });

    const before = statusOf(db, delivery);
    const at = now();
    db.prepare("UPDATE piece_versions SET state = ?, decided_at = ?, change_reason = ? WHERE id = ?").run(target, at.toISOString(), input.reason ?? null, version.id);
    const after = statusOf(db, delivery);
    if (before === "in_review" && after === "approved") logEvent(db, input.deliveryId, "restored", input.piece, version.number, { reason: "pending_version_approved" }, at);

    const row = findVersion(db, input.deliveryId, input.piece, input.number) as VersionRow;
    return { ok: true as const, version: versionView(row, true, commentsCount), deliveryStatus: after };
  });
}

/** Aprova a entrega: cada peça exigida precisa ter a versão atual aprovada. Repetir quando já está aprovada é inofensivo. */
export function approveDelivery(db: DatabaseSync, input: { id: string }, now: () => Date) {
  return inTransaction(db, () => {
    const delivery = findDelivery(db, input.id);
    if (!delivery) return fail("not_found", { what: "delivery" });

    const views = pieceViews(db, delivery);
    const pending = pendingPieces(views);
    if (pending.length > 0) {
      const current = currentVersions(db, delivery.id);
      return fail("pieces_pending", { pending: pending.map((p) => (current.get(p.piece) ? { ...p, current_version: current.get(p.piece)!.number } : p)) });
    }
    if (delivery.approved_at === null) {
      const at = now();
      db.prepare("UPDATE deliveries SET approved_at = ? WHERE id = ?").run(at.toISOString(), delivery.id);
      const current = currentVersions(db, delivery.id);
      const approvedVersions = Object.fromEntries(views.filter((v) => v.required).map((v) => [v.type, current.get(v.type)!.number]));
      logEvent(db, delivery.id, "approved", null, null, { approved_versions: approvedVersions }, at);
    }
    return { ok: true as const, view: deliveryView(db, findDelivery(db, input.id) as DeliveryRow) };
  });
}

// ---------- comentários

export function getVersion(db: DatabaseSync, deliveryId: string, piece: PieceType, number: number) {
  const delivery = findDelivery(db, deliveryId);
  if (!delivery) return fail("not_found", { what: "delivery" });
  const version = findVersion(db, deliveryId, piece, number);
  if (!version) return fail("not_found", { what: "version" });
  const comments = db.prepare("SELECT * FROM comments WHERE version_id = ? ORDER BY second, id").all(version.id) as CommentRow[];
  return {
    ok: true as const,
    version: {
      ...versionView(version, number === currentNumber(db, deliveryId, piece), comments.length),
      piece,
      comments: comments.map((c) => commentView(c, number)),
    },
  };
}

const commentView = (c: CommentRow, version: number) => ({ id: c.id, version, second: c.second, text: c.text, author: c.author, created_at: c.created_at });

/** O comentário fica preso a UMA versão e, no vídeo, a um segundo dela. Nas outras peças vale para a peça toda. */
export function addComment(
  db: DatabaseSync,
  input: { deliveryId: string; piece: PieceType; number: number; second: number | null; text: string; author: string | null },
  now: () => Date,
) {
  return inTransaction(db, () => {
    if (!findDelivery(db, input.deliveryId)) return fail("not_found", { what: "delivery" });
    const version = findVersion(db, input.deliveryId, input.piece, input.number);
    if (!version) return fail("not_found", { what: "version" });

    if (input.piece === "video") {
      if (input.second === null) return fail("validation_error", { field: "second", message: "o comentário do vídeo precisa de um segundo (inteiro, 0 ou mais)" });
      if (version.duration_seconds !== null && input.second > version.duration_seconds) {
        return fail("validation_error", { field: "second", message: `o vídeo tem ${version.duration_seconds} s: o segundo ${input.second} não existe` });
      }
    } else if (input.second !== null) {
      return fail("validation_error", { field: "second", message: "só o comentário do vídeo é preso a um segundo" });
    }

    const at = now().toISOString();
    const result = db.prepare("INSERT INTO comments (version_id, second, text, author, created_at) VALUES (?, ?, ?, ?, ?)").run(version.id, input.second, input.text, input.author, at);
    return { ok: true as const, comment: commentView({ id: Number(result.lastInsertRowid), version_id: version.id, second: input.second, text: input.text, author: input.author, created_at: at }, input.number) };
  });
}
