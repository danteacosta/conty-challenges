import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { plateau, steady } from "./series.ts";

const app = createApp();
const post = async (body: unknown) => {
  const res = await app.request("/classify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};

describe("POST /classify", () => {
  it("devolve a classificação, o motivo legível e os sinais usados", async () => {
    const res = await post({ series: plateau(steady(), 60, 77, 6200) });
    expect(res.status).toBe(200);
    expect(res.body.classification).toBe("suspicious");
    expect(res.body.reason).toMatch(/^Suspeito:/);
    expect(res.body.signals[0]).toMatchObject({ name: "plateau_then_cliff", effect: "suspicious", from_hour: 60, to_hour: 77 });
    expect(res.body.summary).toMatchObject({ hours: 168 });
    expect(res.body.criteria_version).toBe(1);
  });

  it("série normal é orgânica", async () => {
    expect((await post({ series: steady() })).body.classification).toBe("organic");
  });

  it.each([
    ["sem o campo", {}],
    ["não é lista", { series: "1,2,3" }],
    ["menos de 24 horas", { series: Array.from({ length: 23 }, () => 100) }],
    ["mais de 1.440 horas (60 dias)", { series: Array.from({ length: 1441 }, () => 100) }],
    ["valor negativo", { series: [...steady(30), -1] }],
    ["valor fracionário", { series: [...steady(30), 1.5] }],
    ["valor em texto", { series: [...steady(30), "100"] }],
    ["valor nulo", { series: [...steady(30), null] }],
    ["valor gigante (acima de 1 bilhão por hora)", { series: [...steady(30), 2_000_000_000] }],
  ])("%s é 400 e diz o que está errado", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "validation_error", field: "series" });
    expect(typeof res.body.message).toBe("string");
  });

  it("corpo que não é JSON é 400", async () => {
    const res = await app.request("/classify", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(res.status).toBe(400);
  });

  it("aceita exatamente 24 horas e exatamente 1.440", async () => {
    expect((await post({ series: steady(24) })).status).toBe(200);
    expect((await post({ series: steady(1440) })).status).toBe(200);
  });
});

describe("GET /criteria: o critério e o que ele NÃO detecta ficam na própria API", () => {
  it("lista os limiares usados e o que o classificador não detecta", async () => {
    const res = await app.request("/criteria");
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.version).toBe(1);
    expect(body.thresholds).toMatchObject({ min_hours: 24, max_hours: 1440 });
    expect(body.thresholds.plateau_regularity_suspicious).toBeGreaterThan(0);
    expect(body.thresholds.plateau_band).toBeGreaterThan(0);
    expect(Array.isArray(body.not_detected)).toBe(true);
    expect(body.not_detected.length).toBeGreaterThanOrEqual(4);
    expect(body.not_detected.join(" ")).toMatch(/ruído|variação natural/);
  });

  it("a rota de saúde responde", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });
});
