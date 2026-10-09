import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

export function setup() {
  const app = createApp(openDatabase(":memory:"));

  const post = async (path: string, body: unknown) => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const get = async (path: string) => {
    const res = await app.request(path);
    return { status: res.status, body: (await res.json()) as any };
  };

  return {
    app,
    post,
    get,
    creator: (id: string, coupon: string, utm: string) =>
      post("/creators", { id, coupon_code: coupon, utm_handle: utm }),
    order: (o: Record<string, unknown>) => post("/webhooks/orders", order(o)),
    refund: (r: Record<string, unknown>) => post("/webhooks/refunds", r),
  };
}

export function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    total_price: "100.00",
    currency: "BRL",
    financial_status: "paid",
    created_at: "2026-06-01T12:00:00.000Z",
    discount_codes: [],
    utm_parameters: {},
    ...overrides,
  };
}
