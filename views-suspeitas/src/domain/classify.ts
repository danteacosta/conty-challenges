import { CRITERIA_VERSION, THRESHOLDS as T } from "./criteria.ts";
import { type Peak, type Signal, type Effect, findPeaks, findPlateauCliff, findRepetition, findStep, fmt, pct } from "./signals.ts";
import { baselineOf, median, stdDev } from "./stats.ts";

export type Classification = "organic" | "suspicious" | "inconclusive";

export type ClassifyResult = {
  classification: Classification;
  criteria_version: number;
  reason: string;
  signals: Signal[];
  summary: { hours: number; baseline_per_hour: number; peak: { hour: number; value: number } };
};

type Finding = { signal: Signal; sentence: string };

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
/** Número com vírgula decimal, para os textos de `detail` e `reason`. */
const num = (n: number, digits = 1) => n.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const hoursRange = (from: number, to: number) => (from === to ? `na hora ${from}` : `nas horas ${from} a ${to}`);

/** Classifica uma série de views por hora. Determinístico e sem estado: a mesma série dá sempre o mesmo resultado. */
export function classify(series: number[]): ClassifyResult {
  const baseline = baselineOf(series);
  const findings: Finding[] = [];
  const claimed: Array<[number, number]> = [];
  const overlaps = (from: number, to: number) => claimed.some(([a, b]) => from <= b && to >= a);
  const add = (finding: Finding, claim = false) => {
    findings.push(finding);
    if (claim) claimed.push([finding.signal.from_hour, finding.signal.to_hour]);
  };

  const repetition = repetitionFinding(series);
  if (repetition) add(repetition, true);

  const enoughContext = series.length >= T.min_hours_for_context;
  const typical = median(series);
  const lowVolume = enoughContext && typical < T.low_volume_median;

  if (!enoughContext) add(shortSeriesFinding(series.length));
  if (lowVolume) add(lowVolumeFinding(typical, series.length));

  if (enoughContext && !lowVolume) {
    const plateau = plateauFinding(series, baseline);
    if (plateau && !overlaps(plateau.signal.from_hour, plateau.signal.to_hour)) add(plateau, true);
  }
  if (enoughContext) {
    for (const peak of findPeaks(series, baseline)) {
      if (lowVolume && peak.kind !== "pulse") continue;
      if (overlaps(peak.from, peak.to)) continue;
      add(peakFinding(peak, baseline), peak.kind !== "organic_decay");
    }
  }
  if (enoughContext && !lowVolume) {
    const step = findStep(series);
    if (step && !overlaps(step.from, step.from)) add(stepFinding(step));
  }

  findings.sort((a, b) => rank(a.signal.effect) - rank(b.signal.effect) || a.signal.from_hour - b.signal.from_hour);
  const signals = findings.map((f) => f.signal);
  const suspicious = findings.filter((f) => f.signal.effect === "suspicious");
  const weak = findings.filter((f) => f.signal.effect === "weak");

  const summary = { hours: series.length, baseline_per_hour: round(typical, 1), peak: peakOf(series) };
  const base = { criteria_version: CRITERIA_VERSION, signals, summary };

  if (suspicious.length > 0) return { ...base, classification: "suspicious", reason: `Suspeito: ${joinSentences(suspicious)}` };
  if (weak.length > 0) return { ...base, classification: "inconclusive", reason: `Inconclusivo: ${joinSentences(weak)}` };
  if (findings.length > 0) return { ...base, classification: "organic", reason: `Orgânico: ${joinSentences(findings)} Não encontramos nenhum sinal de compra ou de repetição mecânica.` };
  return {
    ...base,
    classification: "organic",
    reason: `Orgânico: sem nenhum sinal de repetição mecânica, de patamar fixo com queda seca ou de pulso sem cauda nas ${series.length} horas analisadas (base de cerca de ${fmt(typical)} views por hora).`,
  };
}

const rank = (effect: Effect) => ({ suspicious: 0, weak: 1, organic: 2 })[effect];
const joinSentences = (findings: Finding[]) => findings.slice(0, T.reason_max_sentences).map((f) => f.sentence).join(" ");

function peakOf(series: number[]): { hour: number; value: number } {
  let hour = 0;
  for (let h = 1; h < series.length; h += 1) if (series[h]! > series[hour]!) hour = h;
  return { hour, value: series[hour]! };
}

// ---------- achados: cada um vira um sinal estruturado e uma frase legível

function repetitionFinding(series: number[]): Finding | undefined {
  const found = findRepetition(series);
  if (!found) return undefined;
  const hours = found.to - found.from + 1;
  const where = `horas ${found.from} a ${found.to}`;
  const make = (measured: number, threshold: number, detail: string, sentence: string): Finding => ({
    signal: { name: "mechanical_repetition", effect: "suspicious", measured, threshold, from_hour: found.from, to_hour: found.to, detail },
    sentence,
  });
  const why = "Contagem de pessoas oscila por acaso; repetir o mesmo número, a mesma progressão ou o mesmo ciclo exato não é comportamento de gente.";
  if (found.kind === "identical") {
    return make(hours, T.repetition_min_run, `${hours} horas com exatamente ${fmt(found.value!)} views (mínimo ${T.repetition_min_run} horas)`, `${hours} horas seguidas (${where}) com contagens idênticas: exatamente ${fmt(found.value!)} views em cada uma. ${why}`);
  }
  if (found.kind === "progression") {
    const step = `${found.step! > 0 ? "+" : "-"}${fmt(Math.abs(found.step!))}`;
    return make(hours, T.progression_min_run, `${hours} horas variando exatamente ${step} por hora (mínimo ${T.progression_min_run} horas)`, `${hours} horas seguidas (${where}) crescendo ou caindo sempre exatamente ${step} views por hora. ${why}`);
  }
  return make(found.repeats!, T.cycle_min_repeats, `ciclo de ${found.period} horas repetido ${found.repeats} vezes (mínimo ${T.cycle_min_repeats})`, `um ciclo de ${found.period} horas se repete ${found.repeats} vezes exatamente igual (${where}). ${why}`);
}

function plateauFinding(series: number[], baseline: number): Finding | undefined {
  const plateau = findPlateauCliff(series, baseline);
  if (!plateau) return undefined;
  const hours = plateau.to - plateau.from + 1;
  const suspicious = plateau.regularity < T.plateau_regularity_suspicious;
  const level = fmt(plateau.mean);
  const std = stdDev(series.slice(plateau.from, plateau.to + 1));
  const observed = pct(std / plateau.mean);
  const byChance = pct(1 / Math.sqrt(plateau.mean));
  const cliff = `queda seca de ${pct(plateau.cliffDrop, 0)}% na hora ${plateau.cliffHour}`;
  const detail = `${hours} horas em ~${level} views por hora (${num(plateau.mean / baseline)}× a base); regularidade ${num(plateau.regularity, 2)} contra limiar ${num(T.plateau_regularity_suspicious)} (menor = mais regular que o acaso)`;
  const signal = (effect: Effect): Signal => ({ name: "plateau_then_cliff", effect, measured: round(plateau.regularity, 3), threshold: T.plateau_regularity_suspicious, from_hour: plateau.from, to_hour: plateau.to, detail });
  if (suspicious) {
    return {
      signal: signal("suspicious"),
      sentence: `${hours} horas seguidas (horas ${plateau.from} a ${plateau.to}) com contagens quase fixas em torno de ${level} views por hora (desvio de ${observed}% entre as horas, só ${num(plateau.regularity)}× os ${byChance}% que o acaso da contagem sozinho já produz; tráfego real passa de ${num(T.plateau_regularity_suspicious)}×) e, logo depois, ${cliff}. Tráfego real varia mais que isso, e uma compra entregue a ritmo constante e interrompida tem exatamente este formato.`,
    };
  }
  return {
    signal: signal("weak"),
    sentence: `${hours} horas (horas ${plateau.from} a ${plateau.to}) num patamar em torno de ${level} views por hora, seguido de ${cliff}. A variação entre as horas (${observed}%) é de tráfego real, então isso também é o que uma transmissão ao vivo que terminou ou um destaque que saiu da página inicial produzem; o padrão não é suficiente para acusar.`,
  };
}

function peakFinding(peak: Peak, baseline: number): Finding {
  const lift = peak.peak / baseline;
  const where = hoursRange(peak.from, peak.to);
  if (peak.kind === "pulse") {
    const tail = peak.from === peak.to ? "na hora seguinte" : "logo depois do pico";
    return {
      signal: { name: "pulse_without_decay", effect: "suspicious", measured: round(lift, 1), threshold: T.pulse_min_lift, from_hour: peak.from, to_hour: peak.to, detail: `pico de ${fmt(peak.peak)} views, ${num(lift)}× a base, ocupando ${peak.to - peak.from + 1} hora(s) acima da cauda (limite de ${T.pulse_max_hours})` },
      sentence: `pico de ${fmt(peak.peak)} views ${where}, ${fmt(lift)}× a base de cerca de ${fmt(baseline)} por hora, sem cauda: ${tail} a série volta à base. Pico orgânico sobe por algumas horas e desce com cauda gradual; um pulso que aparece e some de uma vez é o formato de uma entrega comprada.`,
    };
  }
  if (peak.kind === "abrupt_drop") {
    const drop = 1 - peak.dropTo! / peak.endValue;
    return {
      signal: { name: "abrupt_drop", effect: "weak", measured: round(drop, 2), threshold: T.drop_fraction, from_hour: peak.from, to_hour: peak.to, detail: `nível alto por ${peak.to - peak.from + 1} horas e queda de ${pct(drop, 0)}% numa hora só` },
      sentence: `a série ficou alta e irregular por ${peak.to - peak.from + 1} horas (${hoursRange(peak.from, peak.to)}, pico de ${fmt(peak.peak)}) e despencou de uma vez na hora ${peak.to + 1}. Isso pode ser conteúdo cortado ou removido pela plataforma, ou uma entrega interrompida; o padrão não é suficiente para acusar.`,
    };
  }
  return {
    signal: { name: "organic_decay", effect: "organic", measured: peak.tail, threshold: T.organic_min_tail_hours, from_hour: peak.from, to_hour: peak.to, detail: `pico de ${fmt(peak.peak)} (${num(lift)}× a base), subida em ${peak.ramp} horas e ${peak.tail} horas de queda gradual` },
    sentence: `pico de ${fmt(peak.peak)} views na hora ${peak.peakHour} (${fmt(lift)}× a base), com subida em ${peak.ramp + 1} horas e cauda de ${peak.tail} horas de queda gradual, sem degraus. É o formato de um vídeo que pega tração e esfria aos poucos.`,
  };
}

function stepFinding(step: { from: number; before: number; after: number }): Finding {
  const ratio = step.after / Math.max(step.before, 1);
  return {
    signal: { name: "step_without_return", effect: "weak", measured: round(ratio, 1), threshold: T.step_min_lift, from_hour: step.from, to_hour: step.from, detail: `nível de ~${fmt(step.before)} para ~${fmt(step.after)} por hora a partir da hora ${step.from}, sem voltar` },
    sentence: `o nível subiu de cerca de ${fmt(step.before)} para cerca de ${fmt(step.after)} views por hora na hora ${step.from} e ficou ali, com variação normal. Pode ser uma incorporação (embed) em um site grande ou um destaque permanente; o padrão não é suficiente para acusar.`,
  };
}

function lowVolumeFinding(typical: number, hours: number): Finding {
  return {
    signal: { name: "low_volume", effect: "weak", measured: round(typical, 1), threshold: T.low_volume_median, from_hour: 0, to_hour: hours - 1, detail: `mediana de ${num(typical)} views por hora, abaixo de ${T.low_volume_median}` },
    sentence: `volume baixo demais (mediana de ${fmt(typical)} views por hora, abaixo de ${T.low_volume_median}): com contagens tão pequenas qualquer padrão pode ser acaso, então esta série não permite concluir nada. Só repetição mecânica ou um pulso enorme seriam acusados.`,
  };
}

function shortSeriesFinding(hours: number): Finding {
  return {
    signal: { name: "short_series", effect: "weak", measured: hours, threshold: T.min_hours_for_context, from_hour: 0, to_hour: hours - 1, detail: `${hours} horas de dados, menos que as ${T.min_hours_for_context} necessárias para ter uma base de comparação` },
    sentence: `só ${hours} horas de dados (menos de ${T.min_hours_for_context}): sem uma base de comparação, só repetição mecânica evidente pode ser acusada, e ela não apareceu.`,
  };
}
