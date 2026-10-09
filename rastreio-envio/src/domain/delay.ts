import type { Status } from "./types.ts";

/**
 * Atraso: o envio NÃO foi entregue e já passou mais que o limite desde o primeiro evento (a postagem),
 * ou desde o cadastro se ainda não há evento. "Mais que" é estrito: no limite exato ainda está no prazo.
 *
 * Entregue nunca é atraso, mesmo que a consulta aconteça semanas depois (a comparação de uma entrega
 * normal com "agora" é justamente o erro que marcaria entrega normal como atraso). Entrega que levou mais
 * que o limite fica só informada em `deliveredLate`, sem alerta.
 */
const HOUR_MS = 3_600_000;

export type DelayInput = {
  status: Status | null;
  startedAt: string;
  deliveredAt: string | null;
  now: Date;
  thresholdHours: number;
};

export type DelayAssessment = {
  delayed: boolean;
  elapsedHours: number;
  thresholdHours: number;
  startedAt: string;
  deliveredLate: boolean | null;
};

export function assessDelay(input: DelayInput): DelayAssessment {
  const started = Date.parse(input.startedAt);
  const thresholdMs = input.thresholdHours * HOUR_MS;
  const elapsedMs = Math.max(0, input.now.getTime() - started);
  const isDelivered = input.status === "delivered";
  const deliveredLate =
    isDelivered && input.deliveredAt !== null ? Date.parse(input.deliveredAt) - started > thresholdMs : null;
  return {
    delayed: !isDelivered && elapsedMs > thresholdMs,
    elapsedHours: elapsedMs / HOUR_MS,
    thresholdHours: input.thresholdHours,
    startedAt: input.startedAt,
    deliveredLate: isDelivered ? deliveredLate : null,
  };
}
