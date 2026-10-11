import type { Rng } from "./rng.ts";

export type FamilyLabel = "legit" | "suspicious";
/** Para o experimento de sensibilidade: fixa o volume típico e/ou a duração da série. Sem opções, o resultado é o de sempre. */
export type BuildOptions = { level?: number; hours?: number };
export type Family = { name: string; label: FamilyLabel; description: string; build: (rng: Rng, options?: BuildOptions) => number[] };

// ---------- tráfego orgânico: média por hora + ruído de contagem + ruído de audiência

/** Perfil de um dia (hora 0 a 23): madrugada fraca, noite forte. Normalizado para média 1. */
const DIURNAL = (() => {
  const raw = [0.55, 0.45, 0.4, 0.38, 0.4, 0.5, 0.65, 0.8, 0.95, 1.05, 1.1, 1.12, 1.15, 1.15, 1.12, 1.1, 1.1, 1.15, 1.25, 1.35, 1.4, 1.3, 1.05, 0.75];
  const mean = raw.reduce((sum, v) => sum + v, 0) / raw.length;
  return raw.map((v) => v / mean);
})();

type Shape = {
  level: number;
  /** 0 = sem ciclo diário; 1 = ciclo inteiro. */
  diurnal: number;
  /** Fator dos sábados e domingos. */
  weekend: number;
  /** Crescimento total ao longo da série (0 = nenhum). */
  growth: number;
  /** Desvio relativo da audiência (além do acaso da contagem). */
  noise: number;
};

const randomShape = (rng: Rng, overrides: Partial<Shape> = {}, options?: BuildOptions): Shape => ({
  level: options?.level ?? rng.int(150, 4000),
  diurnal: rng.between(0.2, 0.55),
  weekend: rng.between(0.85, 1.05),
  growth: 0,
  noise: rng.between(0.05, 0.12),
  ...overrides,
});

const randomHours = (rng: Rng, minDays = 7, maxDays = 13) => 24 * rng.int(minDays, maxDays);

/** A média esperada de cada hora. As famílias somam picos, patamares e degraus nesta média antes do ruído. */
function expectedViews(rng: Rng, hours: number, shape: Shape): number[] {
  const startHour = rng.int(0, 23);
  const startDay = rng.int(0, 6);
  return Array.from({ length: hours }, (_, h) => {
    const day = (startDay + Math.floor((startHour + h) / 24)) % 7;
    const daily = 1 + shape.diurnal * (DIURNAL[(startHour + h) % 24]! - 1);
    const weekly = day >= 5 ? shape.weekend : 1;
    const trend = 1 + shape.growth * (h / hours);
    return shape.level * daily * weekly * trend;
  });
}

/** Transforma médias em contagens: ruído de audiência (relativo) e ruído de contagem (√média), sempre inteiros ≥ 0. */
function realize(rng: Rng, expected: number[], noise: number | number[]): number[] {
  return expected.map((mean, h) => {
    const relative = Array.isArray(noise) ? noise[h]! : noise;
    const value = mean * (1 + relative * rng.normal()) + Math.sqrt(Math.max(mean, 0)) * rng.normal();
    return Math.max(0, Math.round(value));
  });
}

/** Pico orgânico somado à média: sobe em `ramp` horas e desce multiplicando por `decay` a cada hora. */
function addSpike(expected: number[], start: number, peak: number, ramp: number, decay: number): void {
  for (let k = 0; k < ramp && start + k < expected.length; k += 1) expected[start + k]! += peak * ((k + 1) / ramp) ** 2;
  let level = peak;
  for (let h = start + ramp; h < expected.length && level > 1; h += 1) {
    level *= decay;
    expected[h]! += level;
  }
}

const medianOf = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
const startIn = (rng: Rng, hours: number, reserve: number) => rng.int(30, Math.max(31, hours - reserve));
const overwrite = (series: number[], start: number, values: number[]) => values.forEach((v, k) => (series[start + k] = Math.max(0, Math.round(v))));

// ---------- legítimos

const steadyDaily = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng);
  return realize(rng, expectedViews(rng, hours, randomShape(rng, {}, options)), randomShape(rng, {}, options).noise);
};

const weekendDip = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng, 14, 28);
  const shape = randomShape(rng, { weekend: rng.between(0.45, 0.7), diurnal: rng.between(0.2, 0.4) }, options);
  return realize(rng, expectedViews(rng, hours, shape), shape.noise);
};

const slowGrowth = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng, 10, 20);
  const shape = randomShape(rng, { growth: rng.between(0.5, 2) }, options);
  return realize(rng, expectedViews(rng, hours, shape), shape.noise);
};

const globalAudience = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng);
  const shape = randomShape(rng, { diurnal: rng.between(0, 0.08), weekend: 1, noise: rng.between(0.03, 0.06) }, options);
  return realize(rng, expectedViews(rng, hours, shape), shape.noise);
};

const lowVolume = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng);
  const shape = randomShape(rng, { level: rng.int(1, 12), diurnal: rng.between(0.2, 0.5), noise: 0.1 }, options);
  return realize(rng, expectedViews(rng, hours, shape), shape.noise);
};

const organicViral = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng);
  const shape = randomShape(rng, {}, options);
  const expected = expectedViews(rng, hours, shape);
  addSpike(expected, startIn(rng, hours, 60), shape.level * rng.between(8, 40), rng.int(2, 5), rng.between(0.8, 0.93));
  return realize(rng, expected, shape.noise);
};

const newsDoubleSpike = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng);
  const shape = randomShape(rng, {}, options);
  const expected = expectedViews(rng, hours, shape);
  const first = rng.int(30, Math.max(31, hours - 100));
  addSpike(expected, first, shape.level * rng.between(8, 30), rng.int(1, 3), rng.between(0.75, 0.9));
  addSpike(expected, first + rng.int(18, 40), shape.level * rng.between(6, 20), rng.int(1, 3), rng.between(0.75, 0.9));
  return realize(rng, expected, shape.noise);
};

const premiere = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng);
  const shape = randomShape(rng, {}, options);
  const expected = expectedViews(rng, hours, shape);
  const start = startIn(rng, hours, 60);
  addSpike(expected, start, shape.level * rng.between(10, 30), 1, rng.between(0.35, 0.6));
  addSpike(expected, start + 1, shape.level * 1.5, 1, 0.9);
  return realize(rng, expected, shape.noise);
};

const liveStream = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng);
  const shape = randomShape(rng, {}, options);
  const expected = expectedViews(rng, hours, shape);
  const start = startIn(rng, hours, 40);
  const duration = rng.int(4, 10);
  const lift = shape.level * rng.between(3, 8);
  const noise = expected.map((_, h) => (h >= start && h < start + duration ? rng.between(0.04, 0.1) : shape.noise));
  for (let h = start; h < start + duration && h < hours; h += 1) expected[h]! += lift;
  return realize(rng, expected, noise);
};

const viralInterrupted = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng);
  const shape = randomShape(rng, {}, options);
  const expected = expectedViews(rng, hours, shape);
  const start = startIn(rng, hours, 40);
  const duration = rng.int(5, 12);
  const lift = shape.level * rng.between(8, 25);
  const noise = expected.map((_, h) => (h >= start && h < start + duration ? rng.between(0.15, 0.3) : shape.noise));
  for (let h = start; h < start + duration && h < hours; h += 1) expected[h]! += lift;
  return realize(rng, expected, noise);
};

const embedStep = (rng: Rng, options?: BuildOptions) => {
  const hours = options?.hours ?? randomHours(rng, 9, 14);
  const shape = randomShape(rng, {}, options);
  const expected = expectedViews(rng, hours, shape);
  const start = rng.int(48, hours - 60);
  const factor = rng.between(2.5, 6);
  for (let h = start; h < hours; h += 1) expected[h]! *= h === start ? (1 + factor) / 2 : factor;
  return realize(rng, expected, shape.noise);
};

// ---------- suspeitos

/** Série orgânica de fundo sobre a qual a compra é colada. */
function backdrop(rng: Rng, options?: BuildOptions): { series: number[]; hours: number; level: number } {
  const hours = options?.hours ?? randomHours(rng);
  const shape = randomShape(rng, {}, options);
  const series = realize(rng, expectedViews(rng, hours, shape), shape.noise);
  return { series, hours, level: medianOf(series) };
}

const boughtPlateauWith = (jitter: [number, number]) => (rng: Rng, options?: BuildOptions) => {
  const { series, hours, level } = backdrop(rng, options);
  const duration = rng.int(6, 36);
  const start = startIn(rng, hours, duration + 24);
  const target = level * rng.between(4, 20);
  const relative = rng.between(jitter[0], jitter[1]);
  overwrite(series, start, Array.from({ length: duration }, () => target * (1 + relative * rng.normal())));
  return series;
};

const mechanicalRepeat = (rng: Rng, options?: BuildOptions) => {
  const { series, hours, level } = backdrop(rng, options);
  const duration = rng.int(8, 30);
  const start = startIn(rng, hours, duration + 24);
  const kind = rng.pick(["identical", "progression", "cycle"] as const);
  if (kind === "identical") {
    const value = level * rng.between(2, 10);
    overwrite(series, start, Array.from({ length: duration }, () => value));
  } else if (kind === "progression") {
    const first = level * rng.between(1, 3);
    const step = Math.max(1, Math.round(level * rng.between(0.2, 1)));
    overwrite(series, start, Array.from({ length: duration }, (_, k) => first + step * k));
  } else {
    const pattern = Array.from({ length: rng.int(2, 4) }, () => level * rng.between(0.5, 8));
    overwrite(series, start, Array.from({ length: duration }, (_, k) => pattern[k % pattern.length]!));
  }
  return series;
};

const pulseWithoutDecay = (rng: Rng, options?: BuildOptions) => {
  const { series, hours, level } = backdrop(rng, options);
  const start = startIn(rng, hours, 30);
  const peak = level * rng.between(15, 60);
  overwrite(series, start, rng.chance(0.5) ? [peak] : [peak, peak * rng.between(0.3, 0.8)]);
  return series;
};

/** Compra que imita a forma orgânica: sobe devagar, segura com ruído natural e desce por degraus graduais. */
const disguisedBuy = (rng: Rng, options?: BuildOptions) => {
  const { series, hours, level } = backdrop(rng, options);
  const rise = rng.int(8, 16);
  const hold = rng.int(2, 3);
  const peak = level * rng.between(8, 20);
  const decay = rng.between(0.7, 0.85);
  const values: number[] = [];
  for (let k = 0; k < rise; k += 1) values.push(peak * ((k + 1) / rise));
  for (let k = 0; k < hold; k += 1) values.push(peak);
  for (let value = peak * decay; value > level * 1.5; value *= decay) values.push(value);
  const start = startIn(rng, hours, values.length + 24);
  overwrite(series, start, values.map((v) => v * (1 + 0.06 * rng.normal())));
  return series;
};

export const FAMILIES: readonly Family[] = [
  { name: "steady_daily", label: "legit", description: "audiência diária estável, com ciclo de dia e noite", build: steadyDaily },
  { name: "weekend_dip", label: "legit", description: "queda nos fins de semana", build: weekendDip },
  { name: "slow_growth", label: "legit", description: "crescimento lento e contínuo", build: slowGrowth },
  { name: "global_audience", label: "legit", description: "audiência espalhada por fusos, quase sem ciclo diário", build: globalAudience },
  { name: "organic_viral", label: "legit", description: "pico viral: sobe em horas e esfria devagar", build: organicViral },
  { name: "news_double_spike", label: "legit", description: "dois picos orgânicos com um dia entre eles", build: newsDoubleSpike },
  { name: "premiere", label: "legit", description: "estreia agendada: pico agudo e queda rápida", build: premiere },
  { name: "live_stream", label: "legit", description: "transmissão ao vivo: patamar alto de poucas horas com fim seco", build: liveStream },
  { name: "viral_interrupted", label: "legit", description: "viral cortado de uma vez pela plataforma", build: viralInterrupted },
  { name: "embed_step", label: "legit", description: "degrau permanente por incorporação num site grande", build: embedStep },
  { name: "low_volume", label: "legit", description: "canal pequeno, de 1 a 12 views por hora", build: lowVolume },
  { name: "bought_plateau", label: "suspicious", description: "entrega comprada em patamar quase fixo e interrompida", build: boughtPlateauWith([0.001, 0.01]) },
  { name: "mechanical_repeat", label: "suspicious", description: "valores idênticos, progressão exata ou ciclo exato", build: mechanicalRepeat },
  { name: "pulse_without_decay", label: "suspicious", description: "pico de uma ou duas horas, sem subida nem cauda", build: pulseWithoutDecay },
  { name: "disguised_buy", label: "suspicious", description: "compra que imita a forma orgânica (sobe devagar, desce gradual)", build: disguisedBuy },
  { name: "noisy_bought_plateau", label: "suspicious", description: "patamar comprado com ruído parecido com o natural", build: boughtPlateauWith([0.03, 0.08]) },
];
