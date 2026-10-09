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

export function ingestOrder(db: DatabaseSync, order: NewOrder, now: () => string): { result: "created" | "duplicate" } {
  return inTransaction(db, () => {
    const attribution = attribute(order.signals, registryFor(db));
    const inserted = db
      .prepare(
        `INSERT INTO orders (id, total_cents, currency, financial_status, counted, creator_id, attribution_json, created_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        order.id,
        order.totalCents,
        order.currency,
        order.financialStatus,
        COUNTED_STATUSES.has(order.financialStatus) ? 1 : 0,
        attribution.creator_id,
        JSON.stringify(attribution),
        order.createdAt,
        now(),
      );
    if (inserted.changes === 0) return { result: "duplicate" as const };
    settlePending(db, order.id, order.totalCents);
    return { result: "created" as const };
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

    const order = db.prepare("SELECT total_cents FROM orders WHERE id = ?").get(refund.orderId) as
      | { total_cents: number }
      | undefined;
    if (!order) return { result: "pending" as const, requested_cents: refund.amountCents };

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
