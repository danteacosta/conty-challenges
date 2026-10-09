import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

const port = Number(process.env.PORT ?? 3010);
const app = createApp(openDatabase(process.env.DB_PATH ?? ":memory:"));
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`vendas-shopify em http://127.0.0.1:${port}`);
