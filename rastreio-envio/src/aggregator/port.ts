import type { CarrierEvent } from "../domain/types.ts";

/**
 * O que o resto do sistema sabe sobre um agregador de rastreio. Nenhum tipo do fornecedor aparece aqui:
 * trocar de agregador é escrever outra implementação desta interface.
 */
export interface TrackingAggregator {
  /** Cadastra o código no agregador. Idempotente. */
  register(code: string, carrier: string): Promise<void>;
  /** Todos os eventos conhecidos do código, na ordem que o agregador entregar (pode ser repetida ou fora de ordem). */
  fetchEvents(code: string): Promise<CarrierEvent[]>;
}

export type AggregatorErrorKind = "http" | "timeout" | "network" | "invalid_payload";

export class AggregatorError extends Error {
  constructor(
    readonly kind: AggregatorErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AggregatorError";
  }
}
