import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

let server: ReturnType<typeof serve>;
let base = "";

beforeAll(async () => {
  server = serve({ fetch: createApp(openDatabase(":memory:")).fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const send = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("jornada completa por HTTP", () => {
  it("pedido, webhook duplicado, estorno parcial, estorno repetido e consulta do criador", async () => {
    await send("/creators", { id: "crt_ana", coupon_code: "ANA10", utm_handle: "ana" });
    const order = { id: 77, total_price: "250.00", financial_status: "paid", discount_codes: [{ code: "ANA10" }] };
    await send("/webhooks/orders", order);
    await send("/webhooks/orders", order);
    await send("/webhooks/refunds", { id: "r1", order_id: 77, amount: "50.00" });
    await send("/webhooks/refunds", { id: "r1", order_id: 77, amount: "50.00" });

    const sales = await (await fetch(`${base}/creators/crt_ana/sales`)).json();
    expect(sales).toMatchObject({ orders: 1, gross_cents: 25000, refunded_cents: 5000, net_cents: 20000 });
  });
});
