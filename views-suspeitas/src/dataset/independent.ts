import { classify } from "../domain/classify.ts";
import { evaluate, type Metrics, type Verdict } from "./evaluate.ts";
import { type Case } from "./generate.ts";
import { formatCount } from "./intervals.ts";
import { createRng, deriveSeed, type Rng } from "./rng.ts";

/**
 * Avaliação INDEPENDENTE: só conteúdo orgânico, em formas que o gerador canônico (`families.ts`) não produz, escritas com outro
 * modelo de queda e de ruído. Serve para ver se o resultado depende demais das formas do próprio gerador. Regras do experimento:
 * os critérios do classificador ficam como estão, nada é recalibrado contra este conjunto, falso positivo zero não é exigido, e
 * cada caso problemático (acusado ou inconclusivo) é preservado com a série e o motivo em `data/independent-problems.json`.
 * Continua sendo dado sintético, escrito por quem escreveu o classificador: reduz o viés, não o elimina.
 */
export const INDEPENDENT_SEED = 27_182_818;
export const CASES_PER_INDEPENDENT_FAMILY = 40;

export type IndependentCase = Case;

type Builder = (rng: Rng) => number[];

/** Onda triangular de dia e noite, de −1 a 1: sem funções transcendentes. */
const wave = (hour: number) => 1 - 4 * Math.abs((hour % 24) / 24 - 0.5);

/** Média esperada → contagem inteira, com ruído de audiência e ruído de contagem. */
const count = (rng: Rng, mean: number, relative: number) => Math.max(0, Math.round(mean * (1 + relative * rng.normal()) + Math.sqrt(Math.max(mean, 0)) * rng.normal()));

const base = (level: number, hour: number, depth: number) => level * (1 + depth * wave(hour));

/** Conteúdo que já nasce no pico e cai por uma lei de potência (1/(1+t/τ)^p), sem rampa de subida. */
const startsAtPeak: Builder = (rng) => {
  const hours = 24 * rng.int(5, 12);
  const level = rng.int(100, 3000);
  const amplitude = rng.between(8, 40);
  const tau = rng.between(2, 10);
  const squared = rng.chance(0.5);
  const noise = rng.between(0.05, 0.12);
  return Array.from({ length: hours }, (_, t) => {
    const d = 1 + t / tau;
    return count(rng, base(level, t, 0.2) + (level * amplitude) / (squared ? d * d : d), noise);
  });
};

/** Horas de zero antes da publicação e, depois, tráfego normal (às vezes com um pico de lançamento de queda hiperbólica). */
const zerosBeforePublication: Builder = (rng) => {
  const zeros = rng.int(24, 96);
  const hours = zeros + 24 * rng.int(5, 10);
  const level = rng.int(100, 3000);
  const noise = rng.between(0.05, 0.12);
  const launch = rng.chance(0.5);
  const amplitude = rng.between(5, 20);
  const tau = rng.between(3, 8);
  return Array.from({ length: hours }, (_, h) => {
    if (h < zeros) return 0;
    const t = h - zeros;
    const spike = launch ? (level * amplitude) / (1 + t / tau) : 0;
    return count(rng, base(level, h, 0.25) + spike, noise);
  });
};

/** Rampa de 1 a 2 horas até o pico e queda linear até a base em 6 a 30 horas (queda triangular, não geométrica). */
const shortRamp: Builder = (rng) => {
  const hours = 24 * rng.int(5, 12);
  const level = rng.int(100, 3000);
  const noise = rng.between(0.05, 0.12);
  const start = rng.int(24, 72);
  const ramp = rng.int(1, 2);
  const peak = level * rng.between(8, 30);
  const fall = rng.int(6, 30);
  return Array.from({ length: hours }, (_, h) => {
    let extra = 0;
    if (h >= start && h < start + ramp) extra = (peak * (h - start + 1)) / ramp;
    else if (h >= start + ramp && h < start + ramp + fall) extra = peak * (1 - (h - start - ramp) / fall);
    return count(rng, base(level, h, 0.25) + extra, noise);
  });
};

/** Cauda lorentziana (1/(1+((t−t0)/τ)²)) depois de uma subida de 3 horas: outro modelo de queda, mais lenta no topo e longa no fim. */
const otherTailModel: Builder = (rng) => {
  const hours = 24 * rng.int(6, 14);
  const level = rng.int(100, 3000);
  const noise = rng.between(0.05, 0.12);
  const peakHour = rng.int(30, 60);
  const amplitude = rng.between(6, 30);
  const tau = rng.between(3, 12);
  return Array.from({ length: hours }, (_, h) => {
    let extra = 0;
    if (h >= peakHour - 3 && h < peakHour) extra = (level * amplitude * (h - (peakHour - 3) + 1)) / 4;
    else if (h >= peakHour) {
      const x = (h - peakHour) / tau;
      extra = (level * amplitude) / (1 + x * x);
    }
    return count(rng, base(level, h, 0.25) + extra, noise);
  });
};

export const INDEPENDENT_FAMILIES: ReadonlyArray<{ name: string; description: string; build: Builder }> = [
  { name: "starts_at_peak", description: "já nasce no pico e cai por lei de potência", build: startsAtPeak },
  { name: "zeros_before_publication", description: "zeros antes da publicação e, depois, tráfego normal ou lançamento", build: zerosBeforePublication },
  { name: "short_ramp", description: "rampa de 1 a 2 horas e queda linear", build: shortRamp },
  { name: "other_tail_model", description: "cauda lorentziana depois de uma subida curta", build: otherTailModel },
];

export function generateIndependent(options: { seed?: number; perFamily?: number } = {}): IndependentCase[] {
  const seed = options.seed ?? INDEPENDENT_SEED;
  const perFamily = options.perFamily ?? CASES_PER_INDEPENDENT_FAMILY;
  const out: IndependentCase[] = [];
  INDEPENDENT_FAMILIES.forEach((family, f) => {
    for (let i = 0; i < perFamily; i += 1) {
      const series = family.build(createRng(deriveSeed(seed, f, i)));
      out.push({ id: `indep-${family.name}-${String(i + 1).padStart(2, "0")}`, family: family.name, label: "legit", split: "dev", hours: series.length, series });
    }
  });
  return out;
}

export type Problem = { id: string; family: string; verdict: "suspicious" | "inconclusive"; signals: string[]; reason: string; series: number[] };
export type IndependentReport = {
  overall: Metrics;
  families: Record<string, { total: number; organic: number; inconclusive: number; suspicious: number }>;
  problems: Problem[];
};

export function evaluateIndependent(cases: IndependentCase[]): IndependentReport {
  const results = new Map(cases.map((c) => [c.id, classify(c.series)]));
  const verdictOf = (_series: number[], id: string): Verdict => results.get(id)!.classification;
  const { overall, families } = evaluate(cases, verdictOf);
  const problems: Problem[] = [];
  for (const c of cases) {
    const result = results.get(c.id)!;
    if (result.classification === "organic") continue;
    problems.push({ id: c.id, family: c.family, verdict: result.classification, signals: result.signals.map((s) => s.name), reason: result.reason, series: c.series });
  }
  return { overall, families: Object.fromEntries(Object.entries(families).map(([name, f]) => [name, { total: f.total, organic: f.organic, inconclusive: f.inconclusive, suspicious: f.suspicious }])), problems };
}

/** Arquivo versionado com cada caso problemático (série, sinais e motivo): evidência preservada, não descartada. */
export const problemsFile = (report: IndependentReport): string => `${JSON.stringify(report.problems, null, 1)}\n`;

const START = "<!-- independent:start -->";
const END = "<!-- independent:end -->";
const REGION = /<!-- independent:start -->[\s\S]*?<!-- independent:end -->/;
const row = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`;

export function renderIndependent(report: IndependentReport): string {
  const line = (name: string, f: { total: number; organic: number; inconclusive: number; suspicious: number }) =>
    row([name, f.total, f.organic, f.inconclusive, formatCount(f.suspicious, f.total), formatCount(f.inconclusive, f.total)]);
  const total = { total: report.overall.legit_total, organic: report.overall.legit_total - report.overall.false_positive - report.overall.legit_inconclusive, inconclusive: report.overall.legit_inconclusive, suspicious: report.overall.false_positive };
  return [
    row(["Família", "Casos", "Orgânico", "Inconclusivo", "Acusado (falso positivo)", "Abstenção"]),
    row(["---", "---:", "---:", "---:", "---:", "---:"]),
    ...Object.entries(report.families).map(([name, f]) => line(name, f)),
    line("total", total),
  ].join("\n");
}

const regionOf = (report: IndependentReport) => `${START}\n${renderIndependent(report)}\n${END}`;

export const applyIndependent = (readme: string, report: IndependentReport): string => readme.replace(REGION, () => regionOf(report));

export function checkIndependent(readme: string, report: IndependentReport): string[] {
  const found = readme.match(REGION);
  if (!found) return [`faltam os marcadores ${START} e ${END} da tabela da avaliação independente`];
  return found[0] === regionOf(report) ? [] : ["a tabela da avaliação independente do README difere da medida: rode npm run dataset"];
}
