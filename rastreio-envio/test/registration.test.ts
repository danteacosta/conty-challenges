import { describe, expect, it } from "vitest";
import { AggregatorError } from "../src/aggregator/port.ts";
import { InMemoryAggregator } from "./fakes.ts";
import { setup } from "./helpers.ts";

/** Agregador cuja `register` só termina quando o teste manda: permite várias requisições chegarem enquanto a primeira espera. */
class SlowAggregator extends InMemoryAggregator {
  calls = 0;
  private release: Array<() => void> = [];
  private rejectWith: Error | null = null;
  override async register(code: string, carrier: string) {
    this.calls += 1;
    await new Promise<void>((resolve) => this.release.push(resolve));
    if (this.rejectWith) throw this.rejectWith;
    await super.register(code, carrier);
  }
  finish(error: Error | null = null) {
    this.rejectWith = error;
    const pending = this.release;
    this.release = [];
    pending.forEach((resolve) => resolve());
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("recadastro com outro vínculo explícito é conflito, e não atualiza nada", () => {
  it.each([
    ["creator_id", { creator_id: "crt_bia" }],
    ["campaign_id", { campaign_id: "cmp_9" }],
  ])("mesmo código e transportadora com outro %s: 409, cadastro original preservado, e o agregador não é chamado", async (field, change) => {
    const t = setup();
    await t.register("BR1", "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" });
    const callsBefore = t.aggregator.registered.length;
    const res = await t.register("BR1", "via-rapida", change);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "link_conflict", conflicts: [{ field, stored: field === "creator_id" ? "crt_ana" : "cmp_1" }] });
    expect(t.aggregator.registered).toHaveLength(callsBefore);
    expect((await t.get("BR1")).body).toMatchObject({ creator_id: "crt_ana", campaign_id: "cmp_1" });
  });

  it("campo omitido não é atualização: recadastrar sem vínculo é 200 e preserva os vínculos", async () => {
    const t = setup();
    await t.register("BR1", "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" });
    const again = await t.register("BR1", "via-rapida");
    expect(again.status).toBe(200);
    expect(again.body.result).toBe("exists");
    expect((await t.get("BR1")).body).toMatchObject({ creator_id: "crt_ana", campaign_id: "cmp_1" });
  });

  it("os mesmos vínculos de novo são repetição (200), e informar só um deles igual ao guardado também", async () => {
    const t = setup();
    await t.register("BR1", "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" });
    expect((await t.register("BR1", "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" })).status).toBe(200);
    expect((await t.register("BR1", "via-rapida", { creator_id: "crt_ana" })).status).toBe(200);
  });

  it("vínculo informado onde o cadastro original não tinha nenhum também não é atualização silenciosa: 409", async () => {
    const t = setup();
    await t.register("BR1", "via-rapida");
    const res = await t.register("BR1", "via-rapida", { creator_id: "crt_ana" });
    expect(res.status).toBe(409);
    expect(res.body.conflicts).toEqual([{ field: "creator_id", stored: null, provided: "crt_ana" }]);
    expect((await t.get("BR1")).body.creator_id).toBeNull();
  });

  it("os dois campos divergentes aparecem juntos no conflito", async () => {
    const t = setup();
    await t.register("BR1", "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" });
    const res = await t.register("BR1", "via-rapida", { creator_id: "crt_bia", campaign_id: "cmp_2" });
    expect(res.body.conflicts.map((c: any) => c.field)).toEqual(["creator_id", "campaign_id"]);
  });

  it("transportadora diferente continua sendo carrier_conflict", async () => {
    const t = setup();
    await t.register("BR1", "via-rapida");
    const res = await t.register("BR1", "correio-norte");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("carrier_conflict");
  });

  it("dentro da transação: um conflito de vínculo que só aparece depois da chamada externa também é 409", async () => {
    const t = setup({ aggregator: new SlowAggregator() });
    const slow = t.aggregator as SlowAggregator;
    const first = t.register("BR1", "via-rapida", { creator_id: "crt_ana" });
    await tick();
    const second = t.register("BR1", "via-rapida", { creator_id: "crt_bia" });
    await tick();
    slow.finish();
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await t.get("BR1")).body.creator_id).toBe("crt_ana");
  });
});

describe("cadastros simultâneos iguais compartilham uma única chamada externa", () => {
  it("dez requisições iguais: uma chamada ao agregador, um criado e nove já existentes", async () => {
    const slow = new SlowAggregator();
    const t = setup({ aggregator: slow });
    const all = Array.from({ length: 10 }, () => t.register("BR1", "via-rapida", { creator_id: "crt_ana" }));
    await tick();
    expect(slow.calls).toBe(1);
    slow.finish();
    const results = await Promise.all(all);
    expect(slow.calls).toBe(1);
    expect(slow.registered).toHaveLength(1);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect((await t.get("BR1")).status).toBe(200);
  });

  it("códigos diferentes, ou a mesma letra em caixa diferente, são tratados como deve: diferentes não se juntam, iguais sim", async () => {
    const slow = new SlowAggregator();
    const t = setup({ aggregator: slow });
    const all = [t.register("BR1", "via-rapida"), t.register("br1", "via-rapida"), t.register("BR2", "via-rapida")];
    await tick();
    expect(slow.calls).toBe(2); // BR1 e br1 são o mesmo código normalizado
    slow.finish();
    await Promise.all(all);
    expect(slow.registered.map((r) => r.code).sort()).toEqual(["BR1", "BR2"]);
  });

  it("falha da chamada externa chega a todas as que esperavam, e a próxima requisição tenta de novo", async () => {
    const slow = new SlowAggregator();
    const t = setup({ aggregator: slow });
    const all = Array.from({ length: 4 }, () => t.register("BR1", "via-rapida"));
    await tick();
    slow.finish(new AggregatorError("timeout", "sem resposta"));
    const results = await Promise.all(all);
    expect(results.map((r) => r.status)).toEqual([502, 502, 502, 502]);
    expect(slow.calls).toBe(1);

    const retry = t.register("BR1", "via-rapida");
    await tick();
    expect(slow.calls).toBe(2); // a operação pendente foi limpa
    slow.finish();
    expect((await retry).status).toBe(201);
  });

  it("depois do sucesso a operação pendente é limpa: um cadastro novo do mesmo código vê o que já existe", async () => {
    const slow = new SlowAggregator();
    const t = setup({ aggregator: slow });
    const first = t.register("BR1", "via-rapida");
    await tick();
    slow.finish();
    await first;
    expect((await t.register("BR1", "via-rapida")).body.result).toBe("exists");
    expect(slow.calls).toBe(1);
  });
});
