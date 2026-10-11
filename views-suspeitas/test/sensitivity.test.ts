import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEEDS } from "../src/dataset/generate.ts";
import {
  CASES_PER_CELL,
  DURATIONS,
  SENSITIVITY_FAMILIES,
  SENSITIVITY_SEED,
  VOLUMES,
  applySensitivity,
  checkSensitivity,
  evaluateSensitivity,
  generateSensitivity,
  renderSensitivity,
} from "../src/dataset/sensitivity.ts";

const cases = generateSensitivity();
const report = evaluateSensitivity(cases);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("o experimento de sensibilidade é independente e reproduzível", () => {
  it("usa uma semente própria, diferente das do dev e do holdout, e é determinístico", () => {
    expect(SENSITIVITY_SEED).not.toBe(SEEDS.dev);
    expect(SENSITIVITY_SEED).not.toBe(SEEDS.holdout);
    expect(generateSensitivity()).toEqual(cases);
    expect(generateSensitivity({ seed: SENSITIVITY_SEED + 1 })).not.toEqual(cases);
  });

  it("cobre toda combinação de volume e duração com todas as famílias (menos a de volume fixo)", () => {
    expect(SENSITIVITY_FAMILIES.map((f) => f.name)).not.toContain("low_volume");
    expect(cases).toHaveLength(VOLUMES.length * DURATIONS.length * SENSITIVITY_FAMILIES.length * CASES_PER_CELL);
    for (const volume of VOLUMES) {
      for (const duration of DURATIONS) {
        const cell = cases.filter((c) => c.volume === volume.name && c.duration === duration.name);
        expect(cell, `${volume.name} × ${duration.name}`).toHaveLength(SENSITIVITY_FAMILIES.length * CASES_PER_CELL);
        expect(cell.every((c) => c.hours === duration.hours && c.series.length === duration.hours)).toBe(true);
      }
    }
    expect(cases.every((c) => c.series.every((v) => Number.isInteger(v) && v >= 0))).toBe(true);
  });

  it("o volume pedido vira a base típica da série legítima (a mediana fica na ordem de grandeza)", () => {
    const steady = cases.filter((c) => c.family === "steady_daily" && c.duration === DURATIONS[1]!.name);
    for (const volume of VOLUMES) {
      const medians = steady.filter((c) => c.volume === volume.name).map((c) => [...c.series].sort((a, b) => a - b)[c.series.length >> 1]!);
      const mean = medians.reduce((s, v) => s + v, 0) / medians.length;
      expect(mean, volume.name).toBeGreaterThan(volume.level * 0.6);
      expect(mean, volume.name).toBeLessThan(volume.level * 1.4);
    }
  });
});

describe("avaliação por faixa", () => {
  it("cada faixa de volume e de duração traz falso positivo, abstenção e recall, e as contagens fecham", () => {
    expect(Object.keys(report.byVolume)).toEqual(VOLUMES.map((v) => v.name));
    expect(Object.keys(report.byDuration)).toEqual(DURATIONS.map((d) => d.name));
    expect(report.cells).toHaveLength(VOLUMES.length * DURATIONS.length);
    const legit = SENSITIVITY_FAMILIES.filter((f) => f.label === "legit").length * CASES_PER_CELL;
    for (const metrics of Object.values(report.byVolume)) expect(metrics.legit_total).toBe(legit * DURATIONS.length);
    expect(report.overall.legit_total + report.overall.suspicious_total).toBe(cases.length);
  });

  it("série curta de baixo volume vira abstenção, não acusação: o falso positivo não explode onde há menos dado", () => {
    const worst = report.cells.reduce((a, b) => (b.metrics.false_positive_rate > a.metrics.false_positive_rate ? b : a));
    expect(worst.metrics.false_positive_rate).toBeLessThan(0.1);
  });
});

describe("a tabela do README vem do comando", () => {
  it("o README tem a região e ela bate com o que o experimento mede agora", () => {
    expect(readme).toContain("<!-- sensitivity:start -->");
    expect(checkSensitivity(readme, report)).toEqual([]);
  });

  it("falha quando a tabela é editada à mão ou some", () => {
    const edited = readme.replace(/(<!-- sensitivity:start -->[\s\S]*?\| )(\d)/, (_m, head, digit) => `${head}${digit === "9" ? "1" : "9"}`);
    expect(edited).not.toBe(readme);
    expect(checkSensitivity(edited, report).length).toBeGreaterThan(0);
    expect(checkSensitivity("# sem nada", report).length).toBeGreaterThan(0);
  });

  it("aplicar atualiza só a região e é idempotente", () => {
    const stale = "antes\n<!-- sensitivity:start -->\nlixo\n<!-- sensitivity:end -->\ndepois\n";
    const updated = applySensitivity(stale, report);
    expect(updated).toContain(renderSensitivity(report));
    expect(updated.startsWith("antes\n")).toBe(true);
    expect(updated.endsWith("\ndepois\n")).toBe(true);
    expect(applySensitivity(updated, report)).toBe(updated);
  });
});
