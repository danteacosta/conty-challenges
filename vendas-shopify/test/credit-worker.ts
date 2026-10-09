import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { ingestOrder } from "../src/store.ts";

// Cada worker usa a sua conexão ao mesmo arquivo e manda o webhook (pendente ou pago) de VÁRIOS pedidos, na mesma ordem
// que os outros; todos largam juntos, na barreira, para os mesmos pedidos serem disputados por conexões diferentes.
const { path, status, orders, barrier } = workerData as { path: string; status: string; orders: number; barrier: SharedArrayBuffer };
const db = openDatabase(path);
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);

const results: string[] = [];
for (let id = 1; id <= orders; id += 1) {
  results.push(
    ingestOrder(
      db,
      { id: String(id), totalCents: 10000, currency: "BRL", financialStatus: status, createdAt: null, signals: { couponCodes: ["ANA10"], utmHandle: null } },
      () => "2026-06-01T12:00:00.000Z",
    ).result,
  );
}
parentPort?.postMessage(results);
