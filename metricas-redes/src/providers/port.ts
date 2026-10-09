import type { FailureKind } from "../domain/retry.ts";
import type { PostSnapshot } from "../domain/types.ts";

/**
 * A fronteira entre a regra de negócio e uma rede social. A regra (sync, retry, idempotência) só conhece esta
 * interface e o formato único `PostSnapshot`; o formato de cada rede vive só nos adapters.
 */
export type FetchRequest = { account: string; token: string; since: string; until: string; cursor: string | null };
export type FetchResult = { items: PostSnapshot[]; invalid: number; nextCursor: string | null };

export interface MetricsProvider {
  fetchPosts(request: FetchRequest): Promise<FetchResult>;
}

export class ProviderError extends Error {
  readonly kind: FailureKind;
  readonly status?: number;
  /** Só em 429: o Retry-After em milissegundos, ou null se o provedor não mandou (ou mandou algo inválido). */
  readonly retryAfterMs: number | null;

  constructor(kind: FailureKind, message: string, status?: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    if (status !== undefined) this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
