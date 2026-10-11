import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("fluxo inteiro, sem adivinhar o estado", () => {
  it("cria, pede alteração, recebe a versão nova e aprova, seguindo allowed_actions", async () => {
    const t = setup("2026-03-10T15:00:00.000Z");
    const created = await t.create("msn_1", "Primeira versão do roteiro");
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ mission_id: "msn_1", state: "awaiting_review", current_version: 1 });
    expect(created.body.allowed_actions.sort()).toEqual(["approve", "request_changes"]);
    const id = created.body.id as string;

    const requested = await t.requestChanges(id, { reason: "Abrir com o produto na mão", deadline_date: "2026-03-14" });
    expect(requested.status).toBe(201);
    expect(requested.body).toMatchObject({ state: "changes_requested", allowed_actions: ["submit_version", "cancel_changes"] });
    expect(requested.body.change_requests).toMatchObject([
      { version_number: 1, reason: "Abrir com o produto na mão", deadline_date: "2026-03-14", answered_by_version: null },
    ]);

    t.set("2026-03-11T12:00:00.000Z");
    const second = await t.submit(id, "Segunda versão");
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ state: "awaiting_review", current_version: 2 });
    expect(second.body.change_requests[0].answered_by_version).toBe(2);

    t.set("2026-03-12T12:00:00.000Z");
    const approved = await t.approve(id);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ state: "approved", allowed_actions: [], approved: { version: 2, approved_at: "2026-03-12T12:00:00.000Z" } });
  });

  it("GET devolve o estado atual, as ações possíveis e o histórico inteiro", async () => {
    const t = setup();
    const { body } = await t.create("msn_1", "v1");
    await t.requestChanges(body.id, { reason: "Mais curto", deadline_date: "2026-03-20" });
    await t.submit(body.id, "v2");
    const seen = (await t.get(body.id)).body;
    expect(seen.versions.map((v: any) => [v.number, v.content, v.late])).toEqual([[1, "v1", false], [2, "v2", false]]);
    expect(seen.state).toBe("awaiting_review");
    expect(seen.approved).toBeNull();
  });

  it("roteiro inexistente é 404 em todas as rotas", async () => {
    const t = setup();
    expect((await t.get("nada")).status).toBe(404);
    expect((await t.approve("nada")).status).toBe(404);
    expect((await t.submit("nada")).status).toBe(404);
    expect((await t.requestChanges("nada", { reason: "x", deadline_date: "2026-03-20" })).status).toBe(404);
  });

  it("a missão tem um roteiro só", async () => {
    const t = setup();
    expect((await t.create("msn_1")).status).toBe(201);
    const again = await t.create("msn_1", "outro");
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("mission_already_has_script");
  });

  it("cria com entrada inválida é 400", async () => {
    const t = setup();
    expect((await t.call("POST", "/scripts", { content: "x" })).status).toBe(400);
    expect((await t.call("POST", "/scripts", { mission_id: "msn_1", content: "   " })).status).toBe(400);
    expect((await t.call("POST", "/scripts", { mission_id: "msn_1" })).status).toBe(400);
    const bad = await t.app.request("/scripts", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(bad.status).toBe(400);
  });
});

describe("entrada malformada nas outras rotas", () => {
  it("corpo que não é JSON é 400 em todas as rotas que recebem corpo, sem derrubar o servidor", async () => {
    const t = setup();
    const { body } = await t.create();
    for (const path of [`/scripts/${body.id}/change-requests`, `/scripts/${body.id}/versions`]) {
      for (const raw of ["{nope", "null", "42", '"texto"']) {
        const res = await t.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
        expect(res.status, `${path} ${raw}`).toBe(400);
      }
    }
  });

  it("os erros de validação dizem qual campo está errado", async () => {
    const t = setup();
    const { body } = await t.create();
    expect((await t.requestChanges(body.id, { deadline_date: "2026-03-20" })).body).toMatchObject({ error: "validation_error", field: "reason" });
    expect((await t.requestChanges(body.id, { reason: "x" })).body).toMatchObject({ error: "validation_error", field: "deadline_date" });
    expect((await t.call("POST", "/scripts", { content: "x" })).body).toMatchObject({ error: "validation_error", field: "mission_id" });
    expect((await t.call("POST", "/scripts", { mission_id: "m" })).body).toMatchObject({ error: "validation_error", field: "content" });
    await t.requestChanges(body.id, { reason: "x", deadline_date: "2026-03-20" });
    expect((await t.call("POST", `/scripts/${body.id}/versions`, {})).body).toMatchObject({ error: "validation_error", field: "content" });
  });

  it("o tamanho máximo do texto é 20.000 caracteres: 20.000 passa e 20.001 não", async () => {
    const t = setup();
    expect((await t.create("msn_ok", "a".repeat(20_000))).status).toBe(201);
    expect((await t.create("msn_grande", "a".repeat(20_001))).status).toBe(400);
  });

  it("a rota de saúde responde", async () => {
    expect((await setup().call("GET", "/health")).body).toEqual({ ok: true });
  });
});

describe("pedido de alteração: motivo e prazo obrigatórios", () => {
  async function fresh() {
    const t = setup("2026-03-10T15:00:00.000Z");
    const { body } = await t.create();
    return { t, id: body.id as string };
  }

  it.each([
    ["sem motivo", { deadline_date: "2026-03-20" }],
    ["motivo vazio", { reason: "", deadline_date: "2026-03-20" }],
    ["motivo só com espaços", { reason: "   \n ", deadline_date: "2026-03-20" }],
    ["motivo que não é texto", { reason: 42, deadline_date: "2026-03-20" }],
    ["sem prazo", { reason: "Mudar a abertura" }],
    ["prazo vazio", { reason: "Mudar a abertura", deadline_date: "" }],
    ["prazo que não é data", { reason: "Mudar a abertura", deadline_date: "amanhã" }],
    ["prazo com data impossível", { reason: "Mudar a abertura", deadline_date: "2026-02-30" }],
    ["prazo com horário junto", { reason: "Mudar a abertura", deadline_date: "2026-03-20T10:00:00Z" }],
    ["corpo vazio", {}],
  ])("%s não passa e nada é gravado", async (_name, body) => {
    const { t, id } = await fresh();
    const res = await t.requestChanges(id, body);
    expect(res.status).toBe(400);
    const seen = (await t.get(id)).body;
    expect(seen.state).toBe("awaiting_review");
    expect(seen.change_requests).toEqual([]);
  });

  it("o motivo é guardado sem espaços nas pontas", async () => {
    const { t, id } = await fresh();
    const res = await t.requestChanges(id, { reason: "  Abrir mais rápido  ", deadline_date: "2026-03-20" });
    expect(res.body.change_requests[0].reason).toBe("Abrir mais rápido");
  });
});

describe("prazo no fuso da marca, com o relógio controlado", () => {
  // O prazo é 12/03. O último instante desse dia em São Paulo é 13/03 às 02:59:59.999Z.
  async function atInstant(instant: string, deadline_date = "2026-03-12") {
    const t = setup("2026-03-10T15:00:00.000Z");
    const { body } = await t.create();
    t.set(instant);
    return { t, id: body.id as string, res: await t.requestChanges(body.id, { reason: "Ajustar o final", deadline_date }) };
  }

  it("no último instante do dia do prazo, o pedido ainda vale", async () => {
    const { res } = await atInstant("2026-03-13T02:59:59.999Z");
    expect(res.status).toBe(201);
  });

  it("no primeiro instante do dia seguinte, o pedido com esse prazo não vale mais", async () => {
    const { t, id, res } = await atInstant("2026-03-13T03:00:00.000Z");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("deadline_in_past");
    expect((await t.get(id)).body.state).toBe("awaiting_review");
  });

  it("o dia não vira cedo: com o UTC já em 13/03 mas ainda 12/03 em São Paulo, o prazo de 12/03 vale", async () => {
    const { res } = await atInstant("2026-03-13T01:30:00.000Z");
    expect(res.status).toBe(201);
  });

  it("o mesmo instante escrito com offset de São Paulo dá o mesmo resultado", async () => {
    expect((await atInstant("2026-03-12T23:59:59.999-03:00")).res.status).toBe(201);
    expect((await atInstant("2026-03-13T00:00:00.000-03:00")).res.status).toBe(422);
  });

  it("prazo de hoje vale e prazo de ontem não", async () => {
    expect((await atInstant("2026-03-10T15:00:00.000Z", "2026-03-10")).res.status).toBe(201);
    expect((await atInstant("2026-03-10T15:00:00.000Z", "2026-03-09")).res.status).toBe(422);
  });
});

describe("versão enviada depois do prazo", () => {
  async function respondAt(instant: string) {
    const t = setup("2026-03-10T15:00:00.000Z");
    const { body } = await t.create();
    await t.requestChanges(body.id, { reason: "Ajustar o final", deadline_date: "2026-03-12" });
    t.set(instant);
    const res = await t.submit(body.id, "Versão 2");
    return res;
  }

  it("até o último instante do dia do prazo não é tardia", async () => {
    const res = await respondAt("2026-03-13T02:59:59.999Z");
    expect(res.status).toBe(201);
    expect(res.body.versions[1].late).toBe(false);
  });

  it("no primeiro instante do dia seguinte é aceita e marcada como tardia, sem perder nada", async () => {
    const res = await respondAt("2026-03-13T03:00:00.000Z");
    expect(res.status).toBe(201);
    expect(res.body.versions.map((v: any) => v.late)).toEqual([false, true]);
    expect(res.body.state).toBe("awaiting_review");
  });
});

describe("regras de estado", () => {
  it("só se pede alteração em um roteiro aguardando revisão; já pedido, o criador é quem responde", async () => {
    const t = setup();
    const { body } = await t.create();
    await t.requestChanges(body.id, { reason: "A", deadline_date: "2026-03-20" });
    const second = await t.requestChanges(body.id, { reason: "B", deadline_date: "2026-03-20" });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: "invalid_state", state: "changes_requested", allowed_actions: ["submit_version", "cancel_changes"] });
  });

  it("não se manda versão nova sem pedido de alteração", async () => {
    const t = setup();
    const { body } = await t.create();
    const res = await t.submit(body.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "invalid_state", state: "awaiting_review" });
    expect((await t.get(body.id)).body.versions).toHaveLength(1);
  });

  it("não se aprova enquanto a alteração pedida está pendente", async () => {
    const t = setup();
    const { body } = await t.create();
    await t.requestChanges(body.id, { reason: "A", deadline_date: "2026-03-20" });
    const res = await t.approve(body.id);
    expect(res.status).toBe(409);
    expect(res.body.state).toBe("changes_requested");
  });

  it("versão nova sem conteúdo é 400 e não vira versão", async () => {
    const t = setup();
    const { body } = await t.create();
    await t.requestChanges(body.id, { reason: "A", deadline_date: "2026-03-20" });
    expect((await t.call("POST", `/scripts/${body.id}/versions`, { content: "  " })).status).toBe(400);
    expect((await t.get(body.id)).body.versions).toHaveLength(1);
  });

  it("o pedido incide sobre a versão atual, mesmo depois de várias rodadas", async () => {
    const t = setup();
    const { body } = await t.create();
    await t.requestChanges(body.id, { reason: "A", deadline_date: "2026-03-20" });
    await t.submit(body.id, "v2");
    const again = await t.requestChanges(body.id, { reason: "B", deadline_date: "2026-03-21" });
    expect(again.body.change_requests.map((c: any) => [c.version_number, c.reason, c.answered_by_version])).toEqual([[1, "A", 2], [2, "B", null]]);
  });
});

describe("aprovado é terminal", () => {
  async function approved() {
    const t = setup();
    const { body } = await t.create("msn_1", "v1");
    await t.requestChanges(body.id, { reason: "A", deadline_date: "2026-03-20" });
    await t.submit(body.id, "v2");
    await t.approve(body.id);
    return { t, id: body.id as string };
  }

  it("não aceita versão nova", async () => {
    const { t, id } = await approved();
    const res = await t.submit(id, "v3");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "script_approved", state: "approved", allowed_actions: [] });
    expect((await t.get(id)).body.versions).toHaveLength(2);
  });

  it("não aceita novo pedido de alteração, nem com dados válidos", async () => {
    const { t, id } = await approved();
    const res = await t.requestChanges(id, { reason: "Mudei de ideia", deadline_date: "2026-04-30" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("script_approved");
    const seen = (await t.get(id)).body;
    expect(seen.state).toBe("approved");
    expect(seen.change_requests).toHaveLength(1);
  });

  it("a aprovação não reabre: repetir a aprovação é inofensivo e não muda data nem versão", async () => {
    const { t, id } = await approved();
    const first = (await t.get(id)).body.approved;
    t.set("2026-06-01T12:00:00.000Z");
    const again = await t.approve(id);
    expect(again.status).toBe(200);
    expect(again.body.approved).toEqual(first);
    expect(again.body.state).toBe("approved");
  });
});

describe("versão antiga não se perde", () => {
  it("cada versão e cada pedido continuam legíveis depois de várias rodadas", async () => {
    const t = setup();
    const { body } = await t.create("msn_1", "primeira");
    for (const n of [2, 3, 4]) {
      await t.requestChanges(body.id, { reason: `rodada ${n - 1}`, deadline_date: "2026-03-30" });
      await t.submit(body.id, `versão ${n}`);
    }
    const seen = (await t.get(body.id)).body;
    expect(seen.versions.map((v: any) => v.content)).toEqual(["primeira", "versão 2", "versão 3", "versão 4"]);
    expect(seen.change_requests.map((c: any) => c.reason)).toEqual(["rodada 1", "rodada 2", "rodada 3"]);
    expect(seen.current_version).toBe(4);
  });
});
