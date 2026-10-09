import { describe, expect, it } from "vitest";
import { parseInstant } from "../src/instant.ts";

describe("parseInstant: instante ISO-8601 com fuso, estrito", () => {
  it.each([
    ["2026-06-01T12:00:00Z", "2026-06-01T12:00:00.000Z"],
    ["2026-06-01T12:00:00.000Z", "2026-06-01T12:00:00.000Z"],
    ["2026-06-01T12:00:00.5Z", "2026-06-01T12:00:00.500Z"],
    ["2026-06-01T12:00:00.123456Z", "2026-06-01T12:00:00.123Z"],
    ["2026-06-01T09:00:00-03:00", "2026-06-01T12:00:00.000Z"],
    ["2026-06-01T15:30:00+03:30", "2026-06-01T12:00:00.000Z"],
    ["2024-02-29T00:00:00Z", "2024-02-29T00:00:00.000Z"],
    ["2000-02-29T00:00:00Z", "2000-02-29T00:00:00.000Z"],
    ["2026-12-31T23:59:59Z", "2026-12-31T23:59:59.000Z"],
    ["2026-03-12T23:59:59.999-03:00", "2026-03-13T02:59:59.999Z"],
    ["0099-01-01T00:00:00Z", "0099-01-01T00:00:00.000Z"],
    ["2026-06-01T10:00:00+23:59", "2026-05-31T10:01:00.000Z"],
    ["2026-06-01T10:00:00-23:59", "2026-06-02T09:59:00.000Z"],
    ["2026-06-01T10:00:00+23:00", "2026-05-31T11:00:00.000Z"],
    ["2026-06-01T10:00:00+00:00", "2026-06-01T10:00:00.000Z"],
  ])("aceita %s", (input, expected) => {
    expect(parseInstant(input)).toBe(expected);
  });

  it.each([
    ["2026-02-30T10:00:00Z", "30 de fevereiro"],
    ["2026-02-29T10:00:00Z", "29 de fevereiro em ano comum"],
    ["1900-02-29T10:00:00Z", "29 de fevereiro em ano centenário não bissexto"],
    ["2026-04-31T10:00:00Z", "31 de abril"],
    ["2026-06-31T10:00:00Z", "31 de junho"],
    ["2026-13-01T10:00:00Z", "mês 13"],
    ["2026-00-10T10:00:00Z", "mês 0"],
    ["2026-01-00T10:00:00Z", "dia 0"],
    ["2026-01-32T10:00:00Z", "dia 32"],
    ["2026-06-01T24:00:00Z", "hora 24"],
    ["2026-06-01T10:60:00Z", "minuto 60"],
    ["2026-06-01T10:00:60Z", "segundo 60"],
    ["2026-06-01T10:00:00+24:00", "offset de 24 horas"],
    ["2026-06-01T10:00:00+03:60", "offset com minuto 60"],
    ["2026-06-01T10:00:00", "sem fuso"],
    ["2026-06-01T10:00Z", "sem segundos"],
    ["2026-06-01", "só a data"],
    ["2026-06-01 10:00:00Z", "separador de espaço"],
    ["2026-06-01t10:00:00z", "minúsculas"],
    ["ontem", "texto livre"],
    ["", "vazio"],
    ["2026-06-01T10:00:00.Z", "fração vazia"],
    ["2026-06-01T10:00:00Z ", "espaço sobrando"],
    ["x2026-06-01T10:00:00Z", "lixo antes"],
    ["2026-06-01T10:00:00Zx", "lixo depois"],
    ["\n2026-06-01T10:00:00Z", "quebra de linha antes"],
  ])("recusa %s (%s)", (input) => {
    expect(parseInstant(input)).toBeNull();
  });

  it.each([null, undefined, 20260601, {}, [], true])("recusa o que não é texto: %j", (input) => {
    expect(parseInstant(input)).toBeNull();
  });

  it("recusa o que só vira um instante válido quando convertido em texto (lista ou objeto com toString)", () => {
    expect(parseInstant(["2026-06-01T10:00:00Z"])).toBeNull();
    expect(parseInstant({ toString: () => "2026-06-01T10:00:00Z" })).toBeNull();
  });
});
