import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { recordInstall, signUp } from "../src/store.ts";

// Cada worker usa a sua conexão ao mesmo arquivo e tenta cadastrar os MESMOS usuários com a sua instalação; todos largam juntos.
const { path, installId, users, barrier } = workerData as { path: string; installId: string; users: number; barrier: SharedArrayBuffer };
const db = openDatabase(path);
recordInstall(db, installId, "2026-06-01T12:00:00.000Z");
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);

const results: string[] = [];
for (let i = 0; i < users; i += 1) {
  results.push(signUp(db, { userId: `usr_${i}`, installId, signedUpAt: "2026-06-02T12:00:00.000Z" }).result);
}
parentPort?.postMessage({ installId, results });
