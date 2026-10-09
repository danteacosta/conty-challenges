import { describe, expect, it } from "vitest";
import { DELIVERED, H, IN_TRANSIT, POSTED, viaRapida } from "./fixtures.ts";
import { setup } from "./helpers.ts";

async function shipmentWith(t: ReturnType<typeof setup>, code: string, events: ReturnType<typeof viaRapida>[]) {
  await t.register(code, "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" });
  t.aggregator.script(code, events);
  await t.refresh(code);
}

describe("aviso de atraso (limite de 72h, relógio controlado)", () => {
  it("no limite exato ainda não é atraso; 1 ms depois é, e o aviso sai", async () => {
    const t = setup({ thresholdHours: 72 });
    await shipmentWith(t, "BR1", [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 10 * H)]);

    t.setNow(72 * H);
    expect((await t.get("BR1")).body.delay).toMatchObject({ delayed: false, elapsed_hours: 72, threshold_hours: 72 });
    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 0, notified: 0 });

    t.setNow(72 * H + 1);
    expect((await t.get("BR1")).body.delay.delayed).toBe(true);
    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 1, notified: 1 });
    expect(t.notifier.sent).toMatchObject([
      { tracking_code: "BR1", kind: "transit_delay", creator_id: "crt_ana", campaign_id: "cmp_1", status: "in_transit", threshold_hours: 72 },
    ]);
  });

  it("entrega normal nunca é marcada como atraso, nem quando a verificação roda semanas depois", async () => {
    const t = setup({ thresholdHours: 72 });
    await shipmentWith(t, "BR1", [viaRapida(POSTED, 0), viaRapida(DELIVERED, 50 * H)]);

    t.setNow(30 * 24 * H);
    expect((await t.get("BR1")).body.delay).toMatchObject({ delayed: false, delivered_late: false });
    expect((await t.checkDelays()).body.newly_alerted).toBe(0);
    expect(t.notifier.sent).toHaveLength(0);
  });

  it("entrega que demorou mais que o limite não gera aviso, só aparece como tardia", async () => {
    const t = setup({ thresholdHours: 72 });
    await shipmentWith(t, "BR1", [viaRapida(POSTED, 0), viaRapida(DELIVERED, 100 * H)]);
    t.setNow(200 * H);
    expect((await t.get("BR1")).body.delay).toMatchObject({ delayed: false, delivered_late: true });
    expect((await t.checkDelays()).body.newly_alerted).toBe(0);
  });

  it("o aviso sai uma vez só, por mais que o job rode", async () => {
    const t = setup({ thresholdHours: 72 });
    await shipmentWith(t, "BR1", [viaRapida(POSTED, 0)]);
    t.setNow(100 * H);
    await t.checkDelays();
    await t.checkDelays();
    t.setNow(200 * H);
    await t.checkDelays();
    expect(t.notifier.sent).toHaveLength(1);
    expect((await t.alerts()).body).toHaveLength(1);
  });

  it("pacote parado em exceção também gera aviso quando passa do limite", async () => {
    const t = setup({ thresholdHours: 72 });
    await shipmentWith(t, "BR1", [viaRapida(POSTED, 0), viaRapida("INVENTADO", 5 * H)]);
    t.setNow(80 * H);
    await t.checkDelays();
    expect(t.notifier.sent[0]).toMatchObject({ tracking_code: "BR1", status: "exception" });
  });

  it("código cadastrado que nunca recebeu evento atrasa a partir do cadastro", async () => {
    const t = setup({ thresholdHours: 72 });
    await t.register("BR1");
    t.setNow(73 * H);
    expect((await t.checkDelays()).body.newly_alerted).toBe(1);
  });

  it("se o destino do aviso falha, o aviso não se perde: sai na próxima verificação", async () => {
    const t = setup({ thresholdHours: 72 });
    await shipmentWith(t, "BR1", [viaRapida(POSTED, 0)]);
    t.setNow(100 * H);
    t.notifier.fail = true;
    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 1, notified: 0 });
    expect(t.notifier.sent).toHaveLength(0);

    t.notifier.fail = false;
    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 0, notified: 1 });
    expect(t.notifier.sent).toHaveLength(1);
  });

  it("só avisa dos pacotes atrasados, não dos que estão no prazo", async () => {
    const t = setup({ thresholdHours: 72 });
    await shipmentWith(t, "BR_VELHO", [viaRapida(POSTED, 0)]);
    await shipmentWith(t, "BR_NOVO", [viaRapida(POSTED, 90 * H)]);
    t.setNow(100 * H);
    await t.checkDelays();
    expect(t.notifier.sent.map((a) => a.tracking_code)).toEqual(["BR_VELHO"]);
  });
});
