import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

async function withTwoOrders() {
  const t = setup();
  await t.creator("crt_ana", "ANA10", "ana");
  await t.order({ id: "o0", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
  await t.order({ id: "o1", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
  return t;
}

describe("o mesmo id de estorno com conteúdo diferente é conflito, não repetição", () => {
  it("outro pedido: 409 refund_conflict, e nenhum saldo muda", async () => {
    const t = await withTwoOrders();
    expect((await t.refund({ id: "r", order_id: "o0", amount: "1.00" })).status).toBe(200);
    const clash = await t.refund({ id: "r", order_id: "o1", amount: "1.00" });
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ error: "refund_conflict", refund_id: "r" });
    expect((await t.get("/orders/o1")).body).toMatchObject({ refunded_cents: 0, net_cents: 10000 });
    expect((await t.get("/orders/o0")).body).toMatchObject({ refunded_cents: 100 });
    expect((await t.get("/refunds/r")).body).toMatchObject({ order_id: "o0", requested_cents: 100 });
  });

  it("outro valor: 409, e o estorno original continua como estava", async () => {
    const t = await withTwoOrders();
    await t.refund({ id: "r", order_id: "o0", amount: "1.00" });
    expect((await t.refund({ id: "r", order_id: "o0", amount: "7.00" })).status).toBe(409);
    expect((await t.get("/orders/o0")).body).toMatchObject({ refunded_cents: 100 });
  });

  it("o mesmo conteúdo escrito de outro jeito (1.0, 1.00, 1) continua sendo repetição", async () => {
    const t = await withTwoOrders();
    await t.refund({ id: "r", order_id: "o0", amount: "1.00" });
    for (const amount of ["1.0", "1.00", 1, "1"]) {
      const again = await t.refund({ id: "r", order_id: "o0", amount });
      expect(again.status, String(amount)).toBe(200);
      expect(again.body.result).toBe("duplicate");
    }
    expect((await t.get("/orders/o0")).body).toMatchObject({ refunded_cents: 100 });
  });

  it("vale também para o estorno que chegou antes do pedido (pendente)", async () => {
    const t = setup();
    await t.refund({ id: "r", order_id: "futuro", amount: "5.00" });
    expect((await t.refund({ id: "r", order_id: "outro", amount: "5.00" })).status).toBe(409);
    expect((await t.refund({ id: "r", order_id: "futuro", amount: "5.00" })).body.result).toBe("duplicate");
    expect((await t.get("/refunds/r")).body).toMatchObject({ order_id: "futuro", status: "pending" });
  });

  it("pedido com o mesmo id e conteúdo diferente continua sendo repetição: o status do pedido evolui (pending → paid)", async () => {
    const t = await withTwoOrders();
    expect((await t.order({ id: "o0", total_price: "999.00", discount_codes: [{ code: "ANA10" }] })).body.result).toBe("duplicate");
  });
});
