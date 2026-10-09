import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

async function withOrder() {
  const t = setup();
  await t.creator("crt_ana", "ANA10", "ana");
  await t.order({ id: 1, total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
  return t;
}

describe("estornos", () => {
  it("estorno parcial reduz o líquido, mantém a atribuição e o histórico", async () => {
    const t = await withOrder();
    const res = await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    expect(res.body).toMatchObject({ result: "applied", applied_cents: 3000 });

    const order = (await t.get("/orders/1")).body;
    expect(order.attribution.creator_id).toBe("crt_ana");
    expect(order.refunded_cents).toBe(3000);
    expect(order.net_cents).toBe(7000);
    expect(order.refunds).toHaveLength(1);

    expect((await t.get("/creators/crt_ana/sales")).body).toMatchObject({
      orders: 1,
      gross_cents: 10000,
      refunded_cents: 3000,
      net_cents: 7000,
    });
  });

  it("estorno repetido (mesmo id) não é somado de novo", async () => {
    const t = await withOrder();
    await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    const again = await t.refund({ id: "r1", order_id: 1, amount: "30.00" });

    expect(again.status).toBe(200);
    expect(again.body.result).toBe("duplicate");
    const order = (await t.get("/orders/1")).body;
    expect(order.refunded_cents).toBe(3000);
    expect(order.refunds).toHaveLength(1);
  });

  it("estornos distintos que passariam do total são cortados no teto e o corte fica rastreável", async () => {
    const t = await withOrder();
    await t.refund({ id: "r1", order_id: 1, amount: "80.00" });
    const second = await t.refund({ id: "r2", order_id: 1, amount: "50.00" });
    const third = await t.refund({ id: "r3", order_id: 1, amount: "10.00" });

    expect(second.body).toMatchObject({ result: "clamped", requested_cents: 5000, applied_cents: 2000 });
    expect(third.body).toMatchObject({ result: "clamped", requested_cents: 1000, applied_cents: 0 });

    const order = (await t.get("/orders/1")).body;
    expect(order.refunded_cents).toBe(10000);
    expect(order.net_cents).toBe(0);
    expect(order.refunds.map((r: any) => [r.id, r.requested_cents, r.applied_cents, r.status])).toEqual([
      ["r1", 8000, 8000, "applied"],
      ["r2", 5000, 2000, "clamped"],
      ["r3", 1000, 0, "clamped"],
    ]);
  });

  it("estorno total zera o líquido sem apagar a venda nem o histórico", async () => {
    const t = await withOrder();
    await t.refund({ id: "r1", order_id: 1, amount: "100.00" });
    const sales = (await t.get("/creators/crt_ana/sales")).body;
    expect(sales).toMatchObject({ orders: 1, gross_cents: 10000, refunded_cents: 10000, net_cents: 0 });
  });

  it("estorno que chega antes do pedido fica pendente e é aplicado quando o pedido chega", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    const early = await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    expect(early.status).toBe(202);
    expect(early.body.result).toBe("pending");

    await t.order({ id: 1, total_price: "100.00", discount_codes: [{ code: "ANA10" }] });

    const order = (await t.get("/orders/1")).body;
    expect(order.refunded_cents).toBe(3000);
    expect(order.refunds).toMatchObject([{ id: "r1", status: "applied", applied_cents: 3000 }]);
    expect((await t.get("/creators/crt_ana/sales")).body.net_cents).toBe(7000);
  });

  it("estornos pendentes respeitam o teto quando o pedido chega", async () => {
    const t = setup();
    await t.refund({ id: "r1", order_id: 1, amount: "70.00" });
    await t.refund({ id: "r2", order_id: 1, amount: "70.00" });
    await t.order({ id: 1, total_price: "100.00" });

    const order = (await t.get("/orders/1")).body;
    expect(order.refunded_cents).toBe(10000);
    expect(order.refunds.map((r: any) => [r.id, r.applied_cents, r.status])).toEqual([
      ["r1", 7000, "applied"],
      ["r2", 3000, "clamped"],
    ]);
  });

  it("estorno pendente repetido continua sendo um só", async () => {
    const t = setup();
    await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    const again = await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    expect(again.body.result).toBe("duplicate");
    await t.order({ id: 1, total_price: "100.00" });
    expect((await t.get("/orders/1")).body.refunded_cents).toBe(3000);
  });

  it("rejeita estorno com valor inválido", async () => {
    const t = await withOrder();
    expect((await t.refund({ id: "r1", order_id: 1, amount: "0" })).status).toBe(400);
    expect((await t.refund({ id: "r2", order_id: 1, amount: "-1.00" })).status).toBe(400);
    expect((await t.refund({ id: "r3", order_id: 1, amount: "x" })).status).toBe(400);
  });
});
