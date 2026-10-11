/**
 * O que pode sair de uma falha para a resposta e para o histórico: só valores de listas FECHADAS. Qualquer texto que o erro
 * original traga (mensagem, nome, código) pode carregar token, URL com credenciais ou trecho de corpo, e uma regra do tipo
 * "parece um identificador" deixaria passar um token alfanumérico curto.
 */
const KNOWN_ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError", "DOMException", "AbortError", "TimeoutError", "ProviderError", "AggregatorError"]);

const KNOWN_SYSTEM_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** Detalhes que o próprio cliente HTTP define (de onde a falha veio), além dos códigos de sistema acima. */
const KNOWN_DETAILS = new Set(["headers", "body", "body_not_json", "missing_data", "bad_cursor"]);

export const KNOWN_KINDS = new Set(["timeout", "network", "server", "rate_limited", "client", "invalid_payload"]);

/** O nome da classe do erro, se for de uma classe conhecida; senão `Error`. */
export const safeName = (value: unknown): string => (typeof value === "string" && KNOWN_ERROR_NAMES.has(value) ? value : "Error");

/** O código de sistema de um erro de transporte (em `cause.code` ou `code`), se for um dos conhecidos. */
export function safeSystemCode(error: unknown): string | undefined {
  const holder = error as { cause?: { code?: unknown }; code?: unknown } | null;
  const code = holder?.cause?.code ?? holder?.code;
  return typeof code === "string" && KNOWN_SYSTEM_CODES.has(code) ? code : undefined;
}

export const isSafeDetail = (value: unknown): value is string => typeof value === "string" && (KNOWN_DETAILS.has(value) || KNOWN_SYSTEM_CODES.has(value));

export const isSafeStatus = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
