import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

export const T0 = Date.parse("2026-06-01T12:00:00.000Z");
export const H = 3_600_000;
export const D = 24 * H;
export const at = (ms: number) => new Date(T0 + ms).toISOString();

export function setup() {
  const db = openDatabase(":memory:");
  const app = createApp(db);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return {
    app,
    db,
    install: (install_id: string, ms = 0) => call("POST", "/installs", { install_id, opened_at: at(ms) }),
    touch: (install_id: string, src: string, ref: string, cid: string, ms: number) =>
      call("POST", "/touches", { install_id, src, ref, cid, touched_at: at(ms) }),
    signup: (user_id: string, install_id: string, ms: number) =>
      call("POST", "/signups", { user_id, install_id, signed_up_at: at(ms) }),
    origin: (user_id: string) => call("GET", `/signups/${user_id}/origin`),
    call,
  };
}
