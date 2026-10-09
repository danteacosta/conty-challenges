import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";

const dir = mkdtempSync(join(tmpdir(), "origem-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("concorrência", () => {
  it("4 workers com conexões separadas cadastrando o mesmo usuário: um cadastro só, uma origem só, um primeiro open só", async () => {
    const path = join(dir, "race.db");
    openDatabase(path).close();
    const run = (worker: number) =>
      new Promise<{ origins: string[]; results: string[] }>((resolve, reject) => {
        const w = new Worker(new URL("./worker.ts", import.meta.url), { workerData: { path, worker } });
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
