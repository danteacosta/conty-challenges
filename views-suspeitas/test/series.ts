/**
 * Séries MONTADAS À MÃO para os testes dos casos óbvios. Não saem do gerador do dataset de propósito: se saíssem, o teste
 * só confirmaria que o classificador concorda com o autor do gerador.
 */
const wobbleAt = (i: number) => ((i * 37 + 11) % 21) / 10 - 1; // determinístico, entre -1 e +1

/** Série "normal": nível com oscilação de ±amplitude (padrão 8%), sem nenhum padrão que importe. */
export function steady(hours = 168, level = 500, amplitude = 0.08): number[] {
  return Array.from({ length: hours }, (_, i) => Math.round(level * (1 + amplitude * wobbleAt(i))));
}

/** Troca um trecho [from, to] (inclusive) por valores calculados por hora. */
export function withRange(series: number[], from: number, to: number, value: (hour: number, index: number) => number): number[] {
  return series.map((v, hour) => (hour >= from && hour <= to ? Math.round(value(hour, hour - from)) : v));
}

/** Patamar quase fixo: `level` com variação de ±amplitude (padrão 0,3%). */
export const plateau = (series: number[], from: number, to: number, level: number, amplitude = 0.003) =>
  withRange(series, from, to, (hour) => level * (1 + amplitude * wobbleAt(hour * 3)));

/** Pico orgânico: sobe em poucas horas até `peak` e desce de forma gradual (fator `decay` por hora), com ruído. */
export function organicSpike(series: number[], start: number, peak: number, decay = 0.88): number[] {
  const out = [...series];
  const ramp = [0.1, 0.35, 0.8, 1];
  ramp.forEach((fraction, k) => (out[start + k] = Math.round(peak * fraction)));
  let level = peak;
  for (let h = start + ramp.length; h < out.length && level > 600; h += 1) {
    level *= decay * (1 + 0.06 * wobbleAt(h * 7));
    out[h] = Math.max(out[h]!, Math.round(level));
  }
  return out;
}
