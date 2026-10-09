export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Desvio padrão amostral (n − 1). */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

/**
 * A base de uma série: a mediana das horas, com piso de 1. A mediana aguenta picos e patamares que ocupam menos da metade da série;
 * se a manipulação ocupa mais da metade, a base já é a manipulada (limite declarado em `not_detected`).
 */
export const baselineOf = (series: number[]): number => Math.max(1, median(series));
