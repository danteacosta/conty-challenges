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
