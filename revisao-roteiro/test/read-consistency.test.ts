import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { createScript, getScript, requestChanges, submitVersion } from "../src/store.ts";
import { setup } from "./helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "roteiro-leitura-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const at = () => new Date("2026-03-11T10:00:00.000Z");

describe("o GET lê o roteiro, as versões e os pedidos de um retrato só", () => {
  it("uma versão enviada por outra conexão no meio da leitura não aparece pela metade", () => {
    const path = join(dir, "snapshot.db");
    const reader = openDatabase(path);
    const writer = openDatabase(path);
    createScript(writer, { id: "scr_1", missionId: "msn_1", content: "v1" }, at);
    requestChanges(writer, { id: "scr_1", reason: "ajustar", deadlineDate: "2026-03-20" }, at);

    // Logo depois de ler a linha do roteiro (changes_requested), a outra conexão envia a v2 e responde o pedido.
    const original = reader.prepare.bind(reader);
    let interleaved = false;
    reader.prepare = ((sql: string) => {
      const statement = original(sql);
      if (!interleaved && sql === "SELECT * FROM scripts WHERE id = ?") {
        const get = statement.get.bind(statement);
        statement.get = ((...args: unknown[]) => {
          const row = (get as (...a: unknown[]) => unknown)(...args);
          interleaved = true;
          submitVersion(writer, { id: "scr_1", content: "v2" }, at);
          return row;
        }) as typeof statement.get;
      }
      return statement;
    }) as typeof reader.prepare;

    const outcome = getScript(reader, "scr_1");
    expect(interleaved).toBe(true);
    if (!outcome.ok) throw new Error("not_found");
    const { view } = outcome;
    // ou o retrato de antes (aguardando alteração, v1, pedido aberto) ou o de depois (aguardando revisão, v2, pedido respondido)
    const before = view.state === "changes_requested" && view.current_version === 1 && view.change_requests.every((r) => r.status === "open");
    const after = view.state === "awaiting_review" && view.current_version === 2 && view.change_requests.every((r) => r.status === "answered");
    expect(before || after).toBe(true);
    expect(view.allowed_actions).toEqual(view.state === "changes_requested" ? ["submit_version", "cancel_changes"] : ["request_changes", "approve"]);
    reader.close();
    writer.close();
  });
});

describe("corpos das decisões não aceitam campo desconhecido", () => {
  it("pedido de alteração com expected_verison escrito errado: 400, nenhum pedido criado, nada decidido sobre a versão atual", async () => {
    const t = setup("2026-03-10T15:00:00.000Z");
    const id = (await t.create("msn_1", "v1")).body.id as string;
    await t.requestChanges(id, { reason: "ajustar", deadline_date: "2026-03-20" });
    await t.submit(id, "v2");
    const res = await t.requestChanges(id, { reason: "sobre a v1", deadline_date: "2026-03-25", expected_verison: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "body" });
    expect(res.body.message).toContain("expected_verison");
    const seen = (await t.get(id)).body;
    expect(seen).toMatchObject({ state: "awaiting_review", current_version: 2 });
    expect(seen.change_requests).toHaveLength(1);
  });

  it("pedido de alteração com a chave certa e versão antiga é 409; sem a chave (cliente antigo) continua valendo", async () => {
    const t = setup("2026-03-10T15:00:00.000Z");
    const id = (await t.create("msn_1", "v1")).body.id as string;
    await t.requestChanges(id, { reason: "ajustar", deadline_date: "2026-03-20" });
    await t.submit(id, "v2");
    expect((await t.requestChanges(id, { reason: "x", deadline_date: "2026-03-25", expected_version: 1 })).status).toBe(409);
    expect((await t.requestChanges(id, { reason: "x", deadline_date: "2026-03-25" })).status).toBe(201);
  });

  it("envio de versão com change_request_id escrito errado: 400, e nada é criado", async () => {
    const t = setup("2026-03-10T15:00:00.000Z");
    const id = (await t.create("msn_1", "v1")).body.id as string;
    await t.requestChanges(id, { reason: "ajustar", deadline_date: "2026-03-20" });
    const res = await t.call("POST", `/scripts/${id}/versions`, { content: "v2", change_requst_id: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "body" });
    expect((await t.get(id)).body.current_version).toBe(1);
  });

  it("cancelamento com chave desconhecida: 400, e o pedido continua aberto", async () => {
    const t = setup("2026-03-10T15:00:00.000Z");
    const id = (await t.create("msn_1", "v1")).body.id as string;
    const changed = await t.requestChanges(id, { reason: "ajustar", deadline_date: "2026-03-20" });
    const requestId = changed.body.change_requests[0].id as number;
    const res = await t.call("POST", `/scripts/${id}/change-requests/${requestId}/cancel`, { reason: "erro", cancelled_by: "ana", cancelled_bi: "ana" });
    expect(res.status).toBe(400);
    expect((await t.get(id)).body.change_requests[0].status).toBe("open");
  });
});
