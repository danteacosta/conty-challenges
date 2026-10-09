import { parentPort, workerData } from "node:worker_threads";
import { checkDelays, type DelayAlert } from "../src/alerts.ts";
import { openDatabase } from "../src/db.ts";

// Cada worker roda a verificação de atraso com a sua conexão ao mesmo arquivo.
const { path, nowMs } = workerData as { path: string; nowMs: number };
const sent: string[] = [];
const result = await checkDelays(openDatabase(path), {
  now: () => new Date(nowMs),
  thresholdHours: 72,
  notifier: { notify: async (alert: DelayAlert) => void sent.push(alert.tracking_code) },
});
parentPort?.postMessage({ result, sent });
