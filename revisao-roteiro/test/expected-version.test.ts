import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { createScript, requestChanges, submitVersion } from "../src/store.ts";
import { setup } from "./helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "roteiro-versao-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Roteiro com a v2 já enviada e aguardando revisão: quem leu a v1 decide agora sobre outra coisa. */
async function withSecondVersion() {
  const t = setup("2026-03-10T15:00:00.000Z");
  const id = (await t.create("msn_1", "v1")).body.id as string;
  await t.requestChanges(id, { reason: "ajustar", deadline_date: "2026-03-20" });
  await t.submit(id, "v2");
  return { t, id };
}
const approveWith = (t: ReturnType<typeof setup>, id: string, body?: unknown) => t.call("POST", `/scripts/${id}/approve`, body);

describe("a decisão da marca vale para a versão que ela examinou (expected_version)", () => {
  it("aprovação dirigida à v1 depois que a v2 existe: 409, nada é aprovado, e a v2 continua aguardando", async () => {
    const { t, id } = await withSecondVersion();
    const res = await approveWith(t, id, { expected_version: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "stale_version", expected_version: 1, current_version: 2 });
    const seen = (await t.get(id)).body;
    expect(seen).toMatchObject({ state: "awaiting_review", approved: null, current_version: 2 });
  });

  it("aprovação dirigida à v2 (a atual) passa e registra a versão aprovada", async () => {
    const { t, id } = await withSecondVersion();
    const res = await approveWith(t, id, { expected_version: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "approved", approved: { version: 2 } });
  });

  it("cliente antigo, sem o campo, continua decidindo sobre a versão atual", async () => {
    const { t, id } = await withSecondVersion();
    const res = await approveWith(t, id);
    expect(res.status).toBe(200);
    expect(res.body.approved.version).toBe(2);
  });

  it("o retry da aprovação já realizada continua inofensivo: mesma versão passa, outra versão é conflito", async () => {
    const { t, id } = await withSecondVersion();
    const first = await approveWith(t, id, { expected_version: 2 });
    t.set("2026-03-15T10:00:00.000Z");
    const retry = await approveWith(t, id, { expected_version: 2 });
    expect(retry.status).toBe(200);
    expect(retry.body.approved).toEqual(first.body.approved); // nem a data da aprovação muda
    const wrong = await approveWith(t, id, { expected_version: 1 });
    expect(wrong.status).toBe(409);
    expect(wrong.body).toMatchObject({ error: "stale_version", current_version: 2 });
    expect((await t.get(id)).body.approved).toEqual(first.body.approved);
    expect((await approveWith(t, id)).status).toBe(200); // e o retry sem o campo também
  });

  it("pedido de alteração dirigido à v1 depois da v2: 409 e nenhum pedido nasce", async () => {
    const { t, id } = await withSecondVersion();
    const res = await t.requestChanges(id, { reason: "sobre a v1", deadline_date: "2026-03-25", expected_version: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "stale_version", expected_version: 1, current_version: 2 });
    const seen = (await t.get(id)).body;
    expect(seen.state).toBe("awaiting_review");
    expect(seen.change_requests).toHaveLength(1); // só o primeiro
  });

  it("pedido de alteração com a versão certa passa e fica ligado a ela", async () => {
    const { t, id } = await withSecondVersion();
    const res = await t.requestChanges(id, { reason: "sobre a v2", deadline_date: "2026-03-25", expected_version: 2 });
    expect(res.status).toBe(201);
    expect(res.body.change_requests[1]).toMatchObject({ version_number: 2, status: "open" });
  });

  it("estado inválido continua tendo precedência: versão certa numa ação que o estado não permite é invalid_state", async () => {
    const { t, id } = await withSecondVersion();
    await t.requestChanges(id, { reason: "x", deadline_date: "2026-03-25" }); // agora em changes_requested
    const res = await approveWith(t, id, { expected_version: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("invalid_state");
  });

  it.each([0, -1, 1.5, "2", null, 2 ** 53])("expected_version inválido (%j) na aprovação é 400", async (value) => {
    const { t, id } = await withSecondVersion();
    const res = await approveWith(t, id, { expected_version: value });
    // null é "campo ausente": não é erro
    if (value === null) expect(res.status).toBe(200);
    else {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "validation_error", field: "expected_version" });
    }
  });

  it("expected_version inválido no pedido de alteração é 400", async () => {
    const { t, id } = await withSecondVersion();
    const res = await t.requestChanges(id, { reason: "x", deadline_date: "2026-03-25", expected_version: "um" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("expected_version");
  });

  it("a conferência é feita DENTRO da transação: a versão nova que nasce depois da leitura e antes da gravação é pega", async () => {
    // O app abre a transação; imediatamente antes, outra conexão pede alteração e envia a v2.
    const path = join(dir, "dentro.db");
    const seed = openDatabase(path);
    const created = createScript(seed, { id: "scr_1", missionId: "msn_1", content: "v1" }, () => new Date("2026-03-10T15:00:00.000Z"));
    if (!created.ok) throw new Error("preparação falhou");
    seed.close();

    const db = openDatabase(path);
    const other = openDatabase(path);
    let fired = false;
    const hooked = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === "exec") {
          return (sql: string) => {
            if (!fired && /^\s*BEGIN IMMEDIATE/i.test(sql)) {
              fired = true;
              const at = () => new Date("2026-03-11T10:00:00.000Z");
              requestChanges(other, { id: "scr_1", reason: "ajustar", deadlineDate: "2026-03-20" }, at);
              submitVersion(other, { id: "scr_1", content: "v2" }, at);
            }
            return target.exec(sql);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const app = createApp({ db: hooked, now: () => new Date("2026-03-12T10:00:00.000Z") });
    const res = await app.request("/scripts/scr_1/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_version: 1 }) });
    expect(fired).toBe(true);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "stale_version", current_version: 2 });
    expect(db.prepare("SELECT state FROM scripts WHERE id = 'scr_1'").get()).toEqual({ state: "awaiting_review" });
    db.close();
    other.close();
  });
});
