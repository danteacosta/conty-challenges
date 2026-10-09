import { serve } from "@hono/node-server";
import { ConsoleNotifier } from "./alerts.ts";
import { HttpTrackHubClient } from "./aggregator/trackhub/client.ts";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

const port = Number(process.env.PORT ?? 3012);
const app = createApp({
  db: openDatabase(process.env.DB_PATH ?? ":memory:"),
  aggregator: new HttpTrackHubClient({
    baseUrl: process.env.TRACKHUB_URL ?? "http://127.0.0.1:4010",
    apiKey: process.env.TRACKHUB_API_KEY ?? "dev-key",
    timeoutMs: Number(process.env.TRACKHUB_TIMEOUT_MS ?? 5000),
  }),
  notifier: new ConsoleNotifier(),
  now: () => new Date(),
  thresholdHours: Number(process.env.TRANSIT_THRESHOLD_HOURS ?? 168),
});
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`rastreio-envio em http://127.0.0.1:${port}`);
