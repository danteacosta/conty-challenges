import { describe, expect, it } from "vitest";
import { allowedActions, nextState, type Action, type State } from "../src/domain/transitions.ts";

describe("máquina de estados do roteiro", () => {
  it.each<[State, Action[]]>([
    ["awaiting_review", ["approve", "request_changes"]],
    ["changes_requested", ["submit_version"]],
    ["approved", []],
  ])("em %s só se pode: %j", (state, actions) => {
    expect([...allowedActions(state)].sort()).toEqual([...actions].sort());
  });

  it.each<[State, Action, State]>([
    ["awaiting_review", "approve", "approved"],
    ["awaiting_review", "request_changes", "changes_requested"],
    ["changes_requested", "submit_version", "awaiting_review"],
  ])("%s + %s leva a %s", (state, action, expected) => {
    expect(nextState(state, action)).toBe(expected);
  });

  it.each<[State, Action]>([
    ["awaiting_review", "submit_version"],
    ["changes_requested", "approve"],
    ["changes_requested", "request_changes"],
    ["approved", "approve"],
    ["approved", "request_changes"],
    ["approved", "submit_version"],
  ])("%s + %s não é permitido", (state, action) => {
    expect(nextState(state, action)).toBeNull();
  });

  it("aprovado é terminal: nenhuma ação leva para fora dele", () => {
    for (const action of ["approve", "request_changes", "submit_version"] as Action[]) {
      expect(nextState("approved", action)).toBeNull();
    }
  });
});
