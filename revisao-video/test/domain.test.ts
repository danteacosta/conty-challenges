import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deliveryStatus, pendingPieces, type PieceView } from "../src/domain/approval.ts";
import { PIECE_TYPES, parseRequiredPieces } from "../src/domain/pieces.ts";
import { allowedVersionActions, nextVersionState, type VersionState } from "../src/domain/versions.ts";

const view = (type: PieceView["type"], required: boolean, currentState: PieceView["currentState"]): PieceView => ({ type, required, currentState });

describe("peças exigidas são dado da campanha", () => {
  it("as peças possíveis são roteiro, vídeo, capa e legenda", () => {
    expect([...PIECE_TYPES]).toEqual(["script", "video", "cover", "caption"]);
  });

  it.each([
    [["video"], ["video"]],
    [["script", "video", "cover", "caption"], ["script", "video", "cover", "caption"]],
    [["caption", "script"], ["caption", "script"]],
  ])("aceita %j", (input, expected) => {
    expect(parseRequiredPieces(input)).toEqual(expected);
  });

  it.each([
    ["lista vazia", []],
    ["peça desconhecida", ["video", "thumbnail"]],
    ["peça repetida", ["video", "video"]],
    ["não é lista", "video"],
    ["item que não é texto", ["video", 3]],
    ["nulo", null],
    ["ausente", undefined],
  ])("recusa %s", (_name, input) => {
    expect(parseRequiredPieces(input)).toBeNull();
  });
});

describe("estados da versão", () => {
  it.each<[VersionState, string[]]>([
    ["pending", ["approve", "request_changes"]],
    ["approved", []],
    ["changes_requested", []],
  ])("em %s só se pode: %j", (state, actions) => {
    expect([...allowedVersionActions(state)].sort()).toEqual([...actions].sort());
  });

  it("aprovar uma versão pendente a aprova; pedir alteração a deixa em changes_requested", () => {
    expect(nextVersionState("pending", "approve")).toBe("approved");
    expect(nextVersionState("pending", "request_changes")).toBe("changes_requested");
  });

  it.each<[VersionState, "approve" | "request_changes"]>([
    ["approved", "approve"],
    ["approved", "request_changes"],
    ["changes_requested", "approve"],
    ["changes_requested", "request_changes"],
  ])("%s + %s não é permitido", (state, action) => {
    expect(nextVersionState(state, action)).toBeNull();
  });
});

describe("peças pendentes", () => {
  it("só entram as exigidas cuja versão atual não está aprovada, cada uma com o motivo", () => {
    const pieces = [
      view("script", true, null),
      view("video", true, "pending"),
      view("cover", true, "changes_requested"),
      view("caption", true, "approved"),
    ];
    expect(pendingPieces(pieces)).toEqual([
      { piece: "script", reason: "no_version" },
      { piece: "video", reason: "pending_review" },
      { piece: "cover", reason: "changes_requested" },
    ]);
  });

  it("peça que a campanha não pediu não bloqueia, qualquer que seja o estado", () => {
    expect(pendingPieces([view("video", true, "approved"), view("cover", false, null), view("script", false, "pending"), view("caption", false, "changes_requested")])).toEqual([]);
  });

  it("campanha só de vídeo não exige roteiro", () => {
    expect(pendingPieces([view("video", true, "approved"), view("script", false, null)])).toEqual([]);
  });
});

describe("status da entrega (derivado)", () => {
  const allApproved = [view("video", true, "approved"), view("script", true, "approved")];
  const oneNew = [view("video", true, "pending"), view("script", true, "approved")];

  it("nunca aprovada explicitamente: em produção, mesmo com todas as peças aprovadas", () => {
    expect(deliveryStatus({ explicitlyApproved: false, pieces: allApproved })).toBe("in_production");
  });
  it("aprovada explicitamente e todas as peças exigidas com a versão atual aprovada: aprovada", () => {
    expect(deliveryStatus({ explicitlyApproved: true, pieces: allApproved })).toBe("approved");
  });
  it("aprovada explicitamente, mas uma peça exigida ganhou versão nova: em revisão até aprovar a nova", () => {
    expect(deliveryStatus({ explicitlyApproved: true, pieces: oneNew })).toBe("in_review");
  });
  it("uma peça não exigida com versão nova não tira a aprovação", () => {
    expect(deliveryStatus({ explicitlyApproved: true, pieces: [...allApproved, view("cover", false, "pending")] })).toBe("approved");
  });
  it("propriedade: aprovada se e só se houve aprovação explícita e nenhuma peça exigida está pendente", () => {
    const pieceArb = fc.record({
      type: fc.constantFrom(...PIECE_TYPES),
      required: fc.boolean(),
      currentState: fc.constantFrom<PieceView["currentState"]>(null, "pending", "approved", "changes_requested"),
    });
    fc.assert(
      fc.property(fc.boolean(), fc.array(pieceArb, { maxLength: 6 }), (explicitlyApproved, pieces) => {
        const status = deliveryStatus({ explicitlyApproved, pieces });
        const pending = pendingPieces(pieces).length;
        expect(status === "approved").toBe(explicitlyApproved && pending === 0);
        if (!explicitlyApproved) expect(status).toBe("in_production");
        if (explicitlyApproved && pending > 0) expect(status).toBe("in_review");
      }),
    );
  });
});
