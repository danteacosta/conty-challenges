import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { InMemoryAggregator, RecordingNotifier } from "./fakes.ts";
import { T0 } from "./fixtures.ts";

export function setup(options: { thresholdHours?: number; aggregator?: InMemoryAggregator } = {}) {
  const aggregator = options.aggregator ?? new InMemoryAggregator();
  const notifier = new RecordingNotifier();
  const clock = { current: T0 };
  const app = createApp({
    db: openDatabase(":memory:"),
    aggregator,
    notifier,
    now: () => new Date(clock.current),
    thresholdHours: options.thresholdHours ?? 72,
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
    aggregator,
    notifier,
    clock,
    setNow: (ms: number) => (clock.current = T0 + ms),
    register: (code: string, carrier = "via-rapida", extra: Record<string, unknown> = {}) =>
      call("POST", "/shipments", { tracking_code: code, carrier, ...extra }),
    refresh: (code: string) => call("POST", `/shipments/${code}/refresh`),
    get: (code: string) => call("GET", `/shipments/${code}`),
    checkDelays: () => call("POST", "/jobs/check-delays"),
    alerts: () => call("GET", "/alerts"),
    call,
  };
}
