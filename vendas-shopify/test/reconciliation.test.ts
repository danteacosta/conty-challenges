import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { reconciliation, registerCreator } from "../src/store.ts";
import { setup } from "./helpers.ts";

const HUGE = "999999999999.99";

async function ana() {
  const t = setup();
  await t.creator("crt_ana", "ANA10", "ana");
  await t.creator("crt_bia", "BIA10", "bia");
  return t;
}

describe("reconciliação: total = atribuído a criadores + sem criador", () => {
  it("o exemplo do enunciado: Ana 100, sem criador 50, estorno de 10 no sem criador", async () => {
    const t = await ana();
    await t.order({ id: 1, total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    await t.order({ id: 2, total_price: "50.00" });
    await t.refund({ id: "r1", order_id: 2, amount: "10.00" });
    const { status, body } = await t.get("/reconciliation");
    expect(status).toBe(200);
    expect(body.total).toMatchObject({ orders: 2, gross_cents: 15000, refunded_cents: 1000, net_cents: 14000 });
    expect(body.attributed).toMatchObject({ orders: 1, gross_cents: 10000, refunded_cents: 0, net_cents: 10000 });
    expect(body.unattributed).toMatchObject({ orders: 1, gross_cents: 5000, refunded_cents: 1000, net_cents: 4000 });
    expect(body.reconciles).toBe(true);
    expect(body.total.exact).toEqual({ gross_cents: "15000", refunded_cents: "1000", net_cents: "14000" });
  });

  it("a soma dos criadores é o atribuído, e cada criador bate com /creators/:id/sales", async () => {
    const t = await ana();
    await t.order({ id: 1, total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    await t.order({ id: 2, total_price: "70.00", discount_codes: [{ code: "BIA10" }] });
    await t.order({ id: 3, total_price: "30.00", discount_codes: [{ code: "ANA10" }] });
    await t.refund({ id: "r1", order_id: 3, amount: "5.00" });
    const { body } = await t.get("/reconciliation");
    expect(body.attributed.creators.map((c: any) => [c.creator_id, c.orders, c.gross_cents, c.refunded_cents, c.net_cents])).toEqual([
      ["crt_ana", 2, 13000, 500, 12500],
      ["crt_bia", 1, 7000, 0, 7000],
    ]);
    for (const creator of body.attributed.creators) {
      const sales = (await t.get(`/creators/${creator.creator_id}/sales`)).body;
      expect(sales).toMatchObject({ orders: creator.orders, gross_cents: creator.gross_cents, refunded_cents: creator.refunded_cents, net_cents: creator.net_cents });
    }
    expect(body.attributed.net_cents).toBe(12500 + 7000);
    expect(body.unattributed).toMatchObject({ orders: 0, net_cents: 0 });
  });

  it("os criadores saem em ordem de id, não de cadastro", async () => {
    const t = setup();
    for (const [id, coupon, utm] of [["crt_c", "C10", "c"], ["crt_a", "A10", "a"], ["crt_b", "B10", "b"]] as const) await t.creator(id, coupon, utm);
    await t.order({ id: 1, total_price: "10.00", discount_codes: [{ code: "C10" }] });
    await t.order({ id: 2, total_price: "20.00", discount_codes: [{ code: "A10" }] });
    await t.order({ id: 3, total_price: "30.00", discount_codes: [{ code: "B10" }] });
    expect((await t.get("/reconciliation")).body.attributed.creators.map((c: any) => c.creator_id)).toEqual(["crt_a", "crt_b", "crt_c"]);
  });

  it("pedido pendente fica fora, e o estorno que chegou antes do pedido pago só entra quando o crédito nasce", async () => {
    const t = await ana();
    await t.order({ id: 1, total_price: "100.00", financial_status: "pending", discount_codes: [{ code: "ANA10" }] });
    await t.refund({ id: "r1", order_id: 1, amount: "20.00" });
    expect((await t.get("/reconciliation")).body.total).toMatchObject({ orders: 0, gross_cents: 0, refunded_cents: 0 });
    await t.order({ id: 1, total_price: "100.00", financial_status: "paid", discount_codes: [{ code: "ANA10" }] });
    const { body } = await t.get("/reconciliation");
    expect(body.total).toMatchObject({ orders: 1, gross_cents: 10000, refunded_cents: 2000, net_cents: 8000 });
    expect(body.reconciles).toBe(true);
  });

  it("estorno repetido e estorno cortado no teto contam uma vez só", async () => {
    const t = await ana();
    await t.order({ id: 1, total_price: "50.00" });
    await t.refund({ id: "r1", order_id: 1, amount: "40.00" });
    await t.refund({ id: "r1", order_id: 1, amount: "40.00" });
    await t.refund({ id: "r2", order_id: 1, amount: "40.00" }); // só cabem 10,00
    const { body } = await t.get("/reconciliation");
    expect(body.total).toMatchObject({ orders: 1, gross_cents: 5000, refunded_cents: 5000, net_cents: 0 });
    expect(body.reconciles).toBe(true);
  });

  it("sem pedidos: tudo zero e reconcilia", async () => {
    const t = setup();
    const { body } = await t.get("/reconciliation");
    expect(body).toMatchObject({ reconciles: true, total: { orders: 0, gross_cents: 0 }, attributed: { creators: [] }, unattributed: { orders: 0 } });
  });

  it("valores além de 2^53 saem exatos (BigInt) e a conta fecha", async () => {
    const t = await ana();
    for (let i = 1; i <= 60; i += 1) await t.order({ id: i, total_price: HUGE, discount_codes: [{ code: "ANA10" }] });
    for (let i = 61; i <= 91; i += 1) await t.order({ id: i, total_price: HUGE });
    const { body } = await t.get("/reconciliation");
    expect(body.total.gross_cents).toBeNull();
    expect(body.total.exact.gross_cents).toBe("9099999999999909");
    expect(body.attributed.exact.gross_cents).toBe("5999999999999940");
    expect(body.unattributed.exact.gross_cents).toBe("3099999999999969");
    expect(body.reconciles).toBe(true);
  });

  it("a conta fecha mesmo quando a soma passa de 64 bits no SQLite", () => {
    const db = openDatabase(":memory:");
    registerCreator(db, { id: "crt_ana", couponCode: "ANA10", utmHandle: "ana" });
    db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100000)
             INSERT INTO orders (id, total_cents, currency, financial_status, counted, creator_id, attribution_json, received_at)
             SELECT 'o' || i, 99999999999999, 'BRL', 'paid', 1, CASE WHEN i % 2 = 0 THEN 'crt_ana' ELSE NULL END, '{}', 'x' FROM n`);
    const refund = db.prepare("INSERT INTO refunds (id, order_id, requested_cents, applied_cents, status, received_at) VALUES (?, ?, ?, ?, 'applied', 'x')");
    refund.run("r1", "o1", 4_000, 4_000); // sem criador
    refund.run("r2", "o2", 600, 600); // com criador
    const result = reconciliation(db);
    expect(result.reconciles).toBe(true);
    expect(result.total.exact).toEqual({ gross_cents: "9999999999999900000", refunded_cents: "4600", net_cents: "9999999999999895400" });
    expect(result.attributed.exact).toEqual({ gross_cents: "4999999999999950000", refunded_cents: "600", net_cents: "4999999999999949400" });
    expect(result.unattributed.exact.refunded_cents).toBe("4000");
    expect(createApp(db)).toBeDefined();
  });
});
