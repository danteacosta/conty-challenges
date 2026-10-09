import { describe, expect, it } from "vitest";
import { AggregatorError } from "../src/aggregator/port.ts";
import { DELIVERED, FAILED_ATTEMPT, H, IN_TRANSIT, OUT_FOR_DELIVERY, POSTED, iso, viaRapida } from "./fixtures.ts";
import { setup } from "./helpers.ts";

const history = (body: any) => body.history.map((h: any) => [h.raw_status, h.status]);

describe("cadastro do código", () => {
  it("cadastra no agregador e guarda o envio sem status até chegar o primeiro evento", async () => {
    const t = setup();
    const res = await t.register("BR1", "via-rapida", { creator_id: "crt_ana", campaign_id: "cmp_1" });
    expect(res).toMatchObject({ status: 201, body: { result: "created", tracking_code: "BR1" } });
    expect(t.aggregator.registered).toEqual([{ code: "BR1", carrier: "via-rapida" }]);

    const shipment = (await t.get("BR1")).body;
    expect(shipment).toMatchObject({ status: null, reason: "no_events_yet", creator_id: "crt_ana", campaign_id: "cmp_1", history: [] });
  });

  it("cadastrar de novo o mesmo código é inofensivo e não chama o agregador outra vez", async () => {
    const t = setup();
    await t.register("BR1");
    const again = await t.register("BR1");
    expect(again).toMatchObject({ status: 200, body: { result: "exists" } });
    expect(t.aggregator.registered).toHaveLength(1);
  });

  it("o código é normalizado (espaços e minúsculas)", async () => {
    const t = setup();
    await t.register(" br1 ");
    expect((await t.get("BR1")).status).toBe(200);
  });

  it("o mesmo código com outra transportadora é conflito, sem sobrescrever", async () => {
    const t = setup();
    await t.register("BR1", "via-rapida");
    expect((await t.register("BR1", "correio-norte")).status).toBe(409);
    expect((await t.get("BR1")).body.carrier).toBe("via-rapida");
  });

  it("recusa transportadora que não tem dialeto e diz quais existem", async () => {
    const t = setup();
    const res = await t.register("BR1", "transp-fantasma");
    expect(res.status).toBe(400);
    expect(res.body.supported_carriers).toEqual(["correio-norte", "via-rapida"]);
  });

  it("recusa entrada incompleta", async () => {
    const t = setup();
    expect((await t.call("POST", "/shipments", { carrier: "via-rapida" })).status).toBe(400);
    expect((await t.call("POST", "/shipments", { tracking_code: "BR1" })).status).toBe(400);
  });

  it("falha do agregador no cadastro responde 502 e não deixa envio pela metade", async () => {
    const t = setup();
    t.aggregator.failWith(new AggregatorError("http", "TrackHub respondeu 500"));
    const res = await t.register("BR1");
    expect(res).toMatchObject({ status: 502, body: { error: "aggregator_unavailable", kind: "http" } });
    expect((await t.get("BR1")).status).toBe(404);
  });
});

describe("consulta e normalização", () => {
  it("traduz o dialeto da transportadora e mostra o histórico do mais antigo ao mais novo", async () => {
    const t = setup();
    await t.register("BR1");
    t.aggregator.script("BR1", [
      viaRapida(IN_TRANSIT, 5 * H, { description: "Em trânsito", location: "Recife" }),
      viaRapida(POSTED, 0, { description: "Objeto postado" }),
    ]);
    const refreshed = await t.refresh("BR1");
    expect(refreshed.body).toMatchObject({ added: 2, duplicates: 0, status: "in_transit" });

    const shipment = (await t.get("BR1")).body;
    expect(shipment).toMatchObject({ status: "in_transit", started_at: iso(0), delivered_at: null });
    expect(shipment.history).toEqual([
      { status: "posted", raw_status: POSTED, description: "Objeto postado", location: null, occurred_at: iso(0), reason: null, ignored: null },
      { status: "in_transit", raw_status: IN_TRANSIT, description: "Em trânsito", location: "Recife", occurred_at: iso(5 * H), reason: null, ignored: null },
    ]);
  });

  it("consultar de novo o mesmo código não duplica o histórico e só acrescenta o que é novo", async () => {
    const t = setup();
    await t.register("BR1");
    t.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 2 * H)]);
    await t.refresh("BR1");
    const again = await t.refresh("BR1");
    expect(again.body).toMatchObject({ added: 0, duplicates: 2 });
    expect((await t.get("BR1")).body.history).toHaveLength(2);

    t.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 2 * H), viaRapida(OUT_FOR_DELIVERY, 9 * H)]);
    const third = await t.refresh("BR1");
    expect(third.body).toMatchObject({ added: 1, duplicates: 2, status: "out_for_delivery" });
    expect((await t.get("BR1")).body.history).toHaveLength(3);
  });

  it("o mesmo evento repetido dentro da mesma resposta do agregador conta uma vez só", async () => {
    const t = setup();
    await t.register("BR1");
    t.aggregator.script("BR1", [viaRapida(POSTED, 0), viaRapida(POSTED, 0, { description: "texto diferente" })]);
    expect((await t.refresh("BR1")).body).toMatchObject({ added: 1, duplicates: 1 });
  });

  it("evento antigo que chega numa consulta posterior não faz o status voltar", async () => {
    const t = setup();
    await t.register("BR1");
    t.aggregator.script("BR1", [viaRapida(OUT_FOR_DELIVERY, 8 * H)]);
    await t.refresh("BR1");
    expect((await t.get("BR1")).body.status).toBe("out_for_delivery");

    t.aggregator.script("BR1", [viaRapida(OUT_FOR_DELIVERY, 8 * H), viaRapida(IN_TRANSIT, 2 * H), viaRapida(POSTED, 0)]);
    await t.refresh("BR1");
    const shipment = (await t.get("BR1")).body;
    expect(shipment.status).toBe("out_for_delivery");
    expect(history(shipment)).toEqual([[POSTED, "posted"], [IN_TRANSIT, "in_transit"], [OUT_FOR_DELIVERY, "out_for_delivery"]]);
    expect(shipment.started_at).toBe(iso(0));
  });

  it("os mesmos eventos em qualquer ordem de chegada resultam no mesmo envio", async () => {
    const events = [viaRapida(POSTED, 0), viaRapida(IN_TRANSIT, 2 * H), viaRapida(FAILED_ATTEMPT, 5 * H), viaRapida(DELIVERED, 9 * H)];
    const results: unknown[] = [];
    for (const order of [events, [...events].reverse(), [events[2]!, events[0]!, events[3]!, events[1]!]]) {
      const t = setup();
      await t.register("BR1");
      for (const event of order) {
        t.aggregator.script("BR1", [event]);
        await t.refresh("BR1");
      }
      const { body } = await t.get("BR1");
      results.push({ status: body.status, history: body.history, started_at: body.started_at, delivered_at: body.delivered_at });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect((results[0] as any).status).toBe("delivered");
  });

  it("status que a transportadora inventou nunca vira entregue: aparece como exceção, com o bruto preservado", async () => {
    const t = setup();
    await t.register("BR1");
    t.aggregator.script("BR1", [
      viaRapida(IN_TRANSIT, 0),
      viaRapida("AGUARDANDO_RETIRADA_XYZ", 3 * H, { description: "Aguardando retirada na agência" }),
    ]);
    await t.refresh("BR1");
    const shipment = (await t.get("BR1")).body;
    expect(shipment).toMatchObject({ status: "exception", reason: "unmapped_carrier_status", delivered_at: null });
    expect(shipment.history[1]).toMatchObject({
      status: "exception",
      reason: "unmapped_carrier_status",
      raw_status: "AGUARDANDO_RETIRADA_XYZ",
      description: "Aguardando retirada na agência",
    });
  });

  it("status inventado não desfaz uma entrega já registrada", async () => {
    const t = setup();
    await t.register("BR1");
    t.aggregator.script("BR1", [viaRapida(DELIVERED, 5 * H), viaRapida("INVENTADO", 6 * H)]);
    await t.refresh("BR1");
    const shipment = (await t.get("BR1")).body;
    expect(shipment.status).toBe("delivered");
    expect(shipment.history.map((h: any) => h.ignored)).toEqual([null, "after_delivered"]);
  });

  it("falha do agregador na consulta responde 502 e preserva o que já estava gravado", async () => {
    const t = setup();
    await t.register("BR1");
    t.aggregator.script("BR1", [viaRapida(POSTED, 0)]);
    await t.refresh("BR1");

    t.aggregator.failWith(new AggregatorError("timeout", "sem resposta em 5000 ms"));
    const failed = await t.refresh("BR1");
    expect(failed).toMatchObject({ status: 502, body: { error: "aggregator_unavailable", kind: "timeout" } });
    expect((await t.get("BR1")).body).toMatchObject({ status: "posted" });
    expect((await t.get("BR1")).body.history).toHaveLength(1);
  });

  it("consultar código que não foi cadastrado é 404", async () => {
    const t = setup();
    expect((await t.refresh("NADA")).status).toBe(404);
    expect((await t.get("NADA")).status).toBe(404);
  });
});
