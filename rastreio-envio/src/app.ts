import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { checkDelays, listAlerts, type Notifier } from "./alerts.ts";
import { AggregatorError, type TrackingAggregator } from "./aggregator/port.ts";
import { assessDelay } from "./domain/delay.ts";
import { SUPPORTED_CARRIERS } from "./domain/dialects.ts";
import { findShipment, ingestEvents, linkConflicts, loadShipment, normalizeCode, registerShipment } from "./store.ts";

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
  if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
    throw new Error(`thresholdHours inválido: ${thresholdHours} (esperado um número de horas maior que 0)`);
  }
  const app = new Hono();
  // Cadastros simultâneos do mesmo código e transportadora, nesta instância, compartilham UMA chamada ao agregador. A transação
  // do banco continua curta e fora da espera de rede; não há coordenação entre processos.
  const pendingRegistrations = new Map<string, Promise<void>>();
  const registerOnce = (code: string, carrier: string): Promise<void> => {
    const key = `${code}\u0000${carrier}`;
    let pending = pendingRegistrations.get(key);
    if (!pending) {
      pending = aggregator.register(code, carrier).finally(() => pendingRegistrations.delete(key));
      pendingRegistrations.set(key, pending);
    }
    return pending;
  };

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
    const links = { creatorId: text(body?.creator_id), campaignId: text(body?.campaign_id) };
    const linkError = (stored: { creator_id: string | null; campaign_id: string | null }) =>
      c.json({ error: "link_conflict", tracking_code: code, conflicts: linkConflicts(stored, links), message: "o envio já está cadastrado com outro vínculo; nada foi alterado" }, 409);

    const known = findShipment(db, code);
    if (known) {
      if (known.carrier !== carrier) return c.json({ error: "carrier_conflict", carrier: known.carrier }, 409);
      if (linkConflicts(known, links).length > 0) return linkError(known); // conflito conhecido não chama o agregador
      return c.json({ result: "exists", tracking_code: code, carrier }, 200);
    }
    await registerOnce(code, carrier);
    const result = registerShipment(db, { code, carrier, ...links }, now);
    if (result === "link_conflict") return linkError(findShipment(db, code) as NonNullable<typeof known>);
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
