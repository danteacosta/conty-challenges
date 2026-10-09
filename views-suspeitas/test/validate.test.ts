import { describe, expect, it } from "vitest";
import { validateSeries } from "../src/validate.ts";

const hours = (n: number, value = 100) => Array.from({ length: n }, () => value);
const message = (body: unknown) => {
  const result = validateSeries(body);
  return result.ok ? undefined : result.message;
};

describe("validateSeries", () => {
  it("aceita zero e exatamente 1 bilhão por hora; recusa 1 bilhão e 1", () => {
    expect(validateSeries({ series: hours(24, 0) }).ok).toBe(true);
    expect(validateSeries({ series: hours(24, 1_000_000_000) }).ok).toBe(true);
    expect(message({ series: [...hours(23), 1_000_000_001] })).toMatch(/series\[23\].*passa de/);
  });

  it("corpos que não são objeto com series recusam sem estourar", () => {
    for (const body of [null, [1, 2, 3], 5, "x", undefined, { series: null }]) expect(message(body), JSON.stringify(body)).toMatch(/lista/);
  });

  it("diz o índice do primeiro valor ruim e o tamanho recebido", () => {
    expect(message({ series: [...hours(5), -1, 1.5, ...hours(20)] })).toMatch(/series\[5\] não pode ser negativo/);
    expect(message({ series: [...hours(5), 1.5, -1, ...hours(20)] })).toMatch(/series\[5\] deve ser um número inteiro/);
    expect(message({ series: hours(23) })).toMatch(/recebi 23/);
    expect(message({ series: hours(1441) })).toMatch(/recebi 1441/);
  });

  it("o tamanho é conferido antes dos valores", () => {
    expect(message({ series: [...hours(22), -1] })).toMatch(/pelo menos 24 horas/);
  });

  it("recusa NaN, infinito e buracos", () => {
    expect(validateSeries({ series: [...hours(23), Number.NaN] }).ok).toBe(false);
    expect(validateSeries({ series: [...hours(23), Number.POSITIVE_INFINITY] }).ok).toBe(false);
    expect(validateSeries({ series: [...hours(23), , ] }).ok).toBe(false); // eslint-disable-line no-sparse-arrays
  });
});
