import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { HttpTrackHubClient } from "../src/aggregator/trackhub/client.ts";
import type { TrackingAggregator } from "../src/aggregator/port.ts";
import { openDatabase } from "../src/db.ts";
import { InMemoryAggregator, RecordingNotifier } from "./fakes.ts";
import { startFakeTrackHub, type RawTracking } from "./fake-trackhub.ts";
import { DELIVERED, IN_TRANSIT, POSTED, H, T0, viaRapida } from "./fixtures.ts";

let hub: Awaited<ReturnType<typeof startFakeTrackHub>>;
let server: ReturnType<typeof serve>;
let base = "";
const notifier = new RecordingNotifier();
const clock = { current: T0 };

function build(aggregator: TrackingAggregator) {
  return createApp({ db: openDatabase(":memory:"), aggregator, notifier, now: () => new Date(clock.current), thresholdHours: 72 });
}

beforeAll(async () => {
  hub = await startFakeTrackHub();
  const aggregator = new HttpTrackHubClient({ baseUrl: hub.baseUrl, apiKey: hub.apiKey, timeoutMs: 1000 });
  server = serve({ fetch: build(aggregator).fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await hub.close();
});

const send = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("jornada completa por HTTP, com o cliente real do TrackHub", () => {
  it("cadastra, consulta duas vezes, vê a entrega chegar e o atraso não disparar", async () => {
    const raw: RawTracking = {
      tracking_number: "BR777",
      courier: "correio-norte",
      checkpoints: [
        { id: "1", status_code: "OBJETO_POSTADO", message: "Postado", time: "2026-06-01T10:00:00Z", city: "Natal" },
        { id: "2", status_code: "EM_TRANSITO", message: "A caminho", time: "2026-06-02T10:00:00Z", city: null },
      ],
    };
    hub.state.trackings.set("BR777", raw);

    const created = await send("POST", "/shipments", { tracking_code: "BR777", carrier: "correio-norte", creator_id: "crt_ana" });
    expect(created.status).toBe(201);
    expect(hub.state.registered.get("BR777")).toBe("correio-norte");

    await send("POST", "/shipments/BR777/refresh");
    const second = await (await send("POST", "/shipments/BR777/refresh")).json();
    expect(second).toMatchObject({ added: 0, duplicates: 2, status: "in_transit" });

    raw.checkpoints.push({ id: "3", status_code: "ENTREGUE", message: "Entregue ao destinatário", time: "2026-06-03T10:00:00Z", city: "Natal" });
    await send("POST", "/shipments/BR777/refresh");

    clock.current = T0 + 400 * H;
    const shipment = await (await send("GET", "/shipments/BR777")).json();
    expect(shipment).toMatchObject({ status: "delivered", delivered_at: "2026-06-03T10:00:00.000Z" });
    expect(shipment.delay).toMatchObject({ delayed: false, delivered_late: false });
    expect(shipment.history.map((h: any) => h.status)).toEqual(["posted", "in_transit", "delivered"]);

    const jobs = await (await send("POST", "/jobs/check-delays")).json();
    expect(jobs.newly_alerted).toBe(0);
  });

  it("se o agregador cai, a API responde 502 em vez de inventar estado", async () => {
    await send("POST", "/shipments", { tracking_code: "BR778", carrier: "via-rapida" });
    hub.state.nextResponse = { status: 503, body: "{}" };
    const res = await send("POST", "/shipments/BR778/refresh");
    hub.state.nextResponse = null;
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "aggregator_unavailable", kind: "http" });
  });

  it("trocar o agregador não muda nada para quem usa a API: o mesmo fluxo roda com outra implementação da interface", async () => {
    const other = new InMemoryAggregator();
    other.script("BR1", [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 2 * H), viaRapida(DELIVERED, 9 * H)]);
    const app = build(other);
    const call = async (method: string, path: string, body?: unknown) =>
      (await app.request(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;

    await call("POST", "/shipments", { tracking_code: "BR1", carrier: "via-rapida" });
    expect(await call("POST", "/shipments/BR1/refresh")).toMatchObject({ added: 3, status: "delivered" });
  });
});
