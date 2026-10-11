import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("segundos e durações fora do inteiro seguro são recusados, e nada é gravado", () => {
  it.each([1e16, 2 ** 53, Number.MAX_SAFE_INTEGER + 2, 1e300])("comentário em %s segundos é 400 e a consulta continua funcionando", async (second) => {
    const t = setup();
    const delivery = await t.newDelivery();
    await t.submit(delivery, "video", { duration_seconds: 60 });
    const before = (await t.getVersion(delivery, "video", 1)).body.comments_count;
    const res = await t.comment(delivery, "video", 1, { second, text: "no fim" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "second" });
    const read = await t.getVersion(delivery, "video", 1);
    expect(read.status).toBe(200);
    expect(read.body.comments).toEqual([]);
    expect(read.body.comments_count).toBe(before);
    expect((await t.get(delivery)).status).toBe(200);
  });

  it("o maior inteiro seguro de segundo passa pela validação de formato (e só falha pela duração do vídeo)", async () => {
    const t = setup();
    const delivery = await t.newDelivery();
    await t.submit(delivery, "video", { duration_seconds: 60 });
    const res = await t.comment(delivery, "video", 1, { second: Number.MAX_SAFE_INTEGER, text: "x" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não existe/);
  });

  it("vídeo sem duração aceita um segundo grande porém seguro, e a leitura continua inteira", async () => {
    const t = setup();
    const delivery = await t.newDelivery();
    await t.submit(delivery, "video");
    expect((await t.comment(delivery, "video", 1, { second: Number.MAX_SAFE_INTEGER, text: "x" })).status).toBe(201);
    expect((await t.getVersion(delivery, "video", 1)).body.comments).toMatchObject([{ second: Number.MAX_SAFE_INTEGER }]);
  });

  it.each([1e16, 2 ** 53, 1e300])("duração de %s segundos é 400 e nenhuma versão nasce", async (duration) => {
    const t = setup();
    const delivery = await t.newDelivery();
    const res = await t.submit(delivery, "video", { duration_seconds: duration });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "duration_seconds" });
    expect((await t.get(delivery)).body.pieces.video.versions).toEqual([]);
    expect((await t.get(delivery)).body.events).toEqual([]);
  });

  it("número de versão gigante na rota é 404, não 500", async () => {
    const t = setup();
    const delivery = await t.newDelivery();
    expect((await t.call("GET", `/deliveries/${delivery}/pieces/video/versions/99999999999999999999`)).status).toBe(404);
  });
});

describe("repetir um envio de versão com o mesmo submission_id não cria outra versão", () => {
  const send = (t: ReturnType<typeof setup>, delivery: string, extra: Record<string, unknown> = {}) =>
    t.call("POST", `/deliveries/${delivery}/pieces/video/versions`, { url: "https://arquivos.example/v.mp4", duration_seconds: 30, submission_id: "s1", ...extra });

  it("o envio original devolve a versão e o id do envio; a repetição devolve a mesma, 200", async () => {
    const t = setup();
    const delivery = await t.newDelivery(["video"]);
    const first = await send(t, delivery);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ version: { number: 1 }, submission: { id: "s1", replayed: false } });
    const again = await send(t, delivery);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ version: { number: 1 }, submission: { id: "s1", replayed: true } });
    expect((await t.get(delivery)).body.pieces.video.versions).toHaveLength(1);
  });

  it("depois da aprovação da entrega, o retry não cria versão nem reabre a revisão", async () => {
    const t = setup();
    const delivery = await t.newDelivery(["video"]);
    await send(t, delivery);
    await t.approveVersion(delivery, "video", 1);
    expect((await t.approve(delivery)).status).toBe(200);
    const retry = await send(t, delivery);
    expect(retry.status).toBe(200);
    expect(retry.body.delivery_status).toBe("approved");
    const view = (await t.get(delivery)).body;
    expect(view.status).toBe("approved");
    expect(view.pieces.video.versions).toHaveLength(1);
    expect(view.events.map((e: any) => e.kind)).toEqual(["approved"]);
  });

  it("repetir um envio antigo depois de uma versão nova devolve a versão original, já marcada como substituída", async () => {
    const t = setup();
    const delivery = await t.newDelivery(["video"]);
    await send(t, delivery);
    await t.submit(delivery, "video");
    const replay = await send(t, delivery);
    expect(replay.status).toBe(200);
    expect(replay.body.version).toMatchObject({ number: 1, superseded: true });
    expect((await t.get(delivery)).body.pieces.video.versions).toHaveLength(2);
  });

  it("o mesmo id com outra URL ou outra duração é conflito e não grava", async () => {
    const t = setup();
    const delivery = await t.newDelivery(["video"]);
    await send(t, delivery);
    const otherUrl = await send(t, delivery, { url: "https://arquivos.example/outro.mp4" });
    expect(otherUrl.status).toBe(409);
    expect(otherUrl.body.error).toBe("submission_conflict");
    expect((await send(t, delivery, { duration_seconds: 31 })).status).toBe(409);
    expect((await t.get(delivery)).body.pieces.video.versions).toHaveLength(1);
  });

  it("a mesma URL com outro id é outro envio: não deduplica só pela URL", async () => {
    const t = setup();
    const delivery = await t.newDelivery(["video"]);
    await send(t, delivery);
    const second = await send(t, delivery, { submission_id: "s2" });
    expect(second.status).toBe(201);
    expect(second.body.version.number).toBe(2);
  });

  it("o id vale por peça e por entrega", async () => {
    const t = setup();
    const a = await t.newDelivery();
    const b = await t.newDelivery();
    await send(t, a);
    expect((await send(t, b)).status).toBe(201);
    const cover = await t.call("POST", `/deliveries/${a}/pieces/cover/versions`, { url: "https://arquivos.example/c.png", submission_id: "s1" });
    expect(cover.status).toBe(201);
  });

  it("sem submission_id o comportamento é o de sempre", async () => {
    const t = setup();
    const delivery = await t.newDelivery(["video"]);
    await t.submit(delivery, "video");
    const second = await t.submit(delivery, "video");
    expect(second.status).toBe(201);
    expect(second.body).not.toHaveProperty("submission");
    expect(second.body.version.number).toBe(2);
  });

  it.each(["", 5, "x".repeat(201)])("submission_id inválido (%j) é 400", async (value) => {
    const t = setup();
    const delivery = await t.newDelivery(["video"]);
    const res = await send(t, delivery, { submission_id: value });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "submission_id" });
  });
});
