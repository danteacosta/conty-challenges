import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HttpMetricsProvider } from "../src/providers/http.ts";
import type { ProviderError } from "../src/providers/port.ts";
import { PROVIDERS } from "../src/providers/adapters.ts";
import { startSimulator } from "./sim.ts";

let sim: Awaited<ReturnType<typeof startSimulator>>;
const NOW = new Date("2026-06-01T12:00:00.000Z");
const WINDOW = { account: "acc_1", token: "tok-1", since: "2026-05-01T00:00:00.000Z", until: "2026-05-31T23:59:59.999Z", cursor: null };

beforeAll(async () => {
  sim = await startSimulator();
});
afterAll(() => sim.close());
beforeEach(() => {
  sim.state.reset();
  sim.state.now = NOW;
});

const provider = (network: (typeof PROVIDERS)[number], extra: { timeoutMs?: number } = {}) =>
  new HttpMetricsProvider({ baseUrl: sim.baseUrl, network, timeoutMs: extra.timeoutMs ?? 500, now: () => NOW });

const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e: ProviderError) => e)) as ProviderError;

describe("cliente HTTP do provedor", () => {
  it.each(PROVIDERS)("%s: busca por janela e entrega os posts no formato único", async (network) => {
    sim.state.setPosts(network, "acc_1", [
      { id: "a", publishedAt: "2026-05-10T10:00:00.000Z", views: 100, likes: 5, comments: 2, shares: 1 },
      { id: "b", publishedAt: "2026-04-10T10:00:00.000Z", views: 999 }, // fora da janela
    ]);
    const result = await provider(network).fetchPosts(WINDOW);
    expect(result.nextCursor).toBeNull();
    expect(result.invalid).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ postId: "a", publishedAt: "2026-05-10T10:00:00.000Z", asOf: NOW.toISOString(), views: 100 });
  });

  it("manda o token no cabeçalho e a janela, a conta e o cursor na URL", async () => {
    await provider("instagram").fetchPosts({ ...WINDOW, account: "conta com espaço", cursor: "3" });
    expect(sim.state.requests[0]).toMatchObject({
      network: "instagram",
      account: "conta com espaço",
      authorization: "Bearer tok-1",
      since: WINDOW.since,
      until: WINDOW.until,
      cursor: "3",
    });
  });

  it("pagina com cursor", async () => {
    sim.state.pageSize = 2;
    sim.state.setPosts("x", "acc_1", ["a", "b", "c"].map((id, i) => ({ id, publishedAt: `2026-05-1${i}T10:00:00.000Z`, views: i + 1 })));
    const first = await provider("x").fetchPosts(WINDOW);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe("2");
    const second = await provider("x").fetchPosts({ ...WINDOW, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it("itens inválidos são contados em vez de virarem número", async () => {
    sim.state.setPosts("instagram", "acc_1", [{ id: "a", publishedAt: "2026-05-10T10:00:00.000Z", views: 100 }]);
    sim.state.corruptItems = 2;
    const result = await provider("instagram").fetchPosts(WINDOW);
    expect(result.items).toHaveLength(1);
    expect(result.invalid).toBe(2);
  });

  describe("429", () => {
    it("Retry-After em segundos vira milissegundos", async () => {
      sim.state.behaviors = [{ status: 429, retryAfter: "7" }];
      const error = await errorOf(provider("x").fetchPosts(WINDOW));
      expect(error).toMatchObject({ kind: "rate_limited", status: 429, retryAfterMs: 7000 });
    });

    it("Retry-After em data HTTP vira a diferença para agora", async () => {
      sim.state.behaviors = [{ status: 429, retryAfter: "Mon, 01 Jun 2026 12:00:10 GMT" }];
      const error = await errorOf(provider("x").fetchPosts(WINDOW));
      expect(error).toMatchObject({ kind: "rate_limited", retryAfterMs: 10_000 });
    });

    it("sem Retry-After, ou com ele inválido, é null", async () => {
      sim.state.behaviors = [{ status: 429 }, { status: 429, retryAfter: "daqui a pouco" }];
      expect(await errorOf(provider("x").fetchPosts(WINDOW))).toMatchObject({ kind: "rate_limited", retryAfterMs: null });
      expect(await errorOf(provider("x").fetchPosts(WINDOW))).toMatchObject({ kind: "rate_limited", retryAfterMs: null });
    });
  });

  it.each([
    [500, "server"],
    [502, "server"],
    [503, "server"],
    [408, "timeout"],
    [400, "client"],
    [401, "client"],
    [403, "client"],
    [404, "client"],
  ])("resposta %i é falha do tipo %s", async (status, kind) => {
    sim.state.behaviors = [{ status }];
    expect(await errorOf(provider("x").fetchPosts(WINDOW))).toMatchObject({ kind, status });
  });

  it("provedor que não responde a tempo é timeout", async () => {
    sim.state.behaviors = ["timeout"];
    sim.state.timeoutDelayMs = 600;
    expect(await errorOf(provider("x", { timeoutMs: 100 }).fetchPosts(WINDOW))).toMatchObject({ kind: "timeout" });
  });

  it("a URL base com barras no fim funciona do mesmo jeito (sem //v1)", async () => {
    sim.state.setPosts("x", "acc_1", [{ id: "a", publishedAt: "2026-05-10T10:00:00.000Z", views: 1 }]);
    for (const suffix of ["/", "///"]) {
      const withSlashes = new HttpMetricsProvider({ baseUrl: sim.baseUrl + suffix, network: "x", timeoutMs: 500, now: () => NOW });
      expect((await withSlashes.fetchPosts(WINDOW)).items).toHaveLength(1);
    }
  });

  it.each([
    ["TimeoutError", "TimeoutError"],
    ["AbortError", "AbortError"],
  ])("fetch que falha com %s é timeout; qualquer outro erro é rede", async (_label, name) => {
    const failing = (error: Error) => new HttpMetricsProvider({ baseUrl: sim.baseUrl, network: "x", fetch: (async () => { throw error; }) as typeof fetch });
    expect(await errorOf(failing(new DOMException("tempo", name)).fetchPosts(WINDOW))).toMatchObject({ kind: "timeout" });
    expect(await errorOf(failing(new TypeError("fetch failed")).fetchPosts(WINDOW))).toMatchObject({ kind: "network" });
  });

  it("resposta sem next_cursor é a última página", async () => {
    sim.state.behaviors = [{ status: 200, body: '{"data":[]}' }];
    expect(await provider("x").fetchPosts(WINDOW)).toEqual({ items: [], invalid: 0, nextCursor: null });
  });

  it("sem relógio injetado, o Retry-After em data HTTP usa o relógio real", async () => {
    sim.state.behaviors = [{ status: 429, retryAfter: new Date(Date.now() + 10_000).toUTCString() }];
    const realClock = new HttpMetricsProvider({ baseUrl: sim.baseUrl, network: "x", timeoutMs: 500 });
    const error = await errorOf(realClock.fetchPosts(WINDOW));
    expect(error.retryAfterMs).toBeGreaterThan(7_000);
    expect(error.retryAfterMs).toBeLessThanOrEqual(10_000);
  });

  it("provedor fora do ar é erro de rede", async () => {
    const down = new HttpMetricsProvider({ baseUrl: "http://127.0.0.1:1", network: "x", timeoutMs: 300 });
    expect(await errorOf(down.fetchPosts(WINDOW))).toMatchObject({ kind: "network" });
  });

  it.each([
    ["JSON malformado", "{nope"],
    ["corpo sem a lista data", '{"outro":1}'],
    ["data que não é lista", '{"data":"texto"}'],
    ["corpo nulo", "null"],
  ])("%s é payload inválido", async (_name, body) => {
    sim.state.behaviors = [{ status: 200, body }];
    expect(await errorOf(provider("x").fetchPosts(WINDOW))).toMatchObject({ kind: "invalid_payload" });
  });

  it("next_cursor que não é texto é payload inválido", async () => {
    sim.state.behaviors = [{ status: 200, body: '{"data":[],"next_cursor":42}' }];
    expect(await errorOf(provider("x").fetchPosts(WINDOW))).toMatchObject({ kind: "invalid_payload" });
  });
});
