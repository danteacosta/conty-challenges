import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALL_PIECES, setup, type Piece } from "./helpers.ts";

type Op = { kind: "submit" | "approve_current" | "changes_current"; piece: Piece } | { kind: "approve_delivery" };

/** Modelo de referência, escrito direto da regra do enunciado, sem olhar a implementação. */
class Model {
  versions: Record<Piece, Array<"pending" | "approved" | "changes_requested">> = { script: [], video: [], cover: [], caption: [] };
  explicit = false;
  constructor(readonly required: Piece[]) {}
  current(piece: Piece) {
    const list = this.versions[piece];
    return list.length === 0 ? null : list[list.length - 1]!;
  }
  allRequiredApproved() {
    return this.required.every((piece) => this.current(piece) === "approved");
  }
  get status() {
    if (!this.explicit) return "in_production";
    return this.allRequiredApproved() ? "approved" : "in_review";
  }
}

describe("modelo de referência: qualquer sequência de ações dá o mesmo estado que a regra do enunciado", () => {
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constantFrom("submit", "approve_current", "changes_current") as fc.Arbitrary<"submit" | "approve_current" | "changes_current">, piece: fc.constantFrom(...ALL_PIECES) }),
    fc.constant({ kind: "approve_delivery" as const }),
  );
  const requiredArb = fc.subarray(ALL_PIECES, { minLength: 1 });

  it("o status da entrega, as peças pendentes e as versões coincidem com o modelo depois de cada ação", async () => {
    await fc.assert(
      fc.asyncProperty(requiredArb, fc.array(opArb, { maxLength: 18 }), async (required, ops) => {
        const t = setup();
        const delivery = await t.newDelivery(required);
        const model = new Model(required);

        for (const op of ops) {
          if (op.kind === "submit") {
            const res = await t.submit(delivery, op.piece);
            expect(res.status).toBe(201);
            model.versions[op.piece].push("pending");
          } else if (op.kind === "approve_current" || op.kind === "changes_current") {
            const n = model.versions[op.piece].length;
            if (n === 0) continue;
            const res = op.kind === "approve_current" ? await t.approveVersion(delivery, op.piece, n) : await t.requestChanges(delivery, op.piece, n);
            const state = model.current(op.piece)!;
            if (op.kind === "approve_current") {
              expect([200, 409]).toContain(res.status);
              if (state === "pending") model.versions[op.piece][n - 1] = "approved";
              expect(res.status).toBe(state === "pending" || state === "approved" ? 200 : 409);
            } else {
              if (state === "pending") model.versions[op.piece][n - 1] = "changes_requested";
              expect(res.status).toBe(state === "pending" ? 200 : 409);
            }
          } else {
            const res = await t.approve(delivery);
            if (model.allRequiredApproved()) {
              expect(res.status).toBe(200);
              model.explicit = true;
            } else {
              expect(res.status).toBe(409);
            }
          }

          const body = (await t.get(delivery)).body;
          expect(body.status).toBe(model.status);
          expect(body.pending.map((p: any) => p.piece)).toEqual(required.filter((piece) => model.current(piece) !== "approved"));
          // Invariante central: aprovada nunca convive com peça exigida pendente.
          if (body.status === "approved") for (const piece of required) expect(body.pieces[piece].current_state).toBe("approved");
          for (const piece of ALL_PIECES) {
            expect(body.pieces[piece].versions.map((v: any) => v.state)).toEqual(model.versions[piece]);
            expect(body.pieces[piece].versions.map((v: any) => v.superseded)).toEqual(model.versions[piece].map((_, i, list) => i < list.length - 1));
          }
        }
      }),
      { numRuns: 60 },
    );
  }, 60_000);
});
