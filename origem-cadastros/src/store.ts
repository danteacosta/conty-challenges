import type { DatabaseSync } from "node:sqlite";
import { decideOrigin, type Considered, type Decision, type Touch, type TouchSource } from "./decide-origin.ts";
import { inTransaction } from "./db.ts";

type TouchRow = { id: number; install_id: string; cid: string; src: TouchSource; ref: string; touched_at: string };

const toTouch = (row: TouchRow): Touch => ({
  id: String(row.id),
  cid: row.cid,
  src: row.src,
  ref: row.ref,
  touchedAt: row.touched_at,
});

export function recordInstall(db: DatabaseSync, installId: string, openedAt: string) {
  const inserted = db
    .prepare("INSERT INTO installs (install_id, first_open_at) VALUES (?, ?) ON CONFLICT(install_id) DO NOTHING")
    .run(installId, openedAt);
  const row = db.prepare("SELECT first_open_at FROM installs WHERE install_id = ?").get(installId) as {
    first_open_at: string;
  };
  return { result: inserted.changes === 1 ? ("created" as const) : ("duplicate" as const), first_open_at: row.first_open_at };
}

export type TouchOutcome =
  | { result: "recorded" | "repeated"; touch_id: string }
  | { result: "conflict"; canonical: { src: TouchSource; ref: string; touched_at: string } };

/**
 * O primeiro payload recebido de (install_id, cid) é o canônico. O mesmo clique reenviado igual é um reenvio
 * inofensivo (fica no log e aparece na auditoria como duplicate_click); reenviado com src, ref ou horário diferentes
 * é rejeitado e não é gravado, para um reenvio defeituoso não reescrever nem invalidar o clique original.
 */
export function recordTouch(
  db: DatabaseSync,
  touch: { installId: string; cid: string; src: TouchSource; ref: string; touchedAt: string },
  receivedAt: string,
): TouchOutcome {
  return inTransaction(db, () => {
    const canonical = db
      .prepare("SELECT src, ref, touched_at FROM touches WHERE install_id = ? AND cid = ? ORDER BY id LIMIT 1")
      .get(touch.installId, touch.cid) as { src: TouchSource; ref: string; touched_at: string } | undefined;
    if (canonical && (canonical.src !== touch.src || canonical.ref !== touch.ref || canonical.touched_at !== touch.touchedAt)) {
      return { result: "conflict" as const, canonical };
    }
    const inserted = db
      .prepare("INSERT INTO touches (install_id, cid, src, ref, touched_at, received_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(touch.installId, touch.cid, touch.src, touch.ref, touch.touchedAt, receivedAt);
    return { result: canonical ? ("repeated" as const) : ("recorded" as const), touch_id: String(inserted.lastInsertRowid) };
  });
}

export type SignupView = { user_id: string } & Decision;

function storedView(db: DatabaseSync, userId: string): SignupView | null {
  const row = db.prepare("SELECT * FROM signups WHERE user_id = ?").get(userId) as
    | { install_id: string; decision_json: string; considered_up_to: number }
    | undefined;
  if (!row) return null;
  const decision = JSON.parse(row.decision_json) as Decision;
  const late = db
    .prepare("SELECT * FROM touches WHERE install_id = ? AND id > ? ORDER BY id")
    .all(row.install_id, row.considered_up_to) as TouchRow[];
  const lateConsidered: Considered[] = late.map((t) => ({
    touch_id: String(t.id),
    cid: t.cid,
    src: t.src,
    ref: t.ref,
    touched_at: t.touched_at,
    verdict: "rejected",
    reason: "received_after_signup",
  }));
  return { user_id: userId, ...decision, considered: [...decision.considered, ...lateConsidered] };
}

export function signUp(db: DatabaseSync, input: { userId: string; installId: string; signedUpAt: string }) {
  return inTransaction(db, () => {
    const existing = storedView(db, input.userId);
    if (existing) {
      // Replay igual devolve a decisão. Mesmo usuário com outra instalação ou outro horário de cadastro NÃO é replay: é
      // um pedido diferente que o primeiro cadastro não cobre, e responder com a decisão antiga esconderia isso.
      const recorded = db.prepare("SELECT install_id, signed_up_at FROM signups WHERE user_id = ?").get(input.userId) as {
        install_id: string;
        signed_up_at: string;
      };
      if (recorded.install_id !== input.installId || recorded.signed_up_at !== input.signedUpAt) {
        return { result: "conflict" as const, view: existing, recorded };
      }
      return { result: "duplicate" as const, view: existing };
    }

    const install = db.prepare("SELECT first_open_at FROM installs WHERE install_id = ?").get(input.installId) as
      | { first_open_at: string }
      | undefined;
    const rows = db.prepare("SELECT * FROM touches WHERE install_id = ? ORDER BY id").all(input.installId) as TouchRow[];
    const decision = decideOrigin({
      userId: input.userId,
      firstOpenAt: install?.first_open_at ?? null,
      signedUpAt: input.signedUpAt,
      touches: rows.map(toTouch),
    });
    db.prepare(
      `INSERT INTO signups (user_id, install_id, signed_up_at, origin_type, origin_ref, origin_reason, decision_json, considered_up_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.userId,
      input.installId,
      input.signedUpAt,
      decision.origin.type,
      decision.origin.ref,
      decision.origin.reason,
      JSON.stringify(decision),
      rows.at(-1)?.id ?? 0,
    );
    return { result: "created" as const, view: { user_id: input.userId, ...decision } };
  });
}

export const getSignupAudit = storedView;
