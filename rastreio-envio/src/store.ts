import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";
import { normalizeEvent } from "./domain/normalize.ts";
import { foldEvents } from "./domain/status.ts";
import type { CarrierEvent, NormalizedEvent, Status } from "./domain/types.ts";

type ShipmentRow = {
  tracking_code: string;
  carrier: string;
  creator_id: string | null;
  campaign_id: string | null;
  registered_at: string;
  status: Status | null;
  started_at: string | null;
  delivered_at: string | null;
};

type EventRow = {
  dedupe_key: string;
  raw_status: string;
  status: Status;
  reason: string | null;
  description: string | null;
  location: string | null;
  occurred_at: string;
};

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function findShipment(db: DatabaseSync, code: string): ShipmentRow | undefined {
  return db.prepare("SELECT * FROM shipments WHERE tracking_code = ?").get(code) as ShipmentRow | undefined;
}

export type Links = { creatorId: string | null; campaignId: string | null };
export type LinkConflict = { field: "creator_id" | "campaign_id"; stored: string | null; provided: string };

/**
 * Vínculos informados que divergem do cadastro. Campo omitido (null) não é atualização e nunca diverge; um valor informado
 * diferente do guardado, inclusive de um campo que estava vazio, é conflito: o cadastro original não é reescrito por recadastro.
 */
export function linkConflicts(stored: { creator_id: string | null; campaign_id: string | null }, provided: Links): LinkConflict[] {
  const conflicts: LinkConflict[] = [];
  if (provided.creatorId !== null && provided.creatorId !== stored.creator_id) conflicts.push({ field: "creator_id", stored: stored.creator_id, provided: provided.creatorId });
  if (provided.campaignId !== null && provided.campaignId !== stored.campaign_id) conflicts.push({ field: "campaign_id", stored: stored.campaign_id, provided: provided.campaignId });
  return conflicts;
}

export function registerShipment(
  db: DatabaseSync,
  shipment: { code: string; carrier: string; creatorId: string | null; campaignId: string | null },
  now: () => Date,
): "created" | "exists" | "conflict" | "link_conflict" {
  return inTransaction(db, () => {
    const inserted = db
      .prepare(
        `INSERT INTO shipments (tracking_code, carrier, creator_id, campaign_id, registered_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(tracking_code) DO NOTHING`,
      )
      .run(shipment.code, shipment.carrier, shipment.creatorId, shipment.campaignId, now().toISOString());
    if (inserted.changes === 1) return "created" as const;
    const stored = findShipment(db, shipment.code) as ShipmentRow;
    if (stored.carrier !== shipment.carrier) return "conflict" as const;
    return linkConflicts(stored, shipment).length > 0 ? ("link_conflict" as const) : ("exists" as const);
  });
}

function storedEvents(db: DatabaseSync, code: string, carrier: string): NormalizedEvent[] {
  const rows = db.prepare("SELECT * FROM tracking_events WHERE tracking_code = ?").all(code) as EventRow[];
  return rows.map((row) => ({
    carrier,
    rawStatus: row.raw_status,
    description: row.description,
    location: row.location,
    occurredAt: row.occurred_at,
    status: row.status,
    reason: row.reason,
    dedupeKey: row.dedupe_key,
  }));
}

/**
 * Grava os eventos novos (os já conhecidos são ignorados) e recalcula o status a partir do histórico inteiro,
 * tudo na mesma transação. Devolve null se o envio não foi cadastrado.
 */
export function ingestEvents(db: DatabaseSync, code: string, events: CarrierEvent[], now: () => Date) {
  return inTransaction(db, () => {
    const shipment = findShipment(db, code);
    if (!shipment) return null;

    const insert = db.prepare(
      `INSERT INTO tracking_events (tracking_code, dedupe_key, raw_status, status, reason, description, location, occurred_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tracking_code, dedupe_key) DO NOTHING`,
    );
    let added = 0;
    let duplicates = 0;
    for (const event of events) {
      const n = normalizeEvent(shipment.carrier, event);
      const result = insert.run(code, n.dedupeKey, n.rawStatus, n.status, n.reason, n.description, n.location, n.occurredAt, now().toISOString());
      if (result.changes === 1) added += 1;
      else duplicates += 1;
    }

    const fold = foldEvents(storedEvents(db, code, shipment.carrier));
    db.prepare("UPDATE shipments SET status = ?, reason = ?, started_at = ?, delivered_at = ? WHERE tracking_code = ?").run(
      fold.status,
      fold.reason,
      fold.startedAt,
      fold.deliveredAt,
      code,
    );
    return { added, duplicates, status: fold.status, reason: fold.reason };
  });
}

export function loadShipment(db: DatabaseSync, code: string) {
  const shipment = findShipment(db, code);
  if (!shipment) return null;
  const events = storedEvents(db, code, shipment.carrier);
  const fold = foldEvents(events);
  const history = [...events]
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.dedupeKey.localeCompare(b.dedupeKey))
    .map((event) => ({
      status: event.status,
      raw_status: event.rawStatus,
      description: event.description,
      location: event.location,
      occurred_at: event.occurredAt,
      reason: event.reason,
      ignored: fold.afterDelivered.has(event.dedupeKey) ? ("after_delivered" as const) : null,
    }));
  return {
    tracking_code: shipment.tracking_code,
    carrier: shipment.carrier,
    creator_id: shipment.creator_id,
    campaign_id: shipment.campaign_id,
    registered_at: shipment.registered_at,
    status: fold.status,
    reason: fold.reason,
    started_at: fold.startedAt,
    delivered_at: fold.deliveredAt,
    history,
  };
}

/** Envios ainda não entregues, que são os candidatos a atraso. */
export function listOpenShipments(db: DatabaseSync): ShipmentRow[] {
  return db.prepare("SELECT * FROM shipments WHERE status IS NOT 'delivered'").all() as ShipmentRow[];
}
