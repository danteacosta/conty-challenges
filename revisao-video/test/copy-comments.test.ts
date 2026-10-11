import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

async function twoVersions() {
  const t = setup();
  const delivery = await t.newDelivery(["video"]);
  await t.submit(delivery, "video", { duration_seconds: 60 });
  const c1 = (await t.comment(delivery, "video", 1, { second: 5, text: "cortar aqui", author: "marca" })).body.id as number;
  const c2 = (await t.comment(delivery, "video", 1, { second: 50, text: "trocar a música" })).body.id as number;
  const c3 = (await t.comment(delivery, "video", 1, { second: 20, text: "logo maior" })).body.id as number;
  await t.requestChanges(delivery, "video", 1);
  await t.submit(delivery, "video", { duration_seconds: 40 });
  const copy = (body: unknown, to = 2) => t.call("POST", `/deliveries/${delivery}/pieces/video/versions/${to}/comments/copy`, body);
  return { t, delivery, c1, c2, c3, copy };
}

describe("copiar comentários escolhidos para outra versão, só quando o revisor pede", () => {
  it("nada migra sozinho: a versão nova nasce sem comentários", async () => {
    const { t, delivery } = await twoVersions();
    expect((await t.getVersion(delivery, "video", 2)).body.comments).toEqual([]);
  });

  it("copia só os escolhidos, preserva o original, registra a origem e avisa que a posição pode ter mudado", async () => {
    const { t, delivery, c1, c3, copy } = await twoVersions();
    const res = await copy({ from_version: 1, comment_ids: [c1, c3] });
    expect(res.status).toBe(201);
    expect(res.body.warning).toMatch(/posição/);
    expect(res.body.copied).toHaveLength(2);
    expect(res.body.copied[0]).toMatchObject({ second: 5, text: "cortar aqui", author: "marca", version: 2, copied_from: { version: 1, comment_id: c1 } });
    const v2 = (await t.getVersion(delivery, "video", 2)).body;
    expect(v2.comments.map((c: any) => c.text)).toEqual(["cortar aqui", "logo maior"]);
    const v1 = (await t.getVersion(delivery, "video", 1)).body;
    expect(v1.comments).toHaveLength(3); // o original continua inteiro
    expect(v1.comments.every((c: any) => c.copied_from === undefined || c.copied_from === null)).toBe(true);
  });

  it("repetir a mesma cópia não duplica", async () => {
    const { t, delivery, c1, copy } = await twoVersions();
    await copy({ from_version: 1, comment_ids: [c1] });
    const again = await copy({ from_version: 1, comment_ids: [c1] });
    expect(again.status).toBe(200);
    expect(again.body.copied).toEqual([]);
    expect(again.body.already_copied).toHaveLength(1);
    expect((await t.getVersion(delivery, "video", 2)).body.comments).toHaveLength(1);
  });

  it("âncora fora da duração do vídeo novo: recusa tudo, lista quais, e nada é copiado", async () => {
    const { t, delivery, c1, c2, copy } = await twoVersions(); // o vídeo novo tem 40 s; o comentário c2 está em 50 s
    const res = await copy({ from_version: 1, comment_ids: [c1, c2] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "comment_ids", out_of_range: [{ comment_id: c2, second: 50, duration_seconds: 40 }] });
    expect((await t.getVersion(delivery, "video", 2)).body.comments).toEqual([]);
  });

  it("comentário que não é da versão de origem (ou não existe) é recusado", async () => {
    const { copy, c1 } = await twoVersions();
    const res = await copy({ from_version: 1, comment_ids: [c1, 9999] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "comment_ids" });
  });

  it("uma mistura de já copiado e novo copia só o novo e diz qual já existia", async () => {
    const { t, delivery, c1, c3, copy } = await twoVersions();
    await copy({ from_version: 1, comment_ids: [c1] });
    const res = await copy({ from_version: 1, comment_ids: [c1, c3] });
    expect(res.status).toBe(201);
    expect(res.body.copied.map((c: any) => c.copied_from.comment_id)).toEqual([c3]);
    expect(res.body.already_copied).toEqual([{ comment_id: c1 }]);
    expect((await t.getVersion(delivery, "video", 2)).body.comments).toHaveLength(2);
  });

  it("o segundo exatamente igual à duração cabe; vídeo novo sem duração aceita qualquer segundo", async () => {
    const t = setup();
    const delivery = await t.newDelivery(["video"]);
    await t.submit(delivery, "video", { duration_seconds: 60 });
    const edge = (await t.comment(delivery, "video", 1, { second: 40, text: "no limite" })).body.id as number;
    await t.requestChanges(delivery, "video", 1);
    await t.submit(delivery, "video", { duration_seconds: 40 });
    const url = `/deliveries/${delivery}/pieces/video/versions`;
    expect((await t.call("POST", `${url}/2/comments/copy`, { from_version: 1, comment_ids: [edge] })).status).toBe(201);
    await t.requestChanges(delivery, "video", 2);
    await t.submit(delivery, "video"); // v3 sem duração informada
    const far = (await t.comment(delivery, "video", 1, { second: 55, text: "longe" })).body.id as number;
    expect((await t.call("POST", `${url}/3/comments/copy`, { from_version: 1, comment_ids: [far, edge] })).status).toBe(201);
  });

  it("comentários de peças sem segundo (roteiro) copiam mesmo sem duração", async () => {
    const t = setup();
    const delivery = await t.newDelivery(["script"]);
    await t.submit(delivery, "script");
    const note = (await t.comment(delivery, "script", 1, { text: "trocar o abre" })).body.id as number;
    await t.requestChanges(delivery, "script", 1);
    await t.submit(delivery, "script");
    const res = await t.call("POST", `/deliveries/${delivery}/pieces/script/versions/2/comments/copy`, { from_version: 1, comment_ids: [note] });
    expect(res.status).toBe(201);
    expect(res.body.copied[0]).toMatchObject({ second: null, text: "trocar o abre" });
  });

  it.each([
    ["sem lista", { from_version: 1 }],
    ["lista vazia", { from_version: 1, comment_ids: [] }],
    ["origem igual ao destino", { from_version: 2, comment_ids: [1] }],
    ["origem inexistente", { from_version: 9, comment_ids: [1] }],
    ["ids repetidos", { from_version: 1, comment_ids: [1, 1] }],
  ])("%s é 400", async (_name, body) => {
    const { copy } = await twoVersions();
    expect((await copy(body)).status).toBe(400);
  });

  it("origem igual ao destino diz que o problema é from_version", async () => {
    const { copy } = await twoVersions();
    expect((await copy({ from_version: 2, comment_ids: [1] })).body).toMatchObject({ error: "validation_error", field: "from_version" });
  });

  it("copiar para uma versão que não existe é 404", async () => {
    const { copy, c1 } = await twoVersions();
    expect((await copy({ from_version: 1, comment_ids: [c1] }, 7)).status).toBe(404);
  });
});
