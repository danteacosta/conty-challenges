import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { parseCalendarDate } from "./domain/deadline.ts";
import { approve, createScript, getScript, requestChanges, submitVersion, type Failure, type Outcome } from "./store.ts";

export type AppOptions = { db: DatabaseSync; now: () => Date };

const MAX_TEXT = 20_000;

/** Texto obrigatório, sem espaços nas pontas. Só espaços ou vazio não passa. */
function required(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > MAX_TEXT ? null : trimmed;
}

const STATUS: Record<Failure["code"], 404 | 409 | 422> = {
  not_found: 404,
  invalid_state: 409,
  script_approved: 409,
  deadline_in_past: 422,
  mission_already_has_script: 409,
};

export function createApp({ db, now }: AppOptions) {
  const app = new Hono();

  const respond = (c: { json: (body: unknown, status?: 200 | 201 | 404 | 409 | 422) => Response }, outcome: Outcome, success: 200 | 201) => {
    if (outcome.ok) return c.json(outcome.view, success);
    const { code, state, allowed_actions } = outcome;
    return c.json({ error: code, ...(state ? { state, allowed_actions } : {}) }, STATUS[code]);
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

  app.post("/scripts/:id/change-requests", async (c) => {
    const body = await c.req.json().catch(() => null);
    const reason = required(body?.reason);
    const deadlineDate = parseCalendarDate(body?.deadline_date);
    if (!reason) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");
    if (!deadlineDate) return invalid(c, "deadline_date", "deadline_date é obrigatório, no formato YYYY-MM-DD e com uma data que existe");
    return respond(c, requestChanges(db, { id: c.req.param("id"), reason, deadlineDate }, now), 201);
  });

  app.post("/scripts/:id/versions", async (c) => {
    const body = await c.req.json().catch(() => null);
    const content = required(body?.content);
    if (!content) return invalid(c, "content", "content é obrigatório");
    return respond(c, submitVersion(db, { id: c.req.param("id"), content }, now), 201);
  });

  app.post("/scripts/:id/approve", (c) => respond(c, approve(db, { id: c.req.param("id") }, now), 200));

  return app;
}
