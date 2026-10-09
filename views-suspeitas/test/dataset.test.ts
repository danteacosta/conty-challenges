import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAMILIES } from "../src/dataset/families.ts";
import { CASES_PER_FAMILY, SEEDS, datasetHash, generateDataset } from "../src/dataset/generate.ts";

const dataset = generateDataset();

describe("o dataset sintético é reproduzível e não depende de rede social nenhuma", () => {
  it("gerar duas vezes com as mesmas sementes dá exatamente o mesmo dataset", () => {
    expect(generateDataset()).toEqual(dataset);
    expect(datasetHash(generateDataset())).toBe(datasetHash(dataset));
  });

  it("o hash do dataset gerado é o que está versionado em data/dataset.sha256", () => {
    const committed = readFileSync(new URL("../data/dataset.sha256", import.meta.url), "utf8").trim();
    expect(datasetHash(dataset)).toBe(committed);
  });

  it("outra semente dá outro dataset", () => {
    const other = generateDataset({ seeds: { dev: SEEDS.dev + 1, holdout: SEEDS.holdout + 1 } });
    expect(datasetHash(other)).not.toBe(datasetHash(dataset));
  });

  it("o gerador não usa Math.random nem o relógio", () => {
    const source = ["../src/dataset/generate.ts", "../src/dataset/families.ts", "../src/dataset/rng.ts"].map((p) => readFileSync(new URL(p, import.meta.url), "utf8")).join("\n");
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date\(|performance\.now/);
  });
});

describe("a estrutura do dataset", () => {
  it("tem casos legítimos e suspeitos, de cada família, nas duas partes (dev e holdout)", () => {
    expect(dataset).toHaveLength(FAMILIES.length * 2 * CASES_PER_FAMILY);
    for (const family of FAMILIES) {
      for (const split of ["dev", "holdout"] as const) {
        const cases = dataset.filter((c) => c.family === family.name && c.split === split);
        expect(cases, `${family.name}/${split}`).toHaveLength(CASES_PER_FAMILY);
        expect(cases.every((c) => c.label === family.label)).toBe(true);
      }
    }
    expect(new Set(dataset.map((c) => c.label))).toEqual(new Set(["legit", "suspicious"]));
  });

  it("inclui os casos difíceis que podem enganar um classificador, dos dois lados", () => {
    const names = FAMILIES.map((f) => f.name);
    for (const hardLegit of ["live_stream", "premiere", "viral_interrupted", "embed_step", "low_volume", "global_audience", "news_double_spike"]) expect(names).toContain(hardLegit);
    for (const suspicious of ["bought_plateau", "mechanical_repeat", "pulse_without_decay", "disguised_buy", "noisy_bought_plateau"]) expect(names).toContain(suspicious);
  });

  it("toda série tem de 24 a 1.440 horas de inteiros não negativos, e os ids são únicos", () => {
    for (const c of dataset) {
      expect(c.series.length).toBeGreaterThanOrEqual(24);
      expect(c.series.length).toBeLessThanOrEqual(1440);
      expect(c.hours).toBe(c.series.length);
      expect(c.series.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    }
    expect(new Set(dataset.map((c) => c.id)).size).toBe(dataset.length);
  });

  it("as sementes do dev e do holdout são diferentes e as séries também", () => {
    expect(SEEDS.dev).not.toBe(SEEDS.holdout);
    const dev = dataset.filter((c) => c.split === "dev" && c.family === "steady_daily").map((c) => c.series.join(","));
    const holdout = dataset.filter((c) => c.split === "holdout" && c.family === "steady_daily").map((c) => c.series.join(","));
    expect(dev.filter((s) => holdout.includes(s))).toEqual([]);
  });

  it("cada família tem variedade: as séries de uma mesma família não são cópias", () => {
    for (const family of FAMILIES) {
      const distinct = new Set(dataset.filter((c) => c.family === family.name).map((c) => c.series.join(",")));
      expect(distinct.size, family.name).toBeGreaterThan(CASES_PER_FAMILY);
    }
  });
});
