import { serve } from "@hono/node-server";
import { ConsoleNotifier } from "./alerts.ts";
import { HttpTrackHubClient } from "./aggregator/trackhub/client.ts";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const app = createApp({
  db: openDatabase(config.dbPath),
  aggregator: new HttpTrackHubClient({ baseUrl: config.trackhubUrl, apiKey: config.trackhubApiKey, timeoutMs: config.trackhubTimeoutMs }),
  notifier: new ConsoleNotifier(),
  now: () => new Date(),
  thresholdHours: config.thresholdHours,
});
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" });
console.log(`rastreio-envio em http://127.0.0.1:${config.port}`);
