import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

let server: ReturnType<typeof serve>;
let base = "";
const clock = { current: new Date("2026-06-01T12:00:00.000Z") };

beforeAll(async () => {
  server = serve({ fetch: createApp({ db: openDatabase(":memory:"), now: () => new Date(clock.current) }).fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const send = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
};

describe("jornada completa por HTTP real", () => {
  it("campanha de vídeo e capa, comentário, versão nova, aprovação, versão nova depois de aprovada e aprovação de volta", async () => {
    const campaign = (await send("POST", "/campaigns", { required_pieces: ["video", "cover"] })).body.id;
    const d = (await send("POST", "/deliveries", { campaign_id: campaign })).body.id;
    const piece = (name: string) => `/deliveries/${d}/pieces/${name}/versions`;

    await send("POST", piece("video"), { url: "https://arquivos.example/v1.mp4", duration_seconds: 60 });
    expect((await send("POST", `${piece("video")}/1/comments`, { second: 10, text: "Cortar" })).status).toBe(201);
    expect((await send("POST", `${piece("video")}/1/request-changes`, { reason: "Cortar a intro" })).status).toBe(200);
    await send("POST", piece("video"), { url: "https://arquivos.example/v2.mp4", duration_seconds: 55 });
    await send("POST", `${piece("video")}/2/approve`);
    expect((await send("POST", `/deliveries/${d}/approve`)).body.pending).toEqual([{ piece: "cover", reason: "no_version" }]);

    await send("POST", piece("cover"), { url: "https://arquivos.example/capa.png" });
    await send("POST", `${piece("cover")}/1/approve`);
    expect((await send("POST", `/deliveries/${d}/approve`)).body.status).toBe("approved");

    await send("POST", piece("cover"), { url: "https://arquivos.example/capa2.png" });
    expect((await send("GET", `/deliveries/${d}`)).body.status).toBe("in_review");
    await send("POST", `${piece("cover")}/2/approve`);
    const final = (await send("GET", `/deliveries/${d}`)).body;
    expect(final.status).toBe("approved");
    expect(final.events.map((e: any) => e.kind)).toEqual(["approved", "invalidated", "restored"]);
    expect(final.pieces.video.versions.find((v: any) => v.number === 2).comments_count).toBe(0);
    expect(final.pieces.video.versions.find((v: any) => v.number === 1).comments_count).toBe(1);
  });
});
