import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

async function withOpenRequest() {
  const t = setup("2026-03-10T15:00:00.000Z");
  const id = (await t.create("msn_1", "v1")).body.id as string;
  const requested = await t.requestChanges(id, { reason: "Abrir com o produto", deadline_date: "2026-03-20" });
  const requestId = requested.body.change_requests[0].id as number;
  const cancel = (body: unknown = { reason: "Mudei de ideia", cancelled_by: "marca@exemplo.com" }, rid = requestId) =>
    t.call("POST", `/scripts/${id}/change-requests/${rid}/cancel`, body);
  return { t, id, requestId, cancel };
}

describe("cancelar um pedido de alteração, com histórico", () => {
  it("o pedido continua visível com quem cancelou, quando e por quê, e o roteiro volta a aguardar revisão", async () => {
    const { t, id, requestId, cancel } = await withOpenRequest();
    t.set("2026-03-11T10:30:00.000Z");
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "awaiting_review", current_version: 1 });
    expect(res.body.allowed_actions.sort()).toEqual(["approve", "request_changes"]);
    expect(res.body.change_requests).toEqual([
      {
        id: requestId,
        version_number: 1,
        reason: "Abrir com o produto",
        deadline_date: "2026-03-20",
        created_at: "2026-03-10T15:00:00.000Z",
        answered_by_version: null,
        status: "cancelled",
        cancellation: { at: "2026-03-11T10:30:00.000Z", by: "marca@exemplo.com", reason: "Mudei de ideia" },
      },
    ]);
    expect((await t.get(id)).body.change_requests[0].status).toBe("cancelled");
  });

  it("um pedido aberto aparece com status open e um respondido com answered", async () => {
    const { t, id } = await withOpenRequest();
    expect((await t.get(id)).body.change_requests[0]).toMatchObject({ status: "open", cancellation: null });
    await t.submit(id, "v2");
    expect((await t.get(id)).body.change_requests[0]).toMatchObject({ status: "answered", answered_by_version: 2 });
  });

  it("um envio que aponta o pedido cancelado não cria versão: sem outro pedido aberto, o roteiro nem aceita envio", async () => {
    const { t, id, requestId, cancel } = await withOpenRequest();
    await cancel();
    const res = await t.call("POST", `/scripts/${id}/versions`, { content: "v2 tardia", change_request_id: requestId, submission_id: "s1" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "invalid_state", state: "awaiting_review" });
    expect((await t.get(id)).body.current_version).toBe(1);
  });

  it("depois do cancelamento e de um pedido novo, o envio da rodada cancelada não responde à nova", async () => {
    const { t, id, requestId, cancel } = await withOpenRequest();
    await cancel();
    const second = await t.requestChanges(id, { reason: "Outra ideia", deadline_date: "2026-03-25" });
    const newId = second.body.change_requests[1].id as number;
    const stale = await t.call("POST", `/scripts/${id}/versions`, { content: "texto da rodada cancelada", change_request_id: requestId });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "round_cancelled", open_change_request_id: newId });
    expect((await t.get(id)).body.current_version).toBe(1);
    // e a rodada nova continua respondível pelo seu próprio id
    const ok = await t.call("POST", `/scripts/${id}/versions`, { content: "texto da rodada nova", change_request_id: newId });
    expect(ok.status).toBe(201);
    expect(ok.body.change_requests[1]).toMatchObject({ status: "answered", answered_by_version: 2 });
    expect(ok.body.change_requests[0].status).toBe("cancelled");
  });

  it("cancelar de novo o mesmo pedido é repetição (200, nada muda, o motivo original fica)", async () => {
    const { t, id, cancel } = await withOpenRequest();
    await cancel();
    t.set("2026-03-12T10:00:00.000Z");
    const again = await cancel({ reason: "outro motivo", cancelled_by: "outra pessoa" });
    expect(again.status).toBe(200);
    expect(again.body.change_requests[0].cancellation).toMatchObject({ reason: "Mudei de ideia", by: "marca@exemplo.com" });
    expect((await t.get(id)).body.state).toBe("awaiting_review");
  });

  it("pedido já respondido não pode ser cancelado", async () => {
    const { t, id, requestId, cancel } = await withOpenRequest();
    await t.submit(id, "v2");
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "request_not_open" });
    expect((await t.get(id)).body.change_requests[0]).toMatchObject({ id: requestId, status: "answered" });
  });

  it("roteiro aprovado não aceita cancelamento", async () => {
    const { t, id, cancel } = await withOpenRequest();
    await t.submit(id, "v2");
    await t.approve(id);
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "script_approved", state: "approved" });
  });

  it("pedido de outro roteiro ou inexistente é 404", async () => {
    const { t, id, cancel } = await withOpenRequest();
    expect((await cancel(undefined, 9999)).status).toBe(404);
    expect((await t.call("POST", `/scripts/nao-existe/change-requests/1/cancel`, { reason: "x", cancelled_by: "y" })).status).toBe(404);
    const other = (await t.create("msn_2", "v1")).body.id as string;
    expect((await t.call("POST", `/scripts/${other}/change-requests/${(await t.get(id)).body.change_requests[0].id}/cancel`, { reason: "x", cancelled_by: "y" })).status).toBe(404);
  });

  it.each([
    ["sem motivo", { cancelled_by: "marca" }],
    ["motivo só de espaços", { reason: "   ", cancelled_by: "marca" }],
    ["sem responsável", { reason: "x" }],
  ])("%s é 400 e nada muda", async (_name, body) => {
    const { t, id, cancel } = await withOpenRequest();
    const res = await cancel(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect((await t.get(id)).body.state).toBe("changes_requested");
  });

  it("a rodada pode ser aberta de novo depois do cancelamento, e a versão atual do pedido novo é a certa", async () => {
    const { t, id, cancel } = await withOpenRequest();
    await cancel();
    const second = await t.requestChanges(id, { reason: "Nova", deadline_date: "2026-03-25" });
    expect(second.status).toBe(201);
    expect(second.body.change_requests).toHaveLength(2);
    expect(second.body.change_requests[1]).toMatchObject({ version_number: 1, status: "open" });
  });
});
