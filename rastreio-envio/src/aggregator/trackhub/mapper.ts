import { parseInstant } from "../../instant.ts";
import { AggregatorError } from "../port.ts";
import type { CarrierEvent } from "../../domain/types.ts";

/**
 * Único lugar que conhece o formato do payload do TrackHub (agregador fictício):
 * { tracking_number, courier, checkpoints: [{ id, status_code, message, time, city }] }.
 * Devolve eventos no formato interno; o código da transportadora (`status_code`) segue bruto.
 */
const invalid = (why: string) => new AggregatorError("invalid_payload", `payload do TrackHub inválido: ${why}`);

/**
 * O envelope tem que ser do envio pedido: sem isso, a resposta de outro código ou de outra transportadora seria
 * lida com o dialeto do envio consultado (um "40" de uma transportadora qualquer viraria entrega).
 */
export function verifyTrackHubEnvelope(payload: unknown, expected: { code: string; carrier: string }): void {
  if (typeof payload !== "object" || payload === null) throw invalid("o corpo não é um objeto");
  const { tracking_number: trackingNumber, courier } = payload as { tracking_number?: unknown; courier?: unknown };
  if (typeof trackingNumber !== "string" || trackingNumber.trim().toUpperCase() !== expected.code.trim().toUpperCase()) {
    throw invalid("tracking_number ausente ou de outro envio");
  }
  if (typeof courier !== "string" || courier.trim().toLowerCase() !== expected.carrier) {
    throw invalid("courier ausente ou de outra transportadora");
  }
}

export function mapTrackHubPayload(payload: unknown): CarrierEvent[] {
  if (typeof payload !== "object" || payload === null) throw invalid("o corpo não é um objeto");
  const checkpoints = (payload as { checkpoints?: unknown }).checkpoints;
  if (!Array.isArray(checkpoints)) throw invalid("checkpoints ausente ou não é uma lista");

  return checkpoints.map((raw, index): CarrierEvent => {
    const checkpoint = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const code = checkpoint.status_code;
    if (typeof code !== "string" || code.trim() === "") throw invalid(`checkpoint ${index} sem status_code`);
    // Estrito: Date.parse corrige 2026-02-30 para março e lê horário sem fuso no fuso do servidor.
    const occurredAt = parseInstant(checkpoint.time);
    if (occurredAt === null) throw invalid(`checkpoint ${index} com data inválida (esperado ISO-8601 com fuso, de uma data que existe)`);
    return {
      rawStatus: code,
      description: typeof checkpoint.message === "string" ? checkpoint.message : null,
      occurredAt,
      location: typeof checkpoint.city === "string" ? checkpoint.city : null,
    };
  });
}
