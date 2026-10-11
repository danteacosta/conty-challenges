import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEEDS } from "../src/dataset/generate.ts";
import {
  CASES_PER_INDEPENDENT_FAMILY,
  INDEPENDENT_FAMILIES,
  INDEPENDENT_SEED,
  applyIndependent,
  checkIndependent,
  evaluateIndependent,
  generateIndependent,
  problemsFile,
  renderIndependent,
} from "../src/dataset/independent.ts";
import { SENSITIVITY_SEED } from "../src/dataset/sensitivity.ts";

const cases = generateIndependent();
const report = evaluateIndependent(cases);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("avaliação independente: conteúdo orgânico fora do gerador canônico", () => {
  it("usa semente própria e não importa as famílias do gerador canônico", () => {
    expect(new Set([INDEPENDENT_SEED, SEEDS.dev, SEEDS.holdout, SENSITIVITY_SEED]).size).toBe(4);
    const source = readFileSync(new URL("../src/dataset/independent.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from "\.\/families\.ts"/);
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date\(|performance\.now/);
  });

  it("é determinístico e a semente muda o resultado", () => {
    expect(generateIndependent()).toEqual(cases);
    expect(generateIndependent({ seed: INDEPENDENT_SEED + 1 })).not.toEqual(cases);
  });

  it("cobre as quatro formas pedidas, todas legítimas, com séries válidas", () => {
    expect(INDEPENDENT_FAMILIES.map((f) => f.name)).toEqual(["starts_at_peak", "zeros_before_publication", "short_ramp", "other_tail_model"]);
    expect(cases).toHaveLength(INDEPENDENT_FAMILIES.length * CASES_PER_INDEPENDENT_FAMILY);
    for (const c of cases) {
      expect(c.label).toBe("legit");
      expect(c.series.length).toBeGreaterThanOrEqual(24);
      expect(c.series.length).toBeLessThanOrEqual(1440);
      expect(c.series.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    }
    expect(new Set(cases.map((c) => c.series.join(","))).size).toBe(cases.length);
  });

  it("as formas têm a assinatura que o nome promete", () => {
    const of = (family: string) => cases.filter((c) => c.family === family);
    for (const c of of("starts_at_peak")) expect(Math.max(...c.series.slice(0, 3))).toBe(Math.max(...c.series.slice(0, 12)));
    for (const c of of("zeros_before_publication")) {
      const zeros = c.series.findIndex((v) => v > 0);
      expect(zeros).toBeGreaterThanOrEqual(24);
      expect(c.series.slice(0, zeros).every((v) => v === 0)).toBe(true);
    }
  });
});

describe("o relatório publica denominadores por família e preserva os casos problemáticos", () => {
  it("as contagens por família fecham", () => {
    for (const family of INDEPENDENT_FAMILIES) {
      const f = report.families[family.name]!;
      expect(f.total).toBe(CASES_PER_INDEPENDENT_FAMILY);
      expect(f.organic + f.inconclusive + f.suspicious).toBe(f.total);
    }
    expect(report.overall.legit_total).toBe(cases.length);
  });

  it("cada falso positivo e cada abstenção ficam listados com o motivo, e o arquivo de problemas bate com o relatório", () => {
    const flagged = report.overall.false_positive + report.overall.legit_inconclusive;
    expect(report.problems).toHaveLength(flagged);
    for (const p of report.problems) {
      expect(["suspicious", "inconclusive"]).toContain(p.verdict);
      expect(p.reason.length).toBeGreaterThan(10);
    }
    expect(JSON.parse(problemsFile(report))).toEqual(report.problems.map((p) => ({ ...p })));
    const committed = readFileSync(new URL("../data/independent-problems.json", import.meta.url), "utf8");
    expect(committed).toBe(problemsFile(report));
  });

  it("os casos problemáticos trazem a série, para poderem ser reexaminados", () => {
    for (const p of report.problems) {
      const original = cases.find((c) => c.id === p.id)!;
      expect(p.series).toEqual(original.series);
    }
  });
});

describe("a tabela do README vem do comando", () => {
  it("o README tem a região e ela bate com o que a avaliação mede agora", () => {
    expect(readme).toContain("<!-- independent:start -->");
    expect(checkIndependent(readme, report)).toEqual([]);
  });

  it("falha quando a tabela é editada ou some, e aplicar é idempotente", () => {
    const edited = readme.replace(/(<!-- independent:start -->[\s\S]*?\| )(\d)/, (_m, head, digit) => `${head}${digit === "9" ? "1" : "9"}`);
    expect(edited).not.toBe(readme);
    expect(checkIndependent(edited, report).length).toBeGreaterThan(0);
    expect(checkIndependent("# nada", report).length).toBeGreaterThan(0);
    const stale = "a\n<!-- independent:start -->\nlixo\n<!-- independent:end -->\nb\n";
    const updated = applyIndependent(stale, report);
    expect(updated).toContain(renderIndependent(report));
    expect(applyIndependent(updated, report)).toBe(updated);
  });
});
