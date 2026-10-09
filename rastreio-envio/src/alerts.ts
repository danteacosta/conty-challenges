import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";
import { assessDelay } from "./domain/delay.ts";
import { listOpenShipments } from "./store.ts";

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

type AlertRow = { id: number; payload_json: string };

/**
 * 1) registra um aviso por envio atrasado (UNIQUE: nunca dois), 2) reserva os pendentes, 3) entrega ao destino.
 * Se o destino falha, a reserva é desfeita e o aviso sai na próxima execução (nada se perde).
 */
export async function checkDelays(
  db: DatabaseSync,
  options: { now: () => Date; thresholdHours: number; notifier: Notifier },
) {
  const now = options.now();

  const newlyAlerted = inTransaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO alerts (tracking_code, kind, payload_json, created_at) VALUES (?, 'transit_delay', ?, ?)
       ON CONFLICT(tracking_code, kind) DO NOTHING`,
    );
    let created = 0;
    for (const shipment of listOpenShipments(db)) {
      const startedAt = shipment.started_at ?? shipment.registered_at;
      const delay = assessDelay({
        status: shipment.status,
        startedAt,
        deliveredAt: shipment.delivered_at,
        now,
        thresholdHours: options.thresholdHours,
      });
      if (!delay.delayed) continue;
      const alert: DelayAlert = {
        tracking_code: shipment.tracking_code,
        kind: "transit_delay",
        creator_id: shipment.creator_id,
        campaign_id: shipment.campaign_id,
        status: shipment.status,
        started_at: startedAt,
        elapsed_hours: delay.elapsedHours,
        threshold_hours: delay.thresholdHours,
        detected_at: now.toISOString(),
      };
      created += Number(insert.run(shipment.tracking_code, JSON.stringify(alert), now.toISOString()).changes);
    }
    return created;
  });

  const claimed = inTransaction(db, () => {
    const pending = db.prepare("SELECT id, payload_json FROM alerts WHERE notified_at IS NULL AND claimed_at IS NULL ORDER BY id").all() as AlertRow[];
    const claim = db.prepare("UPDATE alerts SET claimed_at = ? WHERE id = ?");
    for (const row of pending) claim.run(now.toISOString(), row.id);
    return pending;
  });

  let notified = 0;
  for (const row of claimed) {
    try {
      await options.notifier.notify(JSON.parse(row.payload_json) as DelayAlert);
      db.prepare("UPDATE alerts SET notified_at = ? WHERE id = ?").run(now.toISOString(), row.id);
      notified += 1;
    } catch {
      db.prepare("UPDATE alerts SET claimed_at = NULL WHERE id = ?").run(row.id);
    }
  }
  return { newly_alerted: newlyAlerted, notified };
}

export function listAlerts(db: DatabaseSync) {
  const rows = db.prepare("SELECT payload_json, notified_at FROM alerts ORDER BY id").all() as Array<{ payload_json: string; notified_at: string | null }>;
  return rows.map((row) => ({ ...(JSON.parse(row.payload_json) as DelayAlert), notified: row.notified_at !== null }));
}
