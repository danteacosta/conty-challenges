import { THRESHOLDS as T } from "./domain/criteria.ts";

export type Validation = { ok: true; series: number[] } | { ok: false; message: string };

/** Valida o corpo de POST /classify: lista de 24 a 1.440 inteiros não negativos, até 1 bilhão por hora. */
export function validateSeries(body: unknown): Validation {
  const series = (body as { series?: unknown } | null)?.series;
  if (!Array.isArray(series)) return { ok: false, message: "series deve ser uma lista de números (views por hora)" };
  if (series.length < T.min_hours) return { ok: false, message: `series precisa de pelo menos ${T.min_hours} horas; recebi ${series.length}` };
  if (series.length > T.max_hours) return { ok: false, message: `series aceita no máximo ${T.max_hours} horas (60 dias); recebi ${series.length}` };
  for (let hour = 0; hour < series.length; hour += 1) {
    const value = series[hour];
    if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, message: `series[${hour}] deve ser um número inteiro de views` };
    if (value < 0) return { ok: false, message: `series[${hour}] não pode ser negativo` };
    if (value > T.max_value_per_hour) return { ok: false, message: `series[${hour}] passa de ${T.max_value_per_hour} views por hora` };
  }
  return { ok: true, series: series as number[] };
}
