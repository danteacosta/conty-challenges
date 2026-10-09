import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { recordInstall, recordTouch, signUp } from "../src/store.ts";

// Cada worker usa a sua conexão e dispara a mesma sequência: primeiro open, toque e cadastro do mesmo usuário.
const { path, worker } = workerData as { path: string; worker: number };
const db = openDatabase(path);
const origins: string[] = [];
const results: string[] = [];
for (let round = 0; round < 25; round += 1) {
  // o "primeiro open" tenta ser gravado com horários diferentes por worker
  recordInstall(db, "ins_1", new Date(Date.UTC(2026, 5, 1, 12, 0, worker)).toISOString());
  recordTouch(db, { installId: "ins_1", cid: "clk_1", src: "campaign", ref: "verao", touchedAt: "2026-06-01T13:00:00.000Z" }, "x");
  const out = signUp(db, { userId: "usr_1", installId: "ins_1", signedUpAt: "2026-06-02T12:00:00.000Z" });
  origins.push(JSON.stringify(out.view.origin));
  results.push(out.result);
}
parentPort?.postMessage({ origins, results });
