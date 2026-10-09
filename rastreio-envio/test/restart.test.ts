import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { InMemoryAggregator, RecordingNotifier } from "./fakes.ts";
import { H, IN_TRANSIT, POSTED, T0, viaRapida } from "./fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "rastreio-restart-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** "Reiniciar" = fechar a conexão e subir uma app nova sobre o mesmo arquivo, com tudo (agregador, relógio, destino) novo. */
function boot(path: string, nowMs: number, aggregator = new InMemoryAggregator()) {
  const db = openDatabase(path);
  const notifier = new RecordingNotifier();
  const app = createApp({ db, aggregator, notifier, now: () => new Date(T0 + nowMs), thresholdHours: 72 });
  const call = async (method: string, route: string, body?: unknown) => {
    const res = await app.request(route, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { db, notifier, aggregator, call };
}

describe("persistência com banco em arquivo (DB_PATH)", () => {
  it("envio, histórico e status continuam depois de reiniciar o processo", async () => {
    const path = join(dir, "reinicio.sqlite");
    const first = boot(path, 0);
    await first.call("POST", "/shipments", { tracking_code: "BR1", carrier: "via-rapida", creator_id: "crt_ana", campaign_id: "cmp_1" });
    first.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 5 * H)]);
    await first.call("POST", "/shipments/BR1/refresh");
    const before = (await first.call("GET", "/shipments/BR1")).body;
    first.db.close();

    const second = boot(path, 6 * H);
    const after = (await second.call("GET", "/shipments/BR1")).body;
    expect(after.status).toBe("in_transit");
    expect(after.creator_id).toBe("crt_ana");
    expect(after.history).toEqual(before.history);
    second.db.close();
  });

  it("um aviso pendente (destino fora do ar) sobrevive ao reinício e sai depois dele, uma vez só", async () => {
    const path = join(dir, "aviso.sqlite");
    const first = boot(path, 0);
    await first.call("POST", "/shipments", { tracking_code: "BR1", carrier: "via-rapida" });
    first.aggregator.script("BR1", [viaRapida(POSTED, 0)]);
    await first.call("POST", "/shipments/BR1/refresh");
    first.db.close();

    const down = boot(path, 100 * H);
    down.notifier.fail = true;
    expect((await down.call("POST", "/jobs/check-delays")).body).toMatchObject({ newly_alerted: 1, notified: 0 });
    down.db.close();

    const up = boot(path, 101 * H);
    expect((await up.call("GET", "/alerts")).body).toMatchObject([{ tracking_code: "BR1", status: "pending" }]);
    expect((await up.call("POST", "/jobs/check-delays")).body).toMatchObject({ newly_alerted: 0, notified: 1 });
    expect(up.notifier.sent).toHaveLength(1);
    expect((await up.call("POST", "/jobs/check-delays")).body).toMatchObject({ newly_alerted: 0, notified: 0 });
    expect(up.notifier.sent).toHaveLength(1);
    up.db.close();
  });

  it("a reconsulta depois do reinício não duplica o histórico", async () => {
    const path = join(dir, "reconsulta.sqlite");
    const first = boot(path, 0);
    await first.call("POST", "/shipments", { tracking_code: "BR1", carrier: "via-rapida" });
    first.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 2 * H)]);
    await first.call("POST", "/shipments/BR1/refresh");
    first.db.close();

    const second = boot(path, 3 * H);
    second.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 2 * H)]);
    expect((await second.call("POST", "/shipments/BR1/refresh")).body).toMatchObject({ added: 0, duplicates: 2 });
    expect((await second.call("GET", "/shipments/BR1")).body.history).toHaveLength(2);
    second.db.close();
  });

  it("sem DB_PATH o banco é em memória: um processo novo começa vazio (escolha explícita, documentada)", async () => {
    const one = boot(":memory:", 0);
    await one.call("POST", "/shipments", { tracking_code: "BR1", carrier: "via-rapida" });
    one.db.close();
    const two = boot(":memory:", 0);
    expect((await two.call("GET", "/shipments/BR1")).status).toBe(404);
    two.db.close();
  });
});
