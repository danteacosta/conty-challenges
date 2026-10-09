import { AggregatorError } from "../port.ts";
import type { CarrierEvent } from "../../domain/types.ts";

/**
 * Único lugar que conhece o formato do payload do TrackHub (agregador fictício):
 * { tracking_number, courier, checkpoints: [{ id, status_code, message, time, city }] }.
 * Devolve eventos no formato interno; o código da transportadora (`status_code`) segue bruto.
 */
const invalid = (why: string) => new AggregatorError("invalid_payload", `payload do TrackHub inválido: ${why}`);

export function mapTrackHubPayload(payload: unknown): CarrierEvent[] {
  if (typeof payload !== "object" || payload === null) throw invalid("o corpo não é um objeto");
  const checkpoints = (payload as { checkpoints?: unknown }).checkpoints;
  if (!Array.isArray(checkpoints)) throw invalid("checkpoints ausente ou não é uma lista");

  return checkpoints.map((raw, index): CarrierEvent => {
    const checkpoint = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const code = checkpoint.status_code;
    if (typeof code !== "string" || code.trim() === "") throw invalid(`checkpoint ${index} sem status_code`);
    const time = typeof checkpoint.time === "string" ? Date.parse(checkpoint.time) : Number.NaN;
    if (Number.isNaN(time)) throw invalid(`checkpoint ${index} com data inválida`);
    return {
      rawStatus: code,
      description: typeof checkpoint.message === "string" ? checkpoint.message : null,
      occurredAt: new Date(time).toISOString(),
      location: typeof checkpoint.city === "string" ? checkpoint.city : null,
    };
  });
}
