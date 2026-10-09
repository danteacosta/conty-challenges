import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { ConfigError, loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { InMemoryAggregator, RecordingNotifier } from "./fakes.ts";

describe("configuração do ambiente", () => {
  it("sem nada definido usa os padrões documentados", () => {
    expect(loadConfig({})).toEqual({
      port: 3012,
      dbPath: ":memory:",
      trackhubUrl: "http://127.0.0.1:4010",
      trackhubApiKey: "dev-key",
      trackhubTimeoutMs: 5000,
      thresholdHours: 168,
    });
  });

  it("lê os valores definidos", () => {
    expect(
      loadConfig({ PORT: "8080", DB_PATH: "/dados/rastreio.sqlite", TRACKHUB_URL: "https://trackhub.example/api", TRACKHUB_API_KEY: "k", TRACKHUB_TIMEOUT_MS: "1500", TRANSIT_THRESHOLD_HOURS: "72.5" }),
    ).toEqual({ port: 8080, dbPath: "/dados/rastreio.sqlite", trackhubUrl: "https://trackhub.example/api", trackhubApiKey: "k", trackhubTimeoutMs: 1500, thresholdHours: 72.5 });
  });

  it.each([
    ["NaN", "abc"],
    ["vazio", ""],
    ["só espaços", "   "],
    ["zero", "0"],
    ["negativo", "-1"],
    ["Infinity", "Infinity"],
    ["notação científica gigante", "1e999"],
    ["acima de um ano", "8761"],
    ["com unidade", "72h"],
    ["hexadecimal", "0x10"],
    ["notação científica", "1e2"],
    ["com sinal de mais", "+72"],
    ["sem parte inteira", ".5"],
    ["ponto final sem decimais", "5."],
    ["com separador de milhar", "1_000"],
    ["vírgula decimal", "72,5"],
  ])("TRANSIT_THRESHOLD_HOURS %s (%j) é recusado", (_name, value) => {
    expect(() => loadConfig({ TRANSIT_THRESHOLD_HOURS: value })).toThrowError(ConfigError);
    expect(() => loadConfig({ TRANSIT_THRESHOLD_HOURS: value })).toThrowError(/TRANSIT_THRESHOLD_HOURS/);
  });

  it("o limite de atraso aceita o intervalo inteiro: de uma fração de hora a um ano", () => {
    expect(loadConfig({ TRANSIT_THRESHOLD_HOURS: "0.5" }).thresholdHours).toBe(0.5);
    expect(loadConfig({ TRANSIT_THRESHOLD_HOURS: "8760" }).thresholdHours).toBe(8760);
  });

  it.each([
    ["PORT", "0"],
    ["PORT", "65536"],
    ["PORT", "80.5"],
    ["PORT", "abc"],
    ["TRACKHUB_TIMEOUT_MS", "0"],
    ["TRACKHUB_TIMEOUT_MS", "99"],
    ["TRACKHUB_TIMEOUT_MS", "120001"],
    ["TRACKHUB_TIMEOUT_MS", "1.5"],
    ["TRACKHUB_TIMEOUT_MS", "NaN"],
    ["TRACKHUB_URL", "não é url"],
    ["TRACKHUB_URL", "ftp://trackhub.example"],
    ["TRACKHUB_URL", ""],
    ["TRACKHUB_API_KEY", "  "],
    ["DB_PATH", ""],
  ])("%s=%j é recusado com o nome da variável", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrowError(new RegExp(name));
  });

  it("limites aceitos: porta 1 e 65535, timeout 100 e 120000", () => {
    expect(loadConfig({ PORT: "1" }).port).toBe(1);
    expect(loadConfig({ PORT: "65535" }).port).toBe(65535);
    expect(loadConfig({ TRACKHUB_TIMEOUT_MS: "100" }).trackhubTimeoutMs).toBe(100);
    expect(loadConfig({ TRACKHUB_TIMEOUT_MS: "120000" }).trackhubTimeoutMs).toBe(120_000);
  });

  it("espaços ao redor do valor são ignorados, como acontece ao copiar de um painel", () => {
    expect(loadConfig({ PORT: " 8080 ", TRACKHUB_TIMEOUT_MS: " 1500 ", TRANSIT_THRESHOLD_HOURS: " 72 ", DB_PATH: " /dados/a.sqlite ", TRACKHUB_API_KEY: " k ", TRACKHUB_URL: " https://trackhub.example " })).toEqual({
      port: 8080,
      trackhubTimeoutMs: 1500,
      thresholdHours: 72,
      dbPath: "/dados/a.sqlite",
      trackhubApiKey: "k",
      trackhubUrl: "https://trackhub.example",
    });
  });

  it("o limite aceita mais de uma casa decimal", () => {
    expect(loadConfig({ TRANSIT_THRESHOLD_HOURS: "72.25" }).thresholdHours).toBe(72.25);
    expect(loadConfig({ TRANSIT_THRESHOLD_HOURS: "0.125" }).thresholdHours).toBe(0.125);
  });

  it("o erro se identifica e abre a mensagem dizendo que a configuração é inválida", () => {
    try {
      loadConfig({ PORT: "x" });
    } catch (error) {
      expect((error as Error).name).toBe("ConfigError");
      expect((error as Error).message).toMatch(/^Configuração inválida:\n- PORT/);
      return;
    }
    throw new Error("deveria ter falhado");
  });

  it("junta todos os problemas numa mensagem só, para corrigir de uma vez", () => {
    try {
      loadConfig({ PORT: "x", TRANSIT_THRESHOLD_HOURS: "-3", TRACKHUB_TIMEOUT_MS: "0" });
      throw new Error("deveria ter falhado");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toHaveLength(3);
      expect((error as Error).message).toMatch(/PORT/);
      expect((error as Error).message).toMatch(/TRANSIT_THRESHOLD_HOURS/);
      expect((error as Error).message).toMatch(/TRACKHUB_TIMEOUT_MS/);
    }
  });

  it("a API também recusa um limite inválido, mesmo que ele não venha do ambiente", () => {
    for (const thresholdHours of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createApp({ db: openDatabase(":memory:"), aggregator: new InMemoryAggregator(), notifier: new RecordingNotifier(), now: () => new Date(), thresholdHours }),
      ).toThrowError(/thresholdHours/);
    }
  });
});
