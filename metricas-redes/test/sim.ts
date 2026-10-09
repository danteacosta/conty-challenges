import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSimulator } from "../src/providers/simulator.ts";

/** Sobe o provedor simulado de verdade em uma porta efêmera. */
export async function startSimulator() {
  const simulator = createSimulator();
  const server = serve({ fetch: simulator.app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    state: simulator.state,
    baseUrl,
    close: () =>
      new Promise<void>((resolve) => {
        (server as Server).closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
