import { describe, expect, it } from "vitest";
import { AggregatorError } from "../src/aggregator/port.ts";
import { DELIVERED, H, IN_TRANSIT, POSTED, viaRapida } from "./fixtures.ts";
import { setup } from "./helpers.ts";
import { safeReason } from "../src/alerts.ts";

const SECRET = "tok-SINTETICO-aaa111";

/** Envio postado há 100 h que o NOSSO banco ainda vê parado; o agregador `remote` diz o que já aconteceu de verdade. */
async function stuckLocally(remote: Array<ReturnType<typeof viaRapida>>) {
  const t = setup({ thresholdHours: 72 });
  await t.register("BR1", "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" });
  t.aggregator.script("BR1", [viaRapida(POSTED, 0)]);
  await t.refresh("BR1"); // o cache local para aqui
  t.aggregator.script("BR1", remote); // o agregador já sabe mais
  t.setNow(100 * H);
  return t;
}

describe("o estado remoto é consultado antes de avisar atraso", () => {
  it("a entrega já está registrada no agregador, dentro do prazo: nenhum aviso, o envio vira entregue e o aviso fica descartado", async () => {
    const t = await stuckLocally([viaRapida(POSTED, 0), viaRapida(DELIVERED, 50 * H)]);
    expect((await t.get("BR1")).body.status).not.toBe("delivered"); // o cache local ainda não sabe da entrega
    const res = await t.checkDelays();
    expect(res.body).toMatchObject({ newly_alerted: 1, notified: 0, discarded: 1, confirmed: 1, unconfirmed: 0 });
    expect(t.notifier.sent).toHaveLength(0);
    expect((await t.get("BR1")).body).toMatchObject({ status: "delivered", delay: { delayed: false, delivered_late: false } });
    expect((await t.alerts()).body).toMatchObject([{ tracking_code: "BR1", status: "discarded", discard_reason: "delivered" }]);
  });

  it("o agregador confirma que continua em trânsito: o aviso sai, com o estado confirmado", async () => {
    const t = await stuckLocally([viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 60 * H)]);
    const res = await t.checkDelays();
    expect(res.body).toMatchObject({ notified: 1, confirmed: 1, unconfirmed: 0 });
    expect(t.notifier.sent[0]).toMatchObject({ tracking_code: "BR1", status: "in_transit", elapsed_hours: 100 });
    expect((await t.alerts()).body[0]).toMatchObject({ status: "notified", confirmation: "confirmed" });
  });

  it("entrega remota fora do prazo (tardia) também não vira aviso de trânsito parado", async () => {
    const t = await stuckLocally([viaRapida(POSTED, 0), viaRapida(DELIVERED, 90 * H)]);
    const res = await t.checkDelays();
    expect(res.body).toMatchObject({ notified: 0, discarded: 1 });
    expect((await t.get("BR1")).body.delay).toMatchObject({ delayed: false, delivered_late: true });
  });
});

describe("agregador indisponível: não confirmado, sem aviso, e tenta de novo depois", () => {
  it("registra 'não confirmado' com a categoria e não avisa; quando o agregador volta, o aviso sai", async () => {
    const t = await stuckLocally([viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 60 * H)]);
    t.aggregator.failWith(new AggregatorError("timeout", "sem resposta"));
    const down = await t.checkDelays();
    expect(down.body).toMatchObject({ newly_alerted: 1, notified: 0, discarded: 0, confirmed: 0, unconfirmed: 1 });
    expect(t.notifier.sent).toHaveLength(0);
    expect((await t.alerts()).body).toMatchObject([{ tracking_code: "BR1", status: "pending", confirmation: "unconfirmed", unconfirmed_reason: "timeout" }]);

    t.aggregator.failWith(null);
    t.setNow(101 * H);
    const back = await t.checkDelays();
    expect(back.body).toMatchObject({ newly_alerted: 0, notified: 1, confirmed: 1, unconfirmed: 0 });
    expect((await t.alerts()).body).toHaveLength(1);
    expect((await t.alerts()).body[0]).toMatchObject({ status: "notified", confirmation: "confirmed" });
  });

  it("várias execuções com o agregador fora não avisam nem duplicam o aviso", async () => {
    const t = await stuckLocally([viaRapida(POSTED, 0)]);
    t.aggregator.failWith(new AggregatorError("network", "sem rede"));
    for (let i = 0; i < 3; i += 1) expect((await t.checkDelays()).body).toMatchObject({ notified: 0, unconfirmed: 1 });
    expect(t.notifier.sent).toHaveLength(0);
    expect((await t.alerts()).body).toHaveLength(1);
  });

  it("entrega que chega depois de uma falha: o aviso pendente é descartado, não enviado", async () => {
    const t = await stuckLocally([viaRapida(POSTED, 0)]);
    t.aggregator.failWith(new AggregatorError("timeout", "sem resposta"));
    await t.checkDelays();
    t.aggregator.failWith(null);
    t.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(DELIVERED, 60 * H)]);
    const res = await t.checkDelays();
    expect(res.body).toMatchObject({ notified: 0, discarded: 1 });
    expect(t.notifier.sent).toHaveLength(0);
  });

  it("o motivo guardado é só a categoria: o texto do erro do agregador, com segredo, não é persistido nem devolvido", async () => {
    const t = await stuckLocally([viaRapida(POSTED, 0)]);
    t.aggregator.failWith(new AggregatorError("http", `401 com ${SECRET}`, 401));
    const res = await t.checkDelays();
    const alerts = await t.alerts();
    expect(alerts.body[0].unconfirmed_reason).toBe("http (401)");
    expect(JSON.stringify([res.body, alerts.body])).not.toContain(SECRET);

    t.aggregator.failWith(new Error(`quebrou com ${SECRET}`) as AggregatorError);
    const other = await t.alerts();
    await t.checkDelays();
    expect(JSON.stringify([other.body, (await t.alerts()).body])).not.toContain(SECRET);
    expect((await t.alerts()).body[0].unconfirmed_reason).toBe("unexpected: Error");
  });
});

describe("só se consulta o agregador do que está para avisar", () => {
  it("envio dentro do prazo, entregue ou já avisado não gera consulta", async () => {
    const t = setup({ thresholdHours: 72 });
    await t.register("BR1");
    await t.register("BR2");
    t.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(DELIVERED, 10 * H)]);
    await t.refresh("BR1");
    t.setNow(30 * H); // BR2 ainda dentro do prazo; BR1 entregue
    let fetched = 0;
    const original = t.aggregator.fetchEvents.bind(t.aggregator);
    t.aggregator.fetchEvents = async (code, carrier) => {
      fetched += 1;
      return original(code, carrier);
    };
    expect((await t.checkDelays()).body).toMatchObject({ newly_alerted: 0, confirmed: 0, unconfirmed: 0 });
    expect(fetched).toBe(0);

    t.setNow(100 * H);
    await t.checkDelays(); // BR2 atrasa: uma consulta e o aviso
    expect(fetched).toBe(1);
    await t.checkDelays(); // já avisado: nenhuma consulta nova
    expect(fetched).toBe(1);
  });
});

describe("o motivo de 'não confirmado' só tem valores seguros", () => {
  it("categoria e status do agregador; classe de erro só se conhecida", () => {
    expect(safeReason(new AggregatorError("timeout", `sem resposta ${SECRET}`))).toBe("timeout");
    expect(safeReason(new AggregatorError("http", "x", 503))).toBe("http (503)");
    expect(safeReason(new RangeError("x"))).toBe("unexpected: RangeError");
    class Tokenish extends Error {
      constructor() {
        super("x");
        this.name = SECRET.replace(/-/g, "_");
      }
    }
    expect(safeReason(new Tokenish())).toBe("unexpected: Error");
  });

  it.each([["uma string", `falha ${SECRET}`], ["null", null], ["um número", 7], ["objeto sem nome", { message: SECRET }], ["nome que não é texto", { name: 5 }]])("lançar %s vira unexpected: Error", (_name, thrown) => {
    expect(safeReason(thrown)).toBe("unexpected: Error");
  });
});
