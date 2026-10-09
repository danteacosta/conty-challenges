import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { getSignupAudit, recordInstall, recordTouch, signUp } from "./store.ts";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** ISO-8601 com fuso (Z ou ±hh:mm). Devolve normalizado em UTC, ou null. */
function instant(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function createApp(db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/installs", async (c) => {
    const b = await c.req.json().catch(() => null);
    const installId = text(b?.install_id);
    const openedAt = instant(b?.opened_at);
    if (!installId || !openedAt) return c.json({ error: "install_id e opened_at (ISO-8601 com fuso) são obrigatórios" }, 400);
    const out = recordInstall(db, installId, openedAt);
    return c.json({ install_id: installId, ...out }, out.result === "created" ? 201 : 200);
  });

  app.post("/touches", async (c) => {
    const b = await c.req.json().catch(() => null);
    const installId = text(b?.install_id);
    const ref = text(b?.ref);
    const cid = text(b?.cid);
    const touchedAt = instant(b?.touched_at);
    const src = b?.src === "campaign" || b?.src === "referral" ? b.src : null;
    if (!installId || !ref || !cid || !touchedAt || !src) {
      return c.json({ error: "install_id, src (campaign|referral), ref, cid e touched_at são obrigatórios" }, 400);
    }
    const out = recordTouch(db, { installId, cid, src, ref, touchedAt }, now());
    return c.json(out, out.result === "recorded" ? 201 : 200);
  });

  app.post("/signups", async (c) => {
    const b = await c.req.json().catch(() => null);
    const userId = text(b?.user_id);
    const installId = text(b?.install_id);
    const signedUpAt = instant(b?.signed_up_at);
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
