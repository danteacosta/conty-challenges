import { describe, expect, it } from "vitest";
import { attribute, type Registry } from "../src/attribution.ts";

const registry: Registry = {
  creatorByCoupon: (code) => ({ ANA10: "ana", BIA10: "bia" })[code],
  creatorByUtm: (handle) => ({ ana: "ana", bia: "bia" })[handle],
};
const sig = (couponCodes: string[], utmHandle: string | null) => ({ couponCodes, utmHandle });

describe("attribute", () => {
  it("cupom vence UTM quando apontam para criadores diferentes", () => {
    expect(attribute(sig(["ANA10"], "bia"), registry)).toMatchObject({
      creator_id: "ana",
      rule: "coupon_over_utm",
      conflict: { coupon_creator_id: "ana", utm_creator_id: "bia" },
    });
  });
  it("o resultado não depende de maiúsculas nem de espaços", () => {
    expect(attribute(sig([" ana10 "], " ANA "), registry)).toMatchObject({ creator_id: "ana", rule: "coupon_and_utm" });
  });
  it("usa o primeiro cupom reconhecido quando há vários", () => {
    expect(attribute(sig(["XXX", "BIA10", "ANA10"], null), registry)).toMatchObject({ creator_id: "bia", coupon_code: "BIA10" });
  });
  it("só UTM", () => expect(attribute(sig([], "bia"), registry)).toMatchObject({ creator_id: "bia", rule: "utm", conflict: null }));
  it("só cupom", () => expect(attribute(sig(["ANA10"], null), registry)).toMatchObject({ creator_id: "ana", rule: "coupon" }));
  it("nada reconhecido", () =>
    expect(attribute(sig(["XXX"], "ninguem"), registry)).toMatchObject({ creator_id: null, rule: "unattributed", conflict: null }));
});
