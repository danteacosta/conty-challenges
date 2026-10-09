import { createHash } from "node:crypto";
import { FAMILIES, type FamilyLabel } from "./families.ts";
import { createRng, deriveSeed } from "./rng.ts";

/** Casos por família e por parte. */
export const CASES_PER_FAMILY = 30;

/**
 * `dev` é onde os limiares do classificador foram ajustados. `holdout` foi gerado com outra semente e só foi olhado depois de
 * os limiares estarem congelados: é o número a citar.
 */
export const SEEDS = { dev: 20_261_009, holdout: 77_031_425 } as const;

export type Split = "dev" | "holdout";
export type Case = { id: string; family: string; label: FamilyLabel; split: Split; hours: number; series: number[] };

export type GenerateOptions = { seeds?: { dev: number; holdout: number }; perFamily?: number };

/** Gera o dataset inteiro, sempre igual para as mesmas sementes. Sem rede, sem relógio e sem fonte de aleatoriedade do sistema. */
export function generateDataset(options: GenerateOptions = {}): Case[] {
  const seeds = options.seeds ?? SEEDS;
  const perFamily = options.perFamily ?? CASES_PER_FAMILY;
  const cases: Case[] = [];
  for (const split of ["dev", "holdout"] as const) {
    FAMILIES.forEach((family, familyIndex) => {
      for (let index = 0; index < perFamily; index += 1) {
        const series = family.build(createRng(deriveSeed(seeds[split], familyIndex, index)));
        cases.push({ id: `${split}-${family.name}-${String(index + 1).padStart(2, "0")}`, family: family.name, label: family.label, split, hours: series.length, series });
      }
    });
  }
  return cases;
}

/** SHA-256 do conteúdo do dataset: é o que fica versionado, já que o arquivo grande não vai para o repositório. */
export const datasetHash = (cases: Case[]): string => createHash("sha256").update(JSON.stringify(cases)).digest("hex");
