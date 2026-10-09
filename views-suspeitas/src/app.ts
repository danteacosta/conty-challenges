import { Hono } from "hono";
import { classify } from "./domain/classify.ts";
import { CRITERIA_VERSION, NOT_DETECTED, THRESHOLDS } from "./domain/criteria.ts";
import { validateSeries } from "./validate.ts";

/** A API: classifica uma série, expõe o critério e o que ele não detecta. Sem estado e sem banco: é uma função pura atrás de HTTP. */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/criteria", (c) => c.json({ version: CRITERIA_VERSION, thresholds: THRESHOLDS, not_detected: NOT_DETECTED }));

  app.post("/classify", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "validation_error", field: "series", message: "o corpo precisa ser um JSON com o campo series" }, 400);
    }
    const checked = validateSeries(body);
    if (!checked.ok) return c.json({ error: "validation_error", field: "series", message: checked.message }, 400);
    return c.json(classify(checked.series));
  });

  return app;
}
