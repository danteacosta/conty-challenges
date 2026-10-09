import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { tsWorker } from "./spawn-worker.ts";

const dir = mkdtempSync(join(tmpdir(), "origem-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("concorrência", () => {
  it("4 workers com conexões separadas cadastrando o mesmo usuário: um cadastro só, uma origem só, um primeiro open só", async () => {
    const path = join(dir, "race.db");
    openDatabase(path).close();
    const run = (worker: number) =>
      new Promise<{ origins: string[]; results: string[] }>((resolve, reject) => {
        const w = tsWorker(new URL("./worker.ts", import.meta.url), { path, worker });
        w.once("message", resolve);
        w.once("error", reject);
      });
    const outputs = await Promise.all([0, 1, 2, 3].map(run));

    const results = outputs.flatMap((o) => o.results);
    expect(results.filter((r) => r === "created")).toHaveLength(1);
    expect(new Set(outputs.flatMap((o) => o.origins)).size).toBe(1);

    const db = openDatabase(path);
    expect((db.prepare("SELECT COUNT(*) AS n FROM signups").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM installs").get() as { n: number }).n).toBe(1);
  }, 30_000);

  it("4 workers mandando os mesmos 200 cliques com dados diferentes, largando juntos, 4 vezes: cada clique tem um só canônico e todo conflito aponta para ele", async () => {
    const CLICKS = 200;
    for (let round = 0; round < 4; round += 1) {
      const path = join(dir, `cid-${round}.db`);
      openDatabase(path).close();
      const barrier = new SharedArrayBuffer(8);
      const flags = new Int32Array(barrier);
      const done = [0, 1, 2, 3].map(
        (worker) =>
          new Promise<Array<{ cid: string; result: string; canonicalRef?: string }>>((resolve, reject) => {
            const w = tsWorker(new URL("./cid-worker.ts", import.meta.url), { path, worker, clicks: CLICKS, barrier });
            w.once("message", resolve);
            w.once("error", reject);
          }),
      );
      while (Atomics.load(flags, 1) < 4) await new Promise((resolve) => setTimeout(resolve, 5));
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      const outputs = await Promise.all(done);

      const db = openDatabase(path);
      for (let i = 0; i < CLICKS; i += 1) {
        const cid = `clk_${i}`;
        const stored = db.prepare("SELECT ref FROM touches WHERE cid = ?").all(cid) as Array<{ ref: string }>;
        const results = outputs.flatMap((o) => o.filter((r) => r.cid === cid));
        expect(results.filter((r) => r.result === "recorded"), `rodada ${round}, ${cid}`).toHaveLength(1); // exatamente um primeiro clique
        expect(stored, `rodada ${round}, ${cid}`).toHaveLength(1); // e só o payload canônico foi gravado
        for (const r of results) if (r.result === "conflict") expect(r.canonicalRef).toBe(stored[0]!.ref);
      }
      db.close();
    }
  }, 120_000);

  it("os mesmos 200 usuários cadastrados por 4 conexões com 2 instalações diferentes, largando juntas, 4 vezes: uma decisão por usuário, e quem diverge dela recebe conflito", async () => {
    const USERS = 200;
    for (let round = 0; round < 4; round += 1) {
      const path = join(dir, `conflito-${round}.db`);
      openDatabase(path).close();
      const barrier = new SharedArrayBuffer(8);
      const flags = new Int32Array(barrier);
      const installs = ["ins_A", "ins_B", "ins_A", "ins_B"];
      const done = installs.map(
        (installId) =>
          new Promise<{ installId: string; results: string[] }>((resolve, reject) => {
            const w = tsWorker(new URL("./signup-worker.ts", import.meta.url), { path, installId, users: USERS, barrier });
            w.once("message", resolve);
            w.once("error", reject);
          }),
      );
      while (Atomics.load(flags, 1) < installs.length) await new Promise((resolve) => setTimeout(resolve, 5));
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      const outputs = await Promise.all(done);

      const db = openDatabase(path);
      expect(db.prepare("SELECT COUNT(*) AS n FROM signups").get(), `rodada ${round}`).toEqual({ n: USERS });
      for (let i = 0; i < USERS; i += 1) {
        const winner = (db.prepare("SELECT install_id FROM signups WHERE user_id = ?").get(`usr_${i}`) as { install_id: string }).install_id;
        const results = outputs.map((o) => ({ installId: o.installId, result: o.results[i]! }));
        expect(results.filter((r) => r.result === "created"), `rodada ${round}, usr_${i}: ${JSON.stringify(results)}`).toHaveLength(1);
        for (const r of results) {
          if (r.result === "created") expect(r.installId).toBe(winner);
          else expect(r.result, `rodada ${round}, usr_${i}`).toBe(r.installId === winner ? "duplicate" : "conflict");
        }
      }
      db.close();
    }
  }, 120_000);

  it("a mesma requisição de cadastro em paralelo no mesmo processo cria uma origem só", async () => {
    const { setup, at, D, H } = await import("./helpers.ts").then((m) => ({ ...m }));
    const t = setup();
    await t.install("ins_1", 0);
    await t.touch("ins_1", "campaign", "verao", "clk_1", 1 * H);
    const all = await Promise.all(Array.from({ length: 30 }, () => t.signup("usr_1", "ins_1", 1 * D)));
    expect(all.filter((r) => r.body.result === "created")).toHaveLength(1);
    expect(new Set(all.map((r) => JSON.stringify(r.body.origin))).size).toBe(1);
    expect(at(0)).toBeTruthy();
  });
});
