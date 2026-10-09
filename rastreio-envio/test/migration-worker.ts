import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";

const { path, start } = workerData as { path: string; start: SharedArrayBuffer };
parentPort?.postMessage({ ready: true });
Atomics.wait(new Int32Array(start), 0, 0);
try {
  const db = openDatabase(path);
  db.close();
  parentPort?.postMessage({ opened: true });
} catch (error) {
  parentPort?.postMessage({ opened: false, error: (error as Error).message });
}
