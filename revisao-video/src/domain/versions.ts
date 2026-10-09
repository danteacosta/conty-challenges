/** O estado de uma versão de peça e o que se pode fazer com ela. Aprovada e com alteração pedida são finais: só uma versão nova segue o fluxo. */
export type VersionState = "pending" | "approved" | "changes_requested";
export type VersionAction = "approve" | "request_changes";

const TRANSITIONS: Record<VersionState, Partial<Record<VersionAction, VersionState>>> = {
  pending: { approve: "approved", request_changes: "changes_requested" },
  approved: {},
  changes_requested: {},
};

export const allowedVersionActions = (state: VersionState): VersionAction[] => Object.keys(TRANSITIONS[state]) as VersionAction[];

export const nextVersionState = (state: VersionState, action: VersionAction): VersionState | null => TRANSITIONS[state][action] ?? null;
