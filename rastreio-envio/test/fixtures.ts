import type { CarrierEvent } from "../src/domain/types.ts";

export const T0 = Date.parse("2026-06-01T10:00:00.000Z");
export const H = 3_600_000;
export const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

/** Evento no dialeto da transportadora "via-rapida" (códigos numéricos). */
export const viaRapida = (rawStatus: string, offsetMs: number, extra: Partial<CarrierEvent> = {}): CarrierEvent => ({
  rawStatus,
  description: null,
  occurredAt: iso(offsetMs),
  location: null,
  ...extra,
});

export const POSTED = "10";
export const IN_TRANSIT = "20";
export const OUT_FOR_DELIVERY = "30";
export const DELIVERED = "40";
export const FAILED_ATTEMPT = "90";
