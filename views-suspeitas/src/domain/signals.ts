import { THRESHOLDS as T } from "./criteria.ts";
import { mean, median, stdDev } from "./stats.ts";

export type Effect = "suspicious" | "weak" | "organic";
export type Signal = {
  name: string;
  effect: Effect;
  /** O que foi medido e o limiar com que foi comparado (a leitura de cada sinal está em `detail`). */
  measured: number;
  threshold: number;
  from_hour: number;
  to_hour: number;
  detail: string;
};

export const fmt = (n: number): string => Math.round(n).toLocaleString("pt-BR");
export const pct = (fraction: number, digits = 1): string => (fraction * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// ---------- repetição mecânica

export type Repetition = { kind: "identical" | "progression" | "cycle"; from: number; to: number; value?: number; step?: number; period?: number; repeats?: number };

/** A maior repetição exata acima do volume mínimo: valor idêntico, progressão aritmética ou ciclo curto. */
export function findRepetition(series: number[]): Repetition | undefined {
  const n = series.length;
  const min = T.repetition_min_volume;
  let best: Repetition | undefined;
  const take = (candidate: Repetition) => {
    const length = candidate.to - candidate.from;
    if (!best || length > best.to - best.from) best = candidate;
  };

  // valores idênticos
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && series[j + 1] === series[i]) j += 1;
    if (series[i]! >= min && j - i + 1 >= T.repetition_min_run) take({ kind: "identical", from: i, to: j, value: series[i]! });
    i = j + 1;
  }

  // progressão aritmética (diferença constante e diferente de zero)
  for (let i = 0; i + 1 < n; ) {
    const step = series[i + 1]! - series[i]!;
    let j = i + 1;
    while (j + 1 < n && series[j + 1]! - series[j]! === step) j += 1;
    if (step !== 0 && j - i + 1 >= T.progression_min_run && series.slice(i, j + 1).every((v) => v >= min)) take({ kind: "progression", from: i, to: j, step });
    i = step === 0 ? j + 1 : j;
  }

  // ciclo exato de período p repetido
  for (const p of T.cycle_periods) {
    for (let i = p; i < n; ) {
      if (series[i] !== series[i - p]) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < n && series[j + 1] === series[j + 1 - p]) j += 1;
      const from = i - p;
      const window = series.slice(from, j + 1);
      const repeats = window.length / p;
      if (repeats >= T.cycle_min_repeats && window.every((v) => v >= min) && new Set(window).size > 1) take({ kind: "cycle", from, to: j, period: p, repeats: Math.floor(repeats) });
      i = j + 1;
    }
  }
  return best;
}

// ---------- patamar seguido de queda seca

export type Plateau = { from: number; to: number; mean: number; regularity: number; cliffHour: number; cliffDrop: number };

/** Ruído esperado só pelo acaso da contagem para uma média `m`: √m. A regularidade compara o desvio observado com ele. */
export const regularityOf = (window: number[]): number => {
  const m = mean(window);
  return m <= 0 ? Number.POSITIVE_INFINITY : stdDev(window) / Math.sqrt(m);
};

export function findPlateauCliff(series: number[], baseline: number): Plateau | undefined {
  const n = series.length;
  let best: Plateau | undefined;
  for (let i = 0; i < n; i += 1) {
    let lo = series[i]!;
    let hi = series[i]!;
    let sum = series[i]!;
    let lastGood = -1;
    for (let j = i + 1; j < n; j += 1) {
      const v = series[j]!;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      sum += v;
      const avg = sum / (j - i + 1);
      if ((hi - lo) / (2 * avg) > T.plateau_band) break;
      if (j - i + 1 >= T.plateau_min_hours && avg >= T.plateau_min_lift * baseline) lastGood = j;
    }
    if (lastGood < 0) continue;
    const window = series.slice(i, lastGood + 1);
    const avg = mean(window);
    const next = series[lastGood + 1];
    if (next === undefined || next > (1 - T.cliff_drop) * avg) continue; // sem queda seca logo depois
    const candidate: Plateau = {
      from: i,
      to: lastGood,
      mean: avg,
      regularity: regularityOf(window),
      cliffHour: lastGood + 1,
      cliffDrop: 1 - next / avg,
    };
    if (!best || candidate.to - candidate.from > best.to - best.from) best = candidate;
  }
  return best;
}

// ---------- picos: pulso sem cauda, queda abrupta e pico orgânico

export type PeakKind = "pulse" | "abrupt_drop" | "organic_decay";
export type Peak = { kind: PeakKind; from: number; to: number; peak: number; peakHour: number; ramp: number; tail: number; endValue: number; dropTo?: number };

/** Examina os maiores picos da série (até 5), cada um com a faixa de horas acima do limiar de cauda. */
export function findPeaks(series: number[], baseline: number): Peak[] {
  const peaks: Peak[] = [];
  const claimed = new Set<number>();
  const order = series.map((_, h) => h).sort((a, b) => series[b]! - series[a]! || a - b);
  for (const hour of order) {
    if (peaks.length >= T.max_peaks) break;
    const value = series[hour]!;
    if (value < T.pulse_min_value || value < Math.min(T.pulse_min_lift, T.organic_min_lift) * baseline) break;
    if (claimed.has(hour)) continue;

    const tailThreshold = Math.max(T.tail_floor_baselines * baseline, T.tail_floor_peak_fraction * value);
    let from = hour;
    let to = hour;
    while (from > 0 && !claimed.has(from - 1) && series[from - 1]! > tailThreshold) from -= 1;
    while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;
    for (let h = from; h <= to; h += 1) claimed.add(h);

    const length = to - from + 1;
    const next = series[to + 1];
    const abruptEnd = next !== undefined && next <= (1 - T.drop_fraction) * series[to]!;
    if (length <= T.pulse_max_hours && value >= T.pulse_min_lift * baseline && series[to]! >= T.pulse_end_fraction * value) {
      peaks.push({ kind: "pulse", from, to, peak: value, peakHour: hour, ramp: hour - from, tail: to - hour, endValue: series[to]! });
    } else if (abruptEnd && series[to]! >= T.drop_min_level_vs_peak * value && length > T.pulse_max_hours) {
      peaks.push({ kind: "abrupt_drop", from, to, peak: value, peakHour: hour, ramp: hour - from, tail: to - hour, endValue: series[to]!, dropTo: next });
    } else if (value >= T.organic_min_lift * baseline && to - hour >= T.organic_min_tail_hours && isGradual(series, hour, to)) {
      peaks.push({ kind: "organic_decay", from, to, peak: value, peakHour: hour, ramp: hour - from, tail: to - hour, endValue: series[to]! });
    }
  }
  return peaks;
}

/** Cauda gradual: depois do pico, quase nenhum passo cresce mais de 30% e nenhum desaba de uma vez. */
export function isGradual(series: number[], peakHour: number, end: number): boolean {
  let steps = 0;
  let calm = 0;
  for (let h = peakHour + 1; h <= end; h += 1) {
    steps += 1;
    if (series[h]! <= T.calm_growth * series[h - 1]!) calm += 1;
    if (series[h]! <= (1 - T.drop_fraction) * series[h - 1]!) return false;
  }
  return calm / steps >= T.organic_gradual_fraction; // sem nenhum passo é 0/0 = NaN, que nunca passa
}

// ---------- degrau persistente

export type Step = { from: number; before: number; after: number };

/** Salto de nível feito em poucas horas que se mantém até o fim da série. */
export function findStep(series: number[]): Step | undefined {
  const n = series.length;
  const w = T.step_window_hours;
  for (let s = w; s <= n - w; s += 1) {
    const before = median(series.slice(s - w, s));
    const after = median(series.slice(s, s + w));
    if (after < T.step_min_lift * Math.max(before, 1)) continue;
    if (median(series.slice(s)) < T.step_persistence * after) continue;
    const mid = (before + after) / 2;
    for (let h = s - w; h <= s + w; h += 1) {
      if (h < 3 || h + 6 > n) continue;
      if (series[h - 1]! >= mid || !series.slice(h, h + 6).every((v) => v >= mid)) continue;
      if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida
      return { from: h, before, after };
    }
  }
  return undefined;
}

