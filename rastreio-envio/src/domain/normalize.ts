import { lookupStatus } from "./dialects.ts";
import type { CarrierEvent, NormalizedEvent } from "./types.ts";

/**
 * Traduz um evento do dialeto da transportadora para o status normalizado.
 * O que não está no dialeto NUNCA vira entregue: vira exceção, com o motivo e o bruto preservados,
 * para alguém olhar (e para o mapeamento ser completado).
 */
export function normalizeEvent(carrier: string, event: CarrierEvent): NormalizedEvent {
  const occurredAt = new Date(event.occurredAt).toISOString();
  const found = lookupStatus(carrier, event.rawStatus);
  const base = {
    ...event,
    occurredAt,
    carrier,
    dedupeKey: `${carrier}|${event.rawStatus.trim().toUpperCase()}|${occurredAt}`,
  };
  if (found === "unknown_carrier") return { ...base, status: "exception", reason: "unknown_carrier" };
  if (found === undefined) return { ...base, status: "exception", reason: "unmapped_carrier_status" };
  return { ...base, status: found, reason: null };
}
