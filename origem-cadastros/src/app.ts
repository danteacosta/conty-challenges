import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { parseInstant } from "./instant.ts";
import { getSignupAudit, recordInstall, recordTouch, signUp } from "./store.ts";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function createApp(db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/installs", async (c) => {
    const b = await c.req.json().catch(() => null);
    const installId = text(b?.install_id);
    const openedAt = parseInstant(b?.opened_at);
    if (!installId || !openedAt) return c.json({ error: "install_id e opened_at (ISO-8601 com fuso) são obrigatórios" }, 400);
    const out = recordInstall(db, installId, openedAt);
    return c.json({ install_id: installId, ...out }, out.result === "created" ? 201 : 200);
  });

  app.post("/touches", async (c) => {
    const b = await c.req.json().catch(() => null);
    const installId = text(b?.install_id);
    const ref = text(b?.ref);
    const cid = text(b?.cid);
    const touchedAt = parseInstant(b?.touched_at);
    const src = b?.src === "campaign" || b?.src === "referral" ? b.src : null;
    if (!installId || !ref || !cid || !touchedAt || !src) {
      return c.json({ error: "install_id, src (campaign|referral), ref, cid e touched_at são obrigatórios" }, 400);
    }
    const out = recordTouch(db, { installId, cid, src, ref, touchedAt }, now());
    if (out.result === "conflict") return c.json({ error: "cid_conflict", canonical: out.canonical }, 409);
    return c.json(out, out.result === "recorded" ? 201 : 200);
  });

  app.post("/signups", async (c) => {
    const b = await c.req.json().catch(() => null);
    const userId = text(b?.user_id);
    const installId = text(b?.install_id);
    const signedUpAt = parseInstant(b?.signed_up_at);
    if (!userId || !installId || !signedUpAt) {
      return c.json({ error: "user_id, install_id e signed_up_at (ISO-8601 com fuso) são obrigatórios" }, 400);
    }
    const out = signUp(db, { userId, installId, signedUpAt });
    return c.json({ result: out.result, ...out.view }, out.result === "created" ? 201 : 200);
  });

  app.get("/signups/:userId/origin", (c) => {
    const view = getSignupAudit(db, c.req.param("userId"));
    return view ? c.json(view) : c.json({ error: "cadastro não encontrado" }, 404);
  });

  return app;
}
