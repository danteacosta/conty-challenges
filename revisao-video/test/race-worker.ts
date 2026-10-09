import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { approveDelivery, decideVersion, submitVersion } from "../src/store.ts";

type Job =
  | { role: "submit_video"; deliveries: string[]; times: number }
  | { role: "approve_delivery"; deliveries: string[] }
  | { role: "approve_version"; deliveries: string[]; number: number };

// Cada worker usa a sua conexão ao mesmo arquivo e percorre as MESMAS entregas dos outros; todos largam juntos, na barreira.
const { path, job, barrier } = workerData as { path: string; job: Job; barrier: SharedArrayBuffer };
const db = openDatabase(path);
const now = () => new Date("2026-06-01T12:00:00.000Z");
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);

const results: Array<{ delivery: string; ok: boolean; code?: string; number?: number }> = [];
for (const delivery of job.deliveries) {
  if (job.role === "submit_video") {
    for (let i = 0; i < job.times; i += 1) {
      const out = submitVersion(db, { deliveryId: delivery, piece: "video", url: "https://arquivos.example/x.mp4", durationSeconds: null }, now);
      results.push({ delivery, ok: out.ok, ...(out.ok ? { number: out.version.number } : { code: out.code }) });
    }
  } else if (job.role === "approve_delivery") {
    const out = approveDelivery(db, { id: delivery }, now);
    results.push({ delivery, ok: out.ok, ...(out.ok ? {} : { code: out.code }) });
  } else {
    const out = decideVersion(db, { deliveryId: delivery, piece: "video", number: job.number, action: "approve" }, now);
    results.push({ delivery, ok: out.ok, ...(out.ok ? {} : { code: out.code }) });
  }
}
parentPort?.postMessage(results);
