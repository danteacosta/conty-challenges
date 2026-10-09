import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { createScript, getScript, requestChanges } from "../src/store.ts";
import { tsWorker } from "./spawn-worker.ts";

const dir = mkdtempSync(join(tmpdir(), "roteiro-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const now = () => new Date("2026-03-10T15:00:00.000Z");

type Action = "approve" | "request_changes" | "submit_version";

/** Sobe um worker por ação, espera todos prontos na barreira e libera a largada de uma vez. */
async function race(path: string, id: string, actions: Action[]) {
  const barrier = new SharedArrayBuffer(8);
  const flags = new Int32Array(barrier);
  const done = actions.map(
    (action, i) =>
      new Promise<{ action: Action; result: string }>((resolve, reject) => {
        const worker = tsWorker(new URL("./race-worker.ts", import.meta.url), { path, id, action, barrier, label: `w${i}` });
        worker.once("message", resolve);
        worker.once("error", reject);
      }),
  );
  while (Atomics.load(flags, 1) < actions.length) await new Promise((resolve) => setTimeout(resolve, 5));
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
  return Promise.all(done);
}

function freshScript(name: string, state: "awaiting_review" | "changes_requested") {
  const path = join(dir, name);
  const db = openDatabase(path);
  createScript(db, { id: "scr_1", missionId: "msn_1", content: "v1" }, now);
  if (state === "changes_requested") requestChanges(db, { id: "scr_1", reason: "A", deadlineDate: "2026-03-20" }, now);
  db.close();
  return path;
}

describe("concorrência, com as conexões largando juntas", () => {
  it("aprovar e pedir alteração ao mesmo tempo: um só vence, e o resultado é coerente, 12 vezes em bancos novos", async () => {
    for (let round = 0; round < 12; round += 1) {
      const path = freshScript(`aprova-${round}.sqlite`, "awaiting_review");
      const results = await race(path, "scr_1", ["approve", "approve", "request_changes", "request_changes"]);

      const check = openDatabase(path);
      const view = getScript(check, "scr_1");
      check.close();
      if (!view.ok) throw new Error("roteiro sumiu");
      const byAction = (action: Action) => results.filter((r) => r.action === action).map((r) => r.result).sort();

      if (view.view.state === "approved") {
        expect(view.view.change_requests, `rodada ${round}`).toHaveLength(0);
        expect(byAction("approve")).toEqual(["ok", "ok"]); // a aprovação é idempotente
        expect(byAction("request_changes")).toEqual(["script_approved", "script_approved"]);
      } else {
        expect(view.view.state, `rodada ${round}`).toBe("changes_requested");
        expect(view.view.change_requests, `rodada ${round}`).toHaveLength(1);
        expect(view.view.approved).toBeNull();
        expect(byAction("request_changes")).toEqual(["invalid_state", "ok"]);
        expect(byAction("approve")).toEqual(["invalid_state", "invalid_state"]);
      }
    }
  }, 60_000);

  it("quatro envios de versão ao mesmo tempo: exatamente uma versão nova entra, 12 vezes em bancos novos", async () => {
    for (let round = 0; round < 12; round += 1) {
      const path = freshScript(`versao-${round}.sqlite`, "changes_requested");
      const results = await race(path, "scr_1", ["submit_version", "submit_version", "submit_version", "submit_version"]);

      expect(results.map((r) => r.result).sort(), `rodada ${round}`).toEqual(["invalid_state", "invalid_state", "invalid_state", "ok"]);
      const check = openDatabase(path);
      const view = getScript(check, "scr_1");
      check.close();
      if (!view.ok) throw new Error("roteiro sumiu");
      expect(view.view.versions.map((v) => v.number)).toEqual([1, 2]);
      expect(view.view.state).toBe("awaiting_review");
      expect(view.view.change_requests[0]?.answered_by_version).toBe(2);
    }
  }, 60_000);
});
