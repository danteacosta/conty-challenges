import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { buildCampaignLink, buildReferralLink, parseLink } from "../src/link.ts";

let server: ReturnType<typeof serve>;
let base = "";
beforeAll(async () => {
  server = serve({ fetch: createApp(openDatabase(":memory:")).fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});
const send = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("jornada completa por HTTP", () => {
  it("link de campanha e de indicação → primeiro open → toques → cadastro → auditoria", async () => {
    const campaign = parseLink(buildCampaignLink("verao-2026", "clk_1"))!;
    const referral = parseLink(buildReferralLink("usr_ana", "clk_2"))!;

    await send("POST", "/installs", { install_id: "ins_1", opened_at: "2026-06-01T12:00:00.000Z" });
    await send("POST", "/touches", { install_id: "ins_1", ...campaign, touched_at: "2026-06-01T12:00:01.000Z" });
    await send("POST", "/touches", { install_id: "ins_1", ...referral, touched_at: "2026-06-02T09:00:00.000Z" });
    const signup = await (await send("POST", "/signups", { user_id: "usr_9", install_id: "ins_1", signed_up_at: "2026-06-03T10:00:00.000Z" })).json();
    const audit = await (await send("GET", "/signups/usr_9/origin")).json();

    expect(signup.origin).toMatchObject({ type: "referral", ref: "usr_ana" });
    expect(audit.origin).toEqual(signup.origin);
    expect(audit.considered.map((c: any) => c.verdict)).toEqual(["lost", "winner"]);
  });
});
