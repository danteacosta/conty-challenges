import { describe, expect, it } from "vitest";
import { buildCampaignLink, buildReferralLink, parseLink } from "../src/link.ts";

describe("links de atribuição", () => {
  it("monta o link de campanha e o de indicação com o que viaja: src, ref e cid", () => {
    expect(buildCampaignLink("verao-2026", "clk_01")).toBe("https://conty.app/l?src=campaign&ref=verao-2026&cid=clk_01");
    expect(buildReferralLink("usr_ana", "clk_02")).toBe("https://conty.app/l?src=referral&ref=usr_ana&cid=clk_02");
  });

  it("lê de volta o que o link carrega, sem depender de referrer", () => {
    expect(parseLink("https://conty.app/l?src=referral&ref=usr_ana&cid=clk_02")).toEqual({
      src: "referral",
      ref: "usr_ana",
      cid: "clk_02",
    });
  });

  it("ida e volta preserva valores com caracteres especiais", () => {
    const link = buildCampaignLink("black friday & cia", "clk/1");
    expect(parseLink(link)).toEqual({ src: "campaign", ref: "black friday & cia", cid: "clk/1" });
  });

  it.each([
    "https://conty.app/l?src=outro&ref=x&cid=y",
    "https://conty.app/l?src=campaign&cid=y",
    "https://conty.app/l?src=campaign&ref=x",
    "não é url",
  ])("recusa link sem contrato válido: %s", (link) => {
    expect(parseLink(link)).toBeNull();
  });
});
