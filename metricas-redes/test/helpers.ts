import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import type { Policy } from "../src/domain/retry.ts";
import { FakeClock, FakeProvider } from "./fakes.ts";

export const START = "2026-06-01T12:00:00.000Z";
export const ALL = { since: "2026-01-01T00:00:00.000Z", until: "2026-12-31T23:59:59.999Z" };

export const DEFAULT_POLICY: Policy = { maxAttempts: 4, baseDelayMs: 200, maxBackoffMs: 5000, maxRetryAfterMs: 30_000 };

export function setup(options: { policy?: Partial<Policy>; maxPages?: number } = {}) {
  const clock = new FakeClock(START);
  const provider = new FakeProvider(clock);
  const app = createApp({
    db: openDatabase(":memory:"),
    providerFor: () => provider,
    now: clock.now,
    sleep: clock.sleep,
    policy: { ...DEFAULT_POLICY, ...options.policy },
    maxPages: options.maxPages ?? 50,
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return {
    app,
    clock,
    provider,
    call,
    connect: async (providerName = "instagram", account_id = "acc_1", token = "tok-super-secreto") =>
      (await call("POST", "/connections", { provider: providerName, account_id, token })).body.id as string,
    sync: (id: string, window: { since: string; until: string } = ALL) => call("POST", `/connections/${id}/sync`, window),
    metrics: (id: string) => call("GET", `/connections/${id}/metrics`),
    runs: (id: string) => call("GET", `/connections/${id}/syncs`),
  };
}
