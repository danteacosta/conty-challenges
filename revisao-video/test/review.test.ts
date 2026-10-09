import { describe, expect, it } from "vitest";
import { ALL_PIECES, setup, type Piece } from "./helpers.ts";

describe("cadastro da campanha: as peças exigidas são dado", () => {
  it("a campanha declara as peças e a API devolve exatamente as declaradas", async () => {
    const t = setup();
    const res = await t.call("POST", "/campaigns", { required_pieces: ["video", "caption"] });
    expect(res).toMatchObject({ status: 201, body: { required_pieces: ["video", "caption"] } });
    expect((await t.call("GET", `/campaigns/${res.body.id}`)).body.required_pieces).toEqual(["video", "caption"]);
  });

  it.each([
    ["lista vazia", { required_pieces: [] }],
    ["peça desconhecida", { required_pieces: ["video", "thumbnail"] }],
    ["peça repetida", { required_pieces: ["video", "video"] }],
    ["não é lista", { required_pieces: "video" }],
    ["sem o campo", {}],
  ])("%s é 400 e informa as peças possíveis", async (_name, body) => {
    const t = setup();
    const res = await t.call("POST", "/campaigns", body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "required_pieces", allowed: ALL_PIECES });
  });

  it("campanha ou entrega inexistente é 404", async () => {
    const t = setup();
    expect((await t.call("POST", "/deliveries", { campaign_id: "nada" })).status).toBe(404);
    expect((await t.call("GET", "/campaigns/nada")).status).toBe(404);
    expect((await t.get("nada")).status).toBe(404);
    expect((await t.approve("nada")).status).toBe(404);
    expect((await t.call("POST", "/deliveries", {})).status).toBe(400);
  });
});

describe("aprovar a entrega exige cada peça exigida com a versão atual aprovada", () => {
  it("com peça obrigatória pendente falha com um erro claro que lista cada peça e o motivo", async () => {
    const t = setup();
    const d = await t.newDelivery(["script", "video", "cover", "caption"]);
    const empty = await t.approve(d);
    expect(empty.status).toBe(409);
    expect(empty.body).toMatchObject({ error: "pieces_pending" });
    expect(empty.body.pending).toEqual([
      { piece: "script", reason: "no_version" },
      { piece: "video", reason: "no_version" },
      { piece: "cover", reason: "no_version" },
      { piece: "caption", reason: "no_version" },
    ]);

    await t.submitAndApprove(d, "script");
    await t.submit(d, "video"); // enviada, mas ainda não revisada
    const cover = await t.submit(d, "cover");
    await t.requestChanges(d, "cover", cover.body.version.number, "Cores");
    const partial = await t.approve(d);
    expect(partial.body.pending).toEqual([
      { piece: "video", reason: "pending_review", current_version: 1 },
      { piece: "cover", reason: "changes_requested", current_version: 1 },
      { piece: "caption", reason: "no_version" },
    ]);
    expect((await t.get(d)).body.status).toBe("in_production");
  });

  it("com tudo aprovado a entrega é aprovada", async () => {
    const t = setup();
    const d = await t.newDelivery();
    for (const piece of ALL_PIECES) await t.submitAndApprove(d, piece);
    const res = await t.approve(d);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "approved", approval: { approved_at: "2026-06-01T12:00:00.000Z", invalidated: false } });
    expect(res.body.pending).toEqual([]);
  });

  it("campanha só de vídeo não exige roteiro, capa nem legenda", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submitAndApprove(d, "video");
    const res = await t.approve(d);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.pieces.script).toMatchObject({ required: false, current_version: null });
  });

  it("peça que a campanha não pediu não bloqueia, mesmo enviada e ainda pendente", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submitAndApprove(d, "video");
    await t.submit(d, "cover"); // não exigida, fica pendente
    const script = await t.submit(d, "script");
    await t.requestChanges(d, "script", script.body.version.number); // não exigida, com alteração pedida
    expect((await t.approve(d)).status).toBe(200);
  });

  it("aprovar de novo uma entrega aprovada é inofensivo e não muda a data", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submitAndApprove(d, "video");
    const first = await t.approve(d);
    t.set("2026-06-09T12:00:00.000Z");
    const again = await t.approve(d);
    expect(again.status).toBe(200);
    expect(again.body.approval.approved_at).toBe(first.body.approval.approved_at);
    expect((await t.get(d)).body.events.filter((e: any) => e.kind === "approved")).toHaveLength(1);
  });
});

describe("versão nova substitui a anterior sem apagá-la", () => {
  it("a anterior fica superseded e legível; só a atual pode ser aprovada", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video", { url: "https://arquivos.example/v1.mp4" });
    const second = await t.submit(d, "video", { url: "https://arquivos.example/v2.mp4" });
    expect(second.body.version).toMatchObject({ number: 2, state: "pending", superseded: false });

    const piece = (await t.get(d)).body.pieces.video;
    expect(piece.current_version).toBe(2);
    expect(piece.versions.map((v: any) => [v.number, v.url, v.state, v.superseded])).toEqual([
      [1, "https://arquivos.example/v1.mp4", "pending", true],
      [2, "https://arquivos.example/v2.mp4", "pending", false],
    ]);

    const old = await t.approveVersion(d, "video", 1);
    expect(old.status).toBe(409);
    expect(old.body).toMatchObject({ error: "version_superseded", current_version: 2 });
    expect((await t.getVersion(d, "video", 1)).body.url).toBe("https://arquivos.example/v1.mp4");
  });

  it("o GET de uma versão diz se ela é a atual ou foi substituída", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    expect((await t.getVersion(d, "video", 1)).body.superseded).toBe(false);
    await t.submit(d, "video");
    expect((await t.getVersion(d, "video", 1)).body.superseded).toBe(true);
    expect((await t.getVersion(d, "video", 2)).body.superseded).toBe(false);
  });

  it("aprovar de novo uma versão já aprovada, depois de substituída, continua sendo inofensivo e mostra que está substituída", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    await t.approveVersion(d, "video", 1);
    await t.submit(d, "video");
    const again = await t.approveVersion(d, "video", 1);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ number: 1, state: "approved", superseded: true });
  });

  it("a resposta de aprovar e de pedir alteração mostra a versão atual, não substituída", async () => {
    const t = setup();
    const d = await t.newDelivery(["video", "cover"]);
    await t.submit(d, "video");
    await t.submit(d, "cover");
    expect((await t.approveVersion(d, "video", 1)).body).toMatchObject({ superseded: false, state: "approved" });
    expect((await t.requestChanges(d, "cover", 1)).body).toMatchObject({ superseded: false, state: "changes_requested" });
  });

  it("o 404 diz o que não existe: a entrega ou a versão", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    expect((await t.approveVersion("nada", "video", 1)).body).toMatchObject({ error: "not_found", what: "delivery" });
    expect((await t.approveVersion(d, "video", 9)).body).toMatchObject({ error: "not_found", what: "version" });
    expect((await t.getVersion("nada", "video", 1)).body).toMatchObject({ what: "delivery" });
    expect((await t.getVersion(d, "video", 9)).body).toMatchObject({ what: "version" });
    expect((await t.comment("nada", "video", 1, { second: 1, text: "x" })).body).toMatchObject({ what: "delivery" });
    expect((await t.comment(d, "video", 9, { second: 1, text: "x" })).body).toMatchObject({ what: "version" });
    expect((await t.call("POST", "/deliveries", { campaign_id: "nada" })).body).toMatchObject({ what: "campaign" });
    expect((await t.get("nada")).body).toMatchObject({ what: "delivery" });
  });

  it.each(["0", "01", "1x", "x1", "-1", "1.5", " 1", "1e0"])("número de versão %j na URL é 404 (só inteiros 1, 2, 3… sem zeros à esquerda)", async (n) => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    for (const route of ["", "/approve", "/request-changes", "/comments"]) {
      const method = route === "" ? "GET" : "POST";
      const url = `/deliveries/${d}/pieces/video/versions/${encodeURIComponent(n)}${route}`;
      const res = method === "GET" ? await t.call("GET", url) : await t.call("POST", url, { reason: "x", second: 1, text: "x" });
      expect(res.status, `${method} ${route}`).toBe(404);
    }
    expect((await t.getVersion(d, "video", 1)).body.state).toBe("pending");
  });

  it("nenhuma ação sobre uma entrega que não existe cria nada", async () => {
    const t = setup();
    expect((await t.submit("nada", "video")).body).toMatchObject({ what: "delivery" });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM piece_versions").get()).toEqual({ n: 0 });
  });

  it("as versões são numeradas por peça, sem lacunas", async () => {
    const t = setup();
    const d = await t.newDelivery();
    for (let i = 0; i < 3; i += 1) await t.submit(d, "video");
    await t.submit(d, "cover");
    const body = (await t.get(d)).body;
    expect(body.pieces.video.versions.map((v: any) => v.number)).toEqual([1, 2, 3]);
    expect(body.pieces.cover.versions.map((v: any) => v.number)).toEqual([1]);
  });

  it("validação do envio: url obrigatória; duração só no vídeo, inteira e positiva", async () => {
    const t = setup();
    const d = await t.newDelivery();
    expect((await t.call("POST", `/deliveries/${d}/pieces/video/versions`, {})).status).toBe(400);
    expect((await t.call("POST", `/deliveries/${d}/pieces/video/versions`, { url: "  " })).status).toBe(400);
    expect((await t.submit(d, "video", { duration_seconds: 0 })).status).toBe(400);
    expect((await t.submit(d, "video", { duration_seconds: 1.5 })).status).toBe(400);
    expect((await t.submit(d, "video", { duration_seconds: "60" })).status).toBe(400);
    expect((await t.submit(d, "cover", { duration_seconds: 60 })).status).toBe(400);
    expect((await t.submit(d, "video", { duration_seconds: 60 })).status).toBe(201);
    expect((await t.call("POST", `/deliveries/${d}/pieces/thumbnail/versions`, { url: "x" })).status).toBe(404);
    expect((await t.call("POST", `/deliveries/nada/pieces/video/versions`, { url: "x" })).status).toBe(404);
  });
});

describe("estados da versão", () => {
  it("pedir alteração marca a versão atual; ela não pode mais ser aprovada, só substituída", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    const changes = await t.requestChanges(d, "video", 1, "Cortar a intro");
    expect(changes.status).toBe(200);
    expect(changes.body).toMatchObject({ number: 1, state: "changes_requested", change_reason: "Cortar a intro" });
    const approve = await t.approveVersion(d, "video", 1);
    expect(approve.status).toBe(409);
    expect(approve.body).toMatchObject({ error: "version_not_pending", state: "changes_requested" });
    await t.submit(d, "video");
    expect((await t.approveVersion(d, "video", 2)).status).toBe(200);
  });

  it("pedir alteração exige motivo", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    expect((await t.call("POST", `/deliveries/${d}/pieces/video/versions/1/request-changes`, {})).status).toBe(400);
    expect((await t.requestChanges(d, "video", 1, "   ")).status).toBe(400);
    expect((await t.getVersion(d, "video", 1)).body.state).toBe("pending");
  });

  it("versão aprovada não recebe pedido de alteração, e aprovar de novo é inofensivo", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    const first = await t.approveVersion(d, "video", 1);
    t.set("2026-06-09T12:00:00.000Z");
    const again = await t.approveVersion(d, "video", 1);
    expect(again.status).toBe(200);
    expect(again.body.decided_at).toBe(first.body.decided_at);
    expect((await t.requestChanges(d, "video", 1)).status).toBe(409);
  });

  it("versão que não existe é 404", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    expect((await t.approveVersion(d, "video", 9)).status).toBe(404);
    expect((await t.getVersion(d, "video", 0)).status).toBe(404);
    expect((await t.call("GET", `/deliveries/${d}/pieces/video/versions/x`)).status).toBe(404);
  });
});

describe("versão nova numa peça de entrega já aprovada desfaz a aprovação até a nova ser aprovada", () => {
  async function approvedDelivery() {
    const t = setup("2026-06-01T12:00:00.000Z");
    const d = await t.newDelivery(["script", "video"]);
    await t.submitAndApprove(d, "script");
    await t.submitAndApprove(d, "video");
    expect((await t.approve(d)).body.status).toBe("approved");
    return { t, d };
  }

  it("a entrega deixa de estar aprovada e diz por quê", async () => {
    const { t, d } = await approvedDelivery();
    t.set("2026-06-02T12:00:00.000Z");
    const sent = await t.submit(d, "video");
    expect(sent.body.delivery_status).toBe("in_review");

    const body = (await t.get(d)).body;
    expect(body).toMatchObject({ status: "in_review", approval: { approved_at: "2026-06-01T12:00:00.000Z", invalidated: true } });
    expect(body.pending).toEqual([{ piece: "video", reason: "pending_review", current_version: 2 }]);
  });

  it("aprovar a versão nova devolve a aprovação, sem aprovar a entrega de novo", async () => {
    const { t, d } = await approvedDelivery();
    await t.submit(d, "video");
    expect((await t.get(d)).body.status).toBe("in_review");
    t.set("2026-06-03T12:00:00.000Z");
    const approvedVersion = await t.approveVersion(d, "video", 2);
    expect(approvedVersion.body.delivery_status).toBe("approved");
    const body = (await t.get(d)).body;
    expect(body).toMatchObject({ status: "approved", approval: { approved_at: "2026-06-01T12:00:00.000Z", invalidated: false } });
  });

  it("o log explica cada passo: aprovada, desfeita pela versão nova, restaurada", async () => {
    const { t, d } = await approvedDelivery();
    t.set("2026-06-02T12:00:00.000Z");
    await t.submit(d, "video");
    t.set("2026-06-03T12:00:00.000Z");
    await t.approveVersion(d, "video", 2);
    const events = (await t.get(d)).body.events;
    expect(events.map((e: any) => [e.kind, e.at, e.piece, e.version])).toEqual([
      ["approved", "2026-06-01T12:00:00.000Z", null, null],
      ["invalidated", "2026-06-02T12:00:00.000Z", "video", 2],
      ["restored", "2026-06-03T12:00:00.000Z", "video", 2],
    ]);
    expect(events[0].detail.approved_versions).toEqual({ script: 1, video: 1 });
  });

  it("várias versões novas seguidas desfazem uma vez só e a restauração vem só quando a atual é aprovada", async () => {
    const { t, d } = await approvedDelivery();
    await t.submit(d, "video");
    await t.submit(d, "video");
    await t.approveVersion(d, "video", 3);
    expect((await t.get(d)).body.events.map((e: any) => e.kind)).toEqual(["approved", "invalidated", "restored"]);
  });

  it("enquanto a versão nova não é aprovada, aprovar a entrega de novo é recusado", async () => {
    const { t, d } = await approvedDelivery();
    await t.submit(d, "video");
    const res = await t.approve(d);
    expect(res.status).toBe(409);
    expect(res.body.pending).toEqual([{ piece: "video", reason: "pending_review", current_version: 2 }]);
  });

  it("versão nova de uma peça NÃO exigida não desfaz nada", async () => {
    const { t, d } = await approvedDelivery();
    await t.submit(d, "cover");
    await t.submit(d, "caption");
    expect((await t.get(d)).body.status).toBe("approved");
    expect((await t.get(d)).body.events.map((e: any) => e.kind)).toEqual(["approved"]);
  });

  it("vale para qualquer peça exigida, não só o vídeo", async () => {
    const { t, d } = await approvedDelivery();
    await t.submit(d, "script");
    expect((await t.get(d)).body.status).toBe("in_review");
  });

  it("versão nova numa entrega que nunca foi aprovada não gera evento de desfazer", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submitAndApprove(d, "video");
    await t.submit(d, "video");
    expect((await t.get(d)).body.events).toEqual([]);
    expect((await t.get(d)).body.status).toBe("in_production");
  });

  it("aprovar versões numa entrega que ainda não foi aprovada não registra 'restaurada'", async () => {
    const t = setup();
    const d = await t.newDelivery(["video", "cover"]);
    await t.submitAndApprove(d, "video");
    await t.submit(d, "cover");
    await t.requestChanges(d, "cover", 1);
    await t.submitAndApprove(d, "cover");
    expect((await t.get(d)).body.events).toEqual([]);
  });

  it("aprovar uma versão de peça NÃO exigida, com a entrega em revisão, não a restaura", async () => {
    const { t, d } = await approvedDelivery();
    await t.submit(d, "video"); // desfaz
    await t.submitAndApprove(d, "cover"); // peça não exigida
    expect((await t.get(d)).body.status).toBe("in_review");
    expect((await t.get(d)).body.events.map((e: any) => e.kind)).toEqual(["approved", "invalidated"]);
  });

  it("pedir alteração na versão atual de uma entrega aprovada não é possível: ela já está aprovada", async () => {
    const { t, d } = await approvedDelivery();
    expect((await t.requestChanges(d, "video", 1)).status).toBe(409);
    expect((await t.get(d)).body.status).toBe("approved");
  });
});

describe("comentário preso a um segundo do vídeo", () => {
  it("fica visível na versão em que foi feito, com o segundo", async () => {
    const t = setup("2026-06-01T12:00:00.000Z");
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video", { duration_seconds: 90 });
    const made = await t.comment(d, "video", 1, { second: 12, text: "Cortar aqui", author: "marca" });
    expect(made).toMatchObject({ status: 201, body: { second: 12, text: "Cortar aqui", author: "marca", version: 1, created_at: "2026-06-01T12:00:00.000Z" } });

    const v1 = (await t.getVersion(d, "video", 1)).body;
    expect(v1.comments.map((c: any) => [c.second, c.text])).toEqual([[12, "Cortar aqui"]]);
  });

  it("não migra sozinho para a versão nova, e continua na versão antiga", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video", { duration_seconds: 90 });
    await t.comment(d, "video", 1, { second: 12, text: "Cortar aqui" });
    await t.submit(d, "video", { duration_seconds: 80 });

    expect((await t.getVersion(d, "video", 2)).body.comments).toEqual([]);
    expect((await t.getVersion(d, "video", 1)).body.comments).toHaveLength(1);
    await t.comment(d, "video", 2, { second: 5, text: "Melhor" });
    expect((await t.getVersion(d, "video", 2)).body.comments.map((c: any) => c.text)).toEqual(["Melhor"]);
    expect((await t.getVersion(d, "video", 1)).body.comments.map((c: any) => c.text)).toEqual(["Cortar aqui"]);
    const piece = (await t.get(d)).body.pieces.video.versions;
    expect(piece.map((v: any) => [v.number, v.comments_count])).toEqual([[1, 1], [2, 1]]);
  });

  it("os comentários saem em ordem do segundo, e o mesmo segundo pode ter vários", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video", { duration_seconds: 90 });
    await t.comment(d, "video", 1, { second: 30, text: "c" });
    await t.comment(d, "video", 1, { second: 5, text: "a" });
    await t.comment(d, "video", 1, { second: 5, text: "b" });
    expect((await t.getVersion(d, "video", 1)).body.comments.map((c: any) => [c.second, c.text])).toEqual([[5, "a"], [5, "b"], [30, "c"]]);
  });

  it("o segundo é obrigatório no vídeo, inteiro, não negativo e dentro da duração", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video", { duration_seconds: 90 });
    const bad = (body: Record<string, unknown>) => t.comment(d, "video", 1, body);
    expect((await bad({ text: "sem segundo" })).status).toBe(400);
    expect((await bad({ second: -1, text: "x" })).status).toBe(400);
    expect((await bad({ second: 1.5, text: "x" })).status).toBe(400);
    expect((await bad({ second: "12", text: "x" })).status).toBe(400);
    expect((await bad({ second: 91, text: "x" })).status).toBe(400);
    expect((await bad({ second: 12, text: "   " })).status).toBe(400);
    expect((await bad({ second: 0, text: "início" })).status).toBe(201);
    expect((await bad({ second: 90, text: "último segundo" })).status).toBe(201);
  });

  it("sem duração declarada, qualquer segundo inteiro não negativo vale", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submit(d, "video");
    expect((await t.comment(d, "video", 1, { second: 100_000, text: "x" })).status).toBe(201);
  });

  it("nas outras peças o comentário vale para a peça toda: com segundo é recusado", async () => {
    const t = setup();
    const d = await t.newDelivery();
    await t.submit(d, "caption");
    expect((await t.comment(d, "caption", 1, { text: "Trocar a hashtag" })).status).toBe(201);
    const withSecond = await t.comment(d, "caption", 1, { second: 3, text: "x" });
    expect(withSecond.status).toBe(400);
    expect(withSecond.body.field).toBe("second");
    expect((await t.getVersion(d, "caption", 1)).body.comments).toMatchObject([{ second: null, text: "Trocar a hashtag" }]);
  });

  it("comentar numa versão que não existe é 404", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    expect((await t.comment(d, "video", 1, { second: 1, text: "x" })).status).toBe(404);
  });

  it("comentar não muda o estado da versão nem da entrega", async () => {
    const t = setup();
    const d = await t.newDelivery(["video"]);
    await t.submitAndApprove(d, "video");
    await t.approve(d);
    await t.comment(d, "video", 1, { second: 1, text: "Obs" });
    expect((await t.get(d)).body.status).toBe("approved");
  });
});
