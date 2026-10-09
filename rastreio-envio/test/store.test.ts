import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { ingestEvents, loadShipment, normalizeCode, registerShipment } from "../src/store.ts";
import { IN_TRANSIT, POSTED, DELIVERED, H, iso, viaRapida } from "./fixtures.ts";

const now = () => new Date("2026-06-01T00:00:00.000Z");
const shipment = (carrier = "via-rapida") => ({ code: "BR1", carrier, creatorId: null, campaignId: null });

describe("persistência de envios", () => {
  it("cadastrar duas vezes o mesmo código e transportadora é 'exists'; com outra transportadora é 'conflict'", () => {
    const db = openDatabase(":memory:");
    expect(registerShipment(db, shipment(), now)).toBe("created");
    expect(registerShipment(db, shipment(), now)).toBe("exists");
    expect(registerShipment(db, shipment("correio-norte"), now)).toBe("conflict");
  });

  it("ingerir eventos de um envio que não existe devolve null e não grava nada", () => {
    const db = openDatabase(":memory:");
    expect(ingestEvents(db, "NADA", [viaRapida(POSTED, 0)], now)).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM tracking_events").get() as { n: number }).n).toBe(0);
  });

  it("normaliza o código: sem espaços nas pontas e em maiúsculas", () => {
    expect(normalizeCode("  ab-1x ")).toBe("AB-1X");
  });

  it("o histórico sai ordenado pela data de ocorrência, não pela ordem em que foi gravado", () => {
    const db = openDatabase(":memory:");
    registerShipment(db, shipment(), now);
    ingestEvents(db, "BR1", [viaRapida(DELIVERED, 9 * H)], now);
    ingestEvents(db, "BR1", [viaRapida(POSTED, 0)], now);
    ingestEvents(db, "BR1", [viaRapida(IN_TRANSIT, 4 * H)], now);
    expect(loadShipment(db, "BR1")!.history.map((h) => h.occurred_at)).toEqual([iso(0), iso(4 * H), iso(9 * H)]);
  });

  it("eventos no mesmo instante saem numa ordem estável", () => {
    const db = openDatabase(":memory:");
    registerShipment(db, shipment(), now);
    ingestEvents(db, "BR1", [viaRapida("21", 0), viaRapida("20", 0)], now);
    expect(loadShipment(db, "BR1")!.history.map((h) => h.raw_status)).toEqual(["20", "21"]);
  });

  it("os campos derivados do envio acompanham o histórico", () => {
    const db = openDatabase(":memory:");
    registerShipment(db, shipment(), now);
    ingestEvents(db, "BR1", [viaRapida(POSTED, 0), viaRapida(DELIVERED, 5 * H)], now);
    expect(db.prepare("SELECT status, started_at, delivered_at FROM shipments").get()).toEqual({
      status: "delivered",
      started_at: iso(0),
      delivered_at: iso(5 * H),
    });
  });
});
