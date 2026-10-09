import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { creatorSales, getOrder, ingestRefund, registerCreator } from "../src/store.ts";
import { order } from "./helpers.ts";
import { tsWorker } from "./spawn-worker.ts";

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

  it("4 workers largando juntos, cada um com a sua conexão, 8 vezes em bancos novos, mandando pedido e estornos repetidos: sem duplicar e sem passar do teto", async () => {
    const refundIds = ["r1", "r2", "r3", "r4", "r5"]; // 5 x 30,00 contra um pedido de 100,00
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const path = join(dir, `race-${attempt}.db`);
      const seeded = openDatabase(path); // cria o schema antes de abrir os workers
      registerCreator(seeded, { id: "crt_ana", couponCode: "ANA10", utmHandle: "ana" }); // o pedido lê o cadastro antes de gravar
      seeded.close();

      const barrier = new SharedArrayBuffer(8);
      const flags = new Int32Array(barrier);
      const run = () =>
        new Promise<void>((resolve, reject) => {
          const w = tsWorker(new URL("./worker.ts", import.meta.url), { path, orderTotalCents: 10000, refundIds, rounds: 30, barrier });
          w.once("message", () => resolve());
          w.once("error", reject);
        });
      const workers = [run(), run(), run(), run()];
      while (Atomics.load(flags, 1) < 4) await new Promise((resolve) => setTimeout(resolve, 5));
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      await Promise.all(workers);

      const db = openDatabase(path);
      const result = getOrder(db, "1")!;
      expect(result.refunds.map((r) => r.id)).toEqual(refundIds); // nenhum duplicado, nenhum perdido
      expect(result.refunds.some((r) => r.status === "pending")).toBe(false);
      expect(result.refunded_cents).toBe(10000); // 150,00 pedidos, teto 100,00
      expect(result.refunds.reduce((s, r) => s + (r.applied_cents ?? 0), 0)).toBeLessThanOrEqual(result.total_cents);
      expect((db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n).toBe(1);
      db.close();
    }
  }, 60_000);

  it("pendente e pago dos mesmos 250 pedidos, de 4 conexões largando juntas, 4 vezes em bancos novos: cada crédito nasce uma vez e cada estorno antecipado é aplicado uma vez", async () => {
    const ORDERS = 250;
    for (let round = 0; round < 4; round += 1) {
      const path = join(dir, `credito-${round}.db`);
      const seeded = openDatabase(path);
      registerCreator(seeded, { id: "crt_ana", couponCode: "ANA10", utmHandle: "ana" });
      for (let id = 1; id <= ORDERS; id += 1) ingestRefund(seeded, { id: `r${id}`, orderId: String(id), amountCents: 3000 }, () => "2026-06-01T11:00:00.000Z"); // antes dos pedidos
      seeded.close();

      const barrier = new SharedArrayBuffer(8);
      const flags = new Int32Array(barrier);
      const statuses = ["pending", "paid", "pending", "paid"];
      const done = statuses.map(
        (status) =>
          new Promise<string[]>((resolve, reject) => {
            const w = tsWorker(new URL("./credit-worker.ts", import.meta.url), { path, status, orders: ORDERS, barrier });
            w.once("message", resolve);
            w.once("error", reject);
          }),
      );
      while (Atomics.load(flags, 1) < statuses.length) await new Promise((resolve) => setTimeout(resolve, 5));
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      const perWorker = await Promise.all(done);

      const db = openDatabase(path);
      expect(creatorSales(db, "crt_ana"), `rodada ${round}`).toMatchObject({ creator_id: "crt_ana", orders: ORDERS, gross_cents: ORDERS * 10000, refunded_cents: ORDERS * 3000, net_cents: ORDERS * 7000 });
      for (let id = 1; id <= ORDERS; id += 1) {
        expect(getOrder(db, String(id)), `rodada ${round}, pedido ${id}`).toMatchObject({ counted: true, financial_status: "paid", refunded_cents: 3000 });
        // o crédito de cada pedido nasce exatamente uma vez: num pedido que já nasce pago ("created" por um worker pago) ou num
        // pendente que virou pago ("credited"). Um "created" de um worker pendente só grava o pedido, sem creditar.
        const credits = perWorker.filter((results, worker) => results[id - 1] === "credited" || (results[id - 1] === "created" && statuses[worker] === "paid")).length;
        expect(credits, `rodada ${round}, pedido ${id}: ${perWorker.map((r) => r[id - 1])}`).toBe(1);
      }
      db.close();
    }
  }, 120_000);
});
