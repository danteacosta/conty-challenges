import { beforeAll, describe, expect, it } from "vitest";
import type { Case } from "../src/dataset/generate.ts";
import { evaluate, type Report, type Verdict } from "../src/dataset/evaluate.ts";

const make = (id: string, family: string, label: Case["label"], split: Case["split"]): Case => ({ id, family, label, split, hours: 24, series: Array.from({ length: 24 }, () => 1) });

describe("avaliação do classificador contra os rótulos", () => {
  // O classificador de mentira devolve o que o id manda: assim a conta é conferida à mão.
  const scripted = (answers: Record<string, Verdict>) => (series: number[], id: string) => answers[id]!;
  const cases: Case[] = [
    make("l1", "steady", "legit", "holdout"),
    make("l2", "steady", "legit", "holdout"),
    make("l3", "live", "legit", "holdout"),
    make("l4", "live", "legit", "holdout"),
    make("l5", "steady", "legit", "dev"),
    make("s1", "buy", "suspicious", "holdout"),
    make("s2", "buy", "suspicious", "holdout"),
    make("s3", "disguised", "suspicious", "holdout"),
    make("s4", "disguised", "suspicious", "holdout"),
    make("s5", "buy", "suspicious", "dev"),
  ];
  const answers: Record<string, Verdict> = {
    l1: "organic", l2: "organic", l3: "inconclusive", l4: "suspicious", l5: "organic",
    s1: "suspicious", s2: "suspicious", s3: "inconclusive", s4: "organic", s5: "suspicious",
  };
  let report: Report;
  beforeAll(() => {
    report = evaluate(cases, scripted(answers));
  });

  it("taxa de falso positivo: legítimos acusados / legítimos", () => {
    expect(report.holdout).toMatchObject({ legit_total: 4, false_positive: 1, false_positive_rate: 0.25 });
    expect(report.dev).toMatchObject({ legit_total: 1, false_positive: 0, false_positive_rate: 0 });
    expect(report.overall).toMatchObject({ legit_total: 5, false_positive: 1, false_positive_rate: 0.2 });
  });

  it("abstenção entre os legítimos, que não conta como falso positivo", () => {
    expect(report.holdout).toMatchObject({ legit_inconclusive: 1, legit_inconclusive_rate: 0.25 });
  });

  it("recall: suspeitos acusados / suspeitos, com o que escapou e o que ficou inconclusivo", () => {
    expect(report.holdout).toMatchObject({ suspicious_total: 4, detected: 2, recall: 0.5, suspicious_inconclusive: 1, suspicious_missed: 1 });
    expect(report.overall).toMatchObject({ suspicious_total: 5, detected: 3, recall: 0.6 });
  });

  it("o relatório por família mostra onde o classificador acerta e erra", () => {
    expect(report.families.live).toEqual({ label: "legit", total: 2, organic: 0, inconclusive: 1, suspicious: 1 });
    expect(report.families.disguised).toEqual({ label: "suspicious", total: 2, organic: 1, inconclusive: 1, suspicious: 0 });
    expect(report.families.buy).toEqual({ label: "suspicious", total: 3, organic: 0, inconclusive: 0, suspicious: 3 });
  });

  it("sem legítimos (ou sem suspeitos) não divide por zero: a taxa é 0", () => {
    const only = evaluate([make("s1", "buy", "suspicious", "dev")], () => "suspicious");
    expect(only.dev.false_positive_rate).toBe(0);
    expect(only.dev.legit_inconclusive_rate).toBe(0);
    const none = evaluate([make("l1", "steady", "legit", "dev")], () => "organic");
    expect(none.dev.recall).toBe(0);
  });

  it("abster-se em tudo daria falso positivo zero, mas recall zero: as duas taxas andam juntas no relatório", () => {
    const timid = evaluate(cases, () => "inconclusive");
    expect(timid.overall.false_positive_rate).toBe(0);
    expect(timid.overall.recall).toBe(0);
    expect(timid.overall.legit_inconclusive_rate).toBe(1);
  });
});
