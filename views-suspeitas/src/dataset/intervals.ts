/**
 * Intervalos de confiança para taxas medidas no dataset sintético. Usa o intervalo de Wilson (score), que se comporta bem com
 * contagens pequenas e com zero acusações, ao contrário do normal (Wald), que daria o intervalo [0, 0] para "0 de 40".
 *
 * O que o intervalo é: a incerteza de AMOSTRAGEM do que foi medido, supondo casos independentes. O que ele NÃO é: uma garantia
 * sobre tráfego real. Os casos vêm de famílias que eu escrevi, então a incerteza sobre se as famílias representam o mundo
 * (viés do gerador) não está nele, e casos da mesma família não são independentes de verdade, o que torna o intervalo otimista.
 */
const Z = 1.959964; // normal padrão, 95% bicaudal

/** 0,045 vira "4,5%": vírgula decimal e uma casa, como no README. */
export const formatPercent = (fraction: number): string => `${(fraction * 100).toFixed(1).replace(".", ",")}%`;

export type Interval = { low: number; high: number };

export function wilsonInterval(successes: number, total: number): Interval | null {
  if (total <= 0) return null;
  const p = successes / total;
  const z2 = Z * Z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const half = (Z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** `1 de 330 (0,3%; IC 95% 0,1%–1,7%)`: a contagem, o denominador, a taxa e o intervalo. */
export function formatCount(successes: number, total: number): string {
  const interval = wilsonInterval(successes, total);
  if (!interval) return `${successes} de ${total} (n/d)`;
  return `${successes} de ${total} (${formatPercent(successes / total)}; IC 95% ${formatPercent(interval.low)}–${formatPercent(interval.high)})`;
}
