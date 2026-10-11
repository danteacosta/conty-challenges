import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { createCampaign, createDelivery, getDelivery } from "../src/store.ts";
import { tsWorker } from "./spawn-worker.ts";

const dir = mkdtempSync(join(tmpdir(), "video-envio-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const now = () => new Date("2026-06-01T12:00:00.000Z");

type Result = { result: string; number?: number; replayed?: boolean };

async function raceSubmissions(path: string, urls: string[]): Promise<Result[]> {
  const barrier = new SharedArrayBuffer(8);
  const flags = new Int32Array(barrier);
  const done = urls.map(
    (url) =>
      new Promise<Result>((resolve, reject) => {
        const worker = tsWorker(new URL("./submission-worker.ts", import.meta.url), { path, deliveryId: "d1", url, submissionId: "s1", barrier });
        worker.once("message", resolve);
        worker.once("error", reject);
      }),
  );
  done.forEach((promise) => promise.catch(() => {}));
  while (Atomics.load(flags, 1) < urls.length) await new Promise((resolve) => setTimeout(resolve, 5));
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
  return Promise.all(done);
}

function freshDelivery(name: string) {
  const path = join(dir, name);
  const db = openDatabase(path);
  createCampaign(db, { id: "c1", required: ["video"] }, now);
  createDelivery(db, { id: "d1", campaignId: "c1" }, now);
  db.close();
  return path;
}

const versionsOf = (path: string) => {
  const db = openDatabase(path);
  const out = getDelivery(db, "d1");
  db.close();
  if (!out.ok) throw new Error("entrega sumiu");
  return out.view.pieces.video.versions;
};

describe("o mesmo envio de versão disparado por quatro conexões ao mesmo tempo", () => {
  it("mesmo id e mesma URL: uma versão, um envio original e três repetições, 12 vezes em bancos novos", async () => {
    for (let round = 0; round < 12; round += 1) {
      const path = freshDelivery(`igual-${round}.sqlite`);
      const results = await raceSubmissions(path, Array(4).fill("https://arquivos.example/a.mp4"));
      expect(results.every((r) => r.result === "ok" && r.number === 1), `rodada ${round}`).toBe(true);
      expect(results.filter((r) => r.replayed === false), `rodada ${round}`).toHaveLength(1);
      expect(versionsOf(path), `rodada ${round}`).toHaveLength(1);
    }
  }, 60_000);

  it("mesmo id com duas URLs: uma vence, a outra recebe 409, e nenhuma versão extra nasce", async () => {
    for (let round = 0; round < 12; round += 1) {
      const path = freshDelivery(`conflito-${round}.sqlite`);
      const urls = ["https://arquivos.example/a.mp4", "https://arquivos.example/a.mp4", "https://arquivos.example/b.mp4", "https://arquivos.example/b.mp4"];
      const results = await raceSubmissions(path, urls);
      const versions = versionsOf(path);
      expect(versions, `rodada ${round}`).toHaveLength(1);
      const winnerUrl = versions[0]!.url;
      urls.forEach((url, i) => {
        expect(results[i]!.result, `rodada ${round}`).toBe(url === winnerUrl ? "ok" : "submission_conflict");
      });
    }
  }, 60_000);
});
