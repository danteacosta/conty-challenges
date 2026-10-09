import { describe, expect, it } from "vitest";
import { D, H, setup } from "./helpers.ts";

describe("primeiro open", () => {
  it("o primeiro open vence: reenviar com outro horário não move a janela", async () => {
    const t = setup();
    const first = await t.install("ins_1", 0);
    const again = await t.install("ins_1", 3 * D);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ result: "duplicate", first_open_at: first.body.first_open_at });
  });
});

describe("cadastro consome a origem", () => {
  it("dois links antes do cadastro: a resposta mostra os dois toques e por que cada um venceu ou perdeu", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 1 * H);
    await t.touch("ins_1", "referral", "usr_ana", "clk_b", 5 * H);
    const res = await t.signup("usr_1", "ins_1", 1 * D);

    expect(res.status).toBe(201);
    expect(res.body.origin).toMatchObject({ type: "referral", ref: "usr_ana" });
    expect(res.body.window.days).toBe(7);
    expect(res.body.considered.map((c: any) => [c.cid, c.verdict, c.reason])).toEqual([
      ["clk_a", "lost", "superseded_by_later_touch"],
      ["clk_b", "winner", "latest_valid_touch"],
    ]);
  });

  it("cadastro sem nenhum toque fica orgânico com o motivo gravado", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    const res = await t.signup("usr_1", "ins_1", 1 * D);
    expect(res.body.origin).toEqual({ type: "organic", ref: null, touch_id: null, reason: "no_touches" });
    expect((await t.origin("usr_1")).body.origin.reason).toBe("no_touches");
  });

  it("cadastro de um app que nunca registrou o primeiro open fica orgânico por no_install", async () => {
    const t = setup();
    const res = await t.signup("usr_1", "ins_desconhecido", 1 * D);
    expect(res.body.origin).toMatchObject({ type: "organic", reason: "no_install" });
  });

  it("o mesmo clique enviado duas vezes não cria duas origens", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    const a = await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 1 * H);
    const b = await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 1 * H);
    expect(a.status).toBe(201);
    expect(b.body.result).toBe("repeated");

    const res = await t.signup("usr_1", "ins_1", 1 * D);
    expect(res.body.considered.filter((c: any) => c.verdict === "winner")).toHaveLength(1);
    expect(res.body.considered).toHaveLength(2);
    expect(res.body.considered[1]).toMatchObject({ verdict: "rejected", reason: "duplicate_click" });
  });

  it("toque fora da janela ou depois do cadastro não vence, e o cadastro vira orgânico com motivo", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    await t.touch("ins_1", "campaign", "antiga", "clk_a", 7 * D + 1);
    await t.touch("ins_1", "referral", "usr_ana", "clk_b", 9 * D);
    const res = await t.signup("usr_1", "ins_1", 8 * D);
    expect(res.body.origin).toEqual({ type: "organic", ref: null, touch_id: null, reason: "all_touches_rejected" });
    const reasons = Object.fromEntries(res.body.considered.map((c: any) => [c.cid, c.reason]));
    expect(reasons).toEqual({ clk_a: "outside_window", clk_b: "after_signup" });
  });

  it("o cadastro é idempotente por usuário e a origem não muda quando chega toque novo", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 1 * H);
    const first = await t.signup("usr_1", "ins_1", 1 * D);
    await t.touch("ins_1", "referral", "usr_ana", "clk_b", 2 * H); // chega depois do cadastro, com horário anterior a ele
    const again = await t.signup("usr_1", "ins_1", 1 * D);

    expect(again.status).toBe(200);
    expect(again.body.result).toBe("duplicate");
    expect(again.body.origin).toEqual(first.body.origin);
    expect(again.body.origin.ref).toBe("verao-2026");
  });

  it("toque que chega depois do cadastro aparece na auditoria como rejeitado, sem mudar a origem", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 1 * H);
    await t.signup("usr_1", "ins_1", 1 * D);
    await t.touch("ins_1", "referral", "usr_ana", "clk_b", 2 * D);
    await t.touch("ins_1", "referral", "usr_bia", "clk_c", 2 * H);

    const audit = (await t.origin("usr_1")).body;
    expect(audit.origin.ref).toBe("verao-2026");
    expect(audit.considered.map((c: any) => [c.cid, c.verdict, c.reason])).toEqual([
      ["clk_a", "winner", "latest_valid_touch"],
      ["clk_b", "rejected", "received_after_signup"],
      ["clk_c", "rejected", "received_after_signup"],
    ]);
  });

  it("auditoria de cadastro inexistente é 404", async () => {
    expect((await setup().origin("ninguem")).status).toBe(404);
  });

  it("valida o contrato de entrada", async () => {
    const t = setup();
    expect((await t.call("POST", "/installs", { install_id: "x", opened_at: "ontem" })).status).toBe(400);
    expect((await t.call("POST", "/touches", { install_id: "x", src: "outro", ref: "r", cid: "c", touched_at: "2026-06-01T12:00:00Z" })).status).toBe(400);
    expect((await t.call("POST", "/touches", { install_id: "x", src: "campaign", ref: "", cid: "c", touched_at: "2026-06-01T12:00:00Z" })).status).toBe(400);
    expect((await t.call("POST", "/signups", { user_id: "u", install_id: "x" })).status).toBe(400);
  });
});

describe("datas impossíveis", () => {
  const IMPOSSIBLE = "2026-02-30T10:00:00Z";

  it("o primeiro open com 30 de fevereiro é recusado e não grava nada", async () => {
    const t = setup();
    expect((await t.call("POST", "/installs", { install_id: "ins_1", opened_at: IMPOSSIBLE })).status).toBe(400);
    const signup = await t.signup("usr_1", "ins_1", 1 * D);
    expect(signup.body.origin).toMatchObject({ type: "organic", reason: "no_install" });
  });

  it("o toque com data impossível é recusado", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    const res = await t.call("POST", "/touches", { install_id: "ins_1", src: "campaign", ref: "verao", cid: "clk_a", touched_at: IMPOSSIBLE });
    expect(res.status).toBe(400);
    expect((await t.signup("usr_1", "ins_1", 1 * D)).body.origin.reason).toBe("no_touches");
  });

  it("o cadastro com data impossível é recusado e o usuário continua sem cadastro", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    expect((await t.call("POST", "/signups", { user_id: "usr_1", install_id: "ins_1", signed_up_at: IMPOSSIBLE })).status).toBe(400);
    expect((await t.origin("usr_1")).status).toBe(404);
  });

  it("29 de fevereiro de ano bissexto continua válido", async () => {
    const t = setup();
    expect((await t.call("POST", "/installs", { install_id: "ins_1", opened_at: "2024-02-29T10:00:00Z" })).status).toBe(201);
  });
});

describe("o clique original é o canônico", () => {
  async function withOriginalClick() {
    const t = setup();
    await t.install("ins_1", 0);
    const original = await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 5 * H);
    expect(original.status).toBe(201);
    return t;
  }

  it("reenvio idêntico continua sendo um reenvio inofensivo", async () => {
    const t = await withOriginalClick();
    const again = await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 5 * H);
    expect(again).toMatchObject({ status: 200, body: { result: "repeated" } });
  });

  it("o mesmo cid com horário mais antigo (antes do primeiro open) é recusado e não invalida o clique original", async () => {
    const t = await withOriginalClick();
    const conflict = await t.touch("ins_1", "campaign", "verao-2026", "clk_a", -1 * H);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({
      error: "cid_conflict",
      canonical: { src: "campaign", ref: "verao-2026", touched_at: expect.stringMatching(/T17:00:00\.000Z$/) },
    });

    const signup = await t.signup("usr_1", "ins_1", 1 * D);
    expect(signup.body.origin).toMatchObject({ type: "campaign", ref: "verao-2026", reason: "latest_valid_touch" });
    expect(signup.body.considered).toHaveLength(1);
  });

  it.each([
    ["outro ref", "campaign", "outra-campanha", 5 * H],
    ["outro tipo", "referral", "verao-2026", 5 * H],
    ["outro horário, depois", "campaign", "verao-2026", 6 * H],
  ])("o mesmo cid com %s é recusado e nada é gravado", async (_name, src, ref, ms) => {
    const t = await withOriginalClick();
    expect((await t.touch("ins_1", src, ref, "clk_a", ms)).status).toBe(409);
    const signup = await t.signup("usr_1", "ins_1", 1 * D);
    expect(signup.body.considered).toHaveLength(1);
    expect(signup.body.origin).toMatchObject({ type: "campaign", ref: "verao-2026" });
  });

  it("o mesmo cid em outro app (outra instalação) é outro clique e não conflita", async () => {
    const t = await withOriginalClick();
    await t.install("ins_2", 0);
    expect((await t.touch("ins_2", "referral", "usr_ana", "clk_a", 2 * H)).status).toBe(201);
  });

  it("um clique conflitante que chega depois do cadastro também é recusado, sem aparecer como toque", async () => {
    const t = await withOriginalClick();
    await t.signup("usr_1", "ins_1", 1 * D);
    expect((await t.touch("ins_1", "referral", "usr_ana", "clk_a", 2 * H)).status).toBe(409);
    expect((await t.origin("usr_1")).body.considered).toHaveLength(1);
  });
});

describe("a política fica gravada com a decisão", () => {
  it("a resposta do cadastro e a auditoria trazem a política usada", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 1 * H);
    const signup = await t.signup("usr_1", "ins_1", 1 * D);
    expect(signup.body.policy).toEqual({
      version: 1,
      window_days: 7,
      selection: "last_valid_touch",
      tie_break: ["referral_over_campaign", "lowest_cid", "lowest_delivery_id"],
      signup_boundary: "inclusive",
      self_referral: "rejected",
    });
    expect((await t.origin("usr_1")).body.policy).toEqual(signup.body.policy);
  });

  it("a política gravada é a da época da decisão: mudar a regra depois não reescreve cadastros antigos", async () => {
    const t = setup();
    await t.install("ins_1", 0);
    await t.signup("usr_1", "ins_1", 1 * D);
    // simula um cadastro decidido por uma política anterior (janela de 3 dias, versão 0)
    const row = t.db.prepare("SELECT decision_json FROM signups WHERE user_id = 'usr_1'").get() as { decision_json: string };
    const old = JSON.parse(row.decision_json);
    old.policy = { ...old.policy, version: 0, window_days: 3 };
    t.db.prepare("UPDATE signups SET decision_json = ? WHERE user_id = 'usr_1'").run(JSON.stringify(old));

    const audit = (await t.origin("usr_1")).body;
    expect(audit.policy).toMatchObject({ version: 0, window_days: 3 });
    expect((await t.signup("usr_1", "ins_1", 1 * D)).body.policy).toMatchObject({ version: 0, window_days: 3 });
  });
});

describe("cadastro repetido: replay igual devolve a decisão, cadastro diferente é conflito", () => {
  async function registered() {
    const t = setup();
    await t.install("ins_1", 0);
    await t.install("ins_2", 0);
    await t.touch("ins_1", "campaign", "verao-2026", "clk_a", 1 * H);
    await t.touch("ins_2", "referral", "usr_ana", "clk_b", 2 * H);
    const first = await t.signup("usr_1", "ins_1", 1 * D);
    expect(first.status).toBe(201);
    return { t, first };
  }

  it("o mesmo cadastro de novo é um replay: 200 com a decisão original", async () => {
    const { t, first } = await registered();
    const again = await t.signup("usr_1", "ins_1", 1 * D);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ result: "duplicate", origin: first.body.origin });
  });

  it("o mesmo instante escrito com outro offset ainda é o mesmo cadastro", async () => {
    const { t } = await registered();
    const sameInstant = new Date(Date.parse("2026-06-01T12:00:00.000Z") + 1 * D).toISOString().replace("Z", "+00:00");
    const again = await t.call("POST", "/signups", { user_id: "usr_1", install_id: "ins_1", signed_up_at: sameInstant });
    expect(again.status).toBe(200);
    expect(again.body.result).toBe("duplicate");
  });

  it("o mesmo usuário com OUTRA instalação é conflito (409), e a decisão original não muda", async () => {
    const { t, first } = await registered();
    const conflict = await t.signup("usr_1", "ins_2", 1 * D);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({
      error: "signup_conflict",
      recorded: { install_id: "ins_1", signed_up_at: "2026-06-02T12:00:00.000Z" },
      origin: first.body.origin,
    });
    expect((await t.origin("usr_1")).body.origin).toEqual(first.body.origin);
  });

  it("o mesmo usuário e instalação com OUTRO horário de cadastro é conflito (409)", async () => {
    const { t } = await registered();
    const conflict = await t.signup("usr_1", "ins_1", 2 * D);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("signup_conflict");
    expect(conflict.body.recorded).toMatchObject({ install_id: "ins_1", signed_up_at: "2026-06-02T12:00:00.000Z" });
  });

  it("o conflito não grava nada e não conta como toque ou cadastro novo", async () => {
    const { t } = await registered();
    await t.signup("usr_1", "ins_2", 1 * D);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM signups").get()).toEqual({ n: 1 });
    expect((await t.origin("usr_1")).body.considered).toHaveLength(1);
  });

  it("dois usuários diferentes na mesma instalação continuam possíveis: cada um recebe a sua decisão", async () => {
    const { t } = await registered();
    expect((await t.signup("usr_2", "ins_1", 1 * D)).status).toBe(201);
  });
});
