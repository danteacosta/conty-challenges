import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { parseCalendarDate } from "./domain/deadline.ts";
import { approve, cancelChangeRequest, createScript, getScript, requestChanges, submitVersion, type Failure, type Outcome } from "./store.ts";

export type AppOptions = { db: DatabaseSync; now: () => Date };

const MAX_TEXT = 20_000;

/** Texto obrigatório, sem espaços nas pontas. Só espaços ou vazio não passa. */
function required(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > max ? null : trimmed;
}

const MAX_SUBMISSION_ID = 200;

/** Campo opcional: ausente ou null vira undefined; presente e inválido vira null. */
function optionalPositiveInteger(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
/** `expected_version`: ausente é o cliente antigo; presente (inclusive `null`) tem de ser um inteiro seguro positivo, senão é erro. */
function expectedVersionOf(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" && value.length >= 1 && value.length <= max ? value : null;
}

const STATUS: Record<Failure["code"], 404 | 409 | 422> = {
  not_found: 404,
  invalid_state: 409,
  script_approved: 409,
  deadline_in_past: 422,
  mission_already_has_script: 409,
  stale_round: 409,
  submission_conflict: 409,
  round_cancelled: 409,
  request_not_open: 409,
  stale_version: 409,
};

/** Chaves do corpo fora da lista: uma chave escrita errada não pode virar, em silêncio, uma decisão sem a salvaguarda que ela pedia. */
function unknownKeys(body: unknown, allowed: readonly string[]): string[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return [];
  return Object.keys(body).filter((key) => !allowed.includes(key));
}

export function createApp({ db, now }: AppOptions) {
  const app = new Hono();

  const respond = (c: { json: (body: unknown, status?: 200 | 201 | 404 | 409 | 422) => Response }, outcome: Outcome, success: 200 | 201) => {
    if (outcome.ok) return c.json(outcome.submission ? { ...outcome.view, submission: outcome.submission } : outcome.view, outcome.submission?.replayed ? 200 : success);
    const { code, state, allowed_actions, open_change_request_id, expected_version, current_version } = outcome;
    return c.json(
      {
        error: code,
        ...(state ? { state, allowed_actions } : {}),
        ...(open_change_request_id ? { open_change_request_id } : {}),
        ...(expected_version !== undefined ? { expected_version, current_version } : {}),
      },
      STATUS[code],
    );
  };
  const invalid = (c: { json: (body: unknown, status: 400) => Response }, field: string, message: string) =>
    c.json({ error: "validation_error", field, message }, 400);

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/scripts", async (c) => {
    const body = await c.req.json().catch(() => null);
    const missionId = required(body?.mission_id);
    const content = required(body?.content);
    if (!missionId) return invalid(c, "mission_id", "mission_id é obrigatório");
    if (!content) return invalid(c, "content", "content é obrigatório");
    return respond(c, createScript(db, { id: crypto.randomUUID(), missionId, content }, now), 201);
  });

  app.get("/scripts/:id", (c) => respond(c, getScript(db, c.req.param("id")), 200));

  const rejectUnknown = (c: { json: (body: unknown, status: 400) => Response }, body: unknown, allowed: readonly string[]) => {
    const extra = unknownKeys(body, allowed);
    return extra.length === 0 ? null : invalid(c, "body", `campo desconhecido: ${extra.slice(0, 3).join(", ")}; aceitos: ${allowed.join(", ")}`);
  };

  app.post("/scripts/:id/change-requests", async (c) => {
    const body = await c.req.json().catch(() => null);
    const unknown = rejectUnknown(c, body, ["reason", "deadline_date", "expected_version"]);
    if (unknown) return unknown;
    const reason = required(body?.reason);
    const deadlineDate = parseCalendarDate(body?.deadline_date);
    if (!reason) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");
    if (!deadlineDate) return invalid(c, "deadline_date", "deadline_date é obrigatório, no formato YYYY-MM-DD e com uma data que existe");
    const expectedVersion = expectedVersionOf(body?.expected_version);
    if (expectedVersion === null) return invalid(c, "expected_version", "expected_version deve ser o número inteiro positivo da versão examinada");
    return respond(c, requestChanges(db, { id: c.req.param("id"), reason, deadlineDate, ...(expectedVersion !== undefined ? { expectedVersion } : {}) }, now), 201);
  });

  app.post("/scripts/:id/versions", async (c) => {
    const body = await c.req.json().catch(() => null);
    const unknown = rejectUnknown(c, body, ["content", "change_request_id", "submission_id"]);
    if (unknown) return unknown;
    const content = required(body?.content);
    if (!content) return invalid(c, "content", "content é obrigatório");
    const changeRequestId = optionalPositiveInteger(body?.change_request_id);
    if (changeRequestId === null) return invalid(c, "change_request_id", "change_request_id deve ser o id inteiro positivo do pedido de alteração que este envio responde");
    const submissionId = optionalText(body?.submission_id, MAX_SUBMISSION_ID);
    if (submissionId === null) return invalid(c, "submission_id", `submission_id deve ser um texto de 1 a ${MAX_SUBMISSION_ID} caracteres`);
    return respond(c, submitVersion(db, { id: c.req.param("id"), content, changeRequestId, submissionId }, now), 201);
  });

  app.post("/scripts/:id/change-requests/:requestId/cancel", async (c) => {
    const body = await c.req.json().catch(() => null);
    const unknown = rejectUnknown(c, body, ["reason", "cancelled_by"]);
    if (unknown) return unknown;
    const reason = required(body?.reason);
    const by = required(body?.cancelled_by, 200);
    if (!reason) return invalid(c, "reason", "o motivo do cancelamento é obrigatório");
    if (!by) return invalid(c, "cancelled_by", "cancelled_by (quem cancela) é obrigatório");
    const raw = c.req.param("requestId");
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return c.json({ error: "not_found" }, 404);
    return respond(c, cancelChangeRequest(db, { id: c.req.param("id"), requestId: Number(raw), reason, by }, now), 200);
  });

  app.post("/scripts/:id/approve", async (c) => {
    // O corpo é opcional, mas não "falha aberto": corpo ausente ou só de espaços é o cliente antigo (aprova a versão atual);
    // qualquer coisa que não seja um objeto JSON com, no máximo, `expected_version` é 400. Um JSON truncado, uma chave escrita
    // errada ou `null` não podem virar, em silêncio, a aprovação da versão atual que o cliente não examinou.
    const raw = await c.req.text();
    let expectedVersion: number | undefined;
    if (raw.trim() !== "") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return invalid(c, "body", "o corpo, quando existe, deve ser um objeto JSON válido: { \"expected_version\": <inteiro> }");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return invalid(c, "body", "o corpo deve ser um objeto JSON: { \"expected_version\": <inteiro> }");
      const unknown = Object.keys(parsed).filter((key) => key !== "expected_version");
      if (unknown.length > 0) return invalid(c, "body", `campo desconhecido: ${unknown.slice(0, 3).join(", ")}; só expected_version é aceito`);
      const value = expectedVersionOf((parsed as { expected_version?: unknown }).expected_version);
      if (value === null) return invalid(c, "expected_version", "expected_version deve ser o número inteiro positivo da versão examinada");
      expectedVersion = value;
    }
    return respond(c, approve(db, { id: c.req.param("id"), ...(expectedVersion !== undefined ? { expectedVersion } : {}) }, now), 200);
  });

  return app;
}
