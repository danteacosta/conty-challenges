import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { checkDelays, listAlerts, type Notifier } from "./alerts.ts";
import { AggregatorError, type TrackingAggregator } from "./aggregator/port.ts";
import { assessDelay } from "./domain/delay.ts";
import { SUPPORTED_CARRIERS } from "./domain/dialects.ts";
import { findShipment, ingestEvents, loadShipment, normalizeCode, registerShipment } from "./store.ts";

export type AppOptions = {
  db: DatabaseSync;
  aggregator: TrackingAggregator;
  notifier: Notifier;
  now: () => Date;
  /** Quantas horas desde a postagem até um envio não entregue contar como atrasado. */
  thresholdHours: number;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function createApp(options: AppOptions) {
  const { db, aggregator, notifier, now, thresholdHours } = options;
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof AggregatorError) {
      return c.json({ error: "aggregator_unavailable", kind: error.kind, message: error.message }, 502);
    }
    throw error;
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/shipments", async (c) => {
    const body = await c.req.json().catch(() => null);
    const rawCode = text(body?.tracking_code);
    const carrier = text(body?.carrier);
    if (!rawCode || !carrier) return c.json({ error: "tracking_code e carrier são obrigatórios" }, 400);
    if (!SUPPORTED_CARRIERS.includes(carrier)) {
      return c.json({ error: "unsupported_carrier", supported_carriers: SUPPORTED_CARRIERS }, 400);
    }
    const code = normalizeCode(rawCode);
    const known = findShipment(db, code);
    if (known) {
      return known.carrier === carrier
        ? c.json({ result: "exists", tracking_code: code, carrier }, 200)
        : c.json({ error: "carrier_conflict", carrier: known.carrier }, 409);
    }
    await aggregator.register(code, carrier);
    const result = registerShipment(db, { code, carrier, creatorId: text(body?.creator_id), campaignId: text(body?.campaign_id) }, now);
    return c.json({ result, tracking_code: code, carrier }, result === "created" ? 201 : result === "exists" ? 200 : 409);
  });

  app.post("/shipments/:code/refresh", async (c) => {
    const code = normalizeCode(c.req.param("code"));
    const shipment = findShipment(db, code);
    if (!shipment) return c.json({ error: "envio não encontrado" }, 404);
    const events = await aggregator.fetchEvents(code, shipment.carrier);
    const outcome = ingestEvents(db, code, events, now);
    return outcome ? c.json(outcome) : c.json({ error: "envio não encontrado" }, 404);
  });

  app.get("/shipments/:code", (c) => {
    const shipment = loadShipment(db, normalizeCode(c.req.param("code")));
    if (!shipment) return c.json({ error: "envio não encontrado" }, 404);
    const delay = assessDelay({
      status: shipment.status,
      startedAt: shipment.started_at ?? shipment.registered_at,
      deliveredAt: shipment.delivered_at,
      now: now(),
      thresholdHours,
    });
    return c.json({
      ...shipment,
      delay: {
        delayed: delay.delayed,
        elapsed_hours: delay.elapsedHours,
        threshold_hours: delay.thresholdHours,
        delivered_late: delay.deliveredLate,
      },
    });
  });

  app.post("/jobs/check-delays", async (c) => c.json(await checkDelays(db, { now, thresholdHours, notifier })));

  app.get("/alerts", (c) => c.json(listAlerts(db)));

  return app;
}
