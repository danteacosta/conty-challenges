import type { PieceType } from "./pieces.ts";
import type { VersionState } from "./versions.ts";

/**
 * A regra da aprovação da entrega, pura.
 *
 * A aprovação vale para a VERSÃO ATUAL de cada peça EXIGIDA pela campanha. Peça que a campanha não pediu não bloqueia.
 * O status da entrega é derivado, nunca guardado:
 * - `in_production`: ninguém aprovou a entrega ainda;
 * - `approved`: a entrega foi aprovada e cada peça exigida tem a versão atual aprovada;
 * - `in_review`: a entrega foi aprovada, mas alguma peça exigida recebeu versão nova e a atual ainda não está aprovada.
 *   Aprovar a versão nova devolve `approved` sozinho, sem aprovar a entrega de novo.
 */
export type PieceView = { type: PieceType; required: boolean; currentState: VersionState | null };
export type PendingReason = "no_version" | "pending_review" | "changes_requested";
export type Pending = { piece: PieceType; reason: PendingReason };
export type DeliveryStatus = "in_production" | "approved" | "in_review";

export function pendingPieces(pieces: PieceView[]): Pending[] {
  const pending: Pending[] = [];
  for (const piece of pieces) {
    if (!piece.required || piece.currentState === "approved") continue;
    pending.push({ piece: piece.type, reason: piece.currentState === null ? "no_version" : piece.currentState === "pending" ? "pending_review" : "changes_requested" });
  }
  return pending;
}

export function deliveryStatus(input: { explicitlyApproved: boolean; pieces: PieceView[] }): DeliveryStatus {
  if (!input.explicitlyApproved) return "in_production";
  return pendingPieces(input.pieces).length === 0 ? "approved" : "in_review";
}
