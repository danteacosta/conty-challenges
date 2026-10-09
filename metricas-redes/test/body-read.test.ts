import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { HttpMetricsProvider } from "../src/providers/http.ts";
import type { ProviderError } from "../src/providers/port.ts";
import { DEFAULT_POLICY, ALL, START } from "./helpers.ts";
import { FakeClock } from "./fakes.ts";

const WINDOW = { account: "acc_1", token: "tok-1", since: ALL.since, until: ALL.until, cursor: null };

/** Resposta 200 cujos cabeçalhos chegam e cujo corpo é interrompido no meio por `error`. */
const brokenBody = (error: unknown) => new Response(new ReadableStream({ start: (controller) => controller.error(error) }), { status: 200, headers: { "content-type": "application/json" } });
const okBody = () => new Response('{"data":[],"next_cursor":null}', { status: 200, headers: { "content-type": "application/json" } });

const providerWith = (responses: Array<() => Response>) => {
  const queue = [...responses];
  return new HttpMetricsProvider({ baseUrl: "http://provedor.invalido", network: "x", fetch: (async () => queue.shift()!()) as typeof fetch });
};
const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e: ProviderError) => e)) as ProviderError;

describe("falha ao ler o corpo é falha de transporte, não JSON inválido", () => {
  it("corpo interrompido por TimeoutError ou AbortError é timeout", async () => {
    expect(await errorOf(providerWith([() => brokenBody(new DOMException("tempo esgotado", "TimeoutError"))]).fetchPosts(WINDOW))).toMatchObject({ kind: "timeout" });
    expect(await errorOf(providerWith([() => brokenBody(new DOMException("abortado", "AbortError"))]).fetchPosts(WINDOW))).toMatchObject({ kind: "timeout" });
  });

  it("corpo interrompido por erro de conexão é network", async () => {
    expect(await errorOf(providerWith([() => brokenBody(new TypeError("terminated"))]).fetchPosts(WINDOW))).toMatchObject({ kind: "network" });
  });

  it("JSON sintaticamente inválido continua sendo payload inválido, e a mensagem diz que o corpo chegou", async () => {
    const error = await errorOf(providerWith([() => new Response("{nope", { status: 200 })]).fetchPosts(WINDOW));
    expect(error).toMatchObject({ kind: "invalid_payload" });
  });

  it("corpo vazio é payload inválido, não timeout", async () => {
    expect(await errorOf(providerWith([() => new Response("", { status: 200 })]).fetchPosts(WINDOW))).toMatchObject({ kind: "invalid_payload" });
  });
});

describe("a sincronização repete a página quando o corpo da primeira resposta se perde", () => {
  function appWith(provider: HttpMetricsProvider) {
    const clock = new FakeClock(START);
    const app = createApp({ db: openDatabase(":memory:"), providerFor: () => provider, now: clock.now, sleep: clock.sleep, policy: DEFAULT_POLICY, maxPages: 50 });
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as any };
    };
    return { call, clock };
  }

  it("200 com corpo interrompido e depois uma resposta boa: tenta de novo e termina succeeded", async () => {
    const { call, clock } = appWith(providerWith([() => brokenBody(new DOMException("tempo esgotado", "TimeoutError")), okBody]));
    const id = (await call("POST", "/connections", { provider: "x", account_id: "acc_1", token: "t" })).body.id as string;
    const run = await call("POST", `/connections/${id}/sync`, ALL);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 2, waits_ms: [200] });
    expect(clock.waits).toEqual([200]);
  });

  it("JSON inválido continua terminal: uma tentativa só", async () => {
    const { call } = appWith(providerWith([() => new Response("{nope", { status: 200 }), okBody]));
    const id = (await call("POST", "/connections", { provider: "x", account_id: "acc_1", token: "t" })).body.id as string;
    const run = await call("POST", `/connections/${id}/sync`, ALL);
    expect(run.body).toMatchObject({ status: "failed", attempts: 1 });
  });
});
