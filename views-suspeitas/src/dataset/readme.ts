import type { Metrics, Report } from "./evaluate.ts";

const START = "<!-- metrics:start -->";
const END = "<!-- metrics:end -->";
const REGION = /<!-- metrics:start -->[\s\S]*?<!-- metrics:end -->/;

/** 0,045 vira "4,5%": vírgula decimal e uma casa, como no README. */
export const formatPercent = (fraction: number): string => `${(fraction * 100).toFixed(1).replace(".", ",")}%`;

/** Os números citados no texto do README, cada um preso a um marcador `<!--m:nome-->valor<!--/m-->`. */
export function inlineMetrics(report: Report): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of ["dev", "holdout", "overall"] as const) {
    const m = report[part];
    out[`${part}_fpr`] = formatPercent(m.false_positive_rate);
    out[`${part}_abstain`] = formatPercent(m.legit_inconclusive_rate);
    out[`${part}_recall`] = formatPercent(m.recall);
  }
  const h = report.holdout;
  out.holdout_fp = String(h.false_positive);
  out.holdout_legit = String(h.legit_total);
  out.holdout_detected = String(h.detected);
  out.holdout_suspicious = String(h.suspicious_total);
  out.holdout_susp_inconclusive = String(h.suspicious_inconclusive);
  out.holdout_susp_missed = String(h.suspicious_missed);
  return out;
}

const row = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`;
const metricsRow = (name: string, m: Metrics) =>
  row([name, m.legit_total, `${m.false_positive} (${formatPercent(m.false_positive_rate)})`, `${m.legit_inconclusive} (${formatPercent(m.legit_inconclusive_rate)})`, m.suspicious_total, `${m.detected} (${formatPercent(m.recall)})`, `${m.suspicious_inconclusive}`, `${m.suspicious_missed}`]);

/** As duas tabelas do README: por parte do dataset e por família. */
export function renderMetricsTable(report: Report): string {
  const parts = [
    row(["Parte", "Legítimos", "Falsos positivos (FPR)", "Abstenções em legítimos", "Suspeitos", "Acusados (recall)", "Suspeitos inconclusivos", "Suspeitos tidos como orgânicos"]),
    row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]),
    metricsRow("dev (limiares ajustados aqui)", report.dev),
    metricsRow("holdout (número a citar)", report.holdout),
    metricsRow("total", report.overall),
    "",
    row(["Família", "Rótulo", "Casos", "Orgânico", "Inconclusivo", "Suspeito"]),
    row(["---", "---", "---:", "---:", "---:", "---:"]),
    ...Object.entries(report.families).map(([name, f]) => row([name, f.label === "legit" ? "legítimo" : "suspeito", f.total, f.organic, f.inconclusive, f.suspicious])),
  ];
  return parts.join("\n");
}

const regionOf = (report: Report) => `${START}\n${renderMetricsTable(report)}\n${END}`;
const markerPattern = (name: string) => new RegExp(`<!--m:${name}-->([^<]*)<!--/m-->`, "g");

/** Reescreve só a região da tabela e os números marcados; o resto do texto fica como está. */
export function applyToReadme(readme: string, report: Report): string {
  let out = readme.replace(REGION, () => regionOf(report));
  for (const [name, value] of Object.entries(inlineMetrics(report))) out = out.replace(markerPattern(name), () => `<!--m:${name}-->${value}<!--/m-->`);
  return out;
}

/** Compara o README com o relatório medido. Lista vazia = em dia. Cada divergência diz qual número e quais valores. */
export function checkReadme(readme: string, report: Report): string[] {
  const problems: string[] = [];
  const region = readme.match(REGION);
  if (!region) problems.push(`faltam os marcadores ${START} e ${END} da tabela de métricas`);
  else if (region[0] !== regionOf(report)) problems.push("a tabela de métricas do README difere da medida: rode npm run dataset");
  for (const [name, expected] of Object.entries(inlineMetrics(report))) {
    const found = [...readme.matchAll(markerPattern(name))];
    if (found.length === 0) problems.push(`falta o marcador <!--m:${name}--> no README`);
    for (const match of found) if (match[1] !== expected) problems.push(`o número ${name} no README é ${match[1]}, mas o dataset mede ${expected}`);
  }
  return problems;
}
