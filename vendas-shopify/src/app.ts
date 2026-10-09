import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { toCents } from "./money.ts";
import { creatorSales, getOrder, ingestOrder, ingestRefund, registerCreator } from "./store.ts";

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

export function createApp(db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/creators", async (c) => {
    const b = await c.req.json().catch(() => null);
    const id = str(b?.id);
    const coupon = str(b?.coupon_code);
    const utm = str(b?.utm_handle);
    if (!id || !coupon || !utm) return c.json({ error: "id, coupon_code e utm_handle são obrigatórios" }, 400);
    const result = registerCreator(db, { id, couponCode: coupon, utmHandle: utm });
    return c.json({ result }, result === "created" ? 201 : 409);
  });

  app.post("/webhooks/orders", async (c) => {
    const b = await c.req.json().catch(() => null);
    const id = str(b?.id);
    const totalCents = toCents(b?.total_price);
    if (!id) return c.json({ error: "id é obrigatório" }, 400);
    if (totalCents === null) return c.json({ error: "total_price inválido" }, 400);
    const codes = Array.isArray(b?.discount_codes)
      ? b.discount_codes.map((d: { code?: unknown }) => str(d?.code)).filter((x: string | null): x is string => !!x)
      : [];
    const outcome = ingestOrder(
      db,
      {
        id,
        totalCents,
        currency: str(b?.currency) ?? "BRL",
        financialStatus: str(b?.financial_status) ?? "pending",
        createdAt: str(b?.created_at),
        signals: { couponCodes: codes, utmHandle: str(b?.utm_parameters?.utm_content) },
      },
      now,
    );
    return c.json(outcome, outcome.result === "created" ? 201 : 200);
  });

  app.post("/webhooks/refunds", async (c) => {
    const b = await c.req.json().catch(() => null);
    const id = str(b?.id);
    const orderId = str(b?.order_id);
    const amountCents = toCents(b?.amount);
    if (!id || !orderId) return c.json({ error: "id e order_id são obrigatórios" }, 400);
    if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);
    const outcome = ingestRefund(db, { id, orderId, amountCents }, now);
    return c.json(outcome, outcome.result === "pending" ? 202 : 200);
  });

  app.get("/orders/:id", (c) => {
    const order = getOrder(db, c.req.param("id"));
    return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);
  });

  app.get("/creators/:id/sales", (c) => c.json(creatorSales(db, c.req.param("id"))));

  return app;
}
