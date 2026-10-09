/**
 * Cabeçalho Retry-After: um número inteiro de segundos ou uma data HTTP (IMF-fixdate).
 * Devolve milissegundos a esperar, ou null se ausente ou inválido (nunca um número inventado).
 */
const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

export function parseRetryAfter(value: string | null | undefined, now: Date): number | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const ms = Number(text) * 1000;
    return Number.isSafeInteger(ms) ? ms : null;
  }
  if (HTTP_DATE.test(text)) {
    const at = Date.parse(text);
    return Number.isNaN(at) ? null : Math.max(0, at - now.getTime());
  }
  return null;
}
