import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

async function withCreators() {
  const t = setup();
  await t.creator("crt_ana", "ANA10", "ana");
  await t.creator("crt_bia", "BIA10", "bia");
  return t;
}
const sales = async (t: ReturnType<typeof setup>, id: string) => (await t.get(`/creators/${id}/sales`)).body;

describe("pedido pendente que depois é pago", () => {
  it("o pedido pendente é gravado, mas não conta como venda", async () => {
    const t = await withCreators();
    const res = await t.order({ id: 1, financial_status: "pending", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    expect(res).toMatchObject({ status: 201, body: { result: "created" } });
    expect((await t.get("/orders/1")).body).toMatchObject({ counted: false, financial_status: "pending" });
    expect(await sales(t, "crt_ana")).toMatchObject({ orders: 0, gross_cents: 0, net_cents: 0 });
  });

  it("o pagamento posterior cria o crédito: a venda passa a contar uma vez", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "pending", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    const paid = await t.order({ id: 1, financial_status: "paid", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    expect(paid).toMatchObject({ status: 200, body: { result: "credited" } });
    expect((await t.get("/orders/1")).body).toMatchObject({ counted: true, financial_status: "paid", total_cents: 10000 });
    expect(await sales(t, "crt_ana")).toMatchObject({ orders: 1, gross_cents: 10000, net_cents: 10000 });
  });

  it("o valor creditado é o do pagamento, mesmo que o pedido pendente tivesse outro total", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "pending", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    await t.order({ id: 1, financial_status: "paid", total_price: "150.00", discount_codes: [{ code: "ANA10" }] });
    expect((await t.get("/orders/1")).body.total_cents).toBe(15000);
    expect(await sales(t, "crt_ana")).toMatchObject({ gross_cents: 15000, net_cents: 15000 });
  });

  it("a atribuição é feita (e congelada) quando o crédito nasce, com os sinais do pagamento", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "pending", discount_codes: [], utm_parameters: {} });
    expect((await t.get("/orders/1")).body.attribution).toMatchObject({ creator_id: null, rule: "unattributed" });

    await t.order({ id: 1, financial_status: "paid", discount_codes: [{ code: "ANA10" }], utm_parameters: { utm_content: "bia" } });
    expect((await t.get("/orders/1")).body.attribution).toMatchObject({ creator_id: "crt_ana", rule: "coupon_over_utm" });
    expect(await sales(t, "crt_ana")).toMatchObject({ orders: 1 });
    expect(await sales(t, "crt_bia")).toMatchObject({ orders: 0 });
  });

  it("depois do crédito, reenvios não alteram nem o valor nem o criador, seja qual for o conteúdo", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "pending", total_price: "100.00" });
    await t.order({ id: 1, financial_status: "paid", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });

    for (const replay of [
      { financial_status: "paid", total_price: "100.00", discount_codes: [{ code: "ANA10" }] },
      { financial_status: "paid", total_price: "999.00", discount_codes: [{ code: "BIA10" }] },
      { financial_status: "pending", total_price: "5.00", discount_codes: [{ code: "BIA10" }] },
      { financial_status: "voided", total_price: "1.00", discount_codes: [] },
    ]) {
      const res = await t.order({ id: 1, ...replay });
      expect(res.body.result).toBe("duplicate");
    }
    expect((await t.get("/orders/1")).body).toMatchObject({ counted: true, financial_status: "paid", total_cents: 10000, attribution: { creator_id: "crt_ana" } });
    expect(await sales(t, "crt_ana")).toMatchObject({ orders: 1, gross_cents: 10000 });
    expect(await sales(t, "crt_bia")).toMatchObject({ orders: 0 });
  });

  it("o pago que chega antes do pendente (fora de ordem) já cria o crédito, e o pendente atrasado não o desfaz", async () => {
    const t = await withCreators();
    expect((await t.order({ id: 1, financial_status: "paid", total_price: "100.00", discount_codes: [{ code: "ANA10" }] })).body.result).toBe("created");
    expect((await t.order({ id: 1, financial_status: "pending", total_price: "100.00", discount_codes: [{ code: "ANA10" }] })).body.result).toBe("duplicate");
    expect(await sales(t, "crt_ana")).toMatchObject({ orders: 1, gross_cents: 10000 });
  });

  it("mudar de um status não pago para outro não pago atualiza o status, sem creditar", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "pending", discount_codes: [{ code: "ANA10" }] });
    const authorized = await t.order({ id: 1, financial_status: "authorized", discount_codes: [{ code: "ANA10" }] });
    expect(authorized.body.result).toBe("updated");
    expect((await t.get("/orders/1")).body).toMatchObject({ financial_status: "authorized", counted: false });
    expect((await t.order({ id: 1, financial_status: "authorized", discount_codes: [{ code: "ANA10" }] })).body.result).toBe("duplicate");
    await t.order({ id: 1, financial_status: "voided", discount_codes: [{ code: "ANA10" }] });
    expect((await t.get("/orders/1")).body).toMatchObject({ financial_status: "voided", counted: false });
    expect(await sales(t, "crt_ana")).toMatchObject({ orders: 0 });
  });

  it("o pagamento com moeda não suportada continua recusado e não credita", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "pending", discount_codes: [{ code: "ANA10" }] });
    expect((await t.order({ id: 1, financial_status: "paid", currency: "USD", discount_codes: [{ code: "ANA10" }] })).status).toBe(400);
    expect((await t.get("/orders/1")).body.counted).toBe(false);
  });
});

describe("estornos de uma venda que ainda não foi creditada", () => {
  it("estorno de um pedido pendente fica pendente, não é aplicado e não mexe no líquido", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "pending", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    const refund = await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    expect(refund).toMatchObject({ status: 202, body: { result: "pending", requested_cents: 3000 } });
    expect((await t.get("/orders/1")).body).toMatchObject({ refunded_cents: 0, refunds: [{ id: "r1", status: "pending", applied_cents: null }] });
    expect(await sales(t, "crt_ana")).toMatchObject({ refunded_cents: 0 });
  });

  it("quando o pagamento cria o crédito, o estorno antecipado é aplicado uma vez só", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "pending", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    await t.order({ id: 1, financial_status: "paid", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });

    expect((await t.get("/orders/1")).body).toMatchObject({ refunded_cents: 3000, net_cents: 7000, refunds: [{ id: "r1", status: "applied", applied_cents: 3000 }] });
    expect(await sales(t, "crt_ana")).toMatchObject({ gross_cents: 10000, refunded_cents: 3000, net_cents: 7000 });

    // reenviar o pago e o estorno não aplica de novo
    await t.order({ id: 1, financial_status: "paid", total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    expect((await t.refund({ id: "r1", order_id: 1, amount: "30.00" })).body.result).toBe("duplicate");
    expect(await sales(t, "crt_ana")).toMatchObject({ refunded_cents: 3000, net_cents: 7000 });
  });

  it("o estorno que chegou antes do pedido continua pendente enquanto o pedido está pendente (não é aplicado na criação)", async () => {
    const t = await withCreators();
    await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    await t.order({ id: 1, financial_status: "pending", total_price: "100.00" });
    expect((await t.get("/refunds/r1")).body).toMatchObject({ status: "pending", applied_cents: null });
    expect((await t.get("/orders/1")).body).toMatchObject({ refunded_cents: 0, counted: false });
    await t.order({ id: 1, financial_status: "paid", total_price: "100.00" });
    expect((await t.get("/refunds/r1")).body).toMatchObject({ status: "applied", applied_cents: 3000 });
  });

  it("estornos antecipados respeitam o teto quando o crédito nasce, na ordem em que chegaram", async () => {
    const t = await withCreators();
    await t.refund({ id: "r1", order_id: 1, amount: "70.00" }); // antes mesmo de o pedido existir
    await t.order({ id: 1, financial_status: "pending", total_price: "100.00" });
    await t.refund({ id: "r2", order_id: 1, amount: "70.00" }); // com o pedido pendente
    await t.order({ id: 1, financial_status: "paid", total_price: "100.00" });

    const order = (await t.get("/orders/1")).body;
    expect(order.refunded_cents).toBe(10000);
    expect(order.refunds.map((r: any) => [r.id, r.applied_cents, r.status])).toEqual([["r1", 7000, "applied"], ["r2", 3000, "clamped"]]);
  });

  it("estorno de um pedido já creditado continua sendo aplicado na hora", async () => {
    const t = await withCreators();
    await t.order({ id: 1, financial_status: "paid", total_price: "100.00" });
    expect((await t.refund({ id: "r1", order_id: 1, amount: "40.00" })).body).toMatchObject({ result: "applied", applied_cents: 4000 });
  });

  it("pedido criado já pago aplica os estornos que chegaram antes dele", async () => {
    const t = await withCreators();
    await t.refund({ id: "r1", order_id: 1, amount: "30.00" });
    await t.order({ id: 1, financial_status: "paid", total_price: "100.00" });
    expect((await t.get("/orders/1")).body.refunded_cents).toBe(3000);
  });
});

describe("consulta de estorno pendente", () => {
  it("GET /refunds/:id mostra o estorno mesmo quando o pedido ainda nem existe", async () => {
    const t = setup();
    await t.refund({ id: "r1", order_id: 77, amount: "30.00" });
    expect((await t.get("/refunds/r1")).body).toMatchObject({ id: "r1", order_id: "77", requested_cents: 3000, applied_cents: null, status: "pending" });
    expect((await t.get("/orders/77")).status).toBe(404);
  });

  it("o mesmo estorno aparece como aplicado depois que o crédito nasce", async () => {
    const t = setup();
    await t.refund({ id: "r1", order_id: 77, amount: "30.00" });
    await t.order({ id: 77, financial_status: "paid", total_price: "100.00" });
    expect((await t.get("/refunds/r1")).body).toMatchObject({ status: "applied", applied_cents: 3000 });
  });

  it("estorno inexistente é 404", async () => {
    expect((await setup().get("/refunds/nada")).status).toBe(404);
  });

  it("GET /refunds lista por status e por pedido", async () => {
    const t = setup();
    await t.refund({ id: "r1", order_id: 1, amount: "10.00" });
    await t.refund({ id: "r2", order_id: 2, amount: "20.00" });
    await t.order({ id: 1, financial_status: "paid", total_price: "100.00" });
    expect((await t.get("/refunds?status=pending")).body.map((r: any) => r.id)).toEqual(["r2"]);
    expect((await t.get("/refunds?status=applied")).body.map((r: any) => r.id)).toEqual(["r1"]);
    expect((await t.get("/refunds?order_id=2")).body.map((r: any) => r.id)).toEqual(["r2"]);
    expect((await t.get("/refunds")).body.map((r: any) => r.id)).toEqual(["r1", "r2"]);
    expect((await t.get("/refunds?status=inventado")).status).toBe(400);
  });
});
