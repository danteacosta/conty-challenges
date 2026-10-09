import { describe, expect, it } from "vitest";
import { findPeaks, findPlateauCliffs, findRepetition, findStep, isGradual, regularityOf } from "../src/domain/signals.ts";
import { baselineOf, mean, median, stdDev } from "../src/domain/stats.ts";
import { steady, withRange } from "./series.ts";

/** O maior patamar, ou nada: os testes de borda de cada limiar olham para ele. */
const findPlateauCliff = (series: number[], baseline: number) => findPlateauCliffs(series, baseline)[0];
const flat = (hours: number, value: number) => Array.from({ length: hours }, () => value);
const put = (base: number[], at: number, values: number[]) => base.map((v, i) => (i >= at && i < at + values.length ? values[i - at]! : v));

describe("estatística básica", () => {
  it("mediana: vazia, ímpar, par, e sem alterar a lista recebida", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("média e desvio padrão amostral", () => {
    expect(mean([])).toBe(0);
    expect(mean([2, 4])).toBe(3);
    expect(stdDev([])).toBe(0);
    expect(stdDev([5])).toBe(0);
    expect(stdDev([1, 3])).toBeCloseTo(Math.SQRT2, 10);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });

  it("a base nunca é menor que 1", () => {
    expect(baselineOf([0, 0, 0])).toBe(1);
    expect(baselineOf([5, 7, 9])).toBe(7);
  });

  it("regularidade = desvio ÷ √média; infinita quando a média é zero", () => {
    expect(regularityOf([0, 0, 0])).toBe(Number.POSITIVE_INFINITY);
    expect(regularityOf([100, 100, 100])).toBe(0);
    expect(regularityOf([90, 110])).toBeCloseTo(Math.SQRT2, 10);
  });
});

describe("repetição mecânica: cada limite exatamente na borda", () => {
  const background = () => steady(60);

  it("7 horas idênticas valem; 6 não; 30 views valem; 29 não", () => {
    expect(findRepetition(withRange(background(), 10, 16, () => 30))).toEqual({ kind: "identical", from: 10, to: 16, value: 30 });
    expect(findRepetition(withRange(background(), 10, 15, () => 30))).toBeUndefined();
    expect(findRepetition(withRange(background(), 10, 16, () => 29))).toBeUndefined();
  });

  it("acha a repetição que começa na primeira hora e a que termina na última", () => {
    expect(findRepetition(withRange(background(), 0, 6, () => 80))).toMatchObject({ from: 0, to: 6 });
    expect(findRepetition(withRange(background(), 53, 59, () => 80))).toMatchObject({ from: 53, to: 59 });
  });

  it("entre duas repetições fica a maior; em empate, a primeira", () => {
    const longer = withRange(withRange(background(), 10, 16, () => 40), 30, 38, () => 50);
    expect(findRepetition(longer)).toMatchObject({ value: 50, from: 30, to: 38 });
    const tie = withRange(withRange(background(), 10, 16, () => 40), 30, 36, () => 50);
    expect(findRepetition(tie)).toMatchObject({ value: 40, from: 10 });
  });

  it("progressão de 8 horas vale, de 7 não; descendente também; ponto abaixo de 30 anula", () => {
    expect(findRepetition(withRange(background(), 5, 12, (_, k) => 100 + 10 * k))).toEqual({ kind: "progression", from: 5, to: 12, step: 10 });
    expect(findRepetition(withRange(background(), 5, 11, (_, k) => 100 + 10 * k))).toBeUndefined();
    expect(findRepetition(withRange(background(), 5, 12, (_, k) => 200 - 10 * k))).toMatchObject({ kind: "progression", step: -10 });
    expect(findRepetition(withRange(background(), 5, 12, (_, k) => 65 - 5 * k))).toMatchObject({ kind: "progression", from: 5, to: 12 }); // termina em 30
    expect(findRepetition(withRange(background(), 5, 12, (_, k) => 60 - 5 * k))).toBeUndefined(); // termina em 25
    expect(findRepetition(withRange(background(), 52, 59, (_, k) => 100 + 10 * k))).toMatchObject({ from: 52, to: 59 });
  });

  it("ciclo exato repetido 4 vezes vale, 3 não; conta só as repetições inteiras; abaixo de 30 não vale", () => {
    expect(findRepetition(withRange(background(), 20, 27, (_, k) => (k % 2 === 0 ? 300 : 900)))).toEqual({ kind: "cycle", from: 20, to: 27, period: 2, repeats: 4 });
    expect(findRepetition(withRange(background(), 20, 25, (_, k) => (k % 2 === 0 ? 300 : 900)))).toBeUndefined();
    expect(findRepetition(withRange(background(), 20, 28, (_, k) => (k % 2 === 0 ? 300 : 900)))).toMatchObject({ from: 20, to: 28, repeats: 4 });
    expect(findRepetition(withRange(background(), 0, 7, (_, k) => (k % 2 === 0 ? 300 : 900)))).toMatchObject({ from: 0, to: 7 });
    expect(findRepetition(withRange(background(), 20, 27, (_, k) => (k % 2 === 0 ? 30 : 900)))).toMatchObject({ kind: "cycle" });
    expect(findRepetition(withRange(background(), 20, 27, (_, k) => (k % 2 === 0 ? 29 : 900)))).toBeUndefined();
    expect(findRepetition(withRange(background(), 20, 31, (_, k) => [300, 500, 900][k % 3]!))).toMatchObject({ kind: "cycle", period: 3, repeats: 4, from: 20, to: 31 });
  });
});

describe("patamar seguido de queda seca: cada limite na borda", () => {
  const base = () => flat(40, 100);

  it("devolve o patamar medido: horas, média, janela, regularidade e a queda", () => {
    const found = findPlateauCliff(put(base(), 10, flat(6, 400)), 100);
    expect(found).toEqual({ from: 10, to: 15, mean: 400, regularity: 0, cliffHour: 16, cliffDrop: 0.75 });
  });

  it("6 horas valem, 5 não (nem um patamar curto logo antes da queda)", () => {
    expect(findPlateauCliff(put(base(), 10, flat(5, 400)), 100)).toBeUndefined();
    expect(findPlateauCliff(put(base(), 10, [1000, 1000]), 100)).toBeUndefined();
  });

  it("a média precisa ser 4 vezes a base: 400 vale, 399 não", () => {
    expect(findPlateauCliff(put(base(), 10, flat(6, 399)), 100)).toBeUndefined();
  });

  it("a janela aceita até ±8%: 920/1080 vale (8% exatos), 919/1081 não", () => {
    const wobble = (low: number, high: number) => put(base(), 10, [1000, 1000, 1000, 1000, low, high]);
    expect(findPlateauCliff(wobble(920, 1080), 100)).toMatchObject({ from: 10, to: 15 });
    expect(findPlateauCliff(wobble(919, 1081), 100)).toBeUndefined();
  });

  it("a queda tem de ser de 70% ou mais: 300 vale, 301 não; sem hora seguinte não há queda", () => {
    const plateau = flat(6, 1000);
    expect(findPlateauCliff(put(base(), 10, [...plateau, 300]), 100)).toMatchObject({ cliffDrop: 0.7, cliffHour: 16 });
    expect(findPlateauCliff(put(base(), 10, [...plateau, 301]), 100)).toBeUndefined();
    expect(findPlateauCliff(put(flat(20, 100), 14, plateau), 100)).toBeUndefined();
  });

  it("o patamar se estende até onde a janela aguenta e, entre dois, fica o maior (empate: o primeiro)", () => {
    expect(findPlateauCliff(put(base(), 10, flat(8, 1000)), 100)).toMatchObject({ from: 10, to: 17 });
    const two = put(put(base(), 5, flat(6, 1000)), 20, flat(8, 2000));
    expect(findPlateauCliff(two, 100)).toMatchObject({ from: 20, to: 27, mean: 2000 });
    const tie = put(put(base(), 5, flat(6, 1000)), 20, flat(6, 2000));
    expect(findPlateauCliff(tie, 100)).toMatchObject({ from: 5, to: 10, mean: 1000 });
  });

  it("série sem patamar nenhum (só zeros) não dá nada", () => {
    expect(findPlateauCliff(flat(40, 0), 1)).toBeUndefined();
  });
});

describe("picos: pulso, queda abrupta e cauda orgânica", () => {
  it("pulso de uma hora: 15 vezes a base vale, 14,99 não; 500 views valem, 499 não", () => {
    expect(findPeaks(put(flat(40, 100), 20, [1500]), 100)).toEqual([{ kind: "pulse", from: 20, to: 20, peak: 1500, peakHour: 20, ramp: 0, tail: 0, endValue: 1500 }]);
    expect(findPeaks(put(flat(40, 100), 20, [1499]), 100)).toEqual([]);
    expect(findPeaks(put(flat(40, 10), 20, [500]), 10)).toMatchObject([{ kind: "pulse", peak: 500 }]);
    expect(findPeaks(put(flat(40, 10), 20, [499]), 10)).toEqual([]);
  });

  it("a cauda é o que passa de 10% do pico: vizinho abaixo disso não entra no pulso; igual ao limiar também não", () => {
    expect(findPeaks(put(flat(40, 10), 20, [900, 10000, 900]), 10)[0]).toMatchObject({ from: 21, to: 21 });
    expect(findPeaks(put(flat(40, 10), 20, [1000, 10000, 1000]), 10)[0]).toMatchObject({ from: 21, to: 21 });
    expect(findPeaks(put(flat(40, 10), 20, [1001, 10000, 1001]), 10)).toEqual([]); // 3 horas, mas as vizinhas passam de 10% e o fim não é seco: nem pulso nem queda

  });

  it("pulso de duas e de três horas é um pico só; de quatro já não é pulso", () => {
    expect(findPeaks(put(flat(40, 100), 20, [10000, 2500]), 100)).toEqual([{ kind: "pulse", from: 20, to: 21, peak: 10000, peakHour: 20, ramp: 0, tail: 1, endValue: 2500 }]);
    expect(findPeaks(put(flat(40, 100), 20, [10000, 9000, 8000]), 100)).toMatchObject([{ kind: "pulse", from: 20, to: 22 }]);
    expect(findPeaks(put(flat(40, 100), 20, [10000, 9000, 8000, 7000]), 100)).toMatchObject([{ kind: "abrupt_drop" }]);
  });

  it("o pulso acaba de uma vez: última hora com 25% do pico vale, 24,99% não", () => {
    expect(findPeaks(put(flat(40, 100), 20, [10000, 2500]), 100)).toMatchObject([{ kind: "pulse" }]);
    expect(findPeaks(put(flat(40, 100), 20, [10000, 2499]), 100)).toEqual([]);
  });

  it("subida antes do pico conta na rampa", () => {
    expect(findPeaks(put(flat(40, 100), 18, [3000, 6000, 10000]), 100)).toEqual([{ kind: "pulse", from: 18, to: 20, peak: 10000, peakHour: 20, ramp: 2, tail: 0, endValue: 10000 }]);
  });

  it("pico de duas horas é um pico só (a segunda hora não vira outro)", () => {
    expect(findPeaks(put(flat(40, 100), 20, [10000, 9000]), 100)).toHaveLength(1);
  });

  it("no máximo 5 picos", () => {
    let series = flat(80, 100);
    for (let k = 0; k < 6; k += 1) series = put(series, 5 + k * 10, [2000 + k * 100]);
    expect(findPeaks(series, 100)).toHaveLength(5);
  });

  it("queda abrupta: cluster de 4+ horas que acaba de uma vez a partir de 25% do pico", () => {
    const cluster = [10000, 9000, 6000, 2500];
    expect(findPeaks(put(flat(40, 100), 20, [...cluster, 700]), 100)).toEqual([{ kind: "abrupt_drop", from: 20, to: 23, peak: 10000, peakHour: 20, ramp: 0, tail: 3, endValue: 2500, dropTo: 700 }]); // o 700 que sobra depois não vira outro pico
    expect(findPeaks(put(flat(40, 100), 20, [...cluster.slice(0, 3), 2400, 700]), 100)).toEqual([]); // 24% do pico
    expect(findPeaks(put(flat(40, 100), 20, [...cluster, 750]), 100)).toMatchObject([{ kind: "abrupt_drop" }]); // 30% de 2500
    expect(findPeaks(put(flat(40, 100), 20, [...cluster, 760]), 100)).toEqual([]);
  });

  it("três horas altas sem chegar a 15 vezes a base não são pulso nem queda abrupta", () => {
    expect(findPeaks(put(flat(40, 1000), 20, [10000, 9000, 8000]), 1000)).toEqual([]);
  });

  it("cauda orgânica: pico de 5 vezes a base com 6 horas de queda gradual", () => {
    const tail = [6000, 4000, 2500, 1600, 1200, 1050];
    const found = findPeaks(put(flat(40, 100), 20, [10000, ...tail, 400]), 100);
    expect(found).toEqual([{ kind: "organic_decay", from: 20, to: 26, peak: 10000, peakHour: 20, ramp: 0, tail: 6, endValue: 1050 }]);
    expect(findPeaks(put(flat(40, 100), 20, [10000, ...tail.slice(0, 5), 400]), 100)).toEqual([]); // cauda de 5
  });

  it("o pico orgânico precisa de 5 vezes a base: exatamente 5 vale, abaixo disso o pico nem é examinado", () => {
    const decay = [1000, 900, 820, 740, 670, 600, 540, 490, 440, 380];
    expect(findPeaks(put(flat(40, 200), 20, decay), 200)).toMatchObject([{ kind: "organic_decay", peak: 1000, tail: 8 }]);
    expect(findPeaks(put(flat(40, 200), 20, [999, ...decay.slice(1)]), 200)).toEqual([]);
  });

  it("cauda que despenca num passo (30% do anterior) não é gradual, mesmo no último passo", () => {
    expect(findPeaks(put(flat(40, 100), 20, [10000, 7000, 6000, 5000, 4500, 4400, 1300, 400]), 100)).toEqual([]);
    expect(findPeaks(put(flat(40, 100), 20, [10000, 7000, 6000, 5000, 4500, 4400, 1500, 400]), 100)).toMatchObject([{ kind: "organic_decay", tail: 6 }]);
  });
});

describe("cauda gradual", () => {
  it("passos de até 1,3 vezes o anterior são calmos; 75% de passos calmos bastam, 62,5% não", () => {
    expect(isGradual([10000, 7000, 5000, 6600, 4700, 3400, 4500, 3200, 2300], 0, 8)).toBe(true); // 2 de 8 sobem mais que 30%
    expect(isGradual([10000, 7000, 5000, 6600, 4700, 6200, 4600, 6100, 4400], 0, 8)).toBe(false); // 3 de 8
    expect(isGradual([10000, 7000, 5000, 6600, 4700, 3400, 4500, 3200, 2300, 3100, 2200, 1500], 0, 11)).toBe(false); // 3 de 11 = 72,7% calmos, abaixo de 75%
    expect(isGradual([1000, 1300], 0, 1)).toBe(true); // exatamente 1,3 vezes ainda é calmo
    expect(isGradual([1000, 1310], 0, 1)).toBe(false);
  });

  it("um passo que cai a 30% ou menos do anterior desfaz a queda gradual, inclusive o último", () => {
    expect(isGradual([1000, 800, 240], 0, 2)).toBe(false);
    expect(isGradual([1000, 800, 241], 0, 2)).toBe(true);
    expect(isGradual([1000, 800, 700, 200], 0, 3)).toBe(false);
  });

  it("sem nenhum passo depois do pico não há cauda", () => {
    expect(isGradual([1000, 900], 1, 1)).toBe(false);
  });
});

describe("degrau persistente", () => {
  it("devolve a hora do degrau e os níveis; 2,5 vezes vale, 2,49 não", () => {
    expect(findStep([...flat(48, 100), ...flat(48, 250)])).toEqual({ from: 48, before: 100, after: 250 });
    expect(findStep([...flat(48, 100), ...flat(48, 249)])).toBeUndefined();
  });

  it("acha o degrau mesmo no último ponto em que ainda cabem 24 horas depois", () => {
    expect(findStep([...flat(24, 100), ...flat(24, 300)])).toMatchObject({ from: 24 });
  });

  it("tem de persistir: subir e voltar não é degrau; metade do tempo no nível alto ainda é (borda de 70%)", () => {
    expect(findStep([...flat(48, 100), ...flat(20, 250), ...flat(40, 100)])).toBeUndefined();
    expect(findStep([...flat(48, 100), ...flat(30, 250), ...flat(30, 100)])).toMatchObject({ from: 48 });
  });

  it("ignora o que parece degrau nas três primeiras horas da série", () => {
    expect(findStep([...flat(6, 250), ...flat(18, 100), ...flat(48, 250)])).toMatchObject({ from: 24 });
  });

  it("tem de ser rápido: uma rampa lenta de 24 horas não é degrau", () => {
    const ramp = Array.from({ length: 24 }, (_, k) => 100 + (150 * (k + 1)) / 24);
    expect(findStep([...flat(48, 100), ...ramp, ...flat(24, 250)])).toBeUndefined();
  });
});

describe("todos os patamares, do maior para o menor, sem sobreposição", () => {
  it("devolve o patamar longo e o curto, em ordem de tamanho", () => {
    const series = put(put(flat(80, 100), 5, flat(6, 1000)), 40, flat(12, 2000));
    expect(findPlateauCliffs(series, 100).map((p) => [p.from, p.to])).toEqual([[40, 51], [5, 10]]);
  });

  it("em empate de tamanho, o que começa antes vem primeiro", () => {
    const series = put(put(flat(80, 100), 5, flat(6, 1000)), 40, flat(6, 2000));
    expect(findPlateauCliffs(series, 100).map((p) => p.from)).toEqual([5, 40]);
  });

  it("janelas que se sobrepõem a um patamar já escolhido não viram outro", () => {
    expect(findPlateauCliffs(put(flat(40, 100), 10, flat(10, 1000)), 100)).toHaveLength(1);
  });

  it("sem patamar, lista vazia", () => {
    expect(findPlateauCliffs(flat(40, 100), 100)).toEqual([]);
  });
});
