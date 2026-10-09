import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { recordInstall, recordTouch } from "../src/store.ts";

// Cada worker, com a sua conexão, tenta registrar o MESMO clique (cid) com dados diferentes.
const { path, worker } = workerData as { path: string; worker: number };
const db = openDatabase(path);
recordInstall(db, "ins_1", "2026-06-01T12:00:00.000Z");
const results: string[] = [];
const canonicalRefs = new Set<string>();
for (let round = 0; round < 20; round += 1) {
  const out = recordTouch(
    db,
    { installId: "ins_1", cid: "clk_x", src: "campaign", ref: `ref-do-worker-${worker}`, touchedAt: "2026-06-01T13:00:00.000Z" },
    "x",
  );
  results.push(out.result);
  if (out.result === "conflict") canonicalRefs.add(out.canonical.ref);
}
parentPort?.postMessage({ results, canonicalRefs: [...canonicalRefs] });
