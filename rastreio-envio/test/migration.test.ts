import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkDelays, listAlerts } from "../src/alerts.ts";
import { openDatabase } from "../src/db.ts";
import { ingestEvents, loadShipment, registerShipment } from "../src/store.ts";
import { H, POSTED, T0, viaRapida } from "./fixtures.ts";
import { tsWorker } from "./spawn-worker.ts";

it("conexões concorrentes abrem um banco antigo sem perder o envio, histórico ou aviso pendente", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rastreio-migration-"));
  try {
    // Repetir inicializações sincronizadas aumenta a chance de intercalar a inspeção do esquema e a migração.
    for (let round = 0; round < 8; round += 1) {
      const path = join(dir, `old-${round}.sqlite`);
      const db = openDatabase(path);
      const now = () => new Date(T0);
      registerShipment(db, { code: "BR1", carrier: "via-rapida", creatorId: "crt_1", campaignId: "cmp_1" }, now);
      ingestEvents(db, "BR1", [viaRapida(POSTED, 0)], now);
      const before = loadShipment(db, "BR1");
      await checkDelays(db, {
        now: () => new Date(T0 + 100 * H), thresholdHours: 72,
        notifier: { notify: async () => { throw new Error("destino indisponível"); } },
      });
      // Um arquivo criado antes da introdução do descarte tinha esses mesmos dados, sem as duas colunas.
      db.exec("ALTER TABLE alerts DROP COLUMN discarded_at");
      db.exec("ALTER TABLE alerts DROP COLUMN discard_reason");
      db.close();

      const start = new SharedArrayBuffer(4);
      let ready = 0;
      const results = await Promise.all(Array.from({ length: 8 }, () => new Promise<{ opened: boolean; error?: string }>((resolve, reject) => {
        const worker = tsWorker(new URL("./migration-worker.ts", import.meta.url), { path, start });
        worker.once("error", reject);
        worker.on("message", (result: { ready?: boolean; opened: boolean; error?: string }) => {
          if (result.ready) {
            ready += 1;
            if (ready === 8) {
              Atomics.store(new Int32Array(start), 0, 1);
              Atomics.notify(new Int32Array(start), 0);
            }
          } else resolve(result);
        });
      })));
      expect(results).toEqual(Array.from({ length: 8 }, () => ({ opened: true })));

      const migrated = openDatabase(path);
      try {
        expect(loadShipment(migrated, "BR1")).toEqual(before);
        expect(listAlerts(migrated)).toMatchObject([{ tracking_code: "BR1", status: "pending", notified: false }]);
        expect(await checkDelays(migrated, {
          now: () => new Date(T0 + 101 * H), thresholdHours: 168, notifier: { notify: async () => { throw new Error("não deve enviar"); } },
        })).toMatchObject({ notified: 0, discarded: 1 });
        expect(listAlerts(migrated)).toMatchObject([{ status: "discarded", discard_reason: "within_threshold" }]);
      } finally { migrated.close(); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
