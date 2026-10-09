/**
 * Regra de atribuição de venda a criador. É o único lugar onde ela vive.
 *
 * Desempate quando cupom e UTM apontam para criadores diferentes: o CUPOM vence.
 * Motivo: o cupom é um código emitido para aquele criador e o comprador precisa
 * digitá-lo, então é um sinal explícito. A UTM viaja em link e é facilmente
 * sobrescrita por outro clique ou colada em link de terceiros.
 */
export type Signals = { couponCodes: string[]; utmHandle: string | null };

export type Registry = {
  creatorByCoupon(code: string): string | undefined;
  creatorByUtm(handle: string): string | undefined;
};

export type Attribution = {
  creator_id: string | null;
  rule: "coupon_and_utm" | "coupon_over_utm" | "coupon" | "utm" | "unattributed";
  coupon_code: string | null;
  utm_handle: string | null;
  conflict: { coupon_creator_id: string; utm_creator_id: string } | null;
};

export function normalizeCoupon(code: string): string {
  return code.trim().toUpperCase();
}

export function normalizeUtm(handle: string): string {
  return handle.trim().toLowerCase();
}

export function attribute(signals: Signals, registry: Registry): Attribution {
  let couponCreator: string | undefined;
  let couponCode: string | null = null;
  for (const raw of signals.couponCodes) {
    const code = normalizeCoupon(raw);
    const found = registry.creatorByCoupon(code);
    if (found) {
      couponCreator = found;
      couponCode = code;
      break;
    }
  }

  const utmHandle = signals.utmHandle ? normalizeUtm(signals.utmHandle) : null;
  const utmCreator = utmHandle ? registry.creatorByUtm(utmHandle) : undefined;

  const base = { coupon_code: couponCode, utm_handle: utmHandle, conflict: null };

  if (couponCreator && utmCreator) {
    if (couponCreator === utmCreator) return { ...base, creator_id: couponCreator, rule: "coupon_and_utm" };
    return {
      ...base,
      creator_id: couponCreator,
      rule: "coupon_over_utm",
      conflict: { coupon_creator_id: couponCreator, utm_creator_id: utmCreator },
    };
  }
  if (couponCreator) return { ...base, creator_id: couponCreator, rule: "coupon" };
  if (utmCreator) return { ...base, creator_id: utmCreator, rule: "utm" };
  return { ...base, creator_id: null, rule: "unattributed" };
}
