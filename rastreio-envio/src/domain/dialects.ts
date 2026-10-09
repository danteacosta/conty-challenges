import type { Status } from "./types.ts";

/**
 * Dialeto de cada transportadora: código bruto (em maiúsculas, sem espaços) → status normalizado.
 * Transportadora nova é uma entrada nova aqui; ninguém mais precisa saber como ela fala.
 */
const DIALECTS: Record<string, Record<string, Status>> = {
  "via-rapida": {
    "10": "posted",
    "20": "in_transit",
    "21": "in_transit",
    "30": "out_for_delivery",
    "40": "delivered",
    "90": "exception", // tentativa de entrega falhou
    "91": "exception", // devolvido ao remetente
  },
  "correio-norte": {
    OBJETO_POSTADO: "posted",
    EM_TRANSITO: "in_transit",
    SAIU_PARA_ENTREGA: "out_for_delivery",
    ENTREGUE: "delivered",
    TENTATIVA_FALHA: "exception",
    DEVOLVIDO: "exception",
  },
};

export const SUPPORTED_CARRIERS = Object.keys(DIALECTS).sort();

export function lookupStatus(carrier: string, rawStatus: string): Status | "unknown_carrier" | undefined {
  const table = Object.hasOwn(DIALECTS, carrier) ? DIALECTS[carrier] : undefined;
  if (!table) return "unknown_carrier";
  const key = rawStatus.trim().toUpperCase();
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
