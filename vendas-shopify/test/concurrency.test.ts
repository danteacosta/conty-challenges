import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { getOrder } from "../src/store.ts";
import { order } from "./helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "vendas-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("concorrência", () => {
  it("o mesmo webhook disparado em paralelo no mesmo processo conta uma vez só", async () => {
    const app = createApp(openDatabase(":memory:"));
    const send = () =>
      app.request("/webhooks/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(order({ id: 5 })),
      });
    const results = await Promise.all(Array.from({ length: 50 }, send));
    const bodies = await Promise.all(results.map((r) => r.json() as Promise<{ result: string }>));
    expect(bodies.filter((b) => b.result === "created")).toHaveLength(1);
    expect(bodies.filter((b) => b.result === "duplicate")).toHaveLength(49);
  });

  it("4 workers, cada um com a sua conexão, mandando pedido e estornos repetidos: sem duplicar e sem passar do teto", async () => {
    const path = join(dir, "race.db");
    openDatabase(path).close(); // cria o schema antes de abrir os workers
    const refundIds = ["r1", "r2", "r3", "r4", "r5"]; // 5 x 30,00 contra um pedido de 100,00
    const run = () =>
      new Promise<void>((resolve, reject) => {
        const w = new Worker(new URL("./worker.ts", import.meta.url), {
          workerData: { path, orderTotalCents: 10000, refundIds, rounds: 30 },
        });
        w.once("message", () => resolve());
        w.once("error", reject);
      });
    await Promise.all([run(), run(), run(), run()]);

    const db = openDatabase(path);
    const result = getOrder(db, "1")!;
    expect(result.refunds.map((r) => r.id)).toEqual(refundIds); // nenhum duplicado, nenhum perdido
    expect(result.refunds.some((r) => r.status === "pending")).toBe(false);
    expect(result.refunded_cents).toBe(10000); // 150,00 pedidos, teto 100,00
    expect(result.refunds.reduce((s, r) => s + (r.applied_cents ?? 0), 0)).toBeLessThanOrEqual(result.total_cents);
    const orders = db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number };
    expect(orders.n).toBe(1);
  }, 30_000);
});
