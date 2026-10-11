/**
 * Cabeçalho Retry-After: um número inteiro de segundos ou uma data HTTP (IMF-fixdate).
 * Devolve milissegundos a esperar, ou null se ausente ou malformado (nunca um número inventado). Um inteiro decimal válido que
 * não cabe em milissegundos seguros é um prazo, não uma ausência: satura em Number.MAX_SAFE_INTEGER, que o domínio já trata
 * como "além do que o banco representa".
 */
const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

export function parseRetryAfter(value: string | null | undefined, now: Date): number | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    return Math.min(Number(text) * 1000, Number.MAX_SAFE_INTEGER);
  }
  if (HTTP_DATE.test(text)) {
    const at = Date.parse(text);
    return Number.isNaN(at) ? null : Math.max(0, at - now.getTime());
  }
  return null;
}
