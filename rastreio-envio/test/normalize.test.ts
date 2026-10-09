import { describe, expect, it } from "vitest";
import { normalizeEvent } from "../src/domain/normalize.ts";
import { SUPPORTED_CARRIERS } from "../src/domain/dialects.ts";
import { viaRapida } from "./fixtures.ts";

describe("normalização de status de transportadora", () => {
  it.each([
    ["via-rapida", "10", "posted"],
    ["via-rapida", "20", "in_transit"],
    ["via-rapida", "21", "in_transit"],
    ["via-rapida", "30", "out_for_delivery"],
    ["via-rapida", "40", "delivered"],
    ["via-rapida", "90", "exception"],
    ["via-rapida", "91", "exception"],
    ["correio-norte", "OBJETO_POSTADO", "posted"],
    ["correio-norte", "EM_TRANSITO", "in_transit"],
    ["correio-norte", "SAIU_PARA_ENTREGA", "out_for_delivery"],
    ["correio-norte", "ENTREGUE", "delivered"],
    ["correio-norte", "TENTATIVA_FALHA", "exception"],
    ["correio-norte", "DEVOLVIDO", "exception"],
  ])("%s %s vira %s", (carrier, raw, expected) => {
    const event = normalizeEvent(carrier, viaRapida(raw, 0));
    expect(event.status).toBe(expected);
    expect(event.reason).toBeNull();
  });

  it("ignora maiúsculas e espaços no código bruto", () => {
    expect(normalizeEvent("correio-norte", viaRapida("  entregue ", 0)).status).toBe("delivered");
  });

  it("status que a transportadora inventou vira exceção com motivo e o bruto preservado, nunca entregue", () => {
    const event = normalizeEvent("via-rapida", viaRapida("AGUARDANDO_RETIRADA_XYZ", 0, { description: "Aguardando retirada" }));
    expect(event).toMatchObject({
      status: "exception",
      reason: "unmapped_carrier_status",
      rawStatus: "AGUARDANDO_RETIRADA_XYZ",
      description: "Aguardando retirada",
    });
  });

  it("código de uma transportadora não vale na outra (40 em correio-norte é desconhecido)", () => {
    expect(normalizeEvent("correio-norte", viaRapida("40", 0))).toMatchObject({ status: "exception", reason: "unmapped_carrier_status" });
  });

  it("transportadora desconhecida: tudo vira exceção com motivo, inclusive algo que parece entregue", () => {
    expect(normalizeEvent("transp-fantasma", viaRapida("ENTREGUE", 0))).toMatchObject({
      status: "exception",
      reason: "unknown_carrier",
    });
  });

  it("a chave de deduplicação é a mesma para a mesma ocorrência, venha ela com o fuso que vier", () => {
    const a = normalizeEvent("via-rapida", viaRapida("20", 0, { occurredAt: "2026-06-01T10:00:00.000Z" }));
    const b = normalizeEvent("via-rapida", viaRapida("20", 0, { occurredAt: "2026-06-01T07:00:00-03:00", description: "outro texto" }));
    expect(b.dedupeKey).toBe(a.dedupeKey);
  });

  it("a chave de deduplicação ignora maiúsculas e espaços do código bruto, mas distingue códigos e horários diferentes", () => {
    const base = normalizeEvent("correio-norte", viaRapida("EM_TRANSITO", 0));
    expect(normalizeEvent("correio-norte", viaRapida(" em_transito ", 0)).dedupeKey).toBe(base.dedupeKey);
    expect(normalizeEvent("correio-norte", viaRapida("ENTREGUE", 0)).dedupeKey).not.toBe(base.dedupeKey);
    expect(normalizeEvent("correio-norte", viaRapida("EM_TRANSITO", 1000)).dedupeKey).not.toBe(base.dedupeKey);
    expect(normalizeEvent("via-rapida", viaRapida("EM_TRANSITO", 0)).dedupeKey).not.toBe(base.dedupeKey);
  });

  it("publica a lista de transportadoras suportadas", () => {
    expect(SUPPORTED_CARRIERS).toEqual(["correio-norte", "via-rapida"]);
  });
});
