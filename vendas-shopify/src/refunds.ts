/**
 * Quanto de um estorno pode ser aplicado sem a soma passar do valor da venda.
 * O excedente é cortado (status "clamped"); o pedido de estorno original nunca é descartado.
 */
export function allocateRefund(totalCents: number, alreadyAppliedCents: number, requestedCents: number) {
  const remaining = Math.max(0, totalCents - alreadyAppliedCents);
  const applied = Math.min(requestedCents, remaining);
  return { applied, status: applied === requestedCents ? ("applied" as const) : ("clamped" as const) };
}
