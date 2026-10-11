import type { DatabaseSync } from "node:sqlite";
import { Hono, type Context } from "hono";
import { PIECE_TYPES, isPieceType, parseRequiredPieces, type PieceType } from "./domain/pieces.ts";
import { addComment, approveDelivery, copyComments, createCampaign, createDelivery, decideVersion, getCampaign, getDelivery, getVersion, submitVersion, type Failure } from "./store.ts";

export type AppOptions = { db: DatabaseSync; now: () => Date };

const MAX_TEXT = 5000;
const MAX_SUBMISSION_ID = 200;

/** Texto obrigatório, sem espaços nas pontas. */
function required(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > max ? null : trimmed;
}

const STATUS: Record<Failure["code"], 400 | 404 | 409> = { not_found: 404, version_superseded: 409, version_not_pending: 409, pieces_pending: 409, validation_error: 400, submission_conflict: 409 };

export function createApp({ db, now }: AppOptions) {
  const app = new Hono();

  const failure = (c: Context, f: Failure) => {
    const { ok: _ok, code, ...detail } = f;
    return c.json({ error: code, ...detail }, STATUS[code]);
  };
  const invalid = (c: Context, field: string, message: string, extra: Record<string, unknown> = {}) => c.json({ error: "validation_error", field, message, ...extra }, 400);
  const piece = (c: Context): PieceType | null => {
    const value = c.req.param("piece");
    return isPieceType(value) ? value : null;
  };
  const versionNumber = (c: Context): number | null => {
    const raw = c.req.param("n");
    return raw !== undefined && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
  };
  const unknownPiece = (c: Context) => c.json({ error: "unknown_piece", allowed: PIECE_TYPES }, 404);
  const notFound = (c: Context, what: string) => c.json({ error: "not_found", what }, 404);

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/campaigns", async (c) => {
    const body = await c.req.json().catch(() => null);
    const requiredPieces = parseRequiredPieces(body?.required_pieces);
    if (!requiredPieces) return invalid(c, "required_pieces", "required_pieces deve ser uma lista não vazia, sem repetição, de peças conhecidas", { allowed: PIECE_TYPES });
    return c.json(createCampaign(db, { id: crypto.randomUUID(), required: requiredPieces }, now), 201);
  });

  app.get("/campaigns/:id", (c) => {
    const campaign = getCampaign(db, c.req.param("id"));
    return campaign ? c.json(campaign) : notFound(c, "campaign");
  });

  app.post("/deliveries", async (c) => {
    const body = await c.req.json().catch(() => null);
    const campaignId = required(body?.campaign_id, 200);
    if (!campaignId) return invalid(c, "campaign_id", "campaign_id é obrigatório");
    const out = createDelivery(db, { id: crypto.randomUUID(), campaignId }, now);
    return out.ok ? c.json(out.view, 201) : failure(c, out);
  });

  app.get("/deliveries/:id", (c) => {
    const out = getDelivery(db, c.req.param("id"));
    return out.ok ? c.json(out.view) : failure(c, out);
  });

  app.post("/deliveries/:id/approve", (c) => {
    const out = approveDelivery(db, { id: c.req.param("id") }, now);
    return out.ok ? c.json(out.view) : failure(c, out);
  });

  app.post("/deliveries/:id/pieces/:piece/versions", async (c) => {
    const type = piece(c);
    if (!type) return unknownPiece(c);
    const body = await c.req.json().catch(() => null);
    const url = required(body?.url, 2000);
    if (!url) return invalid(c, "url", "url é obrigatória");
    const duration = body?.duration_seconds;
    if (duration !== undefined && duration !== null) {
      if (type !== "video") return invalid(c, "duration_seconds", "só o vídeo tem duração");
      if (!Number.isSafeInteger(duration) || duration <= 0) return invalid(c, "duration_seconds", "duration_seconds deve ser um inteiro maior que 0 e dentro do inteiro seguro");
    }
    const submissionId = body?.submission_id;
    if (submissionId !== undefined && submissionId !== null && (typeof submissionId !== "string" || submissionId.length < 1 || submissionId.length > MAX_SUBMISSION_ID)) {
      return invalid(c, "submission_id", `submission_id deve ser um texto de 1 a ${MAX_SUBMISSION_ID} caracteres`);
    }
    const out = submitVersion(
      db,
      { deliveryId: c.req.param("id"), piece: type, url, durationSeconds: typeof duration === "number" ? duration : null, ...(typeof submissionId === "string" ? { submissionId } : {}) },
      now,
    );
    if (!out.ok) return failure(c, out);
    const body201 = { version: out.version, delivery_status: out.deliveryStatus, ...(out.submission ? { submission: out.submission } : {}) };
    return c.json(body201, out.submission?.replayed ? 200 : 201);
  });

  app.get("/deliveries/:id/pieces/:piece/versions/:n", (c) => {
    const type = piece(c);
    const n = versionNumber(c);
    if (!type) return unknownPiece(c);
    if (n === null) return notFound(c, "version");
    const out = getVersion(db, c.req.param("id"), type, n);
    return out.ok ? c.json(out.version) : failure(c, out);
  });

  const decide = (action: "approve" | "request_changes") => async (c: Context) => {
    const type = piece(c);
    const n = versionNumber(c);
    if (!type) return unknownPiece(c);
    if (n === null) return notFound(c, "version");
    let reason: string | undefined;
    if (action === "request_changes") {
      const body = await c.req.json().catch(() => null);
      const text = required(body?.reason);
      if (!text) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");
      reason = text;
    }
    const out = decideVersion(db, { deliveryId: c.req.param("id") as string, piece: type, number: n, action, reason }, now);
    return out.ok ? c.json({ ...out.version, delivery_status: out.deliveryStatus }) : failure(c, out);
  };
  app.post("/deliveries/:id/pieces/:piece/versions/:n/approve", decide("approve"));
  app.post("/deliveries/:id/pieces/:piece/versions/:n/request-changes", decide("request_changes"));

  app.post("/deliveries/:id/pieces/:piece/versions/:n/comments", async (c) => {
    const type = piece(c);
    const n = versionNumber(c);
    if (!type) return unknownPiece(c);
    if (n === null) return notFound(c, "version");
    const body = await c.req.json().catch(() => null);
    const text = required(body?.text);
    if (!text) return invalid(c, "text", "text é obrigatório");
    const second = body?.second;
    if (second !== undefined && second !== null && (!Number.isSafeInteger(second) || second < 0)) return invalid(c, "second", "second deve ser um inteiro, 0 ou mais, dentro do inteiro seguro");
    const out = addComment(db, { deliveryId: c.req.param("id") as string, piece: type, number: n, second: typeof second === "number" ? second : null, text, author: required(body?.author, 200) }, now);
    return out.ok ? c.json(out.comment, 201) : failure(c, out);
  });

  app.post("/deliveries/:id/pieces/:piece/versions/:n/comments/copy", async (c) => {
    const type = piece(c);
    const n = versionNumber(c);
    if (!type) return unknownPiece(c);
    if (n === null) return notFound(c, "version");
    const body = await c.req.json().catch(() => null);
    const from = body?.from_version;
    if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "from_version é obrigatório: o número da versão de onde copiar");
    const ids = body?.comment_ids;
    const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x > 0) && new Set(ids).size === ids.length;
    if (!valid) return invalid(c, "comment_ids", "comment_ids deve ser uma lista de 1 a 200 ids de comentário, sem repetição");
    const out = copyComments(db, { deliveryId: c.req.param("id") as string, piece: type, number: n, fromVersion: from, commentIds: ids }, now);
    if (!out.ok) return failure(c, out);
    return c.json({ copied: out.copied, already_copied: out.already_copied, warning: out.warning }, out.copied.length > 0 ? 201 : 200);
  });

  return app;
}
