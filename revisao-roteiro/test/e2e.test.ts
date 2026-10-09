import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

let server: ReturnType<typeof serve>;
let base = "";
const clock = { current: new Date("2026-03-10T15:00:00.000Z") };

beforeAll(async () => {
  server = serve({ fetch: createApp({ db: openDatabase(":memory:"), now: () => new Date(clock.current) }).fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const send = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("jornada completa por HTTP real", () => {
  it("roteiro, pedido de alteração, versão tardia, aprovação e nada mais depois", async () => {
    const created = await (await send("POST", "/scripts", { mission_id: "msn_e2e", content: "v1" })).json();
    const id = created.id as string;

    await send("POST", `/scripts/${id}/change-requests`, { reason: "Tirar o preço", deadline_date: "2026-03-12" });
    clock.current = new Date("2026-03-13T03:00:00.000Z"); // primeiro instante do dia seguinte em São Paulo
    const second = await (await send("POST", `/scripts/${id}/versions`, { content: "v2" })).json();
    expect(second.versions.map((v: any) => v.late)).toEqual([false, true]);

    expect((await send("POST", `/scripts/${id}/approve`)).status).toBe(200);
    expect((await send("POST", `/scripts/${id}/versions`, { content: "v3" })).status).toBe(409);
    expect((await send("POST", `/scripts/${id}/change-requests`, { reason: "x", deadline_date: "2026-04-01" })).status).toBe(409);
    const final = await (await send("GET", `/scripts/${id}`)).json();
    expect(final).toMatchObject({ state: "approved", current_version: 2, allowed_actions: [] });
  });
});
