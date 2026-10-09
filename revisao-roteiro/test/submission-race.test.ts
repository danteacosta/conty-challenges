import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { createScript, getScript, requestChanges } from "../src/store.ts";
import { tsWorker } from "./spawn-worker.ts";

const dir = mkdtempSync(join(tmpdir(), "roteiro-envio-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const now = () => new Date("2026-03-10T15:00:00.000Z");

type Result = { result: string; version?: number; replayed?: boolean };

/** Um worker por conteúdo, todos com o mesmo submission_id e a mesma rodada, largando juntos. */
async function raceSubmissions(path: string, contents: string[], changeRequestId: number): Promise<Result[]> {
  const barrier = new SharedArrayBuffer(8);
  const flags = new Int32Array(barrier);
  const done = contents.map(
    (content) =>
      new Promise<Result>((resolve, reject) => {
        const worker = tsWorker(new URL("./submission-worker.ts", import.meta.url), { path, id: "scr_1", content, submissionId: "s1", changeRequestId, barrier });
        worker.once("message", resolve);
        worker.once("error", reject);
      }),
  );
  while (Atomics.load(flags, 1) < contents.length) await new Promise((resolve) => setTimeout(resolve, 5));
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
  return Promise.all(done);
}

function freshScript(name: string) {
  const path = join(dir, name);
  const db = openDatabase(path);
  createScript(db, { id: "scr_1", missionId: "msn_1", content: "v1" }, now);
  const requested = requestChanges(db, { id: "scr_1", reason: "A", deadlineDate: "2026-03-20" }, now);
  if (!requested.ok) throw new Error("preparação falhou");
  const roundId = requested.view.change_requests[0]!.id;
  db.close();
  return { path, roundId };
}

describe("o mesmo envio disparado por quatro conexões ao mesmo tempo", () => {
  it("mesmo id e mesmo conteúdo: uma versão nova, um envio original e três repetições, 12 vezes em bancos novos", async () => {
    for (let round = 0; round < 12; round += 1) {
      const { path, roundId } = freshScript(`igual-${round}.sqlite`);
      const results = await raceSubmissions(path, ["texto novo", "texto novo", "texto novo", "texto novo"], roundId);
      expect(results.every((r) => r.result === "ok" && r.version === 2), `rodada ${round}`).toBe(true);
      expect(results.filter((r) => r.replayed === false), `rodada ${round}`).toHaveLength(1);
      expect(results.filter((r) => r.replayed === true), `rodada ${round}`).toHaveLength(3);

      const check = openDatabase(path);
      const seen = getScript(check, "scr_1");
      check.close();
      if (!seen.ok) throw new Error("roteiro sumiu");
      expect(seen.view.versions.map((v) => v.number)).toEqual([1, 2]);
    }
  }, 60_000);

  it("mesmo id com dois conteúdos diferentes: um conteúdo vence, o outro recebe 409, e nenhuma versão extra nasce", async () => {
    for (let round = 0; round < 12; round += 1) {
      const { path, roundId } = freshScript(`conflito-${round}.sqlite`);
      const results = await raceSubmissions(path, ["texto A", "texto A", "texto B", "texto B"], roundId);
      const check = openDatabase(path);
      const seen = getScript(check, "scr_1");
      check.close();
      if (!seen.ok) throw new Error("roteiro sumiu");
      expect(seen.view.versions.map((v) => v.number), `rodada ${round}`).toEqual([1, 2]);
      const winner = seen.view.versions[1]!.content;
      const winners = ["texto A", "texto A", "texto B", "texto B"].map((content, i) => ({ content, result: results[i]! })).filter((x) => x.content === winner);
      const losers = ["texto A", "texto A", "texto B", "texto B"].map((content, i) => ({ content, result: results[i]! })).filter((x) => x.content !== winner);
      expect(winners.every((x) => x.result.result === "ok" && x.result.version === 2), `rodada ${round}`).toBe(true);
      expect(losers.every((x) => x.result.result === "submission_conflict"), `rodada ${round}`).toBe(true);
    }
  }, 60_000);
});
