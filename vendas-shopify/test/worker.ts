import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { ingestOrder, ingestRefund } from "../src/store.ts";

// Cada worker abre a sua própria conexão no mesmo arquivo e repete o mesmo lote de webhooks.
const { path, orderTotalCents, refundIds, rounds } = workerData as {
  path: string;
  orderTotalCents: number;
  refundIds: string[];
  rounds: number;
};
const db = openDatabase(path);
const now = () => new Date().toISOString();
for (let i = 0; i < rounds; i += 1) {
  for (const id of refundIds) ingestRefund(db, { id, orderId: "1", amountCents: 3000 }, now);
  ingestOrder(
    db,
    { id: "1", totalCents: orderTotalCents, currency: "BRL", financialStatus: "paid", createdAt: null, signals: { couponCodes: [], utmHandle: null } },
    now,
  );
}
parentPort?.postMessage("done");
