import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { extendCooldown } from "../src/store.ts";

// Cada worker usa a sua conexão ao mesmo arquivo e estende o prazo uma vez; todos largam juntos, na barreira.
const { path, connectionId, until, barrier } = workerData as { path: string; connectionId: string; until: string; barrier: SharedArrayBuffer };
const db = openDatabase(path);
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);
extendCooldown(db, connectionId, until);
parentPort?.postMessage("ok");
