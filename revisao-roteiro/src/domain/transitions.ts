/**
 * O estado do roteiro e o que se pode fazer em cada um, num lugar só e como dado.
 * `approved` não tem saída: aprovar encerra a revisão e a aprovação não reabre.
 */
export type State = "awaiting_review" | "changes_requested" | "approved";
export type Action = "request_changes" | "submit_version" | "approve";

const TRANSITIONS: Record<State, Partial<Record<Action, State>>> = {
  awaiting_review: { request_changes: "changes_requested", approve: "approved" },
  changes_requested: { submit_version: "awaiting_review" },
  approved: {},
};

export function allowedActions(state: State): Action[] {
  return Object.keys(TRANSITIONS[state]) as Action[];
}

export function nextState(state: State, action: Action): State | null {
  return TRANSITIONS[state][action] ?? null;
}
