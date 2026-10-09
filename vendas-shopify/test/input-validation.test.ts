import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** Corpo cru, para poder escrever números que o JSON.stringify do JavaScript já teria arredondado. */
async function raw(t: ReturnType<typeof setup>, path: string, json: string) {
  const res = await t.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: json });
  return { status: res.status, body: (await res.json()) as any };
}

describe("moeda", () => {
  it.each(["USD", "usd", "EUR", " USD ", ""])("pedido em %s é recusado e não é gravado", async (currency) => {
    const t = setup();
    const res = await t.order({ id: 1, currency });
    expect(res).toMatchObject({ status: 400, body: { error: "unsupported_currency" } });
    expect((await t.get("/orders/1")).status).toBe(404);
  });

  it("moeda que não é texto é recusada", async () => {
    const t = setup();
    expect((await t.order({ id: 1, currency: 986 })).status).toBe(400);
    expect((await t.order({ id: 2, currency: null })).status).toBe(201);
  });

  it.each(["BRL", "brl", " BRL "])("%s é aceita e gravada como BRL", async (currency) => {
    const t = setup();
    expect((await t.order({ id: 1, currency })).status).toBe(201);
    expect((await t.get("/orders/1")).body.currency).toBe("BRL");
  });

  it("sem moeda informada vale BRL, como antes", async () => {
    const t = setup();
    await t.post("/webhooks/orders", { id: 1, total_price: "10.00", financial_status: "paid" });
    expect((await t.get("/orders/1")).body.currency).toBe("BRL");
  });

  it("BRL e USD não se somam: o USD é recusado e o líquido do criador só tem o BRL", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    await t.order({ id: 1, total_price: "100.00", currency: "BRL", discount_codes: [{ code: "ANA10" }] });
    await t.order({ id: 2, total_price: "100.00", currency: "USD", discount_codes: [{ code: "ANA10" }] });
    expect((await t.get("/creators/crt_ana/sales")).body).toMatchObject({ orders: 1, gross_cents: 10000, net_cents: 10000 });
  });
});

describe("ids de pedido, estorno e criador", () => {
  it("dois pedidos com ids numéricos inseguros que o JSON arredonda para o mesmo número não viram duplicata: o inseguro é recusado", async () => {
    const t = setup();
    const unsafe = await raw(t, "/webhooks/orders", '{"id":9007199254740993,"total_price":"10.00","financial_status":"paid"}');
    expect(unsafe.status).toBe(400);
    expect((await t.get("/orders/9007199254740992")).status).toBe(404);
  });

  it("o maior inteiro seguro é aceito, e o seguinte não", async () => {
    const t = setup();
    expect((await raw(t, "/webhooks/orders", '{"id":9007199254740991,"total_price":"10.00","financial_status":"paid"}')).status).toBe(201);
    expect((await raw(t, "/webhooks/orders", '{"id":9007199254740992,"total_price":"10.00","financial_status":"paid"}')).status).toBe(400);
  });

  it("ids em texto com muitos dígitos continuam distintos e são aceitos", async () => {
    const t = setup();
    expect((await t.order({ id: "9007199254740992" })).body.result).toBe("created");
    expect((await t.order({ id: "9007199254740993" })).body.result).toBe("created");
    expect((await t.get("/orders/9007199254740993")).status).toBe(200);
  });

  it("espaços ao redor do id em texto não criam outro pedido", async () => {
    const t = setup();
    expect((await t.order({ id: "  1001  " })).body.result).toBe("created");
    expect((await t.order({ id: "1001" })).body.result).toBe("duplicate");
    expect((await t.get("/orders/1001")).status).toBe(200);
  });

  it("id inteiro seguro e o mesmo id em texto são o mesmo pedido", async () => {
    const t = setup();
    expect((await t.order({ id: 1001 })).body.result).toBe("created");
    expect((await t.order({ id: "1001" })).body.result).toBe("duplicate");
  });

  it.each([1.5, true, false, {}, [], "", "   ", null])("id inválido (%j) é recusado", async (id) => {
    const t = setup();
    expect((await t.order({ id })).status).toBe(400);
  });

  it("estorno com id ou order_id inseguro é recusado", async () => {
    const t = setup();
    expect((await raw(t, "/webhooks/refunds", '{"id":9007199254740993,"order_id":1,"amount":"1.00"}')).status).toBe(400);
    expect((await raw(t, "/webhooks/refunds", '{"id":"r1","order_id":9007199254740993,"amount":"1.00"}')).status).toBe(400);
  });

  it("estorno com order_id numérico seguro encontra o pedido de id em texto", async () => {
    const t = setup();
    await t.order({ id: "1001", total_price: "100.00" });
    expect((await t.refund({ id: "r1", order_id: 1001, amount: "30.00" })).body).toMatchObject({ result: "applied", applied_cents: 3000 });
  });

  it("criador com id inseguro é recusado", async () => {
    const t = setup();
    expect((await raw(t, "/creators", '{"id":9007199254740993,"coupon_code":"A","utm_handle":"a"}')).status).toBe(400);
  });
});

describe("campos opcionais do pedido", () => {
  it("pedido sem financial_status é gravado como pending e não entra na venda do criador", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    const res = await t.post("/webhooks/orders", { id: 1, total_price: "10.00", discount_codes: [{ code: "ANA10" }] });
    expect(res.status).toBe(201);
    expect((await t.get("/orders/1")).body).toMatchObject({ financial_status: "pending", counted: false });
    expect((await t.get("/creators/crt_ana/sales")).body.orders).toBe(0);
  });

  it("a rota de saúde responde", async () => {
    expect((await setup().get("/health")).body).toEqual({ ok: true });
  });
});
