import { describe, expect, it } from "vitest";
import { checkDelays, listAlerts, type DelayAlert } from "../src/alerts.ts";
import { openDatabase } from "../src/db.ts";
import { ingestEvents, registerShipment } from "../src/store.ts";
import { DELIVERED, H, IN_TRANSIT, POSTED, T0, viaRapida } from "./fixtures.ts";
import { setup } from "./helpers.ts";

/** Avisos que ficaram pendentes (o destino estava fora do ar) e que o mundo mudou antes do reenvio. */
describe("aviso pendente que ficou obsoleto", () => {
  async function pendingAlert() {
    const t = setup({ thresholdHours: 72 });
    await t.register("BR1", "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" });
    t.aggregator.script("BR1", [viaRapida(POSTED, 0)]);
    await t.refresh("BR1");
    t.setNow(100 * H);
    t.notifier.fail = true;
    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 1, notified: 0 });
    t.notifier.fail = false;
    return t;
  }

  it("chega a entrega, ocorrida dentro do prazo, fora de ordem: o aviso antigo não é enviado e fica descartado", async () => {
    const t = await pendingAlert();
    t.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(DELIVERED, 50 * H)]);
    await t.refresh("BR1");
    expect((await t.get("BR1")).body.delay).toMatchObject({ delayed: false, delivered_late: false });

    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 0, notified: 0, discarded: 1 });
    expect(t.notifier.sent).toHaveLength(0);
    expect((await t.alerts()).body).toMatchObject([{ tracking_code: "BR1", status: "discarded", discard_reason: "delivered", notified: false }]);
  });

  it("um aviso descartado não é reenviado nas execuções seguintes", async () => {
    const t = await pendingAlert();
    t.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(DELIVERED, 50 * H)]);
    await t.refresh("BR1");
    await t.checkDelays();
    t.setNow(500 * H);
    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 0, notified: 0, discarded: 0 });
    expect(t.notifier.sent).toHaveLength(0);
  });

  it("se continua atrasado, o aviso sai com o estado atual (não com o de quando foi criado)", async () => {
    const t = await pendingAlert();
    t.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 60 * H)]);
    await t.refresh("BR1");
    t.setNow(110 * H);

    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 0, notified: 1, discarded: 0 });
    expect(t.notifier.sent).toHaveLength(1);
    expect(t.notifier.sent[0]).toMatchObject({
      tracking_code: "BR1",
      status: "in_transit",
      elapsed_hours: 110,
      detected_at: new Date(T0 + 110 * H).toISOString(),
    });
    expect((await t.alerts()).body[0]).toMatchObject({ status: "notified", notified: true });
  });
});

describe("reavaliação do aviso quando o limite muda", () => {
  const now = (hours: number) => () => new Date(T0 + hours * H);
  function shipmentPostedAtT0() {
    const db = openDatabase(":memory:");
    registerShipment(db, { code: "BR1", carrier: "via-rapida", creatorId: null, campaignId: null }, now(0));
    ingestEvents(db, "BR1", [viaRapida(POSTED, 0)], now(0));
    return db;
  }
  const failing = { notify: async (_alert: DelayAlert) => { throw new Error("fora do ar"); } };
  const collecting = (sent: DelayAlert[]) => ({ notify: async (alert: DelayAlert) => void sent.push(alert) });

  it("com o limite aumentado, o aviso pendente deixa de fazer sentido e é descartado", async () => {
    const db = shipmentPostedAtT0();
    await checkDelays(db, { now: now(100), thresholdHours: 72, notifier: failing });
    const sent: DelayAlert[] = [];
    const result = await checkDelays(db, { now: now(101), thresholdHours: 168, notifier: collecting(sent) });
    expect(result).toMatchObject({ newly_alerted: 0, notified: 0, discarded: 1 });
    expect(sent).toHaveLength(0);
    expect(listAlerts(db)).toMatchObject([{ tracking_code: "BR1", status: "discarded", discard_reason: "within_threshold" }]);
  });

  it("se um envio descartado volta a estar atrasado, o aviso é reativado, sem duplicar", async () => {
    const db = shipmentPostedAtT0();
    await checkDelays(db, { now: now(100), thresholdHours: 72, notifier: failing });
    await checkDelays(db, { now: now(101), thresholdHours: 168, notifier: collecting([]) });

    const sent: DelayAlert[] = [];
    const again = await checkDelays(db, { now: now(200), thresholdHours: 168, notifier: collecting(sent) });
    expect(again).toMatchObject({ newly_alerted: 1, notified: 1 });
    expect(sent).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM alerts").get()).toEqual({ n: 1 });
  });
});
