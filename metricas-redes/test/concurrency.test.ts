import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import type { PostSnapshot } from "../src/domain/types.ts";
import { createConnection } from "../src/store.ts";
import { snap } from "./fakes.ts";
import { tsWorker } from "./spawn-worker.ts";

const dir = mkdtempSync(join(tmpdir(), "metricas-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Job = { window: { since: string; until: string }; posts: PostSnapshot[] };

/** Um worker por sincronização; todos esperam na barreira e largam juntos. Se um worker morrer antes da barreira, o teste falha na hora, com o erro. */
async function race(path: string, connectionId: string, jobs: Job[]) {
  const barrier = new SharedArrayBuffer(8);
  const flags = new Int32Array(barrier);
  let failure: Error | null = null;
  const done = jobs.map(
    (job) =>
      new Promise<{ new_snapshots: number; duplicates: number; stale: number; status: string }>((resolve, reject) => {
        const worker = tsWorker(new URL("./race-worker.ts", import.meta.url), { path, connectionId, barrier, ...job });
        worker.once("message", resolve);
        worker.once("error", (error) => {
          failure = error;
          reject(error);
        });
      }),
  );
  done.forEach((promise) => promise.catch(() => {}));
  while (Atomics.load(flags, 1) < jobs.length) {
    if (failure) throw failure;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
  return Promise.all(done);
}

function freshConnection(name: string) {
  const path = join(dir, name);
  const db = openDatabase(path);
  const connection = createConnection(db, { id: "con_1", provider: "instagram", accountId: "acc_1", token: "tok" }, () => new Date("2026-06-01T12:00:00.000Z"));
  if (!connection.ok) throw new Error("conexão não criada");
  db.close();
  return path;
}

const T1 = "2026-06-01T12:00:00.000Z";
const posts = ["2026-05-20", "2026-05-22", "2026-05-24", "2026-05-26"].map((day, i) => snap(`p${i + 1}`, `${day}T10:00:00.000Z`, T1, 1000 * (i + 1)));
const window = (from: string, to: string) => ({ since: `${from}T00:00:00.000Z`, until: `${to}T23:59:59.999Z` });

describe("sincronizações simultâneas da mesma conexão, largando juntas", () => {
  it("janelas que se sobrepõem, ao mesmo tempo: cada snapshot entra uma vez e o total é o de cada post uma vez, 10 vezes em bancos novos", async () => {
    for (let round = 0; round < 10; round += 1) {
      const path = freshConnection(`sobrepoe-${round}.sqlite`);
      const jobs: Job[] = [
        { window: window("2026-05-19", "2026-05-23"), posts }, // p1, p2
        { window: window("2026-05-21", "2026-05-25"), posts }, // p2, p3
        { window: window("2026-05-19", "2026-05-27"), posts }, // p1..p4
        { window: window("2026-05-23", "2026-05-27"), posts }, // p3, p4
      ];
      const runs = await race(path, "con_1", jobs);

      expect(runs.map((r) => r.status), `rodada ${round}`).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);
      expect(runs.reduce((s, r) => s + r.new_snapshots, 0), `rodada ${round}: cada snapshot é novo exatamente uma vez`).toBe(4);
      expect(runs.reduce((s, r) => s + r.duplicates, 0)).toBe(2 + 2 + 4 + 2 - 4);

      const db = openDatabase(path);
      expect(db.prepare("SELECT COUNT(*) AS n FROM metric_snapshots").get()).toEqual({ n: 4 });
      expect(db.prepare("SELECT COUNT(*) AS posts, SUM(views) AS views FROM posts").get()).toEqual({ posts: 4, views: 10_000 });
      db.close();
    }
  }, 90_000);

  it("snapshot novo e snapshot atrasado do mesmo post, ao mesmo tempo: o número final é sempre o do mais novo", async () => {
    for (let round = 0; round < 10; round += 1) {
      const path = freshConnection(`ordem-${round}.sqlite`);
      const newer = snap("p1", "2026-05-20T10:00:00.000Z", "2026-06-01T13:00:00.000Z", 5000);
      const older = snap("p1", "2026-05-20T10:00:00.000Z", "2026-06-01T09:00:00.000Z", 900);
      const w = window("2026-05-01", "2026-05-31");
      await race(path, "con_1", [
        { window: w, posts: [older] },
        { window: w, posts: [newer] },
        { window: w, posts: [older] },
        { window: w, posts: [newer] },
      ]);
      const db = openDatabase(path);
      expect(db.prepare("SELECT views, as_of FROM posts").get(), `rodada ${round}`).toEqual({ views: 5000, as_of: "2026-06-01T13:00:00.000Z" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM metric_snapshots").get()).toEqual({ n: 2 });
      db.close();
    }
  }, 90_000);
});
