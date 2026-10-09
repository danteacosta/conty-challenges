import { describe, expect, it } from "vitest";
import { evaluate } from "../src/dataset/evaluate.ts";
import { generateDataset } from "../src/dataset/generate.ts";

describe("as taxas não dependem de uma semente de sorte", () => {
  // Outras sementes, escolhidas antes de olhar o resultado e nunca usadas para ajustar limiar: se um número do README só
  // valesse para a semente do holdout, ele mudaria muito aqui.
  const otherSeeds = [1, 2, 3, 4, 5, 6].map((k) => ({ dev: 1000 * k + 7, holdout: 5000 * k + 13 }));

  it.each(otherSeeds)("sementes %j: falso positivo baixo, abstenção e recall na mesma faixa", (seeds) => {
    const { overall } = evaluate(generateDataset({ seeds }));
    expect(overall.false_positive_rate).toBeLessThanOrEqual(0.01);
    expect(overall.legit_inconclusive_rate).toBeGreaterThan(0.3);
    expect(overall.legit_inconclusive_rate).toBeLessThan(0.4);
    expect(overall.recall).toBeGreaterThan(0.45);
    expect(overall.recall).toBeLessThan(0.7);
  });
});
