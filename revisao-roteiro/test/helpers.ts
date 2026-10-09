import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

export const iso = (value: string) => new Date(value);

/** App com relógio controlado: `clock.set("2026-03-13T02:59:59.999Z")` muda o "agora" de todas as rotas. */
export function setup(start = "2026-03-10T15:00:00.000Z") {
  const clock = { current: new Date(start) };
  const app = createApp({ db: openDatabase(":memory:"), now: () => new Date(clock.current) });

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
    call,
    set: (value: string) => void (clock.current = new Date(value)),
    create: (mission_id = "msn_1", content = "Roteiro v1") => call("POST", "/scripts", { mission_id, content }),
    get: (id: string) => call("GET", `/scripts/${id}`),
    requestChanges: (id: string, body: unknown) => call("POST", `/scripts/${id}/change-requests`, body),
    submit: (id: string, content = "Roteiro novo") => call("POST", `/scripts/${id}/versions`, { content }),
    approve: (id: string) => call("POST", `/scripts/${id}/approve`),
  };
}
