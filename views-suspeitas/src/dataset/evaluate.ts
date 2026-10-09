import { type Classification, classify } from "../domain/classify.ts";
import type { Case } from "./generate.ts";

export type Verdict = Classification;

export type Metrics = {
  legit_total: number;
  false_positive: number;
  false_positive_rate: number;
  legit_inconclusive: number;
  legit_inconclusive_rate: number;
  suspicious_total: number;
  detected: number;
  recall: number;
  suspicious_inconclusive: number;
  suspicious_missed: number;
};

export type FamilyCounts = { label: Case["label"]; total: number; organic: number; inconclusive: number; suspicious: number };
export type Report = { overall: Metrics; dev: Metrics; holdout: Metrics; families: Record<string, FamilyCounts> };

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

function metricsOf(answers: Array<{ case: Case; verdict: Verdict }>): Metrics {
  const legit = answers.filter((a) => a.case.label === "legit");
  const suspicious = answers.filter((a) => a.case.label === "suspicious");
  const count = (list: typeof answers, verdict: Verdict) => list.filter((a) => a.verdict === verdict).length;
  return {
    legit_total: legit.length,
    false_positive: count(legit, "suspicious"),
    false_positive_rate: ratio(count(legit, "suspicious"), legit.length),
    legit_inconclusive: count(legit, "inconclusive"),
    legit_inconclusive_rate: ratio(count(legit, "inconclusive"), legit.length),
    suspicious_total: suspicious.length,
    detected: count(suspicious, "suspicious"),
    recall: ratio(count(suspicious, "suspicious"), suspicious.length),
    suspicious_inconclusive: count(suspicious, "inconclusive"),
    suspicious_missed: count(suspicious, "organic"),
  };
}

/**
 * Mede o classificador contra os rótulos. Falso positivo é legítimo acusado; abster-se (inconclusivo) NÃO conta como falso
 * positivo, por isso a taxa de abstenção e o recall saem sempre juntos: abster-se em tudo daria FPR zero e recall zero.
 */
export function evaluate(cases: Case[], classifyFn: (series: number[], id: string) => Verdict = (series) => classify(series).classification): Report {
  const answers = cases.map((c) => ({ case: c, verdict: classifyFn(c.series, c.id) }));
  const families: Record<string, FamilyCounts> = {};
  for (const { case: c, verdict } of answers) {
    const entry = (families[c.family] ??= { label: c.label, total: 0, organic: 0, inconclusive: 0, suspicious: 0 });
    entry.total += 1;
    entry[verdict] += 1;
  }
  return {
    overall: metricsOf(answers),
    dev: metricsOf(answers.filter((a) => a.case.split === "dev")),
    holdout: metricsOf(answers.filter((a) => a.case.split === "holdout")),
    families,
  };
}
