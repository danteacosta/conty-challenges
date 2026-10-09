import { describe, expect, it } from "vitest";
import { ALL, setup } from "./helpers.ts";
import { client, limited, network, server, snap, timeout } from "./fakes.ts";

const T1 = "2026-06-01T12:00:00.000Z";
const P1 = "2026-05-20T10:00:00.000Z";
const P2 = "2026-05-25T10:00:00.000Z";
const P3 = "2026-05-30T10:00:00.000Z";

describe("a primeira sincronização", () => {
  it("guarda os posts, soma os totais e diz quando cada métrica foi buscada", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, "2026-06-01T11:55:00.000Z", 1000, { likes: 10 }), snap("p2", P2, "2026-06-01T11:55:00.000Z", 2000, { likes: 20 })];
    const id = await t.connect();

    const run = await t.sync(id);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 1, pages: 1, received: 2, new_snapshots: 2, duplicates: 0, stale: 0, invalid: 0, waits_ms: [] });

    const { body } = await t.metrics(id);
    expect(body.totals).toEqual({ posts: 2, views: 3000, likes: 30, comments: 0, shares: 0 });
    expect(body.connection).toEqual({ id, provider: "instagram", account_id: "acc_1" });
    expect(body.last_fetched_at).toBe(T1);
    // as_of é o horário da métrica no provedor; fetched_at é quando o NOSSO relógio buscou. São coisas diferentes.
    expect(body.posts.find((p: any) => p.post_id === "p1")).toMatchObject({ as_of: "2026-06-01T11:55:00.000Z", fetched_at: T1, snapshots: 1, metrics: { views: 1000, likes: 10 } });
  });

  it("o histórico de sincronizações diz o que cada uma fez e quando", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 10)];
    const id = await t.connect();
    await t.sync(id, { since: "2026-05-01T00:00:00.000Z", until: "2026-05-31T00:00:00.000Z" });
    const { body } = await t.runs(id);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      status: "succeeded",
      window: { since: "2026-05-01T00:00:00.000Z", until: "2026-05-31T00:00:00.000Z" },
      started_at: T1,
      finished_at: T1,
      new_snapshots: 1,
    });
  });

  it("o token fictício nunca volta em nenhuma resposta", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 10)];
    const created = await t.call("POST", "/connections", { provider: "x", account_id: "acc_x", token: "tok-super-secreto" });
    const id = created.body.id as string;
    const everything = JSON.stringify([created.body, (await t.sync(id)).body, (await t.metrics(id)).body, (await t.runs(id)).body]);
    expect(everything).not.toContain("tok-super-secreto");
    expect(created.body).toMatchObject({ provider: "x", account_id: "acc_x", has_token: true });
  });
});

describe("idempotência: o mesmo snapshot não duplica número", () => {
  it("sincronizar de novo a mesma janela, com o mesmo snapshot, não muda os totais", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1000), snap("p2", P2, T1, 2000)];
    const id = await t.connect();
    await t.sync(id);
    const again = await t.sync(id);
    expect(again.body).toMatchObject({ received: 2, new_snapshots: 0, duplicates: 2 });
    expect((await t.metrics(id)).body.totals.views).toBe(3000);
  });

  it("janelas que se sobrepõem não contam o mesmo post duas vezes", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1000), snap("p2", P2, T1, 2000), snap("p3", P3, T1, 4000)];
    const id = await t.connect();
    const a = await t.sync(id, { since: "2026-05-19T00:00:00.000Z", until: "2026-05-26T00:00:00.000Z" }); // p1, p2
    const b = await t.sync(id, { since: "2026-05-24T00:00:00.000Z", until: "2026-05-31T00:00:00.000Z" }); // p2, p3
    expect(a.body).toMatchObject({ received: 2, new_snapshots: 2, duplicates: 0 });
    expect(b.body).toMatchObject({ received: 2, new_snapshots: 1, duplicates: 1 });
    const { body } = await t.metrics(id);
    expect(body.totals).toMatchObject({ posts: 3, views: 7000 }); // p2 entra uma vez só
  });

  it("o mesmo post com contadores maiores num snapshot mais novo ATUALIZA o número, não soma", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1000), snap("p2", P2, T1, 2000)];
    const id = await t.connect();
    await t.sync(id);

    t.clock.set("2026-06-01T13:00:00.000Z");
    t.provider.posts = [snap("p1", P1, T1, 1000), snap("p2", P2, "2026-06-01T13:00:00.000Z", 2600)];
    const second = await t.sync(id);
    expect(second.body).toMatchObject({ new_snapshots: 1, duplicates: 1 });

    const { body } = await t.metrics(id);
    expect(body.totals.views).toBe(3600); // 1000 + 2600, e não 1000 + 2000 + 2600
    expect(body.posts.find((p: any) => p.post_id === "p2")).toMatchObject({ snapshots: 2, as_of: "2026-06-01T13:00:00.000Z", fetched_at: "2026-06-01T13:00:00.000Z" });
    // p1 foi buscado às 12:00 e p2 às 13:00: a métrica mais recentemente buscada é a de 13:00
    expect(body.posts.find((p: any) => p.post_id === "p1").fetched_at).toBe("2026-06-01T12:00:00.000Z");
    expect(body.last_fetched_at).toBe("2026-06-01T13:00:00.000Z");
  });

  it("last_fetched_at é a busca mais recente de qualquer post, mesmo quando esse post é o primeiro da lista", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1000), snap("p2", P2, T1, 2000)];
    const id = await t.connect();
    await t.sync(id);
    t.clock.set("2026-06-01T13:00:00.000Z");
    t.provider.posts = [snap("p1", P1, "2026-06-01T13:00:00.000Z", 1500), snap("p2", P2, T1, 2000)]; // só p1 mudou
    await t.sync(id);
    const { body } = await t.metrics(id);
    expect(body.posts.map((p: any) => [p.post_id, p.fetched_at])).toEqual([["p1", "2026-06-01T13:00:00.000Z"], ["p2", T1]]);
    expect(body.last_fetched_at).toBe("2026-06-01T13:00:00.000Z");
  });

  it("um snapshot mais antigo que o atual entra no histórico, mas não substitui o número", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, "2026-06-01T13:00:00.000Z", 5000)];
    const id = await t.connect();
    await t.sync(id);

    t.provider.posts = [snap("p1", P1, "2026-06-01T09:00:00.000Z", 900)]; // chegou atrasado
    const late = await t.sync(id);
    expect(late.body).toMatchObject({ new_snapshots: 1, stale: 1, duplicates: 0 });
    const { body } = await t.metrics(id);
    expect(body.totals.views).toBe(5000);
    expect(body.posts[0]).toMatchObject({ snapshots: 2, as_of: "2026-06-01T13:00:00.000Z" });
  });

  it("a resposta do provedor com o mesmo item duplicado dentro dela conta uma vez só", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1000), snap("p2", P2, T1, 2000)];
    t.provider.duplicateEachItem = true;
    const id = await t.connect();
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ received: 4, new_snapshots: 2, duplicates: 2 });
    expect((await t.metrics(id)).body.totals.views).toBe(3000);
  });

  it("segue a paginação até o fim e o duplicado que cruza páginas também conta uma vez", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1), snap("p2", P2, T1, 2), snap("p3", P3, T1, 4)];
    t.provider.pageSize = 2;
    const id = await t.connect();
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ pages: 2, received: 3, new_snapshots: 3 });
    expect(t.provider.calls.map((c) => c.cursor)).toEqual([null, "2"]);

    // pagina de novo o mesmo conteúdo: tudo é duplicado
    const again = await t.sync(id);
    expect(again.body).toMatchObject({ pages: 2, new_snapshots: 0, duplicates: 3 });
    expect((await t.metrics(id)).body.totals.views).toBe(7);
  });

  it("um cursor que se repete não vira laço infinito: a sync falha na hora, com o motivo", async () => {
    const t = setup(); // teto de páginas padrão (50): quem para o laço é a detecção do cursor repetido
    t.provider.posts = [snap("p1", P1, T1, 1), snap("p2", P2, T1, 2)];
    t.provider.pageSize = 1;
    t.provider.stuckCursor = true;
    const id = await t.connect();
    const run = await t.sync(id);
    expect(run.status).toBe(502);
    expect(run.body).toMatchObject({ status: "failed", error: "pagination_loop" });
    expect(t.provider.calls).toHaveLength(2); // a segunda página devolveu o mesmo cursor: parou aí
  });

  it("um provedor que nunca para de dar páginas novas esbarra no teto de páginas, e o que já chegou fica guardado", async () => {
    const t = setup({ maxPages: 3 });
    t.provider.posts = Array.from({ length: 10 }, (_, i) => snap(`p${i}`, `2026-05-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`, T1, 10));
    t.provider.pageSize = 1;
    const id = await t.connect();
    const run = await t.sync(id);
    expect(run.status).toBe(502);
    expect(run.body).toMatchObject({ status: "failed", error: "too_many_pages", pages: 3, new_snapshots: 3 });
    expect(t.provider.calls).toHaveLength(3); // nem uma página além do teto
    expect((await t.metrics(id)).body.totals.posts).toBe(3);
  });

  it("um erro que não é do provedor (um defeito nosso) não é repetido: a sync falha na hora, com o motivo", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1)];
    t.provider.failNext(new TypeError("campo indefinido"));
    const id = await t.connect();
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "failed", attempts: 1, waits_ms: [] });
    expect(run.body.error).toBe("unexpected: campo indefinido");
    expect(t.provider.calls).toHaveLength(1);
  });

  it("itens que o provedor mandou inválidos são contados e não entram nos totais", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1000)];
    t.provider.invalidPerPage = 2;
    const id = await t.connect();
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ received: 1, new_snapshots: 1, invalid: 2 });
    expect((await t.metrics(id)).body.totals.views).toBe(1000);
  });
});

describe("falha transitória: retry com limite", () => {
  async function withOnePost(options?: Parameters<typeof setup>[0]) {
    const t = setup(options);
    t.provider.posts = [snap("p1", P1, T1, 1000)];
    return { t, id: await t.connect() };
  }

  it("timeout seguido de sucesso: tenta de novo depois de 200 ms", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(timeout());
    const run = await t.sync(id);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 2, waits_ms: [200], started_at: T1, finished_at: "2026-06-01T12:00:00.200Z" });
    expect(t.clock.waits).toEqual([200]);
  });

  it("3 erros 5xx e depois sucesso: espera 200, 400 e 800 ms (exponencial)", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(server(), server(503), server());
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 4, waits_ms: [200, 400, 800] });
    expect((await t.metrics(id)).body.totals.views).toBe(1000);
  });

  it("falha persistente: para no teto de tentativas, sem laço infinito", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(...Array.from({ length: 50 }, () => server()));
    const run = await t.sync(id);
    expect(run.status).toBe(502);
    expect(run.body).toMatchObject({ status: "failed", attempts: 4, waits_ms: [200, 400, 800], new_snapshots: 0 });
    expect(run.body.error).toMatch(/server/);
    expect(t.provider.calls).toHaveLength(4);
  });

  it("erro de rede também tem o mesmo limite", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(...Array.from({ length: 50 }, () => network()));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "failed", attempts: 4 });
    expect(run.body.error).toMatch(/network/);
  });

  it("o teto de tentativas é configurável", async () => {
    const { t, id } = await withOnePost({ policy: { maxAttempts: 2 } });
    t.provider.failNext(...Array.from({ length: 50 }, () => timeout()));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "failed", attempts: 2, waits_ms: [200] });
  });

  it("erro do cliente (token recusado) não adianta repetir: falha na primeira tentativa", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(client(401));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "failed", attempts: 1, waits_ms: [] });
    expect(run.body.error).toMatch(/401/);
    expect(t.provider.calls).toHaveLength(1);
  });

  it("o retry é da página que falhou: a anterior não é buscada de novo e nada duplica", async () => {
    const { t, id } = await withOnePost();
    t.provider.posts = [snap("p1", P1, T1, 1), snap("p2", P2, T1, 2), snap("p3", P3, T1, 4)];
    t.provider.pageSize = 2;
    t.provider.failOnCall(2, timeout()); // a segunda chamada (página 2) falha uma vez
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "succeeded", pages: 2, attempts: 3, new_snapshots: 3 });
    expect(t.provider.calls.map((c) => c.cursor)).toEqual([null, "2", "2"]);
    expect((await t.metrics(id)).body.totals.views).toBe(7);
  });

  it("falha na segunda página guarda a primeira, e uma nova sync completa sem duplicar", async () => {
    const { t, id } = await withOnePost({ policy: { maxAttempts: 1 } });
    t.provider.posts = [snap("p1", P1, T1, 1), snap("p2", P2, T1, 2), snap("p3", P3, T1, 4)];
    t.provider.pageSize = 2;
    t.provider.failOnCall(2, server());
    const failed = await t.sync(id);
    expect(failed.body).toMatchObject({ status: "failed", pages: 1, new_snapshots: 2 });
    expect((await t.metrics(id)).body.totals.views).toBe(3);

    const retried = await t.sync(id);
    expect(retried.body).toMatchObject({ status: "succeeded", new_snapshots: 1, duplicates: 2 });
    expect((await t.metrics(id)).body.totals.views).toBe(7);
  });
});

describe("429 com Retry-After", () => {
  async function withOnePost(options?: Parameters<typeof setup>[0]) {
    const t = setup(options);
    t.provider.posts = [snap("p1", P1, T1, 1000)];
    return { t, id: await t.connect() };
  }

  it("espera exatamente o Retry-After que o provedor mandou e tenta de novo", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(limited(7000));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 2, waits_ms: [7000], finished_at: "2026-06-01T12:00:07.000Z" });
    expect(t.clock.waits).toEqual([7000]);
    // a segunda chamada aconteceu 7 s depois da primeira, nem antes
    expect(t.provider.calls[1]!.at.getTime() - t.provider.calls[0]!.at.getTime()).toBe(7000);
  });

  it("Retry-After 0 tenta de novo na hora", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(limited(0));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 2, waits_ms: [0] });
  });

  it("a espera não passa do teto: no teto exato espera, acima dele adia sem esperar", async () => {
    const exactly = await withOnePost({ policy: { maxRetryAfterMs: 10_000 } });
    exactly.t.provider.failNext(limited(10_000));
    expect((await exactly.t.sync(exactly.id)).body).toMatchObject({ status: "succeeded", waits_ms: [10_000] });

    const above = await withOnePost({ policy: { maxRetryAfterMs: 10_000 } });
    above.t.provider.failNext(limited(10_001));
    const run = await above.t.sync(above.id);
    expect(run.status).toBe(202);
    expect(run.body).toMatchObject({ status: "deferred", attempts: 1, waits_ms: [], retry_at: "2026-06-01T12:00:10.001Z" });
    expect(above.t.clock.waits).toEqual([]); // nenhuma espera
    expect(above.t.provider.calls).toHaveLength(1); // e nenhuma tentativa antes da hora
  });

  it("Retry-After de 2 minutos, com teto de 30 s, adia para daqui a 2 minutos sem tentar antes", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(limited(120_000));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "deferred", retry_at: "2026-06-01T12:02:00.000Z" });
    expect((await t.runs(id)).body[0]).toMatchObject({ status: "deferred", retry_at: "2026-06-01T12:02:00.000Z" });
    expect((await t.metrics(id)).body.totals.views).toBe(0);

    t.clock.set("2026-06-01T12:02:00.000Z"); // chegou a hora
    const later = await t.sync(id);
    expect(later.body.status).toBe("succeeded");
    expect((await t.metrics(id)).body.totals.views).toBe(1000);
  });

  it("429 repetidos gastam as tentativas e terminam adiados, não em laço", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(...Array.from({ length: 50 }, () => limited(2000)));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "deferred", attempts: 4, waits_ms: [2000, 2000, 2000], retry_at: "2026-06-01T12:00:08.000Z" });
    expect(t.provider.calls).toHaveLength(4);
  });

  it("429 seguido de timeout: cada falha tem a sua espera (Retry-After, depois backoff da 2ª tentativa)", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(limited(3000), timeout());
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 3, waits_ms: [3000, 400] });
  });

  it("429 sem Retry-After usa o backoff", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(limited(null), limited(null));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "succeeded", attempts: 3, waits_ms: [200, 400] });
  });

  it("429 sem Retry-After para sempre falha no teto de tentativas", async () => {
    const { t, id } = await withOnePost();
    t.provider.failNext(...Array.from({ length: 50 }, () => limited(null)));
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "failed", attempts: 4 });
  });
});

describe("entrada", () => {
  it("cadastra a conexão só com rede conhecida, conta e token", async () => {
    const t = setup();
    expect((await t.call("POST", "/connections", { provider: "orkut", account_id: "a", token: "t" })).status).toBe(400);
    expect((await t.call("POST", "/connections", { provider: "x", account_id: "", token: "t" })).status).toBe(400);
    expect((await t.call("POST", "/connections", { provider: "x", account_id: "a" })).status).toBe(400);
    expect((await t.call("POST", "/connections", { provider: "x", account_id: "a", token: "t" })).status).toBe(201);
    const duplicate = await t.call("POST", "/connections", { provider: "x", account_id: "a", token: "t2" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("duplicate_connection");
  });

  it.each([
    ["sem janela", {}],
    ["since depois de until", { since: "2026-06-02T00:00:00.000Z", until: "2026-06-01T00:00:00.000Z" }],
    ["data impossível", { since: "2026-02-30T00:00:00Z", until: "2026-03-01T00:00:00Z" }],
    ["data sem fuso", { since: "2026-06-01T00:00:00", until: "2026-06-02T00:00:00" }],
  ])("sync %s é 400 e não chama o provedor", async (_name, body) => {
    const t = setup();
    const id = await t.connect();
    expect((await t.call("POST", `/connections/${id}/sync`, body)).status).toBe(400);
    expect(t.provider.calls).toHaveLength(0);
    expect((await t.runs(id)).body).toEqual([]);
  });

  it("janela com since igual a until é válida", async () => {
    const t = setup();
    const id = await t.connect();
    expect((await t.sync(id, { since: "2026-06-01T00:00:00.000Z", until: "2026-06-01T00:00:00.000Z" })).status).toBe(200);
  });

  it("conexão inexistente é 404 em todas as rotas", async () => {
    const t = setup();
    expect((await t.sync("nada", ALL)).status).toBe(404);
    expect((await t.metrics("nada")).status).toBe(404);
    expect((await t.runs("nada")).status).toBe(404);
  });
});
