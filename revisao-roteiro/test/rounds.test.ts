import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** Roteiro com a rodada A respondida pela v2 e a rodada B aberta. */
async function secondRound() {
  const t = setup("2026-03-10T15:00:00.000Z");
  const id = (await t.create("msn_1", "v1")).body.id as string;
  const a = (await t.requestChanges(id, { reason: "Rodada A", deadline_date: "2026-03-20" })).body.change_requests[0].id as number;
  const submitA = await t.call("POST", `/scripts/${id}/versions`, { content: "v2 da rodada A", change_request_id: a, submission_id: "s1" });
  const b = (await t.requestChanges(id, { reason: "Rodada B", deadline_date: "2026-03-25" })).body.change_requests[1].id as number;
  return { t, id, a, b, submitA };
}

describe("um envio responde à rodada que ele declarou, nunca a seguinte", () => {
  it("o envio normal vincula a versão à rodada e devolve o id do envio", async () => {
    const { submitA, a } = await secondRound();
    expect(submitA.status).toBe(201);
    expect(submitA.body).toMatchObject({ current_version: 2, submission: { id: "s1", version: 2, replayed: false } });
    expect(submitA.body.change_requests[0]).toMatchObject({ id: a, answered_by_version: 2 });
  });

  it("o retry do mesmo envio, depois de um novo pedido de alteração, devolve a v2 original e não cria v3 nem responde à rodada B", async () => {
    const { t, id, a, b } = await secondRound();
    const retry = await t.call("POST", `/scripts/${id}/versions`, { content: "v2 da rodada A", change_request_id: a, submission_id: "s1" });
    expect(retry.status).toBe(200);
    expect(retry.body.submission).toEqual({ id: "s1", version: 2, replayed: true });
    const seen = (await t.get(id)).body;
    expect(seen.current_version).toBe(2);
    expect(seen.state).toBe("changes_requested");
    expect(seen.change_requests.find((r: any) => r.id === b).answered_by_version).toBeNull();
  });

  it("o mesmo id de envio com outro conteúdo é conflito e não grava nada", async () => {
    const { t, id, a } = await secondRound();
    const clash = await t.call("POST", `/scripts/${id}/versions`, { content: "outro texto", change_request_id: a, submission_id: "s1" });
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ error: "submission_conflict" });
    expect((await t.get(id)).body.current_version).toBe(2);
  });

  it("o mesmo id de envio com outra rodada declarada também é conflito", async () => {
    const { t, id, b } = await secondRound();
    const clash = await t.call("POST", `/scripts/${id}/versions`, { content: "v2 da rodada A", change_request_id: b, submission_id: "s1" });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe("submission_conflict");
  });

  it("um envio da rodada A sem id de envio, depois que a B abriu, é recusado como rodada vencida", async () => {
    const { t, id, a } = await secondRound();
    const stale = await t.call("POST", `/scripts/${id}/versions`, { content: "texto antigo de novo", change_request_id: a });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "stale_round", open_change_request_id: expect.any(Number) });
    expect((await t.get(id)).body.current_version).toBe(2);
  });

  it("a rodada B aceita o envio dela, mesmo com texto igual ao da rodada A (conteúdo igual pode ser intencional)", async () => {
    const { t, id, b } = await secondRound();
    const ok = await t.call("POST", `/scripts/${id}/versions`, { content: "v2 da rodada A", change_request_id: b, submission_id: "s2" });
    expect(ok.status).toBe(201);
    expect(ok.body.current_version).toBe(3);
    expect(ok.body.change_requests[1].answered_by_version).toBe(3);
  });

  it("rodada que não existe neste roteiro é recusada", async () => {
    const { t, id } = await secondRound();
    const res = await t.call("POST", `/scripts/${id}/versions`, { content: "x", change_request_id: 9999 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("stale_round");
  });

  it("o retry de um envio já gravado continua devolvendo o original depois da aprovação", async () => {
    const { t, id, b } = await secondRound();
    await t.call("POST", `/scripts/${id}/versions`, { content: "v3", change_request_id: b, submission_id: "s2" });
    await t.approve(id);
    const retry = await t.call("POST", `/scripts/${id}/versions`, { content: "v3", change_request_id: b, submission_id: "s2" });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ state: "approved", submission: { version: 3, replayed: true } });
    expect((await t.call("POST", `/scripts/${id}/versions`, { content: "novo", submission_id: "s3" })).status).toBe(409);
  });

  it("o id de envio vale por roteiro: o mesmo id em outro roteiro é outro envio", async () => {
    const one = await secondRound();
    const other = (await one.t.create("msn_2", "v1")).body.id as string;
    await one.t.requestChanges(other, { reason: "ok", deadline_date: "2026-03-20" });
    const res = await one.t.call("POST", `/scripts/${other}/versions`, { content: "v2", submission_id: "s1" });
    expect(res.status).toBe(201);
    expect(res.body.submission.replayed).toBe(false);
  });

  it("sem change_request_id nem submission_id o comportamento é o de sempre (responde à rodada aberta)", async () => {
    const { t, id } = await secondRound();
    const res = await t.submit(id, "sem ids");
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("submission");
    expect(res.body.change_requests[1].answered_by_version).toBe(3);
  });

  it.each([
    ["change_request_id", "abc"],
    ["change_request_id", 1.5],
    ["change_request_id", 0],
    ["submission_id", ""],
    ["submission_id", 5],
    ["submission_id", "x".repeat(201)],
  ])("%s inválido (%j) é 400", async (field, value) => {
    const { t, id } = await secondRound();
    const res = await t.call("POST", `/scripts/${id}/versions`, { content: "x", [field]: value });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field });
  });
});
