import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatCount, wilsonInterval } from "../src/dataset/intervals.ts";

describe("intervalo de Wilson de 95%", () => {
  it.each([
    // k, n, inferior, superior (valores de referência da fórmula de Wilson com z = 1,96)
    [0, 330, 0, 0.0115],
    [1, 330, 0.0005, 0.0168],
    [0, 40, 0, 0.0876],
    [1, 40, 0.0044, 0.1286],
    [83, 150, 0.4731, 0.6309],
    [150, 150, 0.9751, 1],
  ])("%i de %i → [%f, %f]", (k, n, lo, hi) => {
    const interval = wilsonInterval(k, n)!;
    expect(interval.low).toBeCloseTo(lo, 3);
    expect(interval.high).toBeCloseTo(hi, 3);
  });

  it("sem denominador não há intervalo", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it("a taxa observada está sempre dentro do intervalo, que fica em [0, 1] e encolhe com mais casos", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.double({ min: 0, max: 1, noNaN: true }), (n, fraction) => {
        const k = Math.round(fraction * n);
        const { low, high } = wilsonInterval(k, n)!;
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(1);
        expect(low).toBeLessThanOrEqual(k / n + 1e-12);
        expect(high).toBeGreaterThanOrEqual(k / n - 1e-12);
        const bigger = wilsonInterval(k * 4, n * 4)!;
        expect(bigger.high - bigger.low).toBeLessThanOrEqual(high - low + 1e-12);
      }),
    );
  });

  it("zero acusados em n casos tem limite superior perto de 3,84/n (a 'regra dos três', refinada)", () => {
    for (const n of [40, 160, 330, 1000]) expect(wilsonInterval(0, n)!.high).toBeCloseTo(3.8416 / (n + 3.8416), 4);
  });
});

describe("formatação de contagem e intervalo", () => {
  it("mostra a contagem, o denominador, a taxa e o intervalo, em vírgula decimal", () => {
    expect(formatCount(1, 330)).toBe("1 de 330 (0,3%; IC 95% 0,1%–1,7%)");
    expect(formatCount(0, 40)).toBe("0 de 40 (0,0%; IC 95% 0,0%–8,8%)");
    expect(formatCount(150, 150)).toBe("150 de 150 (100,0%; IC 95% 97,5%–100,0%)");
  });

  it("sem denominador diz que não há como calcular", () => {
    expect(formatCount(0, 0)).toBe("0 de 0 (n/d)");
  });
});
