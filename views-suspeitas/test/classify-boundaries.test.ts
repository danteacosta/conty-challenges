import { describe, expect, it } from "vitest";
import { classify } from "../src/domain/classify.ts";
import { organicSpike, plateau, steady, withRange } from "./series.ts";

const names = (series: number[]) => classify(series).signals.map((s) => s.name);
const cycle = (hours: number, median: number) => Array.from({ length: hours }, (_, i) => median + (i % 3) - 1); // mediana exata, sem repetição possível (volume baixo)

describe("fronteiras do classificador", () => {
  it("48 horas já bastam para ter base de comparação; 47 não", () => {
    expect(classify(cycle(48, 20)).classification).toBe("organic");
    const short = classify(cycle(47, 20));
    expect(short.classification).toBe("inconclusive");
    expect(short.signals).toMatchObject([{ name: "short_series", effect: "weak", measured: 47, threshold: 48, from_hour: 0, to_hour: 46 }]);
    expect(short.reason).toMatch(/só 47 horas de dados/);
  });

  it("mediana de 20 views por hora ainda é volume suficiente; 19 já é volume baixo", () => {
    expect(classify(cycle(96, 20)).classification).toBe("organic");
    const low = classify(cycle(96, 19));
    expect(low.signals).toEqual([
      { name: "low_volume", effect: "weak", measured: 19, threshold: 20, from_hour: 0, to_hour: 95, detail: "mediana de 19 views por hora, abaixo de 20" },
    ]);
    expect(low.reason).toMatch(/mediana de 19 views por hora, abaixo de 20/);
  });

  it("em canal de volume baixo só o pulso ainda é avaliado: um corte alto e irregular não vira sinal, o pulso vira", () => {
    const quiet = cycle(120, 5);
    const cut = withRange(quiet, 50, 56, (_, k) => [900, 1200, 1000, 950, 1100, 870, 1010][k]!);
    expect(names(cut)).toEqual(["low_volume"]);
    const pulse = classify(withRange(quiet, 50, 50, () => 5000));
    expect(pulse.classification).toBe("suspicious");
    expect(pulse.signals.map((s) => s.name)).toEqual(["pulse_without_decay", "low_volume"]);
  });

  it("em canal de volume baixo patamar e degrau também não são avaliados", () => {
    const quiet = cycle(168, 5);
    expect(names(withRange(quiet, 80, 167, () => 14))).toEqual(["low_volume"]);
  });

  it("a repetição mecânica não dá sinais extras de quem está dentro dela (queda abrupta, degrau)", () => {
    expect(names(withRange(steady(), 70, 79, (_, k) => 1000 + 250 * k))).toEqual(["mechanical_repetition"]);
    expect(names(withRange(steady(), 40, 49, () => 4800))).toEqual(["mechanical_repetition"]);
  });

  it("um pulso que cai em cima de um patamar não vira sinal duplicado", () => {
    expect(names(plateau(steady(), 60, 77, 6200))).toEqual(["plateau_then_cliff"]);
  });
});

describe("série curta (menos de 48 horas): só a repetição evidente é avaliada", () => {
  it("pulso e patamar não são avaliados sem base de comparação", () => {
    expect(names(withRange(steady(40), 20, 20, () => 18_000))).toEqual(["short_series"]);
    expect(names(plateau(steady(40), 15, 25, 6200))).toEqual(["short_series"]);
  });

  it("o sinal diz o que faltou", () => {
    expect(classify(steady(40)).signals[0]!.detail).toBe("40 horas de dados, menos que as 48 necessárias para ter uma base de comparação");
  });
});

describe("a ordem e o corte do motivo", () => {
  const withThree = () => {
    let series = plateau(steady(), 40, 60, 6200);
    series = withRange(series, 90, 90, () => 18_000);
    return withRange(series, 120, 130, () => 4800);
  };

  it("os sinais saem ordenados: acusações primeiro e, entre iguais, por hora", () => {
    const result = classify(withThree());
    expect(result.signals.map((s) => [s.name, s.from_hour])).toEqual([
      ["plateau_then_cliff", 40],
      ["pulse_without_decay", 90],
      ["mechanical_repetition", 120],
    ]);
  });

  it("o motivo traz só as duas primeiras acusações, mas os três sinais ficam na lista", () => {
    const result = classify(withThree());
    expect(result.reason).toMatch(/fixas/);
    expect(result.reason).toMatch(/18\.000/);
    expect(result.reason).not.toMatch(/idênticas/);
    expect(result.reason).toMatch(/este formato\. pico de 18\.000/); // as duas frases separadas por ponto e espaço
    expect(result.signals).toHaveLength(3);
  });

  it("dúvida (sinal fraco) vem depois de acusação na lista, e o motivo de uma acusação não cita a dúvida", () => {
    const live = withRange(steady(), 30, 37, (hour) => 5200 * (1 + 0.06 * Math.sin(hour * 2.3)));
    const mixed = withRange(live, 100, 100, () => 18_000);
    const result = classify(mixed);
    expect(result.classification).toBe("suspicious");
    expect(result.signals.map((s) => s.effect)).toEqual(["suspicious", "weak"]);
    expect(result.reason).not.toMatch(/transmissão ao vivo/);
  });
});

describe("o resumo", () => {
  it("o pico é o primeiro máximo da série (em empate, a hora mais cedo)", () => {
    const series = steady();
    series[10] = 700;
    series[50] = 700;
    expect(classify(series).summary.peak).toEqual({ hour: 10, value: 700 });
  });

  it("a base é a mediana arredondada em uma casa", () => {
    expect(classify([...Array.from({ length: 24 }, () => 10), ...Array.from({ length: 24 }, () => 11)]).summary.baseline_per_hour).toBe(10.5);
  });
});

describe("os sinais carregam o que foi medido, com texto em pt-BR", () => {
  it("repetição idêntica", () => {
    const s = classify(withRange(steady(), 40, 49, () => 4800)).signals[0]!;
    expect(s).toEqual({ name: "mechanical_repetition", effect: "suspicious", measured: 10, threshold: 7, from_hour: 40, to_hour: 49, detail: "10 horas com exatamente 4.800 views (mínimo 7 horas)" });
    expect(classify(withRange(steady(), 40, 49, () => 4800)).reason).toMatch(/não é comportamento de gente/);
  });

  it("progressão aritmética", () => {
    const s = classify(withRange(steady(), 70, 79, (_, k) => 1000 + 250 * k)).signals[0]!;
    expect(s).toEqual({ name: "mechanical_repetition", effect: "suspicious", measured: 10, threshold: 8, from_hour: 70, to_hour: 79, detail: "10 horas variando exatamente +250 por hora (mínimo 8 horas)" });
    const down = classify(withRange(steady(), 70, 79, (_, k) => 3000 - 250 * k));
    expect(down.signals[0]!.detail).toMatch(/-250 por hora/);
    expect(down.reason).toMatch(/sempre exatamente -250 views por hora/);
  });

  it("ciclo", () => {
    const s = classify(withRange(steady(), 30, 53, (_, k) => (k % 2 === 0 ? 300 : 900))).signals[0]!;
    expect(s).toEqual({ name: "mechanical_repetition", effect: "suspicious", measured: 12, threshold: 4, from_hour: 30, to_hour: 53, detail: "ciclo de 2 horas repetido 12 vezes (mínimo 4)" });
  });

  it("pulso, com a hora e a razão para a base", () => {
    const result = classify(withRange(steady(), 80, 80, () => 18_000));
    const s = result.signals[0]!;
    expect(s).toMatchObject({ name: "pulse_without_decay", measured: 36, threshold: 15, from_hour: 80, to_hour: 80 });
    expect(s.detail).toBe("pico de 18.000 views, 36× a base, ocupando 1 hora(s) acima da cauda (limite de 3)");
    expect(result.reason).toMatch(/na hora 80/);
    expect(result.reason).toMatch(/36× a base/);
    expect(result.reason).toMatch(/na hora seguinte/);
    const two = classify(withRange(steady(), 80, 81, (_, k) => (k === 0 ? 18_000 : 9000)));
    expect(two.reason).toMatch(/nas horas 80 a 81/);
    expect(two.reason).toMatch(/logo depois do pico/);
  });

  it("queda abrupta", () => {
    const cut = withRange(steady(), 60, 66, (_, k) => [9000, 12_500, 10_800, 9500, 11_200, 8700, 10_100][k]!);
    const s = classify(cut).signals.find((x) => x.name === "abrupt_drop")!;
    expect(s).toMatchObject({ effect: "weak", measured: 0.95, threshold: 0.7, from_hour: 60, to_hour: 66 });
    expect(s.detail).toBe("nível alto por 7 horas e queda de 95% numa hora só");
    expect(classify(cut).reason).toMatch(/por 7 horas \(nas horas 60 a 66, pico de 12\.500\) e despencou de uma vez na hora 67/);
  });

  it("pico orgânico", () => {
    const s = classify(plateauless()).signals[0]!;
    expect(s.name).toBe("organic_decay");
    expect(s.measured).toBe(18);
    expect(s.threshold).toBe(6);
    expect(classify(plateauless()).reason).toMatch(/pico de 14\.000 views na hora 63 \(\d+× a base\), com subida em 3 horas e cauda de \d+ horas de queda gradual/);
  });

  it("degrau", () => {
    const step = withRange(steady(), 80, 167, (hour) => 1800 * (1 + 0.08 * Math.sin(hour * 1.7)));
    const s = classify(step).signals[0]!;
    expect(s).toEqual({ name: "step_without_return", effect: "weak", measured: 3.3, threshold: 2.5, from_hour: 80, to_hour: 80, detail: "nível de ~502 para ~1.662 por hora a partir da hora 80, sem voltar" });
  });

  it("patamar suspeito e patamar com dúvida trazem a regularidade, a média e a razão para a base", () => {
    const bought = classify(plateau(steady(), 60, 77, 6200)).signals[0]!;
    expect(bought.detail).toMatch(/^18 horas em ~6\.\d{3} views por hora \(12,\d× a base\); regularidade 0,\d+ contra limiar 1,5 \(menor = mais regular que o acaso\)$/);
    const live = classify(withRange(steady(), 70, 77, (hour) => 5200 * (1 + 0.06 * Math.sin(hour * 2.3))));
    expect(live.signals[0]!.detail).toMatch(/^8 horas em ~5\.\d{3} views por hora \(10,\d× a base\); regularidade 3,\d+ contra limiar 1,5/);
    expect(live.reason).toMatch(/seguido de queda seca de 9\d% na hora 78/);
    expect(live.reason).toMatch(/\(4,\d%\)/);
    expect(classify(plateau(steady(), 60, 77, 6200)).reason).toMatch(/desvio de 0,2% entre as horas, só 0,1× os 1,3% que o acaso da contagem sozinho já produz; tráfego real passa de 1,5×/);
  });

  it("a mesma regularidade um pouco acima do limiar vira dúvida, não acusação", () => {
    // média ~4.000, desvio ~2,5 × √média: acima de 1,5 → dúvida
    const wobble = [4200, 3800, 4160, 3840, 4220, 3780, 4180, 3820];
    const series = withRange(steady(), 70, 77, (_, k) => wobble[k]!);
    const result = classify(series);
    expect(result.signals.find((s) => s.name === "plateau_then_cliff")).toMatchObject({ effect: "weak" });
    expect(result.classification).toBe("inconclusive");
  });
});

function plateauless(): number[] {
  const series = steady();
  const ramp = [1400, 4900, 11_200, 14_000];
  ramp.forEach((v, k) => (series[60 + k] = v));
  let level = 14_000;
  for (let h = 64; level > 900; h += 1) {
    level *= 0.88;
    series[h] = Math.round(level);
  }
  return series;
}

describe("casos adversariais: mais de um episódio, observação curta e série cortada", () => {
  it("um pico orgânico grande não esconde um bloco comprado menor na mesma série (e não o contamina)", () => {
    const series = plateau(organicSpike(steady(336), 40, 14_000), 200, 213, 3000);
    const result = classify(series);
    expect(result.classification).toBe("suspicious");
    const byName = (name: string) => result.signals.find((s) => s.name === name);
    expect(byName("plateau_then_cliff")).toMatchObject({ effect: "suspicious", from_hour: 200, to_hour: 213 });
    expect(byName("organic_decay")).toMatchObject({ effect: "organic" });
    expect(result.reason).toMatch(/horas 200 a 213/);
    expect(result.reason).not.toMatch(/horas 4\d|cauda/); // o motivo da acusação é só do bloco comprado
  });

  it("o mesmo pico orgânico sozinho continua orgânico (o bloco comprado é que muda a resposta)", () => {
    expect(classify(organicSpike(steady(336), 40, 14_000)).classification).toBe("organic");
  });

  it("ciclo de 6 horas: 3 repetições não bastam para demonstrar periodicidade, 4 bastam", () => {
    const pattern = [300, 520, 910, 640, 780, 450];
    const cyc = (repeats: number) => withRange(steady(), 30, 30 + 6 * repeats - 1, (_, k) => pattern[k % 6]!);
    expect(names(cyc(3))).toEqual([]);
    expect(classify(cyc(3)).classification).toBe("organic");
    expect(classify(cyc(4)).signals[0]).toMatchObject({ name: "mechanical_repetition", from_hour: 30, to_hour: 53 });
  });

  it("série que termina dentro do patamar não inventa uma queda: sem hora seguinte não há penhasco", () => {
    const series = plateau(steady(100), 88, 99, 6200);
    expect(names(series)).not.toContain("plateau_then_cliff");
    expect(classify(series).classification).not.toBe("suspicious");
  });

  it("série que termina no meio da cauda de um pico orgânico não é acusada", () => {
    const series = organicSpike(steady(100), 80, 14_000).slice(0, 90);
    expect(classify(series).classification).not.toBe("suspicious");
  });
});

describe("vários patamares na mesma série são avaliados cada um por si", () => {
  const noisy = (series: number[], from: number, to: number) => withRange(series, from, to, (hour) => 4000 * (1 + 0.05 * Math.sin(hour * 2.3)));

  it("um patamar ruidoso longo não esconde um patamar quase fixo menor: o menor é acusado, o longo continua só dúvida", () => {
    const series = plateau(noisy(steady(336), 40, 75), 200, 211, 3000);
    const result = classify(series);
    expect(result.classification).toBe("suspicious");
    const plateaus = result.signals.filter((s) => s.name === "plateau_then_cliff");
    expect(plateaus.map((s) => [s.effect, s.from_hour, s.to_hour])).toEqual([
      ["suspicious", 200, 211],
      ["weak", 40, 75],
    ]);
    expect(result.reason).toMatch(/horas 200 a 211/);
    expect(result.reason).not.toMatch(/horas 40 a 75/); // a dúvida não entra no motivo de uma acusação
  });

  it("o patamar ruidoso sozinho continua inconclusivo (não vira acusação por estar perto de outro)", () => {
    const result = classify(noisy(steady(336), 40, 75));
    expect(result.classification).toBe("inconclusive");
    expect(result.signals.filter((s) => s.name === "plateau_then_cliff")).toHaveLength(1);
  });

  it("o patamar quase fixo menor sozinho continua suspeito, igual com ou sem o outro", () => {
    expect(classify(plateau(steady(336), 200, 211, 3000)).signals[0]).toMatchObject({ name: "plateau_then_cliff", effect: "suspicious", from_hour: 200, to_hour: 211 });
  });

  it("os patamares não se sobrepõem: janelas vizinhas da mesma subida viram um sinal só", () => {
    const result = classify(plateau(steady(168), 60, 77, 6200));
    expect(result.signals.filter((s) => s.name === "plateau_then_cliff")).toHaveLength(1);
  });
});
