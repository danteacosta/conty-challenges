import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, redactUrl } from "../src/config.ts";
import { HttpMetricsProvider } from "../src/providers/http.ts";
import { ProviderError } from "../src/providers/port.ts";
import { client, server } from "./fakes.ts";
import { setup } from "./helpers.ts";
import { ALL } from "./helpers.ts";

const SECRET = "tok-SINTETICO-9f3a7c";
const everything = (...values: unknown[]) => JSON.stringify(values);

async function failingRun(error: Error) {
  const t = setup();
  const id = await t.connect("instagram", "acc_1", SECRET);
  t.provider.failNext(error, error, error, error); // as 4 tentativas da política, para a falha ser a última
  const run = await t.sync(id);
  const history = await t.runs(id);
  return { t, id, run, history };
}

describe("mensagens de erro não expõem credenciais", () => {
  it("erro inesperado de um adapter com o token na mensagem: nem a resposta nem o histórico o carregam, e a categoria fica", async () => {
    const { run, history } = await failingRun(new Error(`falhou ao autenticar com ${SECRET}`));
    expect(run.status).toBe(502);
    expect(run.body).toMatchObject({ status: "failed", error: "unexpected: Error" });
    expect(everything(run.body, history.body)).not.toContain(SECRET);
  });

  it("erro tipado do provedor com o segredo na mensagem: fica a categoria e o status HTTP, não a mensagem", async () => {
    const { run, history } = await failingRun(new ProviderError("server", `500 em https://api.exemplo/?access_token=${SECRET}`, 503));
    expect(run.body.error).toBe("server (503)");
    expect(everything(run.body, history.body)).not.toContain(SECRET);
  });

  it("erro do cliente (401) mantém o código", async () => {
    const { run } = await failingRun(client(401));
    expect(run.body.error).toBe("client (401)");
  });

  it("o nome de classe de erro só entra se for um identificador simples", async () => {
    class Weird extends Error {
      constructor() {
        super("x");
        this.name = `Boom ${SECRET}`;
      }
    }
    const { run, history } = await failingRun(new Weird());
    expect(run.body.error).toBe("unexpected: Error");
    expect(everything(run.body, history.body)).not.toContain(SECRET);
  });

  it.each([
    ["timeout", "timeout"],
    ["network", "network"],
  ])("falha tipada sem status HTTP (%s) vira só a categoria", async (kind) => {
    const { run } = await failingRun(new ProviderError(kind as "timeout" | "network", `sem resposta, token ${SECRET}`));
    expect(run.body.error).toBe(kind);
  });

  it.each([["uma string", `falha com ${SECRET}`], ["um número", 42], ["um objeto sem nome", { message: SECRET }]])("lançar %s também vira texto seguro", async (_name, thrown) => {
    const { run, history } = await failingRun(thrown as Error);
    expect(run.body.error).toBe("unexpected: Error");
    expect(everything(run.body, history.body)).not.toContain(SECRET);
  });

  it("o erro persistido e o devolvido são o mesmo texto seguro", async () => {
    const { run, history } = await failingRun(server(502));
    expect(history.body[0].error).toBe(run.body.error);
  });
});

describe("o cliente HTTP não copia texto arbitrário para os erros", () => {
  const fetching = (error: unknown) => new HttpMetricsProvider({ baseUrl: "http://provedor.invalido", network: "x", fetch: (async () => Promise.reject(error)) as typeof fetch });
  const request = { account: "acc_1", token: SECRET, since: ALL.since, until: ALL.until, cursor: null };
  const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e: ProviderError) => e)) as ProviderError;

  it("rede fora do ar com o segredo na mensagem: o ProviderError traz só a classe e o código de sistema", async () => {
    const cause = Object.assign(new Error(`connect ECONNREFUSED com ${SECRET}`), { code: "ECONNREFUSED" });
    const error = await errorOf(fetching(new TypeError(`fetch failed ${SECRET}`, { cause })).fetchPosts(request));
    expect(error.kind).toBe("network");
    expect(error.message).not.toContain(SECRET);
    expect(error.message).toContain("TypeError");
    expect(error.message).toContain("ECONNREFUSED");
  });

  it("nome de erro e código de sistema só entram se forem identificadores simples", async () => {
    const weird = Object.assign(new TypeError("x", { cause: Object.assign(new Error("y"), { code: `ECONN ${SECRET}` }) }), { name: `Erro ${SECRET}` });
    const error = await errorOf(fetching(weird).fetchPosts(request));
    expect(error.message).not.toContain(SECRET);
    expect(error.message).toContain("(Error)");
    const named = Object.assign(new Error("z"), { name: "AbortLike_1", code: "EPIPE" });
    expect((await errorOf(fetching(named).fetchPosts(request))).message).toContain("(AbortLike_1, EPIPE)");
    const longName = Object.assign(new Error("z"), { name: "A".repeat(60) });
    expect((await errorOf(fetching(longName).fetchPosts(request))).message).toContain("(Error)");
  });

  it("corpo interrompido com o segredo na mensagem também não vaza", async () => {
    const body = new Response(new ReadableStream({ start: (c) => c.error(new TypeError(`terminated ${SECRET}`)) }), { status: 200 });
    const provider = new HttpMetricsProvider({ baseUrl: "http://provedor.invalido", network: "x", fetch: (async () => body) as typeof fetch });
    const error = await errorOf(provider.fetchPosts(request));
    expect(error.kind).toBe("network");
    expect(error.message).not.toContain(SECRET);
  });
});

describe("configuração e log de inicialização", () => {
  it("redactUrl tira usuário, senha, query e hash", () => {
    expect(redactUrl("https://usuario:senha@api.exemplo:8443/v1/posts?access_token=abc#frag")).toBe("https://api.exemplo:8443/v1/posts");
    expect(redactUrl("http://127.0.0.1:4011")).toBe("http://127.0.0.1:4011/");
    expect(redactUrl("//usuario:senha@host/x?token=1")).toBe("//host/x"); // não parseia como URL: cai no tratamento de texto
  });

  it("PROVIDER_URL inválida com credenciais não aparece na mensagem de erro de configuração", () => {
    try {
      loadConfig({ PROVIDER_URL: "ftp://usuario:s3nh4-secreta@api.exemplo/x?token=abc" });
      throw new Error("deveria ter falhado");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).not.toContain("s3nh4-secreta");
      expect(message).not.toContain("token=abc");
      expect(message).toMatch(/PROVIDER_URL/);
    }
  });
});
