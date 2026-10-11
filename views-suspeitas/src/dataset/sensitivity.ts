import { classify } from "../domain/classify.ts";
import { evaluate, type Metrics, type Verdict } from "./evaluate.ts";
import { FAMILIES, type FamilyLabel } from "./families.ts";
import { type Case } from "./generate.ts";
import { createRng, deriveSeed } from "./rng.ts";
import { formatPercent } from "./readme.ts";

/**
 * Sensibilidade por volume e duração. É um experimento À PARTE do dev/holdout: usa outra semente e não serviu para ajustar
 * nenhum limiar. Cada combinação de volume típico × duração é gerada com todas as famílias (menos `low_volume`, cujo volume é o
 * próprio ponto) e o classificador é medido por faixa. Continua sendo o dataset sintético, não tráfego real.
 */
export const SENSITIVITY_SEED = 31_415_926;
export const CASES_PER_CELL = 4;

export const VOLUMES = [
  { name: "muito baixo (~10/h)", level: 10 },
  { name: "baixo (~100/h)", level: 100 },
  { name: "médio (~500/h)", level: 500 },
  { name: "alto (~2.000/h)", level: 2000 },
  { name: "muito alto (~10.000/h)", level: 10_000 },
] as const;

export const DURATIONS = [
  { name: "3 dias (72 h)", hours: 72 },
  { name: "7 dias (168 h)", hours: 168 },
  { name: "30 dias (720 h)", hours: 720 },
  { name: "60 dias (1.440 h)", hours: 1440 },
] as const;

export const SENSITIVITY_FAMILIES = FAMILIES.filter((f) => f.name !== "low_volume");

export type SensitivityCase = { id: string; family: string; label: FamilyLabel; volume: string; duration: string; level: number; hours: number; series: number[] };

export function generateSensitivity(options: { seed?: number; perCell?: number } = {}): SensitivityCase[] {
  const seed = options.seed ?? SENSITIVITY_SEED;
  const perCell = options.perCell ?? CASES_PER_CELL;
  const out: SensitivityCase[] = [];
  VOLUMES.forEach((volume, v) => {
    DURATIONS.forEach((duration, d) => {
      SENSITIVITY_FAMILIES.forEach((family, f) => {
        for (let index = 0; index < perCell; index += 1) {
          const rng = createRng(deriveSeed(seed, (v * DURATIONS.length + d) * SENSITIVITY_FAMILIES.length + f, index));
          const series = family.build(rng, { level: volume.level, hours: duration.hours });
          out.push({ id: `sens-${v}-${d}-${family.name}-${index + 1}`, family: family.name, label: family.label, volume: volume.name, duration: duration.name, level: volume.level, hours: duration.hours, series });
        }
      });
    });
  });
  return out;
}

export type SensitivityReport = {
  overall: Metrics;
  byVolume: Record<string, Metrics>;
  byDuration: Record<string, Metrics>;
  cells: Array<{ volume: string; duration: string; metrics: Metrics }>;
};

const asCases = (items: SensitivityCase[]): Case[] => items.map((c) => ({ id: c.id, family: c.family, label: c.label, split: "dev", hours: c.hours, series: c.series }));
const metricsFor = (items: SensitivityCase[], fn: (series: number[], id: string) => Verdict) => evaluate(asCases(items), fn).overall;

export function evaluateSensitivity(items: SensitivityCase[], classifyFn: (series: number[], id: string) => Verdict = (series) => classify(series).classification): SensitivityReport {
  const byVolume: Record<string, Metrics> = {};
  const byDuration: Record<string, Metrics> = {};
  for (const volume of VOLUMES) byVolume[volume.name] = metricsFor(items.filter((c) => c.volume === volume.name), classifyFn);
  for (const duration of DURATIONS) byDuration[duration.name] = metricsFor(items.filter((c) => c.duration === duration.name), classifyFn);
  const cells = VOLUMES.flatMap((volume) =>
    DURATIONS.map((duration) => ({ volume: volume.name, duration: duration.name, metrics: metricsFor(items.filter((c) => c.volume === volume.name && c.duration === duration.name), classifyFn) })),
  );
  return { overall: metricsFor(items, classifyFn), byVolume, byDuration, cells };
}

const START = "<!-- sensitivity:start -->";
const END = "<!-- sensitivity:end -->";
const REGION = /<!-- sensitivity:start -->[\s\S]*?<!-- sensitivity:end -->/;

const row = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`;
const cell = (m: Metrics) => [
  m.legit_total,
  `${m.false_positive} (${formatPercent(m.false_positive_rate)})`,
  formatPercent(m.legit_inconclusive_rate),
  m.suspicious_total,
  formatPercent(m.recall),
];
const HEADER = ["Legítimos", "Falsos positivos (FPR)", "Abstenção em legítimos", "Suspeitos", "Recall"];

export function renderSensitivity(report: SensitivityReport): string {
  const sections = [
    row(["Volume típico", ...HEADER]),
    row(["---", "---:", "---:", "---:", "---:", "---:"]),
    ...Object.entries(report.byVolume).map(([name, m]) => row([name, ...cell(m)])),
    "",
    row(["Duração da série", ...HEADER]),
    row(["---", "---:", "---:", "---:", "---:", "---:"]),
    ...Object.entries(report.byDuration).map(([name, m]) => row([name, ...cell(m)])),
    "",
    row(["Volume × duração", ...HEADER]),
    row(["---", "---:", "---:", "---:", "---:", "---:"]),
    ...report.cells.map((c) => row([`${c.volume} × ${c.duration}`, ...cell(c.metrics)])),
  ];
  return sections.join("\n");
}

const regionOf = (report: SensitivityReport) => `${START}\n${renderSensitivity(report)}\n${END}`;

export function applySensitivity(readme: string, report: SensitivityReport): string {
  return readme.replace(REGION, () => regionOf(report));
}

export function checkSensitivity(readme: string, report: SensitivityReport): string[] {
  const found = readme.match(REGION);
  if (!found) return [`faltam os marcadores ${START} e ${END} da tabela de sensibilidade`];
  return found[0] === regionOf(report) ? [] : ["a tabela de sensibilidade do README difere da medida: rode npm run dataset"];
}
