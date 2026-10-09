import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeEvent } from "../src/domain/normalize.ts";
import { foldEvents } from "../src/domain/status.ts";
import type { NormalizedEvent } from "../src/domain/types.ts";
import { DELIVERED, FAILED_ATTEMPT, H, IN_TRANSIT, OUT_FOR_DELIVERY, POSTED, iso, viaRapida } from "./fixtures.ts";

const ev = (raw: string, offsetMs: number): NormalizedEvent => normalizeEvent("via-rapida", viaRapida(raw, offsetMs));

describe("status atual a partir do histórico", () => {
  it("sem eventos não há status (o pacote só foi cadastrado)", () => {
    expect(foldEvents([])).toMatchObject({ status: null, reason: "no_events_yet", startedAt: null, deliveredAt: null });
  });

  it("vale o evento mais recente por data de ocorrência, não pela ordem de chegada", () => {
    const fold = foldEvents([ev(OUT_FOR_DELIVERY, 3 * H), ev(POSTED, 0), ev(IN_TRANSIT, 1 * H)]);
    expect(fold.status).toBe("out_for_delivery");
    expect(fold.startedAt).toBe(iso(0));
    expect(fold.lastEventAt).toBe(iso(3 * H));
  });

  it("evento antigo que chega depois não faz o status voltar", () => {
    const arrivedFirst = ev(OUT_FOR_DELIVERY, 3 * H);
    const arrivedLater = ev(IN_TRANSIT, 1 * H);
    expect(foldEvents([arrivedFirst]).status).toBe("out_for_delivery");
    expect(foldEvents([arrivedFirst, arrivedLater]).status).toBe("out_for_delivery");
  });

  it("exceção que se resolve: trânsito depois de uma tentativa falha recupera o status", () => {
    const fold = foldEvents([ev(IN_TRANSIT, 0), ev(FAILED_ATTEMPT, 2 * H), ev(OUT_FOR_DELIVERY, 5 * H)]);
    expect(fold.status).toBe("out_for_delivery");
  });

  it("exceção mais recente que o trânsito é o status atual", () => {
    expect(foldEvents([ev(IN_TRANSIT, 0), ev(FAILED_ATTEMPT, 2 * H)]).status).toBe("exception");
  });

  it("entregue é terminal: evento posterior fica no histórico, marcado, e não muda o status", () => {
    const delivered = ev(DELIVERED, 5 * H);
    const late = ev(IN_TRANSIT, 6 * H);
    const fold = foldEvents([delivered, late]);
    expect(fold.status).toBe("delivered");
    expect(fold.deliveredAt).toBe(iso(5 * H));
    expect([...fold.afterDelivered]).toEqual([late.dedupeKey]);
  });

  it("uma segunda confirmação de entrega, mais tarde, não é marcada como posterior à entrega", () => {
    const fold = foldEvents([ev(DELIVERED, 5 * H), ev(DELIVERED, 6 * H)]);
    expect(fold.afterDelivered.size).toBe(0);
    expect(fold.deliveredAt).toBe(iso(5 * H));
  });

  it("evento no mesmo instante da entrega não é marcado como posterior", () => {
    expect(foldEvents([ev(DELIVERED, 5 * H), ev(IN_TRANSIT, 5 * H)]).afterDelivered.size).toBe(0);
  });

  it("evento anterior à entrega não é marcado como posterior", () => {
    const transit = ev(IN_TRANSIT, 1 * H);
    const fold = foldEvents([ev(DELIVERED, 5 * H), transit]);
    expect(fold.afterDelivered.size).toBe(0);
  });

  it("empate de horário: entregue vence exceção, que vence saiu para entrega, trânsito e postado", () => {
    expect(foldEvents([ev(POSTED, 0), ev(IN_TRANSIT, 0)]).status).toBe("in_transit");
    expect(foldEvents([ev(IN_TRANSIT, 0), ev(OUT_FOR_DELIVERY, 0)]).status).toBe("out_for_delivery");
    expect(foldEvents([ev(OUT_FOR_DELIVERY, 0), ev(FAILED_ATTEMPT, 0)]).status).toBe("exception");
    expect(foldEvents([ev(FAILED_ATTEMPT, 0), ev(DELIVERED, 0)]).status).toBe("delivered");
  });

  it("status desconhecido mais recente vira exceção com o motivo do evento que decidiu", () => {
    const unknown = normalizeEvent("via-rapida", viaRapida("INVENTADO", 4 * H));
    const fold = foldEvents([ev(IN_TRANSIT, 0), unknown]);
    expect(fold).toMatchObject({ status: "exception", reason: "unmapped_carrier_status" });
  });

  it("status desconhecido nunca produz entregue, mesmo sem outros eventos", () => {
    const fold = foldEvents([normalizeEvent("via-rapida", viaRapida("ENTREGUE_MAS_NAO_SEI", 0))]);
    expect(fold.status).toBe("exception");
    expect(fold.deliveredAt).toBeNull();
  });
});

describe("status atual: propriedades", () => {
  const rawArb = fc.constantFrom(POSTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, FAILED_ATTEMPT, "INVENTADO");
  const eventsArb = fc
    .array(fc.record({ raw: rawArb, ms: fc.integer({ min: 0, max: 20 }) }), { maxLength: 8 })
    .map((list) => list.map((e) => ev(e.raw, e.ms * H)));

  it("qualquer ordem de chegada dos mesmos eventos dá o mesmo status e a mesma marcação", () => {
    fc.assert(
      fc.property(eventsArb, fc.nat(), (events, seed) => {
        const shuffled = [...events.slice(seed % (events.length || 1)), ...events.slice(0, seed % (events.length || 1))].reverse();
        const a = foldEvents(events);
        const b = foldEvents(shuffled);
        expect(b.status).toBe(a.status);
        expect(b.reason).toBe(a.reason);
        expect([...b.afterDelivered].sort()).toEqual([...a.afterDelivered].sort());
      }),
    );
  });

  it("reenviar eventos já recebidos não muda nada", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const unique = new Map(events.map((e) => [e.dedupeKey, e]));
        const once = foldEvents([...unique.values()]);
        const twice = foldEvents([...unique.values(), ...unique.values()]);
        expect(twice.status).toBe(once.status);
      }),
    );
  });

  it("entregue só aparece se houve um evento de entrega mapeado, e depois dele o status não muda", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const fold = foldEvents(events);
        const hasDelivered = events.some((e) => e.status === "delivered");
        expect(fold.status === "delivered").toBe(hasDelivered);
        if (hasDelivered) {
          const deliveredAt = Math.min(...events.filter((e) => e.status === "delivered").map((e) => Date.parse(e.occurredAt)));
          expect(Date.parse(fold.deliveredAt as string)).toBe(deliveredAt);
        }
      }),
    );
  });
});
