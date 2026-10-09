/**
 * Regra de qual toque (link) vence como origem de um cadastro. É o único lugar onde ela vive.
 *
 * - A janela de validade é medida a partir do PRIMEIRO OPEN do app: [first_open_at, first_open_at + 7 dias],
 *   com as duas pontas incluídas.
 * - Toque estritamente depois do cadastro não conta.
 * - Entre os toques válidos vence o MAIS RECENTE (último toque: é a intenção mais próxima do cadastro).
 * - Empate de horário: indicação vence campanha (vem de uma pessoa, é um sinal mais forte que um anúncio);
 *   persistindo o empate, vence o menor cid, e depois o menor id de entrega. Assim o resultado não
 *   depende da ordem em que os toques chegaram.
 * - O mesmo clique (mesmo cid) reenviado vale uma vez só: o primeiro conta, os outros são duplicate_click.
 * - Indicação cujo ref é o próprio usuário não vale (self_referral).
 */
export const ATTRIBUTION_WINDOW_DAYS = 7;
export const ATTRIBUTION_WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * A política desta regra, gravada junto de cada decisão. Se a regra mudar um dia (outra janela, outro critério), os
 * cadastros antigos continuam dizendo com qual política foram decididos, em vez de parecerem decididos pela nova.
 * Mudou a regra, sobe a `version`.
 */
export const POLICY = {
  version: 1,
  window_days: ATTRIBUTION_WINDOW_DAYS,
  selection: "last_valid_touch",
  tie_break: ["referral_over_campaign", "lowest_cid", "lowest_delivery_id"],
  signup_boundary: "inclusive",
  self_referral: "rejected",
} as const;

export type TouchSource = "campaign" | "referral";

export type Touch = { id: string; cid: string; src: TouchSource; ref: string; touchedAt: string };

export type Verdict = "winner" | "lost" | "rejected";

export type Considered = {
  touch_id: string;
  cid: string;
  src: TouchSource;
  ref: string;
  touched_at: string;
  verdict: Verdict;
  reason: string;
};

export type Origin =
  | { type: TouchSource; ref: string; touch_id: string; reason: string }
  | { type: "organic"; ref: null; touch_id: null; reason: "no_install" | "no_touches" | "all_touches_rejected" };

export type Decision = {
  origin: Origin;
  policy: typeof POLICY;
  window: { starts_at: string; ends_at: string; days: number } | null;
  considered: Considered[];
};

export type DecisionInput = {
  userId: string;
  firstOpenAt: string | null;
  signedUpAt: string;
  touches: Touch[];
};

const compareId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function byTimeThenId(a: Touch, b: Touch): number {
  return Date.parse(a.touchedAt) - Date.parse(b.touchedAt) || compareId(a.id, b.id);
}

/** Vence o mais recente; no empate, indicação, depois menor cid, depois menor id. */
function compareCandidates(a: Touch, b: Touch): number {
  const byTime = Date.parse(b.touchedAt) - Date.parse(a.touchedAt);
  if (byTime !== 0) return byTime;
  if (a.src !== b.src) return a.src === "referral" ? -1 : 1;
  if (a.cid !== b.cid) return a.cid < b.cid ? -1 : 1;
  return compareId(a.id, b.id);
}

function describe(touch: Touch, verdict: Verdict, reason: string): Considered {
  return {
    touch_id: touch.id,
    cid: touch.cid,
    src: touch.src,
    ref: touch.ref,
    touched_at: new Date(touch.touchedAt).toISOString(),
    verdict,
    reason,
  };
}

export function decideOrigin(input: DecisionInput): Decision {
  const ordered = [...input.touches].sort(byTimeThenId);
  const signedUp = Date.parse(input.signedUpAt);

  if (input.firstOpenAt === null) {
    return {
      origin: { type: "organic", ref: null, touch_id: null, reason: "no_install" },
      policy: POLICY,
      window: null,
      considered: ordered.map((t) => describe(t, "rejected", "no_install")),
    };
  }

  const firstOpen = Date.parse(input.firstOpenAt);
  const windowEnd = firstOpen + ATTRIBUTION_WINDOW_MS;
  const window = {
    starts_at: new Date(firstOpen).toISOString(),
    ends_at: new Date(windowEnd).toISOString(),
    days: ATTRIBUTION_WINDOW_DAYS,
  };

  const seenClicks = new Set<string>();
  const rejected = new Map<string, string>();
  const candidates: Touch[] = [];
  for (const touch of ordered) {
    const at = Date.parse(touch.touchedAt);
    if (seenClicks.has(touch.cid)) rejected.set(touch.id, "duplicate_click");
    else if (at < firstOpen) rejected.set(touch.id, "before_first_open");
    else if (at > signedUp) rejected.set(touch.id, "after_signup");
    else if (at > windowEnd) rejected.set(touch.id, "outside_window");
    else if (touch.src === "referral" && touch.ref === input.userId) rejected.set(touch.id, "self_referral");
    else candidates.push(touch);
    seenClicks.add(touch.cid);
  }

  const ranked = [...candidates].sort(compareCandidates);
  const winner = ranked[0];
  const reasons = new Map<string, { verdict: Verdict; reason: string }>();
  if (winner) {
    const runnerUp = ranked[1];
    let winnerReason = "latest_valid_touch";
    if (runnerUp && Date.parse(runnerUp.touchedAt) === Date.parse(winner.touchedAt)) {
      winnerReason = runnerUp.src !== winner.src ? "won_tiebreak_referral_priority" : "won_tiebreak_cid_order";
    }
    reasons.set(winner.id, { verdict: "winner", reason: winnerReason });
    for (const loser of ranked.slice(1)) {
      let reason = "superseded_by_later_touch";
      if (Date.parse(loser.touchedAt) === Date.parse(winner.touchedAt)) {
        reason = loser.src !== winner.src ? "lost_tiebreak_referral_priority" : "lost_tiebreak_cid_order";
      }
      reasons.set(loser.id, { verdict: "lost", reason });
    }
  }

  const considered = ordered.map((touch) => {
    const decided = reasons.get(touch.id);
    if (decided) return describe(touch, decided.verdict, decided.reason);
    return describe(touch, "rejected", rejected.get(touch.id) as string);
  });

  if (winner) {
    return {
      policy: POLICY,
      origin: {
        type: winner.src,
        ref: winner.ref,
        touch_id: winner.id,
        reason: (reasons.get(winner.id) as { reason: string }).reason,
      },
      window,
      considered,
    };
  }
  return {
    policy: POLICY,
    origin: {
      type: "organic",
      ref: null,
      touch_id: null,
      reason: input.touches.length === 0 ? "no_touches" : "all_touches_rejected",
    },
    window,
    considered,
  };
}
