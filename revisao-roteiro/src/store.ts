import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";
import { isDeadlineInPast, isLateFor } from "./domain/deadline.ts";
import { allowedActions, nextState, type Action, type State } from "./domain/transitions.ts";

type ScriptRow = {
  id: string;
  mission_id: string;
  state: State;
  created_at: string;
  approved_at: string | null;
  approved_version: number | null;
};
type VersionRow = { number: number; content: string; submitted_at: string; late: number };
type RequestRow = {
  id: number;
  version_number: number;
  reason: string;
  deadline_date: string;
  created_at: string;
  answered_by_version: number | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
};

export type FailureCode = "not_found" | "invalid_state" | "script_approved" | "deadline_in_past" | "mission_already_has_script" | "stale_round" | "submission_conflict" | "round_cancelled" | "request_not_open";
export type Failure = { ok: false; code: FailureCode; state?: State; allowed_actions?: Action[]; open_change_request_id?: number };
export type ScriptView = ReturnType<typeof toView>;
export type Submission = { id: string; version: number; replayed: boolean };
export type Outcome = { ok: true; view: ScriptView; submission?: Submission } | Failure;

function toView(db: DatabaseSync, script: ScriptRow) {
  const versions = db.prepare("SELECT * FROM script_versions WHERE script_id = ? ORDER BY number").all(script.id) as VersionRow[];
  const requests = db.prepare("SELECT * FROM change_requests WHERE script_id = ? ORDER BY id").all(script.id) as RequestRow[];
  return {
    id: script.id,
    mission_id: script.mission_id,
    state: script.state,
    allowed_actions: allowedActions(script.state),
    current_version: versions.length,
    approved: script.approved_at === null ? null : { version: script.approved_version as number, approved_at: script.approved_at },
    versions: versions.map((v) => ({ number: v.number, content: v.content, submitted_at: v.submitted_at, late: v.late === 1 })),
    change_requests: requests.map((r) => ({
      id: r.id,
      version_number: r.version_number,
      reason: r.reason,
      deadline_date: r.deadline_date,
      created_at: r.created_at,
      answered_by_version: r.answered_by_version,
      status: r.cancelled_at !== null ? ("cancelled" as const) : r.answered_by_version !== null ? ("answered" as const) : ("open" as const),
      cancellation: r.cancelled_at === null ? null : { at: r.cancelled_at, by: r.cancelled_by, reason: r.cancel_reason },
    })),
  };
}

const find = (db: DatabaseSync, id: string) => db.prepare("SELECT * FROM scripts WHERE id = ?").get(id) as ScriptRow | undefined;

/** Falha por estado: aprovado responde com o motivo próprio; os demais dizem o estado atual e o que se pode fazer. */
function stateFailure(script: ScriptRow): Failure {
  return {
    ok: false,
    code: script.state === "approved" ? "script_approved" : "invalid_state",
    state: script.state,
    allowed_actions: allowedActions(script.state),
  };
}

export function getScript(db: DatabaseSync, id: string): Outcome {
  const script = find(db, id);
  return script ? { ok: true, view: toView(db, script) } : { ok: false, code: "not_found" };
}

export function createScript(db: DatabaseSync, input: { id: string; missionId: string; content: string }, now: () => Date): Outcome {
  return inTransaction(db, () => {
    const at = now().toISOString();
    const inserted = db
      .prepare("INSERT INTO scripts (id, mission_id, state, created_at) VALUES (?, ?, 'awaiting_review', ?) ON CONFLICT(mission_id) DO NOTHING")
      .run(input.id, input.missionId, at);
    if (inserted.changes === 0) return { ok: false, code: "mission_already_has_script" } as const;
    db.prepare("INSERT INTO script_versions (script_id, number, content, submitted_at, late) VALUES (?, 1, ?, ?, 0)").run(input.id, input.content, at);
    return { ok: true, view: toView(db, find(db, input.id) as ScriptRow) } as const;
  });
}

export function requestChanges(db: DatabaseSync, input: { id: string; reason: string; deadlineDate: string }, now: () => Date): Outcome {
  return inTransaction(db, () => {
    const script = find(db, input.id);
    if (!script) return { ok: false, code: "not_found" } as const;
    const target = nextState(script.state, "request_changes");
    if (target === null) return stateFailure(script);
    const current = now();
    if (isDeadlineInPast(input.deadlineDate, current)) return { ok: false, code: "deadline_in_past" } as const;

    const version = (db.prepare("SELECT MAX(number) AS n FROM script_versions WHERE script_id = ?").get(script.id) as { n: number }).n;
    db.prepare("INSERT INTO change_requests (script_id, version_number, reason, deadline_date, created_at) VALUES (?, ?, ?, ?, ?)").run(
      script.id,
      version,
      input.reason,
      input.deadlineDate,
      current.toISOString(),
    );
    db.prepare("UPDATE scripts SET state = ? WHERE id = ?").run(target, script.id);
    return { ok: true, view: toView(db, find(db, script.id) as ScriptRow) } as const;
  });
}

/**
 * Envia a versão nova. `changeRequestId` declara a rodada que o envio responde: se não for a que está aberta, é `stale_round`
 * (um retry atrasado não responde à rodada seguinte). `submissionId` torna o envio repetível: o mesmo id com o mesmo conteúdo
 * e a mesma rodada devolve a versão original, em qualquer estado do roteiro; com outro conteúdo ou rodada é `submission_conflict`.
 */
export function submitVersion(
  db: DatabaseSync,
  input: { id: string; content: string; changeRequestId?: number; submissionId?: string },
  now: () => Date,
): Outcome {
  return inTransaction(db, () => {
    const script = find(db, input.id);
    if (!script) return { ok: false, code: "not_found" } as const;

    if (input.submissionId !== undefined) {
      const previous = db
        .prepare("SELECT content, change_request_id, version_number FROM script_submissions WHERE script_id = ? AND submission_id = ?")
        .get(script.id, input.submissionId) as { content: string; change_request_id: number | null; version_number: number } | undefined;
      if (previous) {
        const same = previous.content === input.content && previous.change_request_id === (input.changeRequestId ?? null);
        if (!same) return { ok: false, code: "submission_conflict" } as const;
        return { ok: true, view: toView(db, script), submission: { id: input.submissionId, version: previous.version_number, replayed: true } } as const;
      }
    }

    const target = nextState(script.state, "submit_version");
    if (target === null) return stateFailure(script);

    const current = now();
    const open = db
      .prepare("SELECT id, deadline_date FROM change_requests WHERE script_id = ? AND answered_by_version IS NULL AND cancelled_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(script.id) as { id: number; deadline_date: string };
    if (input.changeRequestId !== undefined && input.changeRequestId !== open.id) {
      const declared = db.prepare("SELECT cancelled_at FROM change_requests WHERE id = ? AND script_id = ?").get(input.changeRequestId, script.id) as { cancelled_at: string | null } | undefined;
      const code = declared?.cancelled_at ? "round_cancelled" : "stale_round";
      return { ok: false, code, open_change_request_id: open.id } as const;
    }
    const next = (db.prepare("SELECT MAX(number) AS n FROM script_versions WHERE script_id = ?").get(script.id) as { n: number }).n + 1;
    db.prepare("INSERT INTO script_versions (script_id, number, content, submitted_at, late) VALUES (?, ?, ?, ?, ?)").run(
      script.id,
      next,
      input.content,
      current.toISOString(),
      isLateFor(open.deadline_date, current) ? 1 : 0,
    );
    db.prepare("UPDATE change_requests SET answered_by_version = ? WHERE id = ?").run(next, open.id);
    db.prepare("UPDATE scripts SET state = ? WHERE id = ?").run(target, script.id);
    if (input.submissionId !== undefined) {
      db.prepare("INSERT INTO script_submissions (script_id, submission_id, content, change_request_id, version_number) VALUES (?, ?, ?, ?, ?)").run(
        script.id,
        input.submissionId,
        input.content,
        input.changeRequestId ?? null,
        next,
      );
    }
    const view = toView(db, find(db, script.id) as ScriptRow);
    return input.submissionId === undefined
      ? ({ ok: true, view } as const)
      : ({ ok: true, view, submission: { id: input.submissionId, version: next, replayed: false } } as const);
  });
}

/**
 * Cancela um pedido de alteração ainda aberto: ele continua no histórico com quem cancelou, quando e por quê, e o roteiro volta a
 * aguardar revisão. Repetir o cancelamento é inofensivo e não troca o motivo. Pedido já respondido não se cancela.
 */
export function cancelChangeRequest(db: DatabaseSync, input: { id: string; requestId: number; reason: string; by: string }, now: () => Date): Outcome {
  return inTransaction(db, () => {
    const script = find(db, input.id);
    if (!script) return { ok: false, code: "not_found" } as const;
    const request = db.prepare("SELECT * FROM change_requests WHERE id = ? AND script_id = ?").get(input.requestId, script.id) as RequestRow | undefined;
    if (!request) return { ok: false, code: "not_found" } as const;
    if (request.cancelled_at !== null) return { ok: true, view: toView(db, script) } as const;
    if (script.state === "approved") return stateFailure(script);
    if (request.answered_by_version !== null) return { ok: false, code: "request_not_open" } as const;
    const target = nextState(script.state, "cancel_changes");
    if (target === null) return stateFailure(script);

    db.prepare("UPDATE change_requests SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?").run(now().toISOString(), input.by, input.reason, request.id);
    db.prepare("UPDATE scripts SET state = ? WHERE id = ?").run(target, script.id);
    return { ok: true, view: toView(db, find(db, script.id) as ScriptRow) } as const;
  });
}

/** Aprovar encerra a revisão. Repetir a aprovação de um roteiro já aprovado não muda nada. */
export function approve(db: DatabaseSync, input: { id: string }, now: () => Date): Outcome {
  return inTransaction(db, () => {
    const script = find(db, input.id);
    if (!script) return { ok: false, code: "not_found" } as const;
    if (script.state === "approved") return { ok: true, view: toView(db, script) } as const;
    const target = nextState(script.state, "approve");
    if (target === null) return stateFailure(script);

    const version = (db.prepare("SELECT MAX(number) AS n FROM script_versions WHERE script_id = ?").get(script.id) as { n: number }).n;
    db.prepare("UPDATE scripts SET state = ?, approved_at = ?, approved_version = ? WHERE id = ?").run(target, now().toISOString(), version, script.id);
    return { ok: true, view: toView(db, find(db, script.id) as ScriptRow) } as const;
  });
}
