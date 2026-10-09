import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { HttpMetricsProvider } from "./providers/http.ts";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const { providerUrl, providerTimeoutMs, maxRetryAfterMs } = config;
const app = createApp({
  db: openDatabase(config.dbPath),
  providerFor: (connection) => new HttpMetricsProvider({ baseUrl: providerUrl, network: connection.provider, timeoutMs: providerTimeoutMs }),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  policy: { maxAttempts: 4, baseDelayMs: 200, maxBackoffMs: 5000, maxRetryAfterMs },
  maxPages: 50,
});
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" });
console.log(`metricas-redes em http://127.0.0.1:${config.port} (provedor: ${providerUrl})`);
