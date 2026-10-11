import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { PROVIDERS } from "../src/providers/adapters.ts";
import { HttpMetricsProvider } from "../src/providers/http.ts";
import { FakeClock } from "./fakes.ts";
import { DEFAULT_POLICY, START } from "./helpers.ts";
import { startSimulator } from "./sim.ts";

let sim: Awaited<ReturnType<typeof startSimulator>>;
let clock: FakeClock;
// Generoso por padrão: com 150 ms, uma máquina carregada estourava o timeout de verdade num teste que não é o do timeout, a sync
// repetia (+200 ms no relógio) e a asserção do horário falhava. Só o teste do timeout real usa um valor curto.
let providerTimeoutMs = 3000;
let call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

beforeAll(async () => {
  sim = await startSimulator();
});
afterAll(() => sim.close());
beforeEach(() => {
  providerTimeoutMs = 3000;
  sim.state.reset();
  sim.state.now = new Date(START);
  clock = new FakeClock(START);
  const app = createApp({
    db: openDatabase(":memory:"),
    providerFor: (connection) => new HttpMetricsProvider({ baseUrl: sim.baseUrl, network: connection.provider, timeoutMs: providerTimeoutMs, now: clock.now }),
    now: clock.now,
    sleep: clock.sleep,
    policy: DEFAULT_POLICY,
    maxPages: 50,
  });
  call = async (method, path, body) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
});

const posts = [
  { id: "p1", publishedAt: "2026-05-20T10:00:00.000Z", views: 1000, likes: 10, comments: 1, shares: 1 },
  { id: "p2", publishedAt: "2026-05-25T10:00:00.000Z", views: 2000, likes: 20, comments: 2, shares: 2 },
  { id: "p3", publishedAt: "2026-05-30T10:00:00.000Z", views: 4000, likes: 40, comments: 4, shares: 4 },
];

describe("jornada completa, pela API e pelo provedor simulado por HTTP", () => {
  it.each(PROVIDERS)("%s: duas janelas que se sobrepõem contam cada post uma vez", async (network) => {
    sim.state.setPosts(network, "acc_1", posts);
    const connection = await call("POST", "/connections", { provider: network, account_id: "acc_1", token: "tok" });
    const id = connection.body.id as string;

    const a = await call("POST", `/connections/${id}/sync`, { since: "2026-05-19T00:00:00.000Z", until: "2026-05-26T00:00:00.000Z" });
    const b = await call("POST", `/connections/${id}/sync`, { since: "2026-05-24T00:00:00.000Z", until: "2026-05-31T00:00:00.000Z" });
    expect(a.body).toMatchObject({ status: "succeeded", received: 2, new_snapshots: 2 });
    expect(b.body).toMatchObject({ status: "succeeded", received: 2, new_snapshots: 1, duplicates: 1 });

    const { body } = await call("GET", `/connections/${id}/metrics`);
    // o YouTube não tem compartilhamentos; as outras três redes têm
    const shares = network === "youtube" ? 0 : 7;
    expect(body.totals).toEqual({ posts: 3, views: 7000, likes: 70, comments: 7, shares });
    expect(body.last_fetched_at).toBe(START);
  });

  it("429 do provedor com Retry-After: o serviço espera esse prazo e conclui", async () => {
    sim.state.setPosts("instagram", "acc_1", posts);
    sim.state.behaviors = [{ status: 429, retryAfter: "2" }];
    const id = (await call("POST", "/connections", { provider: "instagram", account_id: "acc_1", token: "tok" })).body.id as string;
    const run = await call("POST", `/connections/${id}/sync`, { since: "2026-05-01T00:00:00.000Z", until: "2026-05-31T23:59:59.999Z" });
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 2, waits_ms: [2000] });
    expect(clock.waits).toEqual([2000]);
  });

  it("timeout real do provedor: tenta de novo e conclui", async () => {
    providerTimeoutMs = 150; // o provedor simulado demora 400 ms
    sim.state.setPosts("tiktok", "acc_1", posts);
    sim.state.behaviors = ["timeout"];
    sim.state.timeoutDelayMs = 400;
    const id = (await call("POST", "/connections", { provider: "tiktok", account_id: "acc_1", token: "tok" })).body.id as string;
    const run = await call("POST", `/connections/${id}/sync`, { since: "2026-05-01T00:00:00.000Z", until: "2026-05-31T23:59:59.999Z" });
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 2, waits_ms: [200] });
  });

  it("o provedor duplicando itens na resposta não duplica número", async () => {
    sim.state.setPosts("x", "acc_1", posts);
    sim.state.duplicateItems = true;
    const id = (await call("POST", "/connections", { provider: "x", account_id: "acc_1", token: "tok" })).body.id as string;
    const run = await call("POST", `/connections/${id}/sync`, { since: "2026-05-01T00:00:00.000Z", until: "2026-05-31T23:59:59.999Z" });
    expect(run.body).toMatchObject({ received: 6, new_snapshots: 3, duplicates: 3 });
    expect((await call("GET", `/connections/${id}/metrics`)).body.totals.views).toBe(7000);
  });

  it("token recusado pelo provedor (401) falha na hora, sem insistir", async () => {
    sim.state.setPosts("youtube", "acc_1", posts);
    sim.state.behaviors = [{ status: 401 }];
    const id = (await call("POST", "/connections", { provider: "youtube", account_id: "acc_1", token: "tok" })).body.id as string;
    const run = await call("POST", `/connections/${id}/sync`, { since: "2026-05-01T00:00:00.000Z", until: "2026-05-31T23:59:59.999Z" });
    expect(run.body).toMatchObject({ status: "failed", attempts: 1 });
  });
});

describe("Retry-After enorme pela fronteira HTTP real", () => {
  it("9007199254741 s: uma chamada só, adiada com o cooldown no limite, e a segunda sync não chama o provedor", async () => {
    sim.state.setPosts("instagram", "acc_1", posts);
    const connection = await call("POST", "/connections", { provider: "instagram", account_id: "acc_1", token: "tok" });
    const id = connection.body.id as string;
    sim.state.behaviors = [{ status: 429, retryAfter: "9007199254741" }];
    const first = await call("POST", `/connections/${id}/sync`, { since: "2026-01-01T00:00:00.000Z", until: "2026-12-31T23:59:59.999Z" });
    expect(first.body).toMatchObject({ status: "deferred", attempts: 1, retry_at: "9999-12-31T23:59:59.999Z" });
    expect(first.body.error).toContain("acima do máximo representável");
    const requestsAfterFirst = sim.state.requests.length;
    const second = await call("POST", `/connections/${id}/sync`, { since: "2026-01-01T00:00:00.000Z", until: "2026-12-31T23:59:59.999Z" });
    expect(second.body).toMatchObject({ status: "deferred", error: "cooldown_active" });
    expect(sim.state.requests).toHaveLength(requestsAfterFirst);
  });
});
