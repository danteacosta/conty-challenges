/**
 * O que fazer depois de uma falha ao buscar uma página. Regra pura, sem relógio nem I/O.
 *
 * - Falha transitória (timeout, rede, 5xx): tenta de novo com espera exponencial, até `maxAttempts` tentativas.
 * - Erro do cliente (token recusado) ou payload inválido: repetir não adianta, falha na hora.
 * - 429 com Retry-After: espera EXATAMENTE o que o provedor mandou. Se isso passa do teto de espera
 *   (`maxRetryAfterMs`), ou se as tentativas acabaram, ADIA para o horário que ele indicou: não espera além do teto
 *   e não tenta antes do que o provedor pediu.
 * - 429 sem Retry-After: usa o backoff como qualquer falha transitória.
 */
export type FailureKind = "timeout" | "network" | "server" | "rate_limited" | "client" | "invalid_payload";

export type Failure = { kind: FailureKind; retryAfterMs?: number | null };

export type Policy = {
  /** Tentativas por página, contando a primeira. */
  maxAttempts: number;
  baseDelayMs: number;
  maxBackoffMs: number;
  /** Maior espera aceita por causa de um Retry-After. */
  maxRetryAfterMs: number;
};

export type Decision = { action: "retry"; waitMs: number } | { action: "defer"; retryAfterMs: number } | { action: "fail" };

/** `attempt` é o número de tentativas já feitas para esta página (a primeira falha chega com attempt = 1). */
export function decide(failure: Failure, attempt: number, policy: Policy): Decision {
  if (failure.kind === "client" || failure.kind === "invalid_payload") return { action: "fail" };

  const retryAfterMs = failure.kind === "rate_limited" ? (failure.retryAfterMs ?? null) : null;
  if (retryAfterMs !== null) {
    if (attempt >= policy.maxAttempts || retryAfterMs > policy.maxRetryAfterMs) return { action: "defer", retryAfterMs };
    return { action: "retry", waitMs: retryAfterMs };
  }

  if (attempt >= policy.maxAttempts) return { action: "fail" };
  return { action: "retry", waitMs: Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxBackoffMs) };
}
