import { describe, expect, it } from "vitest";
import { assessDelay } from "../src/domain/delay.ts";
import { H, iso } from "./fixtures.ts";

const LIMIT = 72; // horas
const assess = (over: Partial<Parameters<typeof assessDelay>[0]> & { nowMs: number }) =>
  assessDelay({
    status: "in_transit",
    startedAt: iso(0),
    deliveredAt: null,
    now: new Date(iso(over.nowMs)),
    thresholdHours: LIMIT,
    ...over,
  });

describe("atraso de entrega", () => {
  it("no limite exato não é atraso, 1 ms depois é", () => {
    expect(assess({ nowMs: LIMIT * H }).delayed).toBe(false);
    expect(assess({ nowMs: LIMIT * H + 1 }).delayed).toBe(true);
  });

  it("informa o tempo decorrido, o limite e o início", () => {
    expect(assess({ nowMs: 80 * H })).toMatchObject({ delayed: true, elapsedHours: 80, thresholdHours: LIMIT, startedAt: iso(0) });
  });

  it("entrega dentro do prazo nunca é atraso, nem consultada muito depois", () => {
    const result = assess({ status: "delivered", deliveredAt: iso(50 * H), nowMs: 900 * H });
    expect(result).toMatchObject({ delayed: false, deliveredLate: false });
  });

  it("entrega que demorou mais que o limite não é atraso em andamento, só fica informada como tardia", () => {
    const result = assess({ status: "delivered", deliveredAt: iso(100 * H), nowMs: 900 * H });
    expect(result).toMatchObject({ delayed: false, deliveredLate: true });
  });

  it("entrega exatamente no limite não é tardia", () => {
    expect(assess({ status: "delivered", deliveredAt: iso(LIMIT * H), nowMs: 900 * H }).deliveredLate).toBe(false);
  });

  it("pacote parado em exceção também conta como atraso quando passa do limite", () => {
    expect(assess({ status: "exception", nowMs: LIMIT * H + 1 }).delayed).toBe(true);
  });

  it("sem nenhum evento, o relógio corre desde o cadastro", () => {
    expect(assess({ status: null, nowMs: LIMIT * H + 1 }).delayed).toBe(true);
    expect(assess({ status: null, nowMs: 1 * H }).delayed).toBe(false);
  });

  it("início no futuro em relação ao relógio (skew) não é atraso nem tempo negativo", () => {
    const result = assess({ startedAt: iso(10 * H), nowMs: 0 });
    expect(result.delayed).toBe(false);
    expect(result.elapsedHours).toBe(0);
  });

  it("entregue não é entrega tardia quando a data de entrega não é conhecida", () => {
    expect(assess({ status: "delivered", deliveredAt: null, nowMs: 900 * H })).toMatchObject({ delayed: false, deliveredLate: null });
  });
});
