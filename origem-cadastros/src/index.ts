import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

const port = Number(process.env.PORT ?? 3011);
serve({ fetch: createApp(openDatabase(process.env.DB_PATH ?? ":memory:")).fetch, port, hostname: "127.0.0.1" });
console.log(`origem-cadastros em http://127.0.0.1:${port}`);
