import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../src/db.ts";
import { DEFAULT_POLICY } from "./helpers.ts";
import { syncConnection } from "../src/sync.ts";
import { getConnection } from "../src/store.ts";
import { FakeClock, FakeProvider } from "./fakes.ts";
import type { PostSnapshot } from "../src/domain/types.ts";

// Cada worker usa a sua conexão ao mesmo arquivo e sincroniza a sua janela com os seus dados; todos largam juntos, na barreira.
const { path, connectionId, window, posts, barrier } = workerData as {
  path: string;
  connectionId: string;
  window: { since: string; until: string };
  posts: PostSnapshot[];
  barrier: SharedArrayBuffer;
};
const db = openDatabase(path);
const clock = new FakeClock("2026-06-01T12:00:00.000Z");
const provider = new FakeProvider(clock);
provider.posts = posts;
const connection = getConnection(db, connectionId)!;
const flags = new Int32Array(barrier);
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);

const summary = await syncConnection(db, { provider, now: clock.now, sleep: clock.sleep, policy: DEFAULT_POLICY, maxPages: 50 }, connection, window);
parentPort?.postMessage(summary);
