import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { ingestEvents, registerShipment } from "../src/store.ts";

// Cada worker usa a sua conexão e consulta os mesmos eventos, cada um numa ordem diferente.
const { path, worker, events } = workerData as { path: string; worker: number; events: Array<{ rawStatus: string; occurredAt: string }> };
const db = openDatabase(path);
const now = () => new Date("2026-06-02T00:00:00.000Z");
registerShipment(db, { code: "BR1", carrier: "via-rapida", creatorId: null, campaignId: null }, now);
const rotated = [...events.slice(worker % events.length), ...events.slice(0, worker % events.length)];
const outcomes: Array<{ added: number; duplicates: number }> = [];
for (let round = 0; round < 20; round += 1) {
  const batch = round % 2 === 0 ? rotated : [...rotated].reverse();
  const out = ingestEvents(db, "BR1", batch.map((e) => ({ ...e, description: null, location: null })), now);
  outcomes.push({ added: out?.added ?? 0, duplicates: out?.duplicates ?? 0 });
}
parentPort?.postMessage(outcomes);
