import type { CarrierEvent } from "../domain/types.ts";

/**
 * O que o resto do sistema sabe sobre um agregador de rastreio. Nenhum tipo do fornecedor aparece aqui:
 * trocar de agregador é escrever outra implementação desta interface.
 */
export interface TrackingAggregator {
  /** Cadastra o código no agregador. Idempotente. */
  register(code: string, carrier: string): Promise<void>;
  /**
   * Todos os eventos conhecidos do código, na ordem que o agregador entregar (pode ser repetida ou fora de ordem).
   * A transportadora cadastrada vai junto para o adapter conferir que a resposta é mesmo deste envio.
   */
  fetchEvents(code: string, carrier: string): Promise<CarrierEvent[]>;
}

export type AggregatorErrorKind = "http" | "timeout" | "network" | "invalid_payload";

export class AggregatorError extends Error {
  readonly kind: AggregatorErrorKind;
  readonly status?: number;

  // Sem "parameter properties": este módulo é carregado por workers .ts em modo strip-only, que não as aceita.
  constructor(kind: AggregatorErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AggregatorError";
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}
