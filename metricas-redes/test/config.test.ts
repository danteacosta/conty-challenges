import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

describe("configuração do ambiente", () => {
  it("sem nada definido usa os padrões documentados", () => {
    expect(loadConfig({})).toEqual({ port: 3014, dbPath: ":memory:", providerUrl: "http://127.0.0.1:4011", providerTimeoutMs: 5000, maxRetryAfterMs: 30_000 });
  });

  it("lê os valores definidos, ignorando espaços ao redor", () => {
    expect(loadConfig({ PORT: " 8080 ", DB_PATH: " /dados/m.sqlite ", PROVIDER_URL: " https://provedor.example ", PROVIDER_TIMEOUT_MS: "1500", MAX_RETRY_AFTER_MS: " 60000 " })).toEqual({
      port: 8080,
      dbPath: "/dados/m.sqlite",
      providerUrl: "https://provedor.example",
      providerTimeoutMs: 1500,
      maxRetryAfterMs: 60_000,
    });
  });

  it.each([
    ["NaN", "abc"],
    ["vazio", ""],
    ["só espaços", "   "],
    ["negativo", "-1"],
    ["decimal", "1.5"],
    ["Infinity", "Infinity"],
    ["notação científica", "1e3"],
    ["hexadecimal", "0x10"],
    ["com unidade", "30s"],
    ["acima de uma hora", "3600001"],
  ])("MAX_RETRY_AFTER_MS %s (%j) é recusado: sem isso o teto de espera deixaria de valer", (_name, value) => {
    expect(() => loadConfig({ MAX_RETRY_AFTER_MS: value })).toThrowError(ConfigError);
    expect(() => loadConfig({ MAX_RETRY_AFTER_MS: value })).toThrowError(/MAX_RETRY_AFTER_MS/);
  });

  it("o teto de espera aceita de 0 (adiar sempre) a uma hora", () => {
    expect(loadConfig({ MAX_RETRY_AFTER_MS: "0" }).maxRetryAfterMs).toBe(0);
    expect(loadConfig({ MAX_RETRY_AFTER_MS: "3600000" }).maxRetryAfterMs).toBe(3_600_000);
  });

  it.each([
    ["PORT", "0"], ["PORT", "65536"], ["PORT", "x"],
    ["PROVIDER_TIMEOUT_MS", "99"], ["PROVIDER_TIMEOUT_MS", "120001"], ["PROVIDER_TIMEOUT_MS", "NaN"],
    ["PROVIDER_URL", "não é url"], ["PROVIDER_URL", "ftp://x.example"], ["PROVIDER_URL", ""],
    ["DB_PATH", ""],
  ])("%s=%j é recusado com o nome da variável", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrowError(new RegExp(name));
  });

  it("limites aceitos: porta 1 e 65535, timeout 100 e 120000", () => {
    expect(loadConfig({ PORT: "1" }).port).toBe(1);
    expect(loadConfig({ PORT: "65535" }).port).toBe(65535);
    expect(loadConfig({ PROVIDER_TIMEOUT_MS: "100" }).providerTimeoutMs).toBe(100);
    expect(loadConfig({ PROVIDER_TIMEOUT_MS: "120000" }).providerTimeoutMs).toBe(120_000);
  });

  it("junta todos os problemas numa mensagem só", () => {
    try {
      loadConfig({ PORT: "x", MAX_RETRY_AFTER_MS: "-3", PROVIDER_TIMEOUT_MS: "0" });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toHaveLength(3);
      expect((error as Error).name).toBe("ConfigError");
      expect((error as Error).message).toMatch(/^Configuração inválida:\n- PORT/);
      return;
    }
    throw new Error("deveria ter falhado");
  });
});

describe("inicialização do servidor", () => {
  function start(env: Record<string, string>) {
    const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
    return spawnSync(process.execPath, [tsx, "src/index.ts"], { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8", timeout: 15_000 });
  }

  it.each([
    [{ MAX_RETRY_AFTER_MS: "abc" }, /MAX_RETRY_AFTER_MS/],
    [{ PORT: "99999" }, /PORT/],
    [{ PROVIDER_URL: "não é url" }, /PROVIDER_URL/],
  ])("%j: sai com erro e diz o que está errado, sem subir", (env, message) => {
    const result = start(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(result.stdout).not.toMatch(/metricas-redes em http/);
  });
});
