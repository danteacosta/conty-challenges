/** Converte "100.00" (ou 100) em centavos inteiros. Devolve null se não for um valor monetário válido. */
export function toCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    value = String(value);
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, units, fraction = ""] = match;
  return Number(units) * 100 + Number(fraction.padEnd(2, "0"));
}
