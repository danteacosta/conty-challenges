import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { registerCreator } from "../src/store.ts";
import { order } from "./helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "vendas-busy-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;

function harness() {
  const path = join(dir, `busy-${(counter += 1)}.db`);
  const seed = openDatabase(path);
  registerCreator(seed, { id: "crt_ana", couponCode: "ANA10", utmHandle: "ana" });
  seed.close();
  const blocker = openDatabase(path); // outra conexão que segura o lock de escrita
  const db = openDatabase(path, { busyTimeoutMs: 30 }); // a do app desiste logo: o teste não espera 5 s
  const app = createApp(db);
  const post = async (url: string, body: unknown) => {
    const res = await app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  };
  const get = async (url: string) => {
    const res = await app.request(url);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { db, blocker, post, get };
}

describe("banco ocupado é erro recuperável (503), e repetir depois grava exatamente uma vez", () => {
  it("pedido: 503 estruturado com Retry-After enquanto o lock está preso, sem efeito parcial; depois do lock, 201 e depois duplicate", async () => {
    const { blocker, post, get } = harness();
    blocker.exec("BEGIN IMMEDIATE");
    const busy = await post("/webhooks/orders", order({ id: 1, discount_codes: [{ code: "ANA10" }] }));
    expect(busy.status).toBe(503);
    expect(busy.body).toMatchObject({ error: "database_busy", retryable: true });
    expect(busy.headers.get("retry-after")).toBe("1");
    blocker.exec("ROLLBACK");

    expect((await get("/orders/1")).status).toBe(404); // nada foi gravado
    expect((await post("/webhooks/orders", order({ id: 1, discount_codes: [{ code: "ANA10" }] }))).status).toBe(201);
    expect((await post("/webhooks/orders", order({ id: 1, discount_codes: [{ code: "ANA10" }] }))).body.result).toBe("duplicate");
    expect((await get("/creators/crt_ana/sales")).body).toMatchObject({ orders: 1, gross_cents: 10000 });
  });

  it("estorno: 503 e, depois do lock, é aplicado uma vez só", async () => {
    const { blocker, post, get } = harness();
    await post("/webhooks/orders", order({ id: 1, discount_codes: [{ code: "ANA10" }] }));
    blocker.exec("BEGIN IMMEDIATE");
    const busy = await post("/webhooks/refunds", { id: "r1", order_id: 1, amount: "30.00" });
    expect(busy.status).toBe(503);
    blocker.exec("ROLLBACK");
    expect((await get("/refunds/r1")).status).toBe(404);
    expect((await post("/webhooks/refunds", { id: "r1", order_id: 1, amount: "30.00" })).body.result).toBe("applied");
    expect((await post("/webhooks/refunds", { id: "r1", order_id: 1, amount: "30.00" })).body.result).toBe("duplicate");
    expect((await get("/orders/1")).body).toMatchObject({ refunded_cents: 3000 });
  });

  it("leitura com o lock de escrita preso continua funcionando (WAL)", async () => {
    const { blocker, post, get } = harness();
    await post("/webhooks/orders", order({ id: 1, discount_codes: [{ code: "ANA10" }] }));
    blocker.exec("BEGIN IMMEDIATE");
    expect((await get("/orders/1")).status).toBe(200);
    blocker.exec("ROLLBACK");
  });

  it("outro erro de SQL continua sendo erro interno (500), não 503", async () => {
    const { db, post } = harness();
    db.exec("DROP TABLE refunds");
    const res = await post("/webhooks/refunds", { id: "r1", order_id: 1, amount: "30.00" });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "internal_error" });
  });
});
