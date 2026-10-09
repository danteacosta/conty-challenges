import type { DatabaseSync } from "node:sqlite";
import { attribute, normalizeCoupon, normalizeUtm, type Attribution, type Registry, type Signals } from "./attribution.ts";
import { inTransaction } from "./db.ts";
import { allocateRefund } from "./refunds.ts";

const COUNTED_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

export type NewOrder = {
  id: string;
  totalCents: number;
  currency: string;
  financialStatus: string;
  createdAt: string | null;
  signals: Signals;
};
export type NewRefund = { id: string; orderId: string; amountCents: number };

type RefundRow = {
  seq: number;
  id: string;
  order_id: string;
  requested_cents: number;
  applied_cents: number | null;
  status: "pending" | "applied" | "clamped";
};

function registryFor(db: DatabaseSync): Registry {
  const byCoupon = db.prepare("SELECT id FROM creators WHERE coupon_code = ?");
  const byUtm = db.prepare("SELECT id FROM creators WHERE utm_handle = ?");
  return {
    creatorByCoupon: (code) => (byCoupon.get(code) as { id: string } | undefined)?.id,
    creatorByUtm: (handle) => (byUtm.get(handle) as { id: string } | undefined)?.id,
  };
}

/** Aplica, na ordem de chegada, os estornos pendentes de um pedido. Chamar dentro de transação. */
function settlePending(db: DatabaseSync, orderId: string, totalCents: number): void {
  const pending = db
    .prepare("SELECT * FROM refunds WHERE order_id = ? AND status = 'pending' ORDER BY seq")
    .all(orderId) as RefundRow[];
  const sumApplied = db.prepare(
    "SELECT COALESCE(SUM(applied_cents), 0) AS s FROM refunds WHERE order_id = ? AND status != 'pending'",
  );
  const update = db.prepare("UPDATE refunds SET applied_cents = ?, status = ? WHERE seq = ?");
  for (const refund of pending) {
    const already = (sumApplied.get(orderId) as { s: number }).s;
    const { applied, status } = allocateRefund(totalCents, already, refund.requested_cents);
    update.run(applied, status, refund.seq);
  }
}

export function registerCreator(
  db: DatabaseSync,
  creator: { id: string; couponCode: string; utmHandle: string },
): "created" | "conflict" {
  const result = db
    .prepare("INSERT INTO creators (id, coupon_code, utm_handle) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .run(creator.id, normalizeCoupon(creator.couponCode), normalizeUtm(creator.utmHandle));
  return result.changes === 1 ? "created" : "conflict";
}

export type OrderOutcome = { result: "created" | "credited" | "updated" | "duplicate" };

/**
 * O CRÉDITO da venda nasce no primeiro evento pago do pedido, e só nele:
 * - pedido novo e pago: já nasce creditado ("created") e aplica os estornos que chegaram antes dele;
 * - pedido novo e não pago (pending, authorized...): é gravado, mas não conta ("created", counted = false);
 * - pedido não pago que depois chega pago: o crédito nasce agora ("credited"), com a atribuição calculada com os sinais
 *   deste evento e congelada, e os estornos antecipados são aplicados uma vez, na ordem de chegada;
 * - pedido já creditado: qualquer reenvio é "duplicate" e não altera valor, criador nem estornos (um pendente atrasado
 *   não desfaz o pago).
 */
export function ingestOrder(db: DatabaseSync, order: NewOrder, now: () => string): OrderOutcome {
  return inTransaction(db, () => {
    const paid = COUNTED_STATUSES.has(order.financialStatus);
    const existing = db.prepare("SELECT financial_status, counted FROM orders WHERE id = ?").get(order.id) as
      | { financial_status: string; counted: number }
      | undefined;

    if (!existing) {
      const attribution = attribute(order.signals, registryFor(db));
      db.prepare(
        `INSERT INTO orders (id, total_cents, currency, financial_status, counted, creator_id, attribution_json, created_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(order.id, order.totalCents, order.currency, order.financialStatus, paid ? 1 : 0, attribution.creator_id, JSON.stringify(attribution), order.createdAt, now());
      if (paid) settlePending(db, order.id, order.totalCents);
      return { result: "created" as const };
    }

    if (existing.counted === 1) return { result: "duplicate" as const };

    if (paid) {
      const attribution = attribute(order.signals, registryFor(db));
      db.prepare(
        `UPDATE orders SET total_cents = ?, currency = ?, financial_status = ?, counted = 1, creator_id = ?,
                           attribution_json = ?, created_at = COALESCE(?, created_at) WHERE id = ?`,
      ).run(order.totalCents, order.currency, order.financialStatus, attribution.creator_id, JSON.stringify(attribution), order.createdAt, order.id);
      settlePending(db, order.id, order.totalCents);
      return { result: "credited" as const };
    }

    if (existing.financial_status === order.financialStatus) return { result: "duplicate" as const };
    db.prepare("UPDATE orders SET financial_status = ? WHERE id = ?").run(order.financialStatus, order.id);
    return { result: "updated" as const };
  });
}

export type RefundOutcome =
  | { result: "duplicate" }
  | { result: "pending"; requested_cents: number }
  | { result: "applied" | "clamped"; requested_cents: number; applied_cents: number };

export function ingestRefund(db: DatabaseSync, refund: NewRefund, now: () => string): RefundOutcome {
  return inTransaction(db, () => {
    const inserted = db
      .prepare(
        `INSERT INTO refunds (id, order_id, requested_cents, status, received_at)
         VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(refund.id, refund.orderId, refund.amountCents, now());
    if (inserted.changes === 0) return { result: "duplicate" as const };

    // Sem pedido, ou com o pedido ainda não creditado (pendente), o estorno espera: é aplicado quando o crédito nascer.
    const order = db.prepare("SELECT total_cents, counted FROM orders WHERE id = ?").get(refund.orderId) as
      | { total_cents: number; counted: number }
      | undefined;
    if (!order || order.counted !== 1) return { result: "pending" as const, requested_cents: refund.amountCents };

    settlePending(db, refund.orderId, order.total_cents);
    const row = db.prepare("SELECT * FROM refunds WHERE id = ?").get(refund.id) as RefundRow;
    return {
      result: row.status as "applied" | "clamped",
      requested_cents: row.requested_cents,
      applied_cents: row.applied_cents ?? 0,
    };
  });
}

export function getOrder(db: DatabaseSync, id: string) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as
    | {
        id: string;
        total_cents: number;
        currency: string;
        financial_status: string;
        counted: number;
        attribution_json: string;
        created_at: string | null;
      }
    | undefined;
  if (!order) return null;
  const refunds = db.prepare("SELECT * FROM refunds WHERE order_id = ? ORDER BY seq").all(id) as RefundRow[];
  const refunded = refunds.reduce((sum, r) => sum + (r.applied_cents ?? 0), 0);
  return {
    id: order.id,
    total_cents: order.total_cents,
    currency: order.currency,
    financial_status: order.financial_status,
    counted: order.counted === 1,
    attribution: JSON.parse(order.attribution_json) as Attribution,
    refunded_cents: refunded,
    net_cents: order.total_cents - refunded,
    refunds: refunds.map((r) => ({
      id: r.id,
      requested_cents: r.requested_cents,
      applied_cents: r.applied_cents,
      status: r.status,
    })),
  };
}

export function creatorSales(db: DatabaseSync, creatorId: string) {
  const row = db
    .prepare(
      `SELECT COUNT(o.id) AS orders,
              COALESCE(SUM(o.total_cents), 0) AS gross,
              COALESCE(SUM((SELECT COALESCE(SUM(r.applied_cents), 0) FROM refunds r WHERE r.order_id = o.id)), 0) AS refunded
         FROM orders o WHERE o.creator_id = ? AND o.counted = 1`,
    )
    .get(creatorId) as { orders: number; gross: number; refunded: number };
  return {
    creator_id: creatorId,
    orders: row.orders,
    gross_cents: row.gross,
    refunded_cents: row.refunded,
    net_cents: row.gross - row.refunded,
  };
}

type RefundStatus = "pending" | "applied" | "clamped";

function refundView(row: RefundRow & { received_at: string }) {
  return {
    id: row.id,
    order_id: row.order_id,
    requested_cents: row.requested_cents,
    applied_cents: row.applied_cents,
    status: row.status as RefundStatus,
    received_at: row.received_at,
  };
}

export function getRefund(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT * FROM refunds WHERE id = ?").get(id) as (RefundRow & { received_at: string }) | undefined;
  return row ? refundView(row) : null;
}

export function listRefunds(db: DatabaseSync, filter: { status?: RefundStatus; orderId?: string }) {
  const rows = db
    .prepare("SELECT * FROM refunds WHERE (? IS NULL OR status = ?) AND (? IS NULL OR order_id = ?) ORDER BY seq")
    .all(filter.status ?? null, filter.status ?? null, filter.orderId ?? null, filter.orderId ?? null) as Array<RefundRow & { received_at: string }>;
  return rows.map(refundView);
}
