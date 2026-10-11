import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { submitVersion } from "../src/store.ts";

// Cada worker usa a sua conexão e faz UM envio com id; todos largam juntos, na barreira.
const { path, deliveryId, url, submissionId, barrier } = workerData as { path: string; deliveryId: string; url: string; submissionId: string; barrier: SharedArrayBuffer };
const db = openDatabase(path);
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);

const out = submitVersion(db, { deliveryId, piece: "video", url, durationSeconds: 30, submissionId }, () => new Date("2026-06-01T12:00:00.000Z"));
parentPort?.postMessage(out.ok ? { result: "ok", number: out.version.number, replayed: out.submission?.replayed } : { result: out.code });
