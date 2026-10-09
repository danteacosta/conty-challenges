import { serve } from "@hono/node-server";
import { createSimulator } from "./simulator.ts";

// Provedor simulado com alguns posts de exemplo, para demonstrar a API (`npm run simulator` + `npm start`).
const port = Number(process.env.SIMULATOR_PORT ?? 4011);
const { app, state } = createSimulator();
for (const network of ["instagram", "tiktok", "youtube", "x"] as const) {
  state.setPosts(network, "demo", [
    { id: `${network}_1`, publishedAt: "2026-05-20T10:00:00.000Z", views: 1200, likes: 90, comments: 7, shares: 3 },
    { id: `${network}_2`, publishedAt: "2026-05-25T10:00:00.000Z", views: 5400, likes: 410, comments: 32, shares: 18 },
    { id: `${network}_3`, publishedAt: "2026-05-30T10:00:00.000Z", views: 800, likes: 55, comments: 4, shares: 1 },
  ]);
}
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`provedor simulado em http://127.0.0.1:${port} (contas: "demo" em instagram, tiktok, youtube e x)`);
