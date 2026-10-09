import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("ingestão de pedido e atribuição", () => {
  it("pedido repetido não soma a venda de novo", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    const first = await t.order({ id: 1, total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    const second = await t.order({ id: 1, total_price: "100.00", discount_codes: [{ code: "ANA10" }] });

    expect(first.body.result).toBe("created");
    expect(second.status).toBe(200);
    expect(second.body.result).toBe("duplicate");

    const sales = await t.get("/creators/crt_ana/sales");
    expect(sales.body).toMatchObject({ orders: 1, gross_cents: 10000, refunded_cents: 0, net_cents: 10000 });
  });

  it("repetição com payload diferente não altera o pedido já gravado", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    await t.order({ id: 1, total_price: "100.00", discount_codes: [{ code: "ANA10" }] });
    await t.order({ id: 1, total_price: "999.00", discount_codes: [] });

    const got = await t.get("/orders/1");
    expect(got.body.total_cents).toBe(10000);
    expect(got.body.attribution.creator_id).toBe("crt_ana");
  });

  it("quando cupom e UTM apontam criadores diferentes, o cupom vence e o conflito fica registrado", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    await t.creator("crt_bia", "BIA10", "bia");
    await t.order({
      id: 2,
      discount_codes: [{ code: "ana10" }],
      utm_parameters: { utm_content: "bia" },
    });

    const got = await t.get("/orders/2");
    expect(got.body.attribution).toMatchObject({
      creator_id: "crt_ana",
      rule: "coupon_over_utm",
      conflict: { coupon_creator_id: "crt_ana", utm_creator_id: "crt_bia" },
    });
    expect((await t.get("/creators/crt_bia/sales")).body.orders).toBe(0);
  });

  it("usa a UTM quando o cupom é desconhecido, e o cupom quando a UTM é desconhecida", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    await t.order({ id: 3, discount_codes: [{ code: "OUTRO" }], utm_parameters: { utm_content: "ana" } });
    await t.order({ id: 4, discount_codes: [{ code: "ANA10" }], utm_parameters: { utm_content: "ninguem" } });

    expect((await t.get("/orders/3")).body.attribution).toMatchObject({ creator_id: "crt_ana", rule: "utm" });
    expect((await t.get("/orders/4")).body.attribution).toMatchObject({ creator_id: "crt_ana", rule: "coupon" });
  });

  it("cupom e UTM do mesmo criador contam uma venda só, atribuída a ele", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    await t.order({ id: 5, discount_codes: [{ code: "ANA10" }], utm_parameters: { utm_content: "ana" } });

    expect((await t.get("/orders/5")).body.attribution).toMatchObject({ creator_id: "crt_ana", rule: "coupon_and_utm" });
    expect((await t.get("/creators/crt_ana/sales")).body.orders).toBe(1);
  });

  it("sem sinal reconhecido, o pedido fica sem criador e com o motivo gravado", async () => {
    const t = setup();
    await t.order({ id: 6, discount_codes: [{ code: "XYZ" }] });
    expect((await t.get("/orders/6")).body.attribution).toMatchObject({ creator_id: null, rule: "unattributed" });
  });

  it("pedido não pago é guardado mas não entra na venda do criador", async () => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    await t.order({ id: 7, financial_status: "pending", discount_codes: [{ code: "ANA10" }] });

    expect((await t.get("/orders/7")).status).toBe(200);
    expect((await t.get("/creators/crt_ana/sales")).body.orders).toBe(0);
  });

  it("rejeita pedido com total inválido", async () => {
    const t = setup();
    expect((await t.order({ id: 8, total_price: "abc" })).status).toBe(400);
    expect((await t.order({ id: 9, total_price: "-5.00" })).status).toBe(400);
    expect((await t.get("/orders/8")).status).toBe(404);
  });
});

describe("cadastro de criador e status que contam como venda", () => {
  it("recusa cupom ou UTM já usado por outro criador, sem sobrescrever o original", async () => {
    const t = setup();
    expect((await t.creator("crt_ana", "ANA10", "ana")).status).toBe(201);
    const dup = await t.creator("crt_bia", "ana10", "bia");
    expect(dup.status).toBe(409);
    expect(dup.body.result).toBe("conflict");
    expect((await t.creator("crt_cai", "CAI10", "ANA")).status).toBe(409);
    expect((await t.creator("crt_ana", "OUTRO", "outro")).status).toBe(409);

    await t.order({ id: 1, discount_codes: [{ code: "ANA10" }] });
    expect((await t.get("/orders/1")).body.attribution.creator_id).toBe("crt_ana");
  });

  it.each(["paid", "partially_refunded", "refunded"])("pedido %s entra na venda do criador", async (status) => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    await t.order({ id: 1, financial_status: status, discount_codes: [{ code: "ANA10" }] });
    expect((await t.get("/orders/1")).body.counted).toBe(true);
    expect((await t.get("/creators/crt_ana/sales")).body.orders).toBe(1);
  });

  it.each(["pending", "voided", "authorized"])("pedido %s não entra", async (status) => {
    const t = setup();
    await t.creator("crt_ana", "ANA10", "ana");
    await t.order({ id: 1, financial_status: status, discount_codes: [{ code: "ANA10" }] });
    expect((await t.get("/orders/1")).body.counted).toBe(false);
  });

  it("aceita valor com espaços ao redor", async () => {
    const t = setup();
    await t.order({ id: 1, total_price: " 10.00 " });
    expect((await t.get("/orders/1")).body.total_cents).toBe(1000);
  });
});

describe("corpo inválido", () => {
  it("responde 400 para JSON malformado em vez de falhar", async () => {
    const t = setup();
    for (const path of ["/webhooks/orders", "/webhooks/refunds", "/creators"]) {
      const res = await t.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
      expect(res.status).toBe(400);
    }
  });
});
