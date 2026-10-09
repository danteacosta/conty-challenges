import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { approve, requestChanges, submitVersion } from "../src/store.ts";

// Cada worker usa a sua própria conexão ao mesmo arquivo e faz UMA ação; todos largam juntos, na barreira.
const { path, id, action, barrier, label } = workerData as {
  path: string;
  id: string;
  action: "approve" | "request_changes" | "submit_version";
  barrier: SharedArrayBuffer;
  label: string;
};
const db = openDatabase(path);
const now = () => new Date("2026-03-10T15:00:00.000Z");
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);

const outcome =
  action === "approve"
    ? approve(db, { id }, now)
    : action === "request_changes"
      ? requestChanges(db, { id, reason: `pedido de ${label}`, deadlineDate: "2026-03-20" }, now)
      : submitVersion(db, { id, content: `versão de ${label}` }, now);
parentPort?.postMessage({ action, result: outcome.ok ? "ok" : outcome.code });
