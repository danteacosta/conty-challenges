import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";
import { assessDelay, type DelayAssessment } from "./domain/delay.ts";
import { AggregatorError, type TrackingAggregator } from "./aggregator/port.ts";
import { findShipment, ingestEvents, listOpenShipments } from "./store.ts";

export type DelayAlert = {
  tracking_code: string;
  kind: "transit_delay";
  creator_id: string | null;
  campaign_id: string | null;
  status: string | null;
  started_at: string;
  elapsed_hours: number;
  threshold_hours: number;
  detected_at: string;
};

/** Para onde o aviso vai (e-mail, fila, Slack...). Fica fora do domínio. */
export interface Notifier {
  notify(alert: DelayAlert): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async notify(alert: DelayAlert) {
    console.warn(`[atraso] ${alert.tracking_code}: ${alert.elapsed_hours.toFixed(1)}h (limite ${alert.threshold_hours}h)`);
  }
}

type ShipmentRow = NonNullable<ReturnType<typeof findShipment>>;
type AlertRow = { id: number; tracking_code: string; payload_json: string };

function assess(shipment: ShipmentRow, now: Date, thresholdHours: number): DelayAssessment & { startedAt: string } {
  const startedAt = shipment.started_at ?? shipment.registered_at;
  return {
    ...assessDelay({ status: shipment.status, startedAt, deliveredAt: shipment.delivered_at, now, thresholdHours }),
    startedAt,
  };
}

function alertFor(shipment: ShipmentRow, delay: DelayAssessment, now: Date): DelayAlert {
  return {
    tracking_code: shipment.tracking_code,
    kind: "transit_delay",
    creator_id: shipment.creator_id,
    campaign_id: shipment.campaign_id,
    status: shipment.status,
    started_at: delay.startedAt,
    elapsed_hours: delay.elapsedHours,
    threshold_hours: delay.thresholdHours,
    detected_at: now.toISOString(),
  };
}

// Lista fechada: um nome de classe que "parece um identificador" poderia ser o próprio token.
const KNOWN_ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AggregateError", "DOMException", "AbortError", "TimeoutError"]);

/** Só a categoria (e o status HTTP) da falha: o texto do erro do agregador pode carregar credenciais e nunca é guardado. */
export function safeReason(error: unknown): string {
  if (error instanceof AggregatorError) return error.status === undefined ? error.kind : `${error.kind} (${error.status})`;
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return `unexpected: ${typeof name === "string" && KNOWN_ERROR_NAMES.has(name) ? name : "Error"}`;
}

/**
 * 1) registra um aviso por envio atrasado (UNIQUE: nunca dois; um aviso já descartado é reativado se o envio voltar a atrasar),
 * 2) CONFIRMA no agregador, antes de avisar, o estado de cada envio com aviso pendente: o que o banco local ainda vê parado pode já
 *    estar entregue lá. Se a consulta funciona, os eventos são gravados (e a reavaliação abaixo descarta o aviso obsoleto). Se o
 *    agregador está indisponível, o aviso fica "não confirmado" (com a categoria da falha), não é enviado agora e é tentado de
 *    novo na próxima execução: avisar com base num cache que não deu para conferir é o que isto evita,
 * 3) na hora de reservar, reavalia cada aviso confirmado contra o estado ATUAL do envio: o que ficou obsoleto
 *    (a entrega chegou, o limite mudou) é descartado e o que continua válido sai com os dados atuais,
 * 4) entrega ao destino. Se o destino falha, a reserva é desfeita e o aviso sai na próxima execução.
 *
 * Sem `aggregator` (por exemplo num job que só reenvia avisos), a confirmação é pulada e todo aviso pendente conta como confirmado.
 * Entre a reserva e o envio ainda há uma janela curta em que uma entrega pode chegar: a garantia é
 * "pelo menos uma vez e nunca um aviso já sabidamente obsoleto".
 */
export async function checkDelays(
  db: DatabaseSync,
  options: { now: () => Date; thresholdHours: number; notifier: Notifier; aggregator?: TrackingAggregator },
) {
  const now = options.now();
  const nowIso = now.toISOString();

  const newlyAlerted = inTransaction(db, () => {
    const upsert = db.prepare(
      `INSERT INTO alerts (tracking_code, kind, payload_json, created_at) VALUES (?, 'transit_delay', ?, ?)
       ON CONFLICT(tracking_code, kind) DO UPDATE SET
         payload_json = excluded.payload_json, created_at = excluded.created_at,
         claimed_at = NULL, discarded_at = NULL, discard_reason = NULL, unconfirmed_at = NULL, unconfirmed_reason = NULL
       WHERE alerts.discarded_at IS NOT NULL`,
    );
    let created = 0;
    for (const shipment of listOpenShipments(db)) {
      const delay = assess(shipment, now, options.thresholdHours);
      if (!delay.delayed) continue;
      created += Number(upsert.run(shipment.tracking_code, JSON.stringify(alertFor(shipment, delay, now)), nowIso).changes);
    }
    return created;
  });

  // Confirmação remota, fora de qualquer transação (rede). Cada envio pendente é consultado uma vez por execução.
  const confirmed = new Set<string>();
  let unconfirmed = 0;
  const pendingCodes = db
    .prepare("SELECT tracking_code FROM alerts WHERE notified_at IS NULL AND claimed_at IS NULL AND discarded_at IS NULL ORDER BY id")
    .all() as Array<{ tracking_code: string }>;
  for (const { tracking_code: code } of pendingCodes) {
    if (!options.aggregator) {
      confirmed.add(code);
      continue;
    }
    const shipment = findShipment(db, code);
    if (!shipment) continue;
    // O que já se sabe localmente não precisa de consulta: entrega registrada (terminal) ou envio que já não está atrasado. A
    // reavaliação abaixo descarta o aviso; consultar o agregador aqui só atrasaria o descarte e dependeria de ele estar no ar.
    if (!assess(shipment, now, options.thresholdHours).delayed) {
      confirmed.add(code);
      continue;
    }
    try {
      const events = await options.aggregator.fetchEvents(code, shipment.carrier);
      ingestEvents(db, code, events, options.now);
      confirmed.add(code);
      db.prepare("UPDATE alerts SET unconfirmed_at = NULL, unconfirmed_reason = NULL WHERE tracking_code = ? AND kind = 'transit_delay'").run(code);
    } catch (error) {
      unconfirmed += 1;
      db.prepare("UPDATE alerts SET unconfirmed_at = ?, unconfirmed_reason = ? WHERE tracking_code = ? AND kind = 'transit_delay' AND notified_at IS NULL AND discarded_at IS NULL").run(nowIso, safeReason(error), code);
    }
  }

  const { claimed, discarded } = inTransaction(db, () => {
    const pending = db
      .prepare("SELECT id, tracking_code, payload_json FROM alerts WHERE notified_at IS NULL AND claimed_at IS NULL AND discarded_at IS NULL ORDER BY id")
      .all() as AlertRow[];
    const claim = db.prepare("UPDATE alerts SET claimed_at = ?, payload_json = ? WHERE id = ?");
    const discard = db.prepare("UPDATE alerts SET discarded_at = ?, discard_reason = ? WHERE id = ?");
    const keep: Array<{ id: number; alert: DelayAlert }> = [];
    let dropped = 0;
    for (const row of pending) {
      if (!confirmed.has(row.tracking_code)) continue; // não confirmado: continua pendente, sem avisar e sem reservar
      const shipment = findShipment(db, row.tracking_code);
      const delay = shipment ? assess(shipment, now, options.thresholdHours) : null;
      if (!shipment || !delay || !delay.delayed) {
        discard.run(nowIso, shipment?.status === "delivered" ? "delivered" : "within_threshold", row.id);
        dropped += 1;
        continue;
      }
      const alert = alertFor(shipment, delay, now);
      claim.run(nowIso, JSON.stringify(alert), row.id);
      keep.push({ id: row.id, alert });
    }
    return { claimed: keep, discarded: dropped };
  });

  let notified = 0;
  for (const { id, alert } of claimed) {
    try {
      await options.notifier.notify(alert);
      db.prepare("UPDATE alerts SET notified_at = ? WHERE id = ?").run(nowIso, id);
      notified += 1;
    } catch {
      db.prepare("UPDATE alerts SET claimed_at = NULL WHERE id = ?").run(id);
    }
  }
  return { newly_alerted: newlyAlerted, notified, discarded, confirmed: confirmed.size, unconfirmed };
}

export function listAlerts(db: DatabaseSync) {
  const rows = db
    .prepare("SELECT payload_json, notified_at, discarded_at, discard_reason, unconfirmed_at, unconfirmed_reason FROM alerts ORDER BY id")
    .all() as Array<{
    payload_json: string;
    notified_at: string | null;
    discarded_at: string | null;
    discard_reason: string | null;
    unconfirmed_at: string | null;
    unconfirmed_reason: string | null;
  }>;
  return rows.map((row) => ({
    ...(JSON.parse(row.payload_json) as DelayAlert),
    status: row.notified_at ? ("notified" as const) : row.discarded_at ? ("discarded" as const) : ("pending" as const),
    discard_reason: row.discard_reason,
    confirmation: row.unconfirmed_at !== null ? ("unconfirmed" as const) : ("confirmed" as const),
    unconfirmed_reason: row.unconfirmed_reason,
    notified: row.notified_at !== null,
  }));
}
