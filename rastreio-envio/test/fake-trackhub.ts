import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";

/** Servidor que fala o formato do TrackHub (agregador fictício), para testar o cliente HTTP de verdade. */
export type RawTracking = {
  tracking_number: string;
  courier: string;
  checkpoints: Array<{ id: string; status_code: string; message: string; time: string; city: string | null }>;
};

export async function startFakeTrackHub(apiKey = "chave-de-teste") {
  const state = {
    registered: new Map<string, string>(),
    trackings: new Map<string, RawTracking>(),
    nextResponse: null as null | { status: number; body: string },
    delayMs: 0,
    requests: [] as Array<{ method: string; path: string; auth: string | undefined }>,
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    state.requests.push({ method: c.req.method, path: new URL(c.req.url).pathname, auth: c.req.header("authorization") });
    if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    if (state.nextResponse) {
      const { status, body } = state.nextResponse;
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    }
    if (c.req.header("authorization") !== `Bearer ${apiKey}`) return c.json({ error: "unauthorized" }, 401);
    return next();
  });
  app.post("/v1/trackings", async (c) => {
    const b = await c.req.json();
    state.registered.set(b.tracking_number, b.courier);
    return c.json({ tracking_number: b.tracking_number, courier: b.courier }, 201);
  });
  app.get("/v1/trackings/:code", (c) => {
    const found = state.trackings.get(c.req.param("code"));
    return found ? c.json(found) : c.json({ error: "not_found" }, 404);
  });

  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { state, baseUrl, apiKey, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
