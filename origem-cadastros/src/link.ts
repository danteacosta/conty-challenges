import type { TouchSource } from "./decide-origin.ts";

/**
 * O que viaja no link: src (campaign|referral), ref (id da campanha ou de quem convidou) e cid (id do clique,
 * gerado pelo redirecionador a cada clique). Tudo vai na própria URL, então não depende de referrer:
 * o app lê esses três valores no primeiro open (deferred deep link) e os manda em POST /touches.
 */
export const LINK_BASE = "https://conty.app/l";

function build(src: TouchSource, ref: string, cid: string): string {
  const url = new URL(LINK_BASE);
  url.searchParams.set("src", src);
  url.searchParams.set("ref", ref);
  url.searchParams.set("cid", cid);
  return url.toString();
}

export const buildCampaignLink = (campaignId: string, clickId: string) => build("campaign", campaignId, clickId);
export const buildReferralLink = (referrerUserId: string, clickId: string) => build("referral", referrerUserId, clickId);

export function parseLink(link: string): { src: TouchSource; ref: string; cid: string } | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const src = url.searchParams.get("src");
  const ref = url.searchParams.get("ref");
  const cid = url.searchParams.get("cid");
  if ((src !== "campaign" && src !== "referral") || !ref || !cid) return null;
  return { src, ref, cid };
}
