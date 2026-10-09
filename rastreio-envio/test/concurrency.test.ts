import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { loadShipment, registerShipment } from "../src/store.ts";
import { setup } from "./helpers.ts";
import { DELIVERED, H, IN_TRANSIT, OUT_FOR_DELIVERY, POSTED, T0, iso } from "./fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "rastreio-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("concorrência", () => {
  it("4 workers com conexões separadas consultando os mesmos eventos em ordens diferentes: um evento por ocorrência e o mesmo status final", async () => {
    const path = join(dir, "race.db");
    openDatabase(path).close();
    const events = [POSTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED].map((rawStatus, i) => ({ rawStatus, occurredAt: iso(i * 3 * H) }));
    const run = (worker: number) =>
      new Promise<Array<{ added: number; duplicates: number }>>((resolve, reject) => {
        const w = new Worker(new URL("./worker.ts", import.meta.url), { workerData: { path, worker, events } });
        w.once("message", resolve);
        w.once("error", reject);
      });
    const outputs = await Promise.all([0, 1, 2, 3].map(run));

    const totalAdded = outputs.flat().reduce((sum, o) => sum + o.added, 0);
    expect(totalAdded).toBe(4); // cada ocorrência entrou exatamente uma vez, de todos os workers somados

    const db = openDatabase(path);
    const view = loadShipment(db, "BR1")!;
    expect(view.history).toHaveLength(4);
    expect(view.status).toBe("delivered");
    expect((db.prepare("SELECT COUNT(*) AS n FROM tracking_events").get() as { n: number }).n).toBe(4);
  }, 30_000);

  it("4 workers verificando atrasos ao mesmo tempo, cada um com a sua conexão: cada aviso é entregue exatamente uma vez", async () => {
    const path = join(dir, "alerts.db");
    const db = openDatabase(path);
    const codes = ["BR1", "BR2", "BR3", "BR4", "BR5", "BR6"];
    for (const code of codes) registerShipment(db, { code, carrier: "via-rapida", creatorId: null, campaignId: null }, () => new Date(T0));
    db.close();

    const run = () =>
      new Promise<{ result: { newly_alerted: number; notified: number }; sent: string[] }>((resolve, reject) => {
        const w = new Worker(new URL("./alerts-worker.ts", import.meta.url), { workerData: { path, nowMs: T0 + 100 * H } });
        w.once("message", resolve);
        w.once("error", reject);
      });
    const outputs = await Promise.all([run(), run(), run(), run()]);

    const delivered = outputs.flatMap((o) => o.sent).sort();
    expect(delivered).toEqual(codes); // nenhum aviso perdido e nenhum duplicado
    expect(outputs.reduce((sum, o) => sum + o.result.newly_alerted, 0)).toBe(codes.length);
    const verify = openDatabase(path);
    expect(verify.prepare("SELECT COUNT(*) AS n FROM alerts WHERE notified_at IS NOT NULL").get()).toEqual({ n: codes.length });
    expect(verify.prepare("SELECT COUNT(*) AS n FROM alerts").get()).toEqual({ n: codes.length });
  }, 30_000);

  it("várias verificações de atraso no mesmo processo avisam uma vez só", async () => {
    const t = setup({ thresholdHours: 72 });
    await t.register("BR1");
    t.setNow(100 * H);
    const results = await Promise.all(Array.from({ length: 10 }, () => t.checkDelays()));
    expect(t.notifier.sent).toHaveLength(1);
    expect(results.reduce((sum, r) => sum + r.body.newly_alerted, 0)).toBe(1);
  });
});
