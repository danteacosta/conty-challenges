import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { submitVersion } from "../src/store.ts";

// Cada worker usa a sua conexão e faz UM envio com id; todos largam juntos, na barreira.
const { path, id, content, submissionId, changeRequestId, barrier } = workerData as {
  path: string;
  id: string;
  content: string;
  submissionId: string;
  changeRequestId: number;
  barrier: SharedArrayBuffer;
};
const db = openDatabase(path);
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);

const outcome = submitVersion(db, { id, content, submissionId, changeRequestId }, () => new Date("2026-03-10T15:00:00.000Z"));
parentPort?.postMessage(outcome.ok ? { result: "ok", version: outcome.submission?.version, replayed: outcome.submission?.replayed } : { result: outcome.code });
