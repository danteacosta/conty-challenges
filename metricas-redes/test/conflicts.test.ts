import { describe, expect, it } from "vitest";
import { server, snap } from "./fakes.ts";
import { setup } from "./helpers.ts";

const P1 = "2026-05-20T10:00:00.000Z";
const P2 = "2026-05-25T10:00:00.000Z";
const AS_OF = "2026-06-01T11:00:00.000Z";
const T1 = "2026-06-01T12:00:00.000Z";

describe("o mesmo post e o mesmo as_of com contadores diferentes é conflito, não repetição", () => {
  it("100 e depois 999: o canônico fica, os totais não mudam, e o conflito aparece separado de duplicates", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100, { likes: 5 })];
    const id = await t.connect();
    await t.sync(id);
    t.provider.posts = [snap("p1", P1, AS_OF, 999, { likes: 5 })];
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "succeeded", new_snapshots: 0, duplicates: 0, conflicts: 1, stale: 0 });
    const { body } = await t.metrics(id);
    expect(body.totals).toMatchObject({ posts: 1, views: 100, likes: 5 });
    expect(body.posts[0]).toMatchObject({ snapshots: 1, metrics: { views: 100 } });
    expect(body.conflicts).toEqual([
      {
        post_id: "p1",
        as_of: AS_OF,
        canonical: { views: 100, likes: 5, comments: 0, shares: 0 },
        observed: { views: 999, likes: 5, comments: 0, shares: 0 },
        occurrences: 1,
        first_seen_at: T1,
        last_seen_at: T1,
      },
    ]);
  });

  it("repetir o mesmo conflito conta a ocorrência mas não cria registros novos", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    await t.sync(id);
    t.provider.posts = [snap("p1", P1, AS_OF, 999)];
    for (let i = 0; i < 5; i += 1) await t.sync(id);
    const { conflicts } = (await t.metrics(id)).body;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ occurrences: 5 });
  });

  it("um valor contraditório diferente é outro registro", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    await t.sync(id);
    for (const views of [999, 777]) {
      t.provider.posts = [snap("p1", P1, AS_OF, views)];
      await t.sync(id);
    }
    expect((await t.metrics(id)).body.conflicts.map((c: any) => c.observed.views).sort()).toEqual([777, 999]);
  });

  it.each([["likes", { likes: 9 }], ["comments", { comments: 9 }], ["shares", { shares: 9 }]])("só %s diferente também é conflito", async (_name, change) => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    await t.sync(id);
    t.provider.posts = [snap("p1", P1, AS_OF, 100, change)];
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ conflicts: 1, duplicates: 0 });
    expect((await t.metrics(id)).body.totals).toMatchObject({ likes: 0, comments: 0, shares: 0 });
  });

  it("a repetição idêntica continua duplicate e não gera conflito", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    await t.sync(id);
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ duplicates: 1, conflicts: 0 });
    expect((await t.metrics(id)).body.conflicts).toEqual([]);
  });

  it("um conflito não interrompe o lote: os outros posts da mesma página entram", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    await t.sync(id);
    t.provider.posts = [snap("p1", P1, AS_OF, 999), snap("p2", P2, AS_OF, 50)];
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "succeeded", new_snapshots: 1, conflicts: 1 });
    expect((await t.metrics(id)).body.totals).toMatchObject({ posts: 2, views: 150 });
  });

  it("o mesmo conflito dentro da mesma resposta conta cada ocorrência uma vez", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    await t.sync(id);
    t.provider.posts = [snap("p1", P1, AS_OF, 999)];
    t.provider.duplicateEachItem = true; // a resposta traz o item contraditório duas vezes
    const run = await t.sync(id);
    expect(run.body.conflicts).toBe(2);
    expect((await t.metrics(id)).body.conflicts).toMatchObject([{ occurrences: 2 }]);
  });
});

describe("last_checked_at: quando o post foi consultado com sucesso pela última vez", () => {
  it("existe ao lado de fetched_at e as_of, que mantêm o significado", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    await t.sync(id);
    const { body } = await t.metrics(id);
    expect(body.posts[0]).toMatchObject({ as_of: AS_OF, fetched_at: T1, last_checked_at: T1 });
    expect(body.last_checked_at).toBe(T1);
  });

  it("o last_checked_at geral é o do post consultado mais recentemente", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100), snap("p2", P2, AS_OF, 50)];
    const id = await t.connect();
    await t.sync(id);
    t.clock.set("2026-06-02T09:00:00.000Z");
    t.provider.posts = [snap("p2", P2, AS_OF, 50)];
    await t.sync(id);
    const { body } = await t.metrics(id);
    expect(body.posts.map((p: any) => p.last_checked_at)).toEqual([T1, "2026-06-02T09:00:00.000Z"]);
    expect(body.last_checked_at).toBe("2026-06-02T09:00:00.000Z");
    expect(body.last_fetched_at).toBe(T1);
  });

  it("receber o mesmo snapshot de novo confirma a consulta: last_checked_at avança, fetched_at e as_of não", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    await t.sync(id);
    t.clock.set("2026-06-02T09:00:00.000Z");
    await t.sync(id);
    expect((await t.metrics(id)).body.posts[0]).toMatchObject({ as_of: AS_OF, fetched_at: T1, last_checked_at: "2026-06-02T09:00:00.000Z" });
  });

  it("falha da sync e post ausente da resposta não avançam o campo", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100), snap("p2", P2, AS_OF, 50)];
    const id = await t.connect();
    await t.sync(id);
    t.clock.set("2026-06-02T09:00:00.000Z");
    t.provider.failNext(server(), server(), server(), server());
    expect((await t.sync(id)).body.status).toBe("failed");
    expect((await t.metrics(id)).body.posts.map((p: any) => p.last_checked_at)).toEqual([T1, T1]);

    t.provider.posts = [snap("p1", P1, AS_OF, 100)]; // o p2 sumiu da resposta
    t.clock.set("2026-06-02T09:00:00.000Z");
    await t.sync(id);
    const posts = (await t.metrics(id)).body.posts;
    expect(posts.find((p: any) => p.post_id === "p1").last_checked_at).toBe("2026-06-02T09:00:00.000Z");
    expect(posts.find((p: any) => p.post_id === "p2").last_checked_at).toBe(T1);
  });

  it("uma resposta mais antiga que chega depois não faz o campo regredir", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, AS_OF, 100)];
    const id = await t.connect();
    t.clock.set("2026-06-03T00:00:00.000Z");
    await t.sync(id);
    t.clock.set("2026-06-02T00:00:00.000Z"); // o relógio desta sync é anterior (resposta fora de ordem)
    await t.sync(id);
    expect((await t.metrics(id)).body.posts[0].last_checked_at).toBe("2026-06-03T00:00:00.000Z");
  });

  it("um snapshot mais antigo que o atual (stale) também confirma a consulta do post, sem mudar o número atual", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, "2026-06-01T11:00:00.000Z", 200)];
    const id = await t.connect();
    await t.sync(id);
    t.clock.set("2026-06-02T09:00:00.000Z");
    t.provider.posts = [snap("p1", P1, "2026-06-01T10:00:00.000Z", 150)];
    await t.sync(id);
    expect((await t.metrics(id)).body.posts[0]).toMatchObject({ metrics: { views: 200 }, last_checked_at: "2026-06-02T09:00:00.000Z" });
  });
});
