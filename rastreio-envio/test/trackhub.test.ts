import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AggregatorError } from "../src/aggregator/port.ts";
import { HttpTrackHubClient } from "../src/aggregator/trackhub/client.ts";
import { mapTrackHubPayload } from "../src/aggregator/trackhub/mapper.ts";
import { normalizeEvent } from "../src/domain/normalize.ts";
import { startFakeTrackHub, type RawTracking } from "./fake-trackhub.ts";

/** O exemplo do README: payload bruto do agregador e o que sai dele. */
const RAW_EXAMPLE: RawTracking = {
  tracking_number: "BR123456789",
  courier: "via-rapida",
  checkpoints: [
    { id: "chk_9f2", status_code: "20", message: "Objeto em trânsito para o centro de distribuição", time: "2026-06-02T08:15:00-03:00", city: "Recife" },
    { id: "chk_9f1", status_code: "10", message: "Objeto postado", time: "2026-06-01T16:40:00-03:00", city: "São Paulo" },
    { id: "chk_9f3", status_code: "SEPARADO_NA_BANCADA", message: "Em separação", time: "2026-06-03T09:00:00-03:00", city: null },
  ],
};

describe("mapper do TrackHub", () => {
  it("transforma o payload bruto em eventos da transportadora, sem carregar o formato do agregador", () => {
    expect(mapTrackHubPayload(RAW_EXAMPLE)).toEqual([
      { rawStatus: "20", description: "Objeto em trânsito para o centro de distribuição", occurredAt: "2026-06-02T11:15:00.000Z", location: "Recife" },
      { rawStatus: "10", description: "Objeto postado", occurredAt: "2026-06-01T19:40:00.000Z", location: "São Paulo" },
      { rawStatus: "SEPARADO_NA_BANCADA", description: "Em separação", occurredAt: "2026-06-03T12:00:00.000Z", location: null },
    ]);
  });

  it("o exemplo do README: payload bruto → status normalizado (inclui o código que a transportadora inventou)", () => {
    const normalized = mapTrackHubPayload(RAW_EXAMPLE).map((event) => {
      const n = normalizeEvent("via-rapida", event);
      return { raw: n.rawStatus, status: n.status, reason: n.reason, at: n.occurredAt };
    });
    expect(normalized).toEqual([
      { raw: "20", status: "in_transit", reason: null, at: "2026-06-02T11:15:00.000Z" },
      { raw: "10", status: "posted", reason: null, at: "2026-06-01T19:40:00.000Z" },
      { raw: "SEPARADO_NA_BANCADA", status: "exception", reason: "unmapped_carrier_status", at: "2026-06-03T12:00:00.000Z" },
    ]);
  });

  it.each([
    ["sem checkpoints", { tracking_number: "X", courier: "c" }, /checkpoints ausente/],
    ["checkpoints que não é lista", { checkpoints: "nada" }, /checkpoints ausente/],
    ["checkpoint sem status_code", { checkpoints: [{ time: "2026-06-01T10:00:00Z" }] }, /checkpoint 0 sem status_code/],
    ["checkpoint com status_code vazio", { checkpoints: [{ status_code: "  ", time: "2026-06-01T10:00:00Z" }] }, /checkpoint 0 sem status_code/],
    ["checkpoint com status_code que não é texto", { checkpoints: [{ status_code: 40, time: "2026-06-01T10:00:00Z" }] }, /sem status_code/],
    ["checkpoint com data inválida", { checkpoints: [{ status_code: "10", time: "ontem" }] }, /checkpoint 0 com data inválida/],
    ["checkpoint sem data", { checkpoints: [{ status_code: "10" }] }, /data inválida/],
    ["checkpoint que não é objeto", { checkpoints: ["10"] }, /checkpoint 0 sem status_code/],
    ["corpo que não é objeto", "texto", /não é um objeto/],
    ["corpo nulo", null, /não é um objeto/],
  ])("payload inválido (%s) é um erro tipado e explicado, não um evento errado", (_name, payload, message) => {
    let caught: unknown;
    try {
      mapTrackHubPayload(payload);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregatorError);
    expect((caught as AggregatorError).kind).toBe("invalid_payload");
    expect((caught as AggregatorError).message).toMatch(message);
  });

  it("descrição e cidade que não são texto viram nulo, sem derrubar o evento", () => {
    expect(mapTrackHubPayload({ checkpoints: [{ status_code: "10", time: "2026-06-01T10:00:00Z", message: 5, city: {} }] })).toEqual([
      { rawStatus: "10", description: null, occurredAt: "2026-06-01T10:00:00.000Z", location: null },
    ]);
  });

  it("lista vazia de checkpoints é válida (código recém-cadastrado)", () => {
    expect(mapTrackHubPayload({ checkpoints: [] })).toEqual([]);
  });
});

describe("cliente HTTP do TrackHub", () => {
  let hub: Awaited<ReturnType<typeof startFakeTrackHub>>;
  let client: HttpTrackHubClient;
  beforeAll(async () => {
    hub = await startFakeTrackHub();
  });
  afterAll(() => hub.close());
  beforeEach(() => {
    hub.state.nextResponse = null;
    hub.state.delayMs = 0;
    hub.state.requests.length = 0;
    hub.state.trackings.clear();
    client = new HttpTrackHubClient({ baseUrl: hub.baseUrl, apiKey: hub.apiKey, timeoutMs: 300 });
  });

  it("cadastra o código no agregador com a chave de API", async () => {
    await client.register("BR1", "via-rapida");
    expect(hub.state.registered.get("BR1")).toBe("via-rapida");
    expect(hub.state.requests[0]).toMatchObject({ method: "POST", path: "/v1/trackings", auth: `Bearer ${hub.apiKey}` });
  });

  it("consulta e devolve eventos já traduzidos para o formato interno", async () => {
    hub.state.trackings.set("BR123456789", RAW_EXAMPLE);
    const events = await client.fetchEvents("BR123456789");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ rawStatus: "20", location: "Recife" });
  });

  it("código ainda desconhecido pelo agregador (404) é lista vazia, não erro", async () => {
    expect(await client.fetchEvents("NAO_EXISTE")).toEqual([]);
  });

  it("chave de API errada é erro http tipado", async () => {
    const wrong = new HttpTrackHubClient({ baseUrl: hub.baseUrl, apiKey: "errada", timeoutMs: 300 });
    await expect(wrong.fetchEvents("BR1")).rejects.toMatchObject({ kind: "http", status: 401 });
  });

  it("resposta 500 é erro http tipado", async () => {
    hub.state.nextResponse = { status: 500, body: '{"error":"boom"}' };
    await expect(client.fetchEvents("BR1")).rejects.toMatchObject({ kind: "http", status: 500 });
    await expect(client.register("BR1", "via-rapida")).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it("JSON malformado é payload inválido", async () => {
    hub.state.nextResponse = { status: 200, body: "{nope" };
    await expect(client.fetchEvents("BR1")).rejects.toMatchObject({ kind: "invalid_payload" });
  });

  it("agregador lento demais é timeout", async () => {
    hub.state.delayMs = 1000;
    await expect(client.fetchEvents("BR1")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("agregador fora do ar é erro de rede", async () => {
    const down = new HttpTrackHubClient({ baseUrl: "http://127.0.0.1:1", apiKey: "x", timeoutMs: 300 });
    await expect(down.fetchEvents("BR1")).rejects.toMatchObject({ kind: "network" });
  });

  it("o código vai codificado na URL", async () => {
    await client.fetchEvents("a/b c");
    expect(hub.state.requests[0]?.path).toBe("/v1/trackings/a%2Fb%20c");
  });
});
