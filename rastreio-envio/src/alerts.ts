import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";
import { assessDelay, type DelayAssessment } from "./domain/delay.ts";
import { findShipment, listOpenShipments } from "./store.ts";

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

/**
 * 1) registra um aviso por envio atrasado (UNIQUE: nunca dois; um aviso já descartado é reativado se o envio voltar a atrasar),
 * 2) na hora de reservar, reavalia cada aviso pendente contra o estado ATUAL do envio: o que ficou obsoleto
 *    (a entrega chegou, o limite mudou) é descartado e o que continua válido sai com os dados atuais,
 * 3) entrega ao destino. Se o destino falha, a reserva é desfeita e o aviso sai na próxima execução.
 *
 * Entre a reserva e o envio ainda há uma janela curta em que uma entrega pode chegar: a garantia é
 * "pelo menos uma vez e nunca um aviso já sabidamente obsoleto".
 */
export async function checkDelays(
  db: DatabaseSync,
  options: { now: () => Date; thresholdHours: number; notifier: Notifier },
) {
  const now = options.now();
  const nowIso = now.toISOString();

  const newlyAlerted = inTransaction(db, () => {
    const upsert = db.prepare(
      `INSERT INTO alerts (tracking_code, kind, payload_json, created_at) VALUES (?, 'transit_delay', ?, ?)
       ON CONFLICT(tracking_code, kind) DO UPDATE SET
         payload_json = excluded.payload_json, created_at = excluded.created_at,
         claimed_at = NULL, discarded_at = NULL, discard_reason = NULL
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

  const { claimed, discarded } = inTransaction(db, () => {
    const pending = db
      .prepare("SELECT id, tracking_code, payload_json FROM alerts WHERE notified_at IS NULL AND claimed_at IS NULL AND discarded_at IS NULL ORDER BY id")
      .all() as AlertRow[];
    const claim = db.prepare("UPDATE alerts SET claimed_at = ?, payload_json = ? WHERE id = ?");
    const discard = db.prepare("UPDATE alerts SET discarded_at = ?, discard_reason = ? WHERE id = ?");
    const keep: Array<{ id: number; alert: DelayAlert }> = [];
    let dropped = 0;
    for (const row of pending) {
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
  return { newly_alerted: newlyAlerted, notified, discarded };
}

export function listAlerts(db: DatabaseSync) {
  const rows = db
    .prepare("SELECT payload_json, notified_at, discarded_at, discard_reason FROM alerts ORDER BY id")
    .all() as Array<{ payload_json: string; notified_at: string | null; discarded_at: string | null; discard_reason: string | null }>;
  return rows.map((row) => ({
    ...(JSON.parse(row.payload_json) as DelayAlert),
    status: row.notified_at ? ("notified" as const) : row.discarded_at ? ("discarded" as const) : ("pending" as const),
    discard_reason: row.discard_reason,
    notified: row.notified_at !== null,
  }));
}
