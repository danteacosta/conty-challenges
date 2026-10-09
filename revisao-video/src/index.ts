import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

const port = Number(process.env.PORT ?? 3015);
const app = createApp({ db: openDatabase(process.env.DB_PATH ?? ":memory:"), now: () => new Date() });
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`revisao-video em http://127.0.0.1:${port}`);
