/** O conjunto pequeno e estável de status que o resto do sistema conhece. */
export const STATUSES = ["posted", "in_transit", "out_for_delivery", "delivered", "exception"] as const;
export type Status = (typeof STATUSES)[number];

/** Evento como a transportadora o descreve, já fora do envelope do agregador. `rawStatus` está no dialeto dela. */
export type CarrierEvent = {
  rawStatus: string;
  description: string | null;
  occurredAt: string;
  location: string | null;
};

export type NormalizedEvent = CarrierEvent & {
  carrier: string;
  status: Status;
  /** Preenchido quando o status não veio de um mapeamento conhecido (ex.: unmapped_carrier_status). */
  reason: string | null;
  /** Identifica a ocorrência: a mesma chave em duas consultas é o mesmo evento. */
  dedupeKey: string;
};
