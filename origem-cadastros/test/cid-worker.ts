import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { recordInstall, recordTouch } from "../src/store.ts";

// Cada worker, com a sua conexão, tenta registrar os MESMOS cliques (cids) com dados diferentes (o seu ref); todos largam juntos.
const { path, worker, clicks, barrier } = workerData as { path: string; worker: number; clicks: number; barrier: SharedArrayBuffer };
const db = openDatabase(path);
recordInstall(db, "ins_1", "2026-06-01T12:00:00.000Z");
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);

const results: Array<{ cid: string; result: string; canonicalRef?: string }> = [];
for (let i = 0; i < clicks; i += 1) {
  const cid = `clk_${i}`;
  const out = recordTouch(db, { installId: "ins_1", cid, src: "campaign", ref: `ref-do-worker-${worker}`, touchedAt: "2026-06-01T13:00:00.000Z" }, "x");
  results.push({ cid, result: out.result, canonicalRef: out.result === "conflict" ? out.canonical.ref : undefined });
}
parentPort?.postMessage(results);
