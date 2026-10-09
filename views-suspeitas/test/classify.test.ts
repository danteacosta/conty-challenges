import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classify } from "../src/domain/classify.ts";
import { organicSpike, plateau, steady, withRange } from "./series.ts";

const signal = (result: ReturnType<typeof classify>, name: string) => result.signals.find((s) => s.name === name);

describe("série normal", () => {
  it("sem nenhum padrão estranho é orgânica, e o motivo diz que nada foi encontrado", () => {
    const result = classify(steady());
    expect(result.classification).toBe("organic");
    expect(result.reason).toMatch(/^Orgânico:/);
    expect(result.reason).toMatch(/sem (nenhum )?sinal/i);
    expect(result.summary).toMatchObject({ hours: 168 });
    expect(result.summary.baseline_per_hour).toBeGreaterThan(450);
    expect(result.summary.baseline_per_hour).toBeLessThan(550);
  });

  it("a resposta é sempre completa: classificação, motivo em texto, sinais e resumo", () => {
    const result = classify(steady());
    expect(Object.keys(result).sort()).toEqual(["classification", "criteria_version", "reason", "signals", "summary"]);
    expect(typeof result.reason).toBe("string");
    expect(Array.isArray(result.signals)).toBe(true);
  });
});

describe("casos óbvios de compra ou de repetição mecânica (séries montadas à mão)", () => {
  it("dez horas seguidas com exatamente o mesmo número: repetição mecânica", () => {
    const series = withRange(steady(), 40, 49, () => 4800);
    const result = classify(series);
    expect(result.classification).toBe("suspicious");
    expect(signal(result, "mechanical_repetition")).toMatchObject({ effect: "suspicious", from_hour: 40, to_hour: 49 });
    expect(result.reason).toMatch(/^Suspeito:/);
    expect(result.reason).toMatch(/horas 40 a 49/);
    expect(result.reason).toMatch(/idênticas/);
    expect(result.reason).toMatch(/4\.800/);
  });

  it("a mesma repetição em volume baixo (zeros e poucas views) não é acusada: acontece por acaso", () => {
    const quiet = steady(168, 3, 0.6).map((v, i) => (i % 5 === 0 ? 0 : v % 4));
    const result = classify(withRange(quiet, 40, 60, () => 0));
    expect(result.classification).not.toBe("suspicious");
    expect(signal(result, "mechanical_repetition")).toBeUndefined();
  });

  it("progressão aritmética exata (+250 por hora durante 10 horas): repetição mecânica", () => {
    const series = withRange(steady(), 70, 79, (_, k) => 1000 + 250 * k);
    const result = classify(series);
    expect(result.classification).toBe("suspicious");
    expect(signal(result, "mechanical_repetition")).toMatchObject({ from_hour: 70, to_hour: 79 });
    expect(result.reason).toMatch(/\+250/);
  });

  it("ciclo exato repetido (300, 900, 300, 900…) por 24 horas: repetição mecânica", () => {
    const series = withRange(steady(), 30, 53, (_, k) => (k % 2 === 0 ? 300 : 900));
    const result = classify(series);
    expect(result.classification).toBe("suspicious");
    expect(signal(result, "mechanical_repetition")).toMatchObject({ from_hour: 30, to_hour: 53 });
    expect(result.reason).toMatch(/ciclo/);
  });

  it("patamar quase fixo em ~6.200/h por 18 horas e queda seca de volta à base: patamar e queda", () => {
    const series = plateau(steady(), 60, 77, 6200);
    const result = classify(series);
    expect(result.classification).toBe("suspicious");
    expect(signal(result, "plateau_then_cliff")).toMatchObject({ effect: "suspicious", from_hour: 60, to_hour: 77 });
    expect(result.reason).toMatch(/^Suspeito:/);
    expect(result.reason).toMatch(/fixas/);
    expect(result.reason).toMatch(/queda/);
    expect(result.reason).toMatch(/hora 78/);
  });

  it("pico de 18.000 numa hora só, sem cauda, volta à base na hora seguinte: pulso sem decaimento", () => {
    const series = withRange(steady(), 80, 80, () => 18_000);
    const result = classify(series);
    expect(result.classification).toBe("suspicious");
    expect(signal(result, "pulse_without_decay")).toMatchObject({ effect: "suspicious", from_hour: 80, to_hour: 80 });
    expect(result.reason).toMatch(/18\.000/);
    expect(result.reason).toMatch(/cauda/);
  });

  it("pulso de duas horas também, mesmo com a segunda hora menor", () => {
    const series = withRange(steady(), 80, 81, (_, k) => (k === 0 ? 18_000 : 9000));
    expect(classify(series).classification).toBe("suspicious");
  });
});

describe("pico orgânico plausível NÃO cai no mesmo balde de um pico comprado", () => {
  const peak = 14_000;
  const organic = organicSpike(steady(), 60, peak);
  const bought = plateau(steady(), 60, 71, peak);

  it("o orgânico (sobe em poucas horas e desce gradualmente, com cauda) é orgânico", () => {
    const result = classify(organic);
    expect(result.classification).toBe("organic");
    expect(signal(result, "organic_decay")).toMatchObject({ effect: "organic" });
    expect(result.reason).toMatch(/^Orgânico:/);
    expect(result.reason).toMatch(/cauda/);
    expect(result.reason).toMatch(/gradual/);
  });

  it("o comprado (patamar fixo e queda seca) é suspeito", () => {
    const result = classify(bought);
    expect(result.classification).toBe("suspicious");
    expect(signal(result, "organic_decay")).toBeUndefined();
  });

  it("as duas respostas dizem coisas diferentes e apontam sinais diferentes", () => {
    const a = classify(organic);
    const b = classify(bought);
    expect(a.classification).not.toBe(b.classification);
    expect(a.reason).not.toBe(b.reason);
    expect(a.signals.map((s) => s.name)).not.toEqual(b.signals.map((s) => s.name));
  });

  it("um pulso de uma hora com o mesmo pico também é suspeito, e é outro motivo que o patamar", () => {
    const pulse = classify(withRange(steady(), 60, 60, () => peak));
    expect(pulse.classification).toBe("suspicious");
    expect(pulse.signals.map((s) => s.name)).toContain("pulse_without_decay");
    expect(pulse.signals.map((s) => s.name)).not.toContain("plateau_then_cliff");
  });
});

describe("casos em que o classificador prefere não acusar", () => {
  it("transmissão ao vivo: oito horas num patamar alto com variação natural de ±6% e fim seco → inconclusivo", () => {
    const live = withRange(steady(), 70, 77, (hour) => 5200 * (1 + 0.06 * Math.sin(hour * 2.3)));
    const result = classify(live);
    expect(result.classification).toBe("inconclusive");
    expect(result.reason).toMatch(/^Inconclusivo:/);
    expect(result.reason).toMatch(/transmissão ao vivo/);
    expect(result.reason).toMatch(/não é suficiente para acusar/);
    expect(signal(result, "plateau_then_cliff")).toMatchObject({ effect: "weak", from_hour: 70, to_hour: 77 });
  });

  it("o mesmo patamar, mas com variação de ±0,3%, é suspeito: o que separa é a naturalidade da variação", () => {
    expect(classify(plateau(steady(), 70, 77, 5200)).classification).toBe("suspicious");
  });

  it("viral cortado pela plataforma (alto e irregular, e some de uma vez) → inconclusivo", () => {
    const base = steady();
    const cut = withRange(base, 60, 66, (_, k) => [9000, 12_500, 10_800, 9500, 11_200, 8700, 10_100][k]!);
    const result = classify(cut);
    expect(result.classification).toBe("inconclusive");
    expect(signal(result, "abrupt_drop")).toMatchObject({ effect: "weak" });
    expect(result.reason).toMatch(/pode ser/);
  });

  it("degrau persistente (de ~500 para ~1.800 e fica): pode ser incorporação num site grande → inconclusivo", () => {
    const step = withRange(steady(), 80, 167, (hour) => 1800 * (1 + 0.08 * Math.sin(hour * 1.7)));
    const result = classify(step);
    expect(result.classification).toBe("inconclusive");
    expect(signal(result, "step_without_return")).toMatchObject({ effect: "weak", from_hour: 80 });
    expect(result.reason).toMatch(/incorporação/);
  });

  it("volume muito baixo, sem nada de anormal, não permite concluir nada → inconclusivo, não orgânico", () => {
    const quiet = steady(168, 4, 0.9).map((v, i) => (i % 3 === 0 ? 0 : v % 6));
    const result = classify(quiet);
    expect(result.classification).toBe("inconclusive");
    expect(result.reason).toMatch(/volume/);
    expect(signal(result, "low_volume")).toMatchObject({ effect: "weak" });
  });

  it("uma série constante em zero não é repetição mecânica: é só um canal parado", () => {
    const result = classify(Array.from({ length: 100 }, () => 0));
    expect(result.classification).toBe("inconclusive");
    expect(signal(result, "mechanical_repetition")).toBeUndefined();
  });

  it("poucas horas (menos de 48) não bastam para uma conclusão, exceto repetição mecânica evidente", () => {
    const short = steady(30, 500);
    expect(classify(short).classification).toBe("inconclusive");
    expect(classify(withRange(short, 5, 14, () => 4800)).classification).toBe("suspicious");
  });
});

describe("os sinais explicam o que foi medido", () => {
  it("cada sinal diz o que mediu, o limiar e as horas", () => {
    const result = classify(plateau(steady(), 60, 77, 6200));
    const s = signal(result, "plateau_then_cliff")!;
    expect(s).toMatchObject({ name: "plateau_then_cliff", effect: "suspicious", from_hour: 60, to_hour: 77 });
    expect(typeof s.measured).toBe("number");
    expect(typeof s.threshold).toBe("number");
    expect(s.measured).toBeLessThanOrEqual(s.threshold);
    expect(s.detail).toMatch(/18 horas|18 h/);
  });

  it("sinais correlacionados (patamar e a queda dele) saem agrupados num sinal só", () => {
    const names = classify(plateau(steady(), 60, 77, 6200)).signals.map((s) => s.name);
    expect(names.filter((n) => n === "plateau_then_cliff")).toHaveLength(1);
    expect(names).not.toContain("abrupt_drop");
    expect(names).not.toContain("step_without_return");
  });

  it("o resumo traz a base por hora e o pico", () => {
    const result = classify(withRange(steady(), 80, 80, () => 18_000));
    expect(result.summary.peak).toEqual({ hour: 80, value: 18_000 });
    expect(result.summary.baseline_per_hour).toBeGreaterThan(450);
  });
});

describe("propriedades", () => {
  it("toda série válida recebe uma resposta completa, sempre a mesma para a mesma série", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 24, maxLength: 400 }), (series) => {
        const a = classify(series);
        const b = classify([...series]);
        expect(b).toEqual(a);
        expect(["organic", "suspicious", "inconclusive"]).toContain(a.classification);
        expect(a.reason.length).toBeGreaterThan(20);
        expect(a.reason.startsWith({ organic: "Orgânico:", suspicious: "Suspeito:", inconclusive: "Inconclusivo:" }[a.classification])).toBe(true);
        for (const s of a.signals) {
          expect(s.from_hour).toBeGreaterThanOrEqual(0);
          expect(s.to_hour).toBeGreaterThanOrEqual(s.from_hour);
          expect(s.to_hour).toBeLessThan(series.length);
        }
        if (a.classification === "suspicious") expect(a.signals.some((s) => s.effect === "suspicious")).toBe(true);
        if (a.classification === "organic") expect(a.signals.every((s) => s.effect !== "suspicious")).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it("ruído aleatório de volume alto, sem estrutura, nunca é acusado de repetição mecânica", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1000, max: 20_000 }), { minLength: 48, maxLength: 200 }), (series) => {
        fc.pre(!hasRunOf(series, 4));
        expect(classify(series).signals.map((s) => s.name)).not.toContain("mechanical_repetition");
      }),
    );
  });
});

function hasRunOf(series: number[], length: number): boolean {
  let run = 1;
  for (let i = 1; i < series.length; i += 1) {
    run = series[i] === series[i - 1] ? run + 1 : 1;
    if (run >= length) return true;
  }
  return false;
}
