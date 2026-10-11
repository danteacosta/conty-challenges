import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { extendCooldown, getConnection } from "../src/store.ts";
import { tsWorker } from "./spawn-worker.ts";
import { limited, snap } from "./fakes.ts";
import { setup } from "./helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "metricas-cooldown-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const P1 = "2026-05-20T10:00:00.000Z";
const T1 = "2026-06-01T11:00:00.000Z";
const START = "2026-06-01T12:00:00.000Z";
const READY = "2026-06-01T12:02:00.000Z"; // START + 120 s

/** Conexão cuja primeira sync recebe um 429 com Retry-After de 120 s (o teto padrão é 30 s: a sync é adiada). */
async function deferred(options: Parameters<typeof setup>[0] = {}) {
  const t = setup(options);
  t.provider.posts = [snap("p1", P1, T1, 1000)];
  const id = await t.connect();
  t.provider.failNext(limited(120_000));
  const first = await t.sync(id);
  return { t, id, first };
}

describe("o prazo do Retry-After vale entre sincronizações", () => {
  it("depois de um 429 adiado, uma nova sync antes do prazo não chama o provedor e devolve o mesmo prazo", async () => {
    const { t, id, first } = await deferred();
    expect(first.body).toMatchObject({ status: "deferred", retry_at: READY });
    const callsBefore = t.provider.calls.length;

    t.clock.set("2026-06-01T12:00:30.000Z");
    const blocked = await t.sync(id);
    expect(blocked.status).toBe(202);
    expect(blocked.body).toMatchObject({ status: "deferred", error: "cooldown_active", retry_at: READY, attempts: 0, pages: 0, new_snapshots: 0 });
    expect(t.provider.calls).toHaveLength(callsBefore);
    expect(t.clock.waits).toEqual([]);
  });

  it("uma janela diferente também fica bloqueada: o limite é da conta, não da janela", async () => {
    const { t, id } = await deferred();
    const blocked = await t.sync(id, { since: "2026-05-01T00:00:00.000Z", until: "2026-05-31T00:00:00.000Z" });
    expect(blocked.body).toMatchObject({ status: "deferred", error: "cooldown_active" });
    expect(t.provider.calls).toHaveLength(1);
  });

  it("no instante do prazo a sync volta a rodar", async () => {
    const { t, id } = await deferred();
    t.clock.set(READY);
    const run = await t.sync(id);
    expect(run.body.status).toBe("succeeded");
    expect((await t.metrics(id)).body.totals.views).toBe(1000);
  });

  it("um instante antes do prazo ainda bloqueia", async () => {
    const { t, id } = await deferred();
    t.clock.set("2026-06-01T12:01:59.999Z");
    expect((await t.sync(id)).body).toMatchObject({ status: "deferred", error: "cooldown_active" });
  });

  it("a sync bloqueada fica no histórico, e o prazo aparece nas métricas da conexão", async () => {
    const { t, id } = await deferred();
    await t.sync(id);
    const runs = (await t.runs(id)).body;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ status: "deferred", error: "cooldown_active", attempts: 0, retry_at: READY });
    expect((await t.metrics(id)).body.cooldown_until).toBe(READY);
    t.clock.set(READY);
    expect((await t.metrics(id)).body.cooldown_until).toBeNull(); // já passou
  });

  it("um 429 que cabe no teto de espera (esperou e deu certo) não deixa cooldown nenhum", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1000)];
    const id = await t.connect();
    t.provider.failNext(limited(5_000));
    expect((await t.sync(id)).body.status).toBe("succeeded");
    expect((await t.metrics(id)).body.cooldown_until).toBeNull();
    expect((await t.sync(id)).body.status).toBe("succeeded");
  });

  it("outra conexão (outra conta) não é afetada", async () => {
    const { t, id } = await deferred();
    const other = await t.connect("tiktok", "acc_2");
    expect((await t.sync(other)).body.status).toBe("succeeded");
    expect((await t.sync(id)).body.error).toBe("cooldown_active");
  });

  it("depois que o prazo passa, uma falha comum (sem Retry-After) não deixa cooldown", async () => {
    const { t, id } = await deferred();
    t.clock.set(READY);
    t.provider.failNext(limited(null), limited(null), limited(null), limited(null));
    const run = await t.sync(id);
    expect(run.body.status).toBe("failed");
    expect((await t.metrics(id)).body.cooldown_until).toBeNull();
  });
});

describe("persiste: reinício e outra conexão ao banco", () => {
  it("depois de reiniciar (outra instância sobre o mesmo arquivo, relógio e provedor novos) o prazo continua valendo", async () => {
    const path = join(dir, "reinicio.db");
    const first = setup({ db: openDatabase(path) });
    first.provider.posts = [snap("p1", P1, T1, 1000)];
    const id = await first.connect();
    first.provider.failNext(limited(120_000));
    expect((await first.sync(id)).body.status).toBe("deferred");
    first.db.close();

    const second = setup({ db: openDatabase(path), start: "2026-06-01T12:00:10.000Z" });
    second.provider.posts = [snap("p1", P1, T1, 1000)];
    const blocked = await second.sync(id);
    expect(blocked.body).toMatchObject({ status: "deferred", error: "cooldown_active", retry_at: READY });
    expect(second.provider.calls).toHaveLength(0);
    second.clock.set(READY);
    expect((await second.sync(id)).body.status).toBe("succeeded");
  });

  it("outra instância do serviço sobre o mesmo banco, com a conexão cadastrada pela primeira, respeita o prazo", async () => {
    const path = join(dir, "duas-instancias.db");
    const a = setup({ db: openDatabase(path) });
    a.provider.posts = [snap("p1", P1, T1, 1000)];
    const id = await a.connect();
    const b = setup({ db: openDatabase(path) });
    a.provider.failNext(limited(120_000));
    await a.sync(id);
    expect((await b.sync(id)).body).toMatchObject({ status: "deferred", error: "cooldown_active" });
    expect(b.provider.calls).toHaveLength(0);
  });

  it("outra sync já em andamento cria o prazo no meio: esta para antes da próxima página, guardando o que já chegou", async () => {
    const t = setup();
    t.provider.posts = [snap("p1", P1, T1, 1), snap("p2", P1, T1, 2), snap("p3", P1, T1, 4)];
    t.provider.pageSize = 2;
    const id = await t.connect();
    const original = t.provider.fetchPosts.bind(t.provider);
    t.provider.fetchPosts = async (request) => {
      const result = await original(request);
      if (t.provider.calls.length === 1) extendCooldown(t.db, id, READY); // outra sync recebeu 429 enquanto esta lia a página 1
      return result;
    };
    const run = await t.sync(id);
    expect(run.body).toMatchObject({ status: "deferred", error: "cooldown_active", retry_at: READY, pages: 1, new_snapshots: 2 });
    expect((await t.metrics(id)).body.totals.views).toBe(3);
    expect(t.provider.calls).toHaveLength(1);
  });
});

describe("o prazo não regride", () => {
  it("um prazo mais curto depois de um mais longo não o encurta; um mais longo o estende", async () => {
    const t = setup();
    const id = await t.connect();
    extendCooldown(t.db, id, "2026-06-01T12:10:00.000Z");
    extendCooldown(t.db, id, "2026-06-01T12:05:00.000Z");
    expect(getConnection(t.db, id)!.cooldown_until).toBe("2026-06-01T12:10:00.000Z");
    extendCooldown(t.db, id, "2026-06-01T12:20:00.000Z");
    expect(getConnection(t.db, id)!.cooldown_until).toBe("2026-06-01T12:20:00.000Z");
  });

  it("4 conexões ao banco estendendo o prazo ao mesmo tempo, 12 vezes: sempre fica o maior", async () => {
    for (let round = 0; round < 12; round += 1) {
      const path = join(dir, `corrida-${round}.db`);
      const seed = setup({ db: openDatabase(path) });
      const id = await seed.connect();
      seed.db.close();

      const barrier = new SharedArrayBuffer(8);
      const flags = new Int32Array(barrier);
      const untils = ["2026-06-01T12:03:00.000Z", "2026-06-01T12:09:00.000Z", "2026-06-01T12:05:00.000Z", "2026-06-01T12:01:00.000Z"];
      const done = untils.map(
        (until) =>
          new Promise<void>((resolve, reject) => {
            const worker = tsWorker(new URL("./cooldown-worker.ts", import.meta.url), { path, connectionId: id, until, barrier });
            worker.once("message", () => resolve());
            worker.once("error", reject);
          }),
      );
      done.forEach((p) => p.catch(() => {}));
      while (Atomics.load(flags, 1) < untils.length) await new Promise((resolve) => setTimeout(resolve, 5));
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      await Promise.all(done);

      const check = openDatabase(path);
      expect(getConnection(check, id)!.cooldown_until, `rodada ${round}`).toBe("2026-06-01T12:09:00.000Z");
      check.close();
    }
  }, 60_000);
});
