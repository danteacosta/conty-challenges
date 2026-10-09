import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { civilDayInBrandZone, isDeadlineInPast, isLateFor, parseCalendarDate } from "../src/domain/deadline.ts";

describe("dia civil no fuso da marca (America/Sao_Paulo)", () => {
  it.each([
    ["2026-03-13T02:59:59.999Z", "2026-03-12", "último milissegundo do dia 12 em SP, quando o UTC já virou para o 13"],
    ["2026-03-13T03:00:00.000Z", "2026-03-13", "primeiro instante do dia 13 em SP"],
    ["2026-03-12T03:00:00.000Z", "2026-03-12", "primeiro instante do dia 12 em SP"],
    ["2026-03-12T02:59:59.999Z", "2026-03-11", "último milissegundo do dia 11 em SP"],
    ["2026-12-31T23:30:00-03:00", "2026-12-31", "virada de ano escrita com o offset de SP"],
    ["2027-01-01T02:59:59.999Z", "2026-12-31", "virada de ano em UTC, ainda 31/12 em SP"],
    ["2027-01-01T03:00:00.000Z", "2027-01-01", "ano novo em SP"],
  ])("%s é o dia %s (%s)", (instant, day) => {
    expect(civilDayInBrandZone(new Date(instant))).toBe(day);
  });

  it("usa o horário de verão que o Brasil tinha em 2018 (offset -02:00): não é um -03:00 fixo", () => {
    // O horário de verão de 2018 começou em 04/11 à 00:00 local. Às 02:30Z de 05/11 eram 00:30 de 05/11 em SP.
    // Com um -03:00 fixo esse instante cairia em 04/11 às 23:30.
    expect(civilDayInBrandZone(new Date("2018-11-05T02:30:00.000Z"))).toBe("2018-11-05");
    expect(civilDayInBrandZone(new Date("2018-11-05T01:59:59.999Z"))).toBe("2018-11-04");
  });
});

describe("prazo já passado", () => {
  const deadline = "2026-03-12";
  it("no último instante do dia do prazo ainda vale", () => {
    expect(isDeadlineInPast(deadline, new Date("2026-03-13T02:59:59.999Z"))).toBe(false);
  });
  it("no primeiro instante do dia seguinte já passou", () => {
    expect(isDeadlineInPast(deadline, new Date("2026-03-13T03:00:00.000Z"))).toBe(true);
  });
  it("prazo de hoje vale; prazo de ontem não", () => {
    const now = new Date("2026-03-10T15:00:00.000Z");
    expect(isDeadlineInPast("2026-03-10", now)).toBe(false);
    expect(isDeadlineInPast("2026-03-09", now)).toBe(true);
  });
  it("prazo no futuro vale", () => {
    expect(isDeadlineInPast("2026-04-01", new Date("2026-03-10T15:00:00.000Z"))).toBe(false);
  });
  it("propriedade: o prazo está no passado exatamente a partir do primeiro instante do dia seguinte em SP", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), (days) => {
        const base = Date.parse("2026-01-01T03:00:00.000Z"); // 00:00 de 01/01 em SP
        const dayStart = base + days * 86_400_000;
        const deadlineDate = civilDayInBrandZone(new Date(dayStart));
        const nextDayStart = dayStart + 86_400_000;
        expect(isDeadlineInPast(deadlineDate, new Date(nextDayStart - 1))).toBe(false);
        expect(isDeadlineInPast(deadlineDate, new Date(nextDayStart))).toBe(true);
      }),
    );
  });
});

describe("versão tardia", () => {
  it("enviada até o último instante do dia do prazo não é tardia; no primeiro do dia seguinte é", () => {
    expect(isLateFor("2026-03-12", new Date("2026-03-13T02:59:59.999Z"))).toBe(false);
    expect(isLateFor("2026-03-12", new Date("2026-03-13T03:00:00.000Z"))).toBe(true);
  });
});

describe("parseCalendarDate: data de calendário estrita", () => {
  it.each(["2026-03-12", "2024-02-29", "2000-02-29", "2026-12-31", "2026-01-01", "2026-01-31", "2026-02-28", "2026-04-30", "2026-06-30"])("aceita %s", (value) => {
    expect(parseCalendarDate(value)).toBe(value);
  });
  it.each([
    "2026-02-30", "2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-01-32",
    "2026-3-12", "26-03-12", "2026-03-12T10:00:00Z", " 2026-03-12", "2026-03-12 ", "12/03/2026", "", "amanhã",
  ])("recusa %j", (value) => {
    expect(parseCalendarDate(value)).toBeNull();
  });
  it.each([null, undefined, 20260312, {}, [], ["2026-03-12"]])("recusa o que não é texto: %j", (value) => {
    expect(parseCalendarDate(value)).toBeNull();
  });
});
