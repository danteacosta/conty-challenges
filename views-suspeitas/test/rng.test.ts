import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRng, deriveSeed } from "../src/dataset/rng.ts";

describe("gerador pseudoaleatório semeado", () => {
  it("mesma semente, mesma sequência, em qualquer máquina (valores conhecidos do mulberry32)", () => {
    const rng = createRng(1);
    expect([rng.next(), rng.next(), rng.next()].map((n) => Math.round(n * 1e6))).toEqual([627_074, 2736, 527_447]); // 0,62707394… é o primeiro valor publicado do mulberry32 com semente 1
  });

  it("next fica em [0, 1); int fica no intervalo e alcança as duas pontas; between em [lo, hi)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = createRng(seed);
        for (let i = 0; i < 50; i += 1) {
          const n = rng.next();
          expect(n >= 0 && n < 1).toBe(true);
          const k = rng.int(3, 6);
          expect(k >= 3 && k <= 6 && Number.isInteger(k)).toBe(true);
          const b = rng.between(2, 5);
          expect(b >= 2 && b < 5).toBe(true);
        }
      }),
    );
    const rng = createRng(7);
    const seen = new Set(Array.from({ length: 400 }, () => rng.int(3, 6)));
    expect(seen).toEqual(new Set([3, 4, 5, 6]));
    expect(createRng(7).int(5, 5)).toBe(5);
  });

  it("chance(0) nunca e chance(1) sempre; duas instâncias com a mesma semente andam juntas", () => {
    const rng = createRng(3);
    expect(Array.from({ length: 100 }, () => rng.chance(0)).some(Boolean)).toBe(false);
    expect(Array.from({ length: 100 }, () => rng.chance(1)).every(Boolean)).toBe(true);
    const a = createRng(99);
    const b = createRng(99);
    expect(Array.from({ length: 20 }, () => a.normal())).toEqual(Array.from({ length: 20 }, () => b.normal()));
  });

  it("a normal tem média perto de 0 e desvio perto de 1", () => {
    const rng = createRng(11);
    const values = Array.from({ length: 5000 }, () => rng.normal());
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(sd - 1)).toBeLessThan(0.05);
  });

  it("a semente derivada muda com a parte, a família e o caso", () => {
    const seeds = new Set<number>();
    for (let family = 0; family < 16; family += 1) for (let index = 0; index < 30; index += 1) seeds.add(deriveSeed(20_261_009, family, index));
    expect(seeds.size).toBe(16 * 30);
    expect(deriveSeed(1, 0, 0)).not.toBe(deriveSeed(2, 0, 0));
  });
});
