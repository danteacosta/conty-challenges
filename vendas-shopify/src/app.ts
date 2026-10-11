import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { isContention } from "./db.ts";
import { toCents } from "./money.ts";
import { creatorSales, getOrder, getRefund, ingestOrder, ingestRefund, listRefunds, reconciliation, registerCreator } from "./store.ts";

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

/** Id aceito: texto não vazio ou inteiro seguro. Número fora da faixa segura já chega arredondado do JSON e confundiria pedidos distintos. */
const idOf = (v: unknown): string | null =>
  typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;

/** Só há suporte a BRL: moeda ausente vale BRL, qualquer outra é recusada para não somar reais com dólares. */
const SUPPORTED_CURRENCY = "BRL";

export function createApp(db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Banco ocupado não é defeito: o evento não foi gravado (a transação falhou inteira) e repetir depois grava uma vez só.
  app.onError((error, c) => {
    if (isContention(error)) {
      c.header("Retry-After", "1");
      return c.json({ error: "database_busy", retryable: true, message: "o banco está ocupado; nada foi gravado, repita o envio" }, 503);
    }
    return c.json({ error: "internal_error" }, 500);
  });

  app.post("/creators", async (c) => {
    const b = await c.req.json().catch(() => null);
    const id = idOf(b?.id);
    const coupon = str(b?.coupon_code);
    const utm = str(b?.utm_handle);
    if (!id || !coupon || !utm) return c.json({ error: "id, coupon_code e utm_handle são obrigatórios" }, 400);
    const result = registerCreator(db, { id, couponCode: coupon, utmHandle: utm });
    return c.json({ result }, result === "created" ? 201 : 409);
  });

  app.post("/webhooks/orders", async (c) => {
    const b = await c.req.json().catch(() => null);
    const id = idOf(b?.id);
    const totalCents = toCents(b?.total_price);
    if (!id) return c.json({ error: "id é obrigatório (texto ou inteiro seguro)" }, 400);
    if (b?.currency !== undefined && b?.currency !== null) {
      if (typeof b.currency !== "string" || b.currency.trim().toUpperCase() !== SUPPORTED_CURRENCY) {
        return c.json({ error: "unsupported_currency", supported_currency: SUPPORTED_CURRENCY }, 400);
      }
    }
    if (totalCents === null) return c.json({ error: "total_price inválido" }, 400);
    const codes = Array.isArray(b?.discount_codes)
      ? b.discount_codes.map((d: { code?: unknown }) => str(d?.code)).filter((x: string | null): x is string => !!x)
      : [];
    const outcome = ingestOrder(
      db,
      {
        id,
        totalCents,
        currency: SUPPORTED_CURRENCY,
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
    const id = idOf(b?.id);
    const orderId = idOf(b?.order_id);
    const amountCents = toCents(b?.amount);
    if (!id || !orderId) return c.json({ error: "id e order_id são obrigatórios (texto ou inteiro seguro)" }, 400);
    if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);
    const outcome = ingestRefund(db, { id, orderId, amountCents }, now);
    if (outcome.result === "conflict") return c.json({ error: "refund_conflict", refund_id: id, message: "já existe um estorno com este id para outro pedido ou outro valor; nada foi alterado" }, 409);
    return c.json(outcome, outcome.result === "pending" ? 202 : 200);
  });

  app.get("/orders/:id", (c) => {
    const order = getOrder(db, c.req.param("id"));
    return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);
  });

  app.get("/refunds/:id", (c) => {
    const refund = getRefund(db, c.req.param("id"));
    return refund ? c.json(refund) : c.json({ error: "estorno não encontrado" }, 404);
  });

  app.get("/refunds", (c) => {
    const status = c.req.query("status");
    if (status !== undefined && status !== "pending" && status !== "applied" && status !== "clamped") {
      return c.json({ error: "status deve ser pending, applied ou clamped" }, 400);
    }
    return c.json(listRefunds(db, { status, orderId: c.req.query("order_id") }));
  });

  app.get("/reconciliation", (c) => c.json(reconciliation(db)));

  app.get("/creators/:id/sales", (c) => c.json(creatorSales(db, c.req.param("id"))));

  return app;
}
