import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { allocateRefund } from "../src/refunds.ts";
import { getOrder, ingestOrder, ingestRefund } from "../src/store.ts";
import { toCents } from "../src/money.ts";

const now = () => "2026-06-01T00:00:00.000Z";
const signals = { couponCodes: [], utmHandle: null };

describe("invariantes de estorno", () => {
  it("para qualquer ordem de chegada (inclusive estorno antes do pedido), o estornado é min(total, soma pedida) e nunca passa do total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.array(fc.integer({ min: 1, max: 60_000 }), { minLength: 1, maxLength: 8 }),
        fc.nat(),
        (total, amounts, orderPosition) => {
          const db = openDatabase(":memory:");
          const events: Array<() => void> = amounts.map((amount, i) => () =>
            void ingestRefund(db, { id: `r${i}`, orderId: "1", amountCents: amount }, now),
          );
          events.splice(
            orderPosition % (events.length + 1),
            0,
            () => void ingestOrder(db, { id: "1", totalCents: total, currency: "BRL", financialStatus: "paid", createdAt: null, signals }, now),
          );
          events.forEach((run) => run());

          const result = getOrder(db, "1")!;
          const requested = amounts.reduce((a, b) => a + b, 0);
          expect(result.refunded_cents).toBe(Math.min(total, requested));
          expect(result.refunded_cents).toBeLessThanOrEqual(total);
          expect(result.net_cents).toBeGreaterThanOrEqual(0);
          expect(result.refunds).toHaveLength(amounts.length);
          expect(result.refunds.every((r) => r.status !== "pending")).toBe(true);
          // o histórico guarda o que foi pedido, mesmo quando foi cortado
          expect(result.refunds.reduce((s, r) => s + r.requested_cents, 0)).toBe(requested);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reenviar qualquer evento já recebido não muda o resultado", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 6 }), (amounts) => {
        const once = openDatabase(":memory:");
        const twice = openDatabase(":memory:");
        for (const db of [once, twice]) {
          ingestOrder(db, { id: "1", totalCents: 8000, currency: "BRL", financialStatus: "paid", createdAt: null, signals }, now);
        }
        amounts.forEach((a, i) => {
          ingestRefund(once, { id: `r${i}`, orderId: "1", amountCents: a }, now);
          ingestRefund(twice, { id: `r${i}`, orderId: "1", amountCents: a }, now);
          ingestRefund(twice, { id: `r${i}`, orderId: "1", amountCents: a }, now);
        });
        expect(getOrder(twice, "1")).toEqual(getOrder(once, "1"));
      }),
    );
  });
});

describe("allocateRefund", () => {
  it("aplica tudo quando cabe", () => {
    expect(allocateRefund(10000, 2000, 3000)).toEqual({ applied: 3000, status: "applied" });
  });
  it("aplica exatamente o que sobra quando bate no teto, sem marcar corte", () => {
    expect(allocateRefund(10000, 7000, 3000)).toEqual({ applied: 3000, status: "applied" });
  });
  it("corta o excedente", () => {
    expect(allocateRefund(10000, 7000, 3001)).toEqual({ applied: 3000, status: "clamped" });
  });
  it("não aplica nada quando já está tudo estornado", () => {
    expect(allocateRefund(10000, 10000, 1)).toEqual({ applied: 0, status: "clamped" });
  });
});

describe("toCents", () => {
  it.each([
    ["100.00", 10000],
    ["0.5", 50],
    ["1", 100],
    ["19.99", 1999],
    [12.3, 1230],
  ])("%s -> %s", (input, cents) => expect(toCents(input)).toBe(cents));
  it.each(["", "abc", "-1", "1.234", "1,50", null, undefined, NaN, {}])("recusa %s", (input) =>
    expect(toCents(input)).toBeNull(),
  );
});
