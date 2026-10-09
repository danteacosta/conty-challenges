import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ATTRIBUTION_WINDOW_MS, POLICY, decideOrigin, type Touch } from "../src/decide-origin.ts";

const T0 = Date.parse("2026-06-01T12:00:00.000Z"); // primeiro open
const at = (ms: number) => new Date(T0 + ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

let seq = 0;
const touch = (over: Partial<Touch> & { ms: number }): Touch => {
  seq += 1;
  const { ms, ...rest } = over;
  return { id: String(seq), cid: `c${seq}`, src: "campaign", ref: "verao", touchedAt: at(ms), ...rest };
};
const decide = (touches: Touch[], over: { signedUpMs?: number; firstOpen?: boolean; userId?: string } = {}) =>
  decideOrigin({
    userId: over.userId ?? "usr_novo",
    firstOpenAt: over.firstOpen === false ? null : at(0),
    signedUpAt: at(over.signedUpMs ?? 2 * D),
    touches,
  });
const verdictOf = (d: ReturnType<typeof decide>, id: string) => d.considered.find((c) => c.touch_id === id)!;

describe("decideOrigin: qual toque vence", () => {
  it("com dois links antes do cadastro, vence o mais recente e o outro registra o motivo", () => {
    const a = touch({ ms: 1 * H, ref: "verao" });
    const b = touch({ ms: 5 * H, src: "referral", ref: "usr_ana" });
    const d = decide([a, b]);
    expect(d.origin).toMatchObject({ type: "referral", ref: "usr_ana", touch_id: b.id });
    expect(verdictOf(d, b.id)).toMatchObject({ verdict: "winner", reason: "latest_valid_touch" });
    expect(verdictOf(d, a.id)).toMatchObject({ verdict: "lost", reason: "superseded_by_later_touch" });
  });

  it("empate de horário entre indicação e campanha: a indicação vence", () => {
    const camp = touch({ ms: 3 * H, src: "campaign", ref: "verao" });
    const ref = touch({ ms: 3 * H, src: "referral", ref: "usr_ana" });
    const d = decide([camp, ref]);
    expect(d.origin).toMatchObject({ type: "referral", touch_id: ref.id });
    expect(verdictOf(d, ref.id)).toMatchObject({ verdict: "winner", reason: "won_tiebreak_referral_priority" });
    expect(verdictOf(d, camp.id)).toMatchObject({ verdict: "lost", reason: "lost_tiebreak_referral_priority" });
  });

  it("empate de horário entre toques do mesmo tipo: vence o menor cid, qualquer que seja a ordem de chegada", () => {
    const x = touch({ ms: 3 * H, cid: "aaa", ref: "c1" });
    const y = touch({ ms: 3 * H, cid: "bbb", ref: "c2" });
    expect(decide([x, y]).origin).toMatchObject({ ref: "c1" });
    expect(decide([y, x]).origin).toMatchObject({ ref: "c1" });
    expect(verdictOf(decide([x, y]), y.id)).toMatchObject({ verdict: "lost", reason: "lost_tiebreak_cid_order" });
    expect(verdictOf(decide([x, y]), x.id)).toMatchObject({ verdict: "winner", reason: "won_tiebreak_cid_order" });
  });

  it("um toque só vence por ser o último válido", () => {
    const only = touch({ ms: 1 * H });
    const d = decide([only]);
    expect(d.origin).toMatchObject({ type: "campaign", ref: "verao", touch_id: only.id });
    expect(d.considered).toHaveLength(1);
  });
});

describe("decideOrigin: desempates sem depender da ordem de chegada", () => {
  it("a indicação mais antiga perde para a campanha mais recente: prioridade de tipo só vale em empate de horário", () => {
    const oldReferral = touch({ ms: 1 * H, src: "referral", ref: "usr_ana" });
    const newCampaign = touch({ ms: 2 * H, src: "campaign", ref: "verao" });
    const d = decide([oldReferral, newCampaign]);
    expect(d.origin).toMatchObject({ type: "campaign", touch_id: newCampaign.id });
    expect(verdictOf(d, oldReferral.id).reason).toBe("superseded_by_later_touch");
  });

  it("empate de horário e tipo: o cid menor vence mesmo quando chegou depois (id maior)", () => {
    const bbb = touch({ ms: 3 * H, cid: "bbb", ref: "primeiro-a-chegar" });
    const aaa = touch({ ms: 3 * H, cid: "aaa", ref: "ultimo-a-chegar" });
    expect(decide([bbb, aaa]).origin).toMatchObject({ ref: "ultimo-a-chegar" });
    expect(decide([aaa, bbb]).origin).toMatchObject({ ref: "ultimo-a-chegar" });
  });

  it("empate de horário entre campanha (chegou primeiro) e indicação (chegou depois): indicação vence, em qualquer ordem", () => {
    const camp = touch({ ms: 3 * H, src: "campaign", cid: "aaa" });
    const ref = touch({ ms: 3 * H, src: "referral", cid: "zzz", ref: "usr_ana" });
    expect(decide([camp, ref]).origin).toMatchObject({ type: "referral" });
    expect(decide([ref, camp]).origin).toMatchObject({ type: "referral" });
  });

  it("empate de horário em que a indicação chegou primeiro (id menor) e a campanha depois: a indicação continua vencendo", () => {
    const ref = touch({ ms: 3 * H, src: "referral", cid: "zzz", ref: "usr_ana" });
    const camp = touch({ ms: 3 * H, src: "campaign", cid: "aaa" });
    expect(decide([ref, camp]).origin).toMatchObject({ type: "referral", touch_id: ref.id });
    expect(verdictOf(decide([ref, camp]), camp.id).reason).toBe("lost_tiebreak_referral_priority");
  });

  it("a ordem de entrega é numérica: o id 10 vem depois do 9 na auditoria", () => {
    const nine = { ...touch({ ms: 3 * H, cid: "k9" }), id: "9" };
    const ten = { ...touch({ ms: 3 * H, cid: "k10" }), id: "10" };
    expect(decide([ten, nine]).considered.map((c) => c.touch_id)).toEqual(["9", "10"]);
  });

  it("campanha cujo ref coincide com o id do usuário continua valendo: auto-indicação só existe para indicação", () => {
    const camp = touch({ ms: 1 * H, src: "campaign", ref: "usr_novo" });
    expect(decide([camp]).origin).toMatchObject({ type: "campaign", touch_id: camp.id });
  });
});

describe("decideOrigin: janela de validade medida do primeiro open", () => {
  it("expõe a janela explícita: de first_open_at até first_open_at + 7 dias", () => {
    const d = decide([]);
    expect(ATTRIBUTION_WINDOW_MS).toBe(7 * D);
    expect(d.window).toEqual({ starts_at: at(0), ends_at: at(7 * D), days: 7 });
  });

  it("toque exatamente no primeiro open e exatamente no fim da janela valem", () => {
    const start = touch({ ms: 0 });
    const end = touch({ ms: 7 * D });
    expect(decide([start], { signedUpMs: 8 * D }).origin).toMatchObject({ touch_id: start.id });
    expect(decide([end], { signedUpMs: 8 * D }).origin).toMatchObject({ touch_id: end.id });
  });

  it("toque 1 ms depois da janela não vence", () => {
    const late = touch({ ms: 7 * D + 1 });
    const d = decide([late], { signedUpMs: 8 * D });
    expect(verdictOf(d, late.id)).toMatchObject({ verdict: "rejected", reason: "outside_window" });
    expect(d.origin).toMatchObject({ type: "organic", reason: "all_touches_rejected" });
  });

  it("toque 1 ms antes do primeiro open não vence", () => {
    const early = touch({ ms: -1 });
    expect(verdictOf(decide([early]), early.id)).toMatchObject({ verdict: "rejected", reason: "before_first_open" });
  });

  it("a janela conta do primeiro open, não do cadastro: cadastro tardio não estende a janela", () => {
    const t = touch({ ms: 6 * D });
    const d = decide([t], { signedUpMs: 20 * D });
    expect(d.origin).toMatchObject({ touch_id: t.id });
    const tooLate = touch({ ms: 10 * D });
    expect(decide([tooLate], { signedUpMs: 20 * D }).origin.type).toBe("organic");
  });
});

describe("decideOrigin: cadastro, clique repetido e auto-indicação", () => {
  it("toque depois do cadastro não vence, mesmo sendo o mais recente", () => {
    const before = touch({ ms: 1 * D, ref: "antes" });
    const after = touch({ ms: 2 * D + 1, ref: "depois" });
    const d = decide([before, after], { signedUpMs: 2 * D });
    expect(d.origin).toMatchObject({ ref: "antes" });
    expect(verdictOf(d, after.id)).toMatchObject({ verdict: "rejected", reason: "after_signup" });
  });

  it("toque no mesmo instante do cadastro conta (só estritamente depois fica de fora)", () => {
    const same = touch({ ms: 2 * D });
    expect(decide([same], { signedUpMs: 2 * D }).origin).toMatchObject({ touch_id: same.id });
  });

  it("o mesmo clique (cid) reenviado não cria duas origens: o primeiro conta e os demais viram duplicate_click", () => {
    const first = touch({ ms: 1 * H, cid: "dup" });
    const again = touch({ ms: 1 * H, cid: "dup" });
    const retry = touch({ ms: 2 * H, cid: "dup" });
    const d = decide([retry, again, first]);
    expect(d.considered.filter((c) => c.verdict === "winner")).toHaveLength(1);
    expect(d.origin).toMatchObject({ touch_id: first.id });
    expect(verdictOf(d, again.id)).toMatchObject({ verdict: "rejected", reason: "duplicate_click" });
    expect(verdictOf(d, retry.id)).toMatchObject({ verdict: "rejected", reason: "duplicate_click" });
  });

  it("indicação do próprio usuário não vale", () => {
    const self = touch({ ms: 1 * H, src: "referral", ref: "usr_novo" });
    const other = touch({ ms: 0, src: "campaign", ref: "verao" });
    const d = decide([self, other]);
    expect(verdictOf(d, self.id)).toMatchObject({ verdict: "rejected", reason: "self_referral" });
    expect(d.origin).toMatchObject({ type: "campaign", touch_id: other.id });
  });
});

describe("decideOrigin: a política vai gravada na decisão", () => {
  it("descreve a regra que decidiu: janela, critério de escolha, desempates e fronteira do cadastro", () => {
    expect(POLICY).toEqual({
      version: 1,
      window_days: 7,
      selection: "last_valid_touch",
      tie_break: ["referral_over_campaign", "lowest_cid", "lowest_delivery_id"],
      signup_boundary: "inclusive",
      self_referral: "rejected",
    });
  });

  it("toda decisão carrega a política, seja vencedor, orgânico por falta de toque ou por falta de install", () => {
    const winner = decide([touch({ ms: 1 * H })]);
    const noTouches = decide([]);
    const noInstall = decide([touch({ ms: 1 * H })], { firstOpen: false });
    for (const d of [winner, noTouches, noInstall]) expect(d.policy).toEqual(POLICY);
  });

  it("a janela declarada na política é a mesma que a decisão usou", () => {
    const d = decide([]);
    expect(d.policy.window_days).toBe(d.window?.days);
    expect(d.policy.window_days * D).toBe(ATTRIBUTION_WINDOW_MS);
  });
});

describe("decideOrigin: orgânico sempre com motivo", () => {
  it("sem primeiro open conhecido", () => {
    expect(decide([], { firstOpen: false }).origin).toEqual({ type: "organic", ref: null, touch_id: null, reason: "no_install" });
  });
  it("sem nenhum toque", () => {
    expect(decide([]).origin).toEqual({ type: "organic", ref: null, touch_id: null, reason: "no_touches" });
  });
  it("só toques inválidos", () => {
    const d = decide([touch({ ms: 9 * D })], { signedUpMs: 10 * D });
    expect(d.origin).toEqual({ type: "organic", ref: null, touch_id: null, reason: "all_touches_rejected" });
  });
  it("toques sem primeiro open conhecido aparecem rejeitados na auditoria", () => {
    const t = touch({ ms: 1 * H });
    const d = decide([t], { firstOpen: false });
    expect(d.window).toBeNull();
    expect(verdictOf(d, t.id)).toMatchObject({ verdict: "rejected", reason: "no_install" });
  });
});

describe("decideOrigin: propriedades", () => {
  const rawTouchArb = fc.record({
    ms: fc.integer({ min: -2 * D, max: 9 * D }),
    src: fc.constantFrom("campaign" as const, "referral" as const),
    ref: fc.constantFrom("a", "b", "usr_novo"),
    cid: fc.constantFrom("c1", "c2", "c3", "c4"),
  });
  const touchesArb = fc
    .array(rawTouchArb, { maxLength: 7 })
    .map((raws): Touch[] => raws.map((r, i) => ({ id: String(i), cid: r.cid, src: r.src, ref: r.ref, touchedAt: at(r.ms) })));

  it("a decisão não depende da ordem em que os toques chegam, exceto para o clique repetido, que vale o primeiro", () => {
    fc.assert(
      fc.property(touchesArb, fc.integer({ min: 0, max: 10 * D }), (touches, signedUpMs) => {
        // cids únicos para isolar a propriedade da regra de duplicidade
        const unique = touches.map((t, i) => ({ ...t, cid: `u${i}` }));
        const a = decide(unique, { signedUpMs });
        const b = decide([...unique].reverse(), { signedUpMs });
        expect(b.origin).toEqual(a.origin);
      }),
    );
  });

  it("no máximo um vencedor, e o vencedor sempre está dentro da janela e antes do cadastro", () => {
    fc.assert(
      fc.property(touchesArb, fc.integer({ min: 0, max: 10 * D }), (touches, signedUpMs) => {
        const d = decide(touches, { signedUpMs });
        const winners = d.considered.filter((c) => c.verdict === "winner");
        expect(winners.length).toBeLessThanOrEqual(1);
        expect(d.considered).toHaveLength(touches.length);
        expect(d.considered.every((c) => c.reason.length > 0)).toBe(true);
        if (winners[0]) {
          const ms = Date.parse(winners[0].touched_at) - T0;
          expect(ms).toBeGreaterThanOrEqual(0);
          expect(ms).toBeLessThanOrEqual(Math.min(7 * D, signedUpMs));
          expect(d.origin.type).not.toBe("organic");
        } else {
          expect(d.origin.type).toBe("organic");
        }
      }),
    );
  });
});
