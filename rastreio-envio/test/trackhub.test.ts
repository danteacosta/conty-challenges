import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AggregatorError } from "../src/aggregator/port.ts";
import { HttpTrackHubClient } from "../src/aggregator/trackhub/client.ts";
import { mapTrackHubPayload, verifyTrackHubEnvelope } from "../src/aggregator/trackhub/mapper.ts";
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

  describe("datas estritas: nada de data corrigida em silêncio nem de horário que depende do fuso do servidor", () => {
    const at = (time: unknown) => () => mapTrackHubPayload({ checkpoints: [{ status_code: "10", time }] });
    it.each<[unknown, string]>([
      ["2026-02-30T12:00:00.000Z", "30 de fevereiro"],
      ["2026-02-29T12:00:00Z", "29 de fevereiro em ano comum"],
      ["2026-04-31T12:00:00Z", "31 de abril"],
      ["2026-13-01T12:00:00Z", "mês 13"],
      ["2026-06-01T24:00:00Z", "hora 24"],
      ["2026-06-01T12:60:00Z", "minuto 60"],
      ["2026-06-01T12:00:00", "horário sem fuso (dependeria do servidor)"],
      ["2026-06-01", "só a data"],
      ["2026-06-01 12:00:00Z", "separador de espaço"],
      ["1 Jun 2026 12:00 GMT", "formato que o Date.parse aceita mas o contrato não"],
      [1_780_000_000, "número em vez de texto"],
    ])("recusa %j (%s)", (time) => {
      expect(at(time)).toThrowError(expect.objectContaining({ kind: "invalid_payload", message: expect.stringMatching(/data inválida/) }));
    });

    it("aceita Z, offset e fração, e normaliza para UTC", () => {
      expect(at("2026-06-01T12:00:00Z")()[0]?.occurredAt).toBe("2026-06-01T12:00:00.000Z");
      expect(at("2026-06-01T09:00:00-03:00")()[0]?.occurredAt).toBe("2026-06-01T12:00:00.000Z");
      expect(at("2026-06-01T12:00:00.5Z")()[0]?.occurredAt).toBe("2026-06-01T12:00:00.500Z");
      expect(at("2024-02-29T12:00:00Z")()[0]?.occurredAt).toBe("2024-02-29T12:00:00.000Z");
    });

    it("o resultado não depende do fuso do processo", () => {
      const original = process.env.TZ;
      try {
        for (const tz of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
          process.env.TZ = tz;
          expect(at("2026-06-01T12:00:00-03:00")()[0]?.occurredAt).toBe("2026-06-01T15:00:00.000Z");
        }
      } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
      }
    });

    it("um lote com UM checkpoint inválido é recusado inteiro: nenhum evento é aproveitado pela metade", () => {
      expect(() =>
        mapTrackHubPayload({
          checkpoints: [
            { status_code: "10", time: "2026-06-01T12:00:00Z" },
            { status_code: "20", time: "2026-02-30T12:00:00Z" },
            { status_code: "30", time: "2026-06-03T12:00:00Z" },
          ],
        }),
      ).toThrowError(expect.objectContaining({ kind: "invalid_payload", message: expect.stringMatching(/checkpoint 1/) }));
    });
  });

  it("lista vazia de checkpoints é válida (código recém-cadastrado)", () => {
    expect(mapTrackHubPayload({ checkpoints: [] })).toEqual([]);
  });
});

describe("verifyTrackHubEnvelope: a identidade do envelope, direto", () => {
  const expected = { code: "BR1", carrier: "via-rapida" };
  it.each([[null], ["texto"], [42], [undefined]])("corpo %j não é um objeto: erro tipado, não TypeError", (payload) => {
    expect(() => verifyTrackHubEnvelope(payload, expected)).toThrowError(expect.objectContaining({ kind: "invalid_payload", message: expect.stringMatching(/não é um objeto/) }));
  });
  it("envelope certo passa sem devolver nada", () => {
    expect(verifyTrackHubEnvelope({ tracking_number: "BR1", courier: "via-rapida" }, expected)).toBeUndefined();
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
    const events = await client.fetchEvents("BR123456789", "via-rapida");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ rawStatus: "20", location: "Recife" });
  });

  it("código ainda desconhecido pelo agregador (404) é lista vazia, não erro", async () => {
    expect(await client.fetchEvents("NAO_EXISTE", "via-rapida")).toEqual([]);
  });

  it("chave de API errada é erro http tipado", async () => {
    const wrong = new HttpTrackHubClient({ baseUrl: hub.baseUrl, apiKey: "errada", timeoutMs: 300 });
    await expect(wrong.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "http", status: 401 });
  });

  it("resposta 500 é erro http tipado", async () => {
    hub.state.nextResponse = { status: 500, body: '{"error":"boom"}' };
    await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "http", status: 500 });
    await expect(client.register("BR1", "via-rapida")).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it("JSON malformado é payload inválido", async () => {
    hub.state.nextResponse = { status: 200, body: "{nope" };
    await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload" });
  });

  it("agregador lento demais é timeout", async () => {
    hub.state.delayMs = 1000;
    await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("agregador fora do ar é erro de rede", async () => {
    const down = new HttpTrackHubClient({ baseUrl: "http://127.0.0.1:1", apiKey: "x", timeoutMs: 300 });
    await expect(down.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "network" });
  });

  describe("identidade do envelope: o payload tem que ser do envio e da transportadora pedidos", () => {
    const checkpoint = { id: "1", status_code: "40", message: "Entregue", time: "2026-06-01T12:00:00Z", city: null };

    it("envelope de outro código e de outra transportadora não vira evento do envio consultado (caso da auditoria)", async () => {
      hub.state.trackings.set("BR1", { tracking_number: "OTHER", courier: "unknown-carrier", checkpoints: [checkpoint] });
      await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload" });
    });

    it("mesmo código com outra transportadora é recusado", async () => {
      hub.state.trackings.set("BR1", { tracking_number: "BR1", courier: "correio-norte", checkpoints: [checkpoint] });
      await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload", message: expect.stringMatching(/courier/) });
    });

    it("mesma transportadora com outro código é recusado", async () => {
      hub.state.trackings.set("BR1", { tracking_number: "BR2", courier: "via-rapida", checkpoints: [checkpoint] });
      await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload", message: expect.stringMatching(/tracking_number/) });
    });

    it("envelope sem identidade é recusado", async () => {
      hub.state.trackings.set("BR1", { checkpoints: [checkpoint] } as never);
      await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload" });
    });

    it("courier que não é texto é recusado, não derruba a consulta", async () => {
      hub.state.trackings.set("BR1", { tracking_number: "BR1", courier: 123, checkpoints: [checkpoint] } as never);
      await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload", message: expect.stringMatching(/courier/) });
    });

    it("tracking_number que não é texto é recusado", async () => {
      hub.state.trackings.set("BR1", { tracking_number: 1, courier: "via-rapida", checkpoints: [checkpoint] } as never);
      await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload", message: expect.stringMatching(/tracking_number/) });
    });

    it.each(["null", '"texto"', "[]", "42"])("corpo JSON %s não é um envelope", async (body) => {
      hub.state.nextResponse = { status: 200, body };
      await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload" });
    });

    it("o código pedido em minúsculas e com espaços também confere com o envelope", async () => {
      hub.state.trackings.set(" br1 ", { tracking_number: "BR1", courier: " Via-Rapida ", checkpoints: [checkpoint] });
      expect(await client.fetchEvents(" br1 ", "via-rapida")).toHaveLength(1);
    });

    it("a identidade certa passa, mesmo com caixa e espaços diferentes no código", async () => {
      hub.state.trackings.set("BR1", { tracking_number: " br1 ", courier: "VIA-RAPIDA", checkpoints: [checkpoint] });
      expect(await client.fetchEvents("BR1", "via-rapida")).toHaveLength(1);
    });
  });

  describe("falha ao LER o corpo não é o mesmo que JSON inválido", () => {
    const withBody = (body: ReadableStream<Uint8Array>) =>
      new HttpTrackHubClient({
        baseUrl: "http://trackhub.invalid",
        apiKey: "k",
        timeoutMs: 80,
        fetch: (async (_url: unknown, init?: RequestInit) => {
          void init;
          return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
        }) as typeof fetch,
      });

    it("conexão que cai no meio do corpo é erro de rede (vale tentar de novo), não payload inválido", async () => {
      const dropped = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"checkpoints":['));
          controller.error(new Error("connection reset"));
        },
      });
      await expect(withBody(dropped).fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "network" });
    });

    it("corpo que não termina de chegar a tempo é timeout", async () => {
      const stalled = new ReadableStream<Uint8Array>({ start() {} });
      const client = new HttpTrackHubClient({
        baseUrl: "http://trackhub.invalid",
        apiKey: "k",
        timeoutMs: 60,
        fetch: (async (_url: unknown, init?: RequestInit) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
            },
          });
          void stalled;
          return new Response(body, { status: 200 });
        }) as typeof fetch,
      });
      await expect(client.fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "timeout" });
    });

    it("corpo que chegou inteiro mas não é JSON continua sendo payload inválido", async () => {
      const text = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<html>erro</html>"));
          controller.close();
        },
      });
      await expect(withBody(text).fetchEvents("BR1", "via-rapida")).rejects.toMatchObject({ kind: "invalid_payload" });
    });
  });

  it("o código vai codificado na URL", async () => {
    await client.fetchEvents("a/b c", "via-rapida");
    expect(hub.state.requests[0]?.path).toBe("/v1/trackings/a%2Fb%20c");
  });
});
