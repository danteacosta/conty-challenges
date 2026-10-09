import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { creatorSales, registerCreator } from "../src/store.ts";
import { order } from "./helpers.ts";

const HUGE = "999999999999.99"; // o maior valor que o contrato aceita por pedido: 99.999.999.999.999 centavos

function harness() {
  const db = openDatabase(":memory:");
  const app = createApp(db);
  registerCreator(db, { id: "crt_ana", couponCode: "ANA10", utmHandle: "ana" });
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const sales = async () => ({ ...(await (await app.request("/creators/crt_ana/sales")).json() as any) });
  return { db, app, post, sales };
}

describe("agregados exatos além do inteiro seguro do JavaScript", () => {
  it("91 pedidos válidos de 999.999.999.999,99 somam além de 2^53 e a consulta responde com o valor exato, não 500", async () => {
    const { post, app } = harness();
    for (let i = 1; i <= 91; i += 1) expect((await post("/webhooks/orders", order({ id: i, total_price: HUGE, discount_codes: [{ code: "ana10" }] }))).status).toBe(201);
    const res = await app.request("/creators/crt_ana/sales");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      creator_id: "crt_ana",
      orders: 91,
      gross_cents: null, // não cabe num número JSON sem perder centavos: o valor está em exact
      refunded_cents: 0,
      net_cents: null,
      exact: { gross_cents: "9099999999999909", refunded_cents: "0", net_cents: "9099999999999909" },
    });
  });

  it("bruto enorme com líquido pequeno: o bruto só sai exato, os outros dois cabem num número", async () => {
    const { post, sales } = harness();
    for (let i = 1; i <= 91; i += 1) {
      await post("/webhooks/orders", order({ id: i, total_price: HUGE, discount_codes: [{ code: "ana10" }] }));
      if (i !== 91) await post("/webhooks/refunds", { id: `r${i}`, order_id: String(i), amount: HUGE });
    }
    const result = await sales();
    expect(result).toMatchObject({ gross_cents: null, refunded_cents: 8_999_999_999_999_910, net_cents: 99_999_999_999_999 });
    expect(result.exact).toEqual({ gross_cents: "9099999999999909", refunded_cents: "8999999999999910", net_cents: "99999999999999" });
  });

  it("valores pequenos continuam saindo como número, e o exato acompanha", async () => {
    const { post, sales } = harness();
    await post("/webhooks/orders", order({ id: 1, total_price: "100.00", discount_codes: [{ code: "ANA10" }] }));
    await post("/webhooks/refunds", { id: "r1", order_id: "1", amount: "30.00" });
    expect(await sales()).toEqual({
      creator_id: "crt_ana",
      orders: 1,
      gross_cents: 10000,
      refunded_cents: 3000,
      net_cents: 7000,
      exact: { gross_cents: "10000", refunded_cents: "3000", net_cents: "7000" },
    });
  });

  it("o inteiro seguro exato ainda sai como número; um centavo acima só como texto", () => {
    const db = openDatabase(":memory:");
    registerCreator(db, { id: "crt_ana", couponCode: "ANA10", utmHandle: "ana" });
    const insert = db.prepare("INSERT INTO orders (id, total_cents, currency, financial_status, counted, creator_id, attribution_json, received_at) VALUES (?, ?, 'BRL', 'paid', 1, 'crt_ana', '{}', 'x')");
    insert.run("a", 9_007_199_254_740_000);
    insert.run("b", 991);
    expect(creatorSales(db, "crt_ana")).toMatchObject({ gross_cents: Number.MAX_SAFE_INTEGER, exact: { gross_cents: "9007199254740991" } });
    insert.run("c", 1);
    expect(creatorSales(db, "crt_ana")).toMatchObject({ gross_cents: null, net_cents: null, exact: { gross_cents: "9007199254740992", net_cents: "9007199254740992" } });
  });

  it("quando a soma passa de 64 bits no próprio SQLite, o resultado continua exato", () => {
    const db = openDatabase(":memory:");
    registerCreator(db, { id: "crt_ana", couponCode: "ANA10", utmHandle: "ana" });
    db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100000)
             INSERT INTO orders (id, total_cents, currency, financial_status, counted, creator_id, attribution_json, received_at)
             SELECT 'o' || i, 99999999999999, 'BRL', 'paid', 1, 'crt_ana', '{}', 'x' FROM n`);
    const result = creatorSales(db, "crt_ana");
    expect(result.orders).toBe(100_000);
    expect(result.gross_cents).toBeNull();
    expect(result.exact).toEqual({ gross_cents: "9999999999999900000", refunded_cents: "0", net_cents: "9999999999999900000" });
  });

  it("criador sem vendas: zeros em número e em texto", async () => {
    const { sales } = harness();
    expect(await sales()).toEqual({ creator_id: "crt_ana", orders: 0, gross_cents: 0, refunded_cents: 0, net_cents: 0, exact: { gross_cents: "0", refunded_cents: "0", net_cents: "0" } });
  });
});
