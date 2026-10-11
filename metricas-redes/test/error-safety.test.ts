import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, originOf } from "../src/config.ts";
import { HttpMetricsProvider } from "../src/providers/http.ts";
import { ProviderError } from "../src/providers/port.ts";
import { client, server } from "./fakes.ts";
import { openDatabase } from "../src/db.ts";
import { activeCooldown, listRuns, normalizeStoredError } from "../src/store.ts";
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

  it("o nome de classe só entra se for de uma classe conhecida: um nome que parece um identificador (ou um token) vira Error", async () => {
    class TokenNamed extends Error {
      constructor() {
        super("x");
        this.name = SECRET.replace(/-/g, "_"); // alfanumérico e curto: passaria numa regex, não numa lista
      }
    }
    const { run, history } = await failingRun(new TokenNamed());
    expect(run.body.error).toBe("unexpected: Error");
    expect(everything(run.body, history.body)).not.toContain(SECRET.replace(/-/g, "_"));
    const known = await failingRun(new RangeError("fora da faixa"));
    expect(known.run.body.error).toBe("unexpected: RangeError");
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

  it("rede fora do ar com o segredo na mensagem: o ProviderError traz só a classe conhecida e, no detalhe, o código de sistema", async () => {
    const cause = Object.assign(new Error(`connect ECONNREFUSED com ${SECRET}`), { code: "ECONNREFUSED" });
    const error = await errorOf(fetching(new TypeError(`fetch failed ${SECRET}`, { cause })).fetchPosts(request));
    expect(error.kind).toBe("network");
    expect(error.message).not.toContain(SECRET);
    expect(error.message).toContain("TypeError");
    expect(error.detail).toBe("ECONNREFUSED");
  });

  it("o código de sistema só entra se tiver a forma de um (ECONNREFUSED, UND_ERR_...), e o nome só se for conhecido", async () => {
    const weird = Object.assign(new TypeError("x", { cause: Object.assign(new Error("y"), { code: `ECONN ${SECRET}` }) }), { name: `Erro ${SECRET}` });
    const error = await errorOf(fetching(weird).fetchPosts(request));
    expect(error.message).not.toContain(SECRET);
    expect(error.detail).toBeUndefined();
    const named = Object.assign(new TypeError("z", { cause: Object.assign(new Error("w"), { code: "ECONNREFUSED" }) }), {});
    expect((await errorOf(fetching(named).fetchPosts(request))).detail).toBe("ECONNREFUSED");
    const tokenLike = Object.assign(new Error("z"), { code: SECRET.replace(/-/g, "_") });
    expect((await errorOf(fetching(tokenLike).fetchPosts(request))).detail).toBeUndefined();
    const undici = Object.assign(new Error("z"), { code: "UND_ERR_SOCKET" });
    expect((await errorOf(fetching(undici).fetchPosts(request))).detail).toBe("UND_ERR_SOCKET");
  });

  it("o detalhe seguro chega ao histórico: o operador distingue recusa de conexão, timeout de corpo e JSON inválido", async () => {
    const refused = new HttpMetricsProvider({
      baseUrl: "http://provedor.invalido",
      network: "x",
      fetch: (async () => Promise.reject(Object.assign(new TypeError(`falhou ${SECRET}`), { cause: { code: "ECONNREFUSED" } }))) as typeof fetch,
    });
    const t = setup();
    const id = await t.connect("instagram", "acc_1", SECRET);
    t.provider.failNext(await errorOf(refused.fetchPosts(request)), await errorOf(refused.fetchPosts(request)), await errorOf(refused.fetchPosts(request)), await errorOf(refused.fetchPosts(request)));
    const run = await t.sync(id);
    expect(run.body.error).toBe("network: ECONNREFUSED");
    expect(everything(run.body, (await t.runs(id)).body)).not.toContain(SECRET);

    const notJson = new HttpMetricsProvider({ baseUrl: "http://p.invalido", network: "x", fetch: (async () => new Response("<html>", { status: 200 })) as typeof fetch });
    const bodyTimeout = new HttpMetricsProvider({
      baseUrl: "http://p.invalido",
      network: "x",
      fetch: (async () => new Response(new ReadableStream({ start: (c) => c.error(new DOMException("t", "TimeoutError")) }), { status: 200 })) as typeof fetch,
    });
    expect((await errorOf(notJson.fetchPosts(request))).detail).toBe("body_not_json");
    expect((await errorOf(bodyTimeout.fetchPosts(request))).detail).toBe("body");
  });

  it("kind e status inesperados (adapter que monta ProviderError com texto) não chegam ao histórico", async () => {
    const forged = new ProviderError(`server ${SECRET}` as never, "x", `503 ${SECRET}` as never, null, `detalhe ${SECRET}`);
    const { run, history } = await failingRun(forged);
    expect(run.body.error).toBe("unexpected: ProviderError");
    expect(everything(run.body, history.body)).not.toContain(SECRET);
    const badStatus = await failingRun(new ProviderError("server", "x", 99_999));
    expect(badStatus.run.body.error).toBe("server");
  });

  it("linhas antigas do histórico, gravadas com texto livre, saem normalizadas na leitura", async () => {
    const t = setup();
    const id = await t.connect("instagram", "acc_1", SECRET);
    await t.sync(id);
    // simula um banco anterior a esta correção
    const db = (t as unknown as { db: ReturnType<typeof openDatabase> }).db;
    db.prepare("UPDATE sync_runs SET error = ? WHERE connection_id = ?").run(`unexpected: falhou com ${SECRET} na conta`, id);
    const legacy = (await t.runs(id)).body[0].error as string;
    expect(legacy).toBe("unexpected: Error");
    db.prepare("UPDATE sync_runs SET error = ? WHERE connection_id = ?").run("server: o provedor respondeu 503 em https://x/?access_token=" + SECRET, id);
    expect((await t.runs(id)).body[0].error).toBe("server (503)");
    expect(listRuns(db, id)[0]!.error).toBe("server (503)");
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
  it("o log mostra só a origem: sem usuário, senha, caminho, query nem hash", () => {
    expect(originOf("https://usuario:senha@api.exemplo:8443/v1/SEGREDO/posts?access_token=abc#frag")).toBe("https://api.exemplo:8443");
    expect(originOf("http://127.0.0.1:4011")).toBe("http://127.0.0.1:4011");
    expect(originOf("isso não é uma url")).toBe("(URL inválida)");
  });

  it.each([
    ["com protocolo errado e credenciais", "ftp://usuario:S3NH4-secreta@api.exemplo/x?token=abc"],
    ["sem protocolo, com usuário e senha", "u:S3NH4-secreta@api.exemplo/x"],
    ["só usuário@host", "S3NH4-secreta@api.exemplo/x"],
    ["senha com barra sem codificar", "https://u:pa/S3NH4-secreta@host/x"],
    ["um token colado no lugar da URL", "token=S3NH4-secreta"],
  ])("PROVIDER_URL inválida (%s) não é repetida na mensagem de erro", (_name, value) => {
    try {
      loadConfig({ PROVIDER_URL: value });
      throw new Error("deveria ter falhado");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).not.toContain("S3NH4-secreta");
      expect((error as ConfigError).message).toMatch(/PROVIDER_URL deve ser uma URL http ou https/);
    }
  });
});

describe("normalização do que já estava gravado", () => {
  it.each([
    [null, null],
    ["timeout", "timeout"],
    ["server (503)", "server (503)"],
    ["network: ECONNREFUSED", "network: ECONNREFUSED"],
    ["client (401)", "client (401)"],
    ["unexpected: TypeError", "unexpected: TypeError"],
    ["rate_limited: o provedor pediu para esperar 120000 ms", "rate_limited: o provedor pediu para esperar 120000 ms"],
    ["too_many_pages", "too_many_pages"],
    ["pagination_loop", "pagination_loop"],
    ["cooldown_active", "cooldown_active"],
  ])("forma segura %j é mantida", (input, expected) => {
    expect(normalizeStoredError(input)).toBe(expected);
  });

  it.each([
    ["unexpected: falhou com tok-1 na conta", "unexpected: Error"],
    ["antes unexpected: TypeError", "unexpected: Error"],
    ["unexpected: TypeError e mais texto com tok-2", "unexpected: Error"],
    ["server: o provedor respondeu 503", "server (503)"],
    ["server (503) com segredo tok-3", "server (503)"],
    ["rate_limited: o provedor pediu para esperar 5 ms e depois tok-4", "rate_limited"],
    ["rate_limited: o provedor pediu para esperar 5 ms (acima do máximo representável; cooldown fixado em 9999-12-31T23:59:59.999Z)", "rate_limited: o provedor pediu para esperar 5 ms (acima do máximo representável; cooldown fixado em 9999-12-31T23:59:59.999Z)"],
    ["rate_limited: o provedor pediu para esperar 5 ms (cooldown fixado em tok-9)", "rate_limited"],
    ["xrate_limited: o provedor pediu para esperar 5 ms", "unexpected: Error"],
    ["too_many_pages e texto", "unexpected: Error"],
    ["pagination_loopx", "unexpected: Error"],
    ["network: ECONN REFUSED tok-5", "network"],
    ["falha qualquer", "unexpected: Error"],
  ])("texto livre %j é normalizado", (input, expected) => {
    expect(normalizeStoredError(input)).toBe(expected);
  });

  it.each([
    ["unexpected: tokSECRETfa", "unexpected: Error"],
    ["unexpected: TypeError", "unexpected: TypeError"],
    ["server: tok_SECRET_9f3a", "server"],
    ["client: sk_live_abcDEF123", "client"],
    ["rate_limited: tok123", "rate_limited"],
    ["network: ECONNREFUSED", "network: ECONNREFUSED"],
    ["network: ECONNREFUSED_x", "network"],
    ["timeout: body", "timeout: body"],
    ["timeout: bodyx", "timeout"],
  ])("a forma só é aceita com valores de listas fechadas: %j → %j", (input, expected) => {
    expect(normalizeStoredError(input)).toBe(expected);
  });

  it("cooldown de conexão que não existe é nulo", () => {
    expect(activeCooldown(openDatabase(":memory:"), "nao-existe", new Date())).toBeNull();
  });
});
