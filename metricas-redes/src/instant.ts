/**
 * Instante ISO-8601 estrito: `YYYY-MM-DDTHH:MM:SS[.fff]` com fuso obrigatório (`Z` ou `±HH:MM`).
 * Devolve o instante normalizado em UTC, ou null se não for um instante possível.
 *
 * `Date.parse` é permissivo demais para validar entrada: "2026-02-30" vira 2 de março, o que gravaria uma data
 * que nunca existiu e mudaria a janela de atribuição sem ninguém perceber. Aqui cada campo é conferido.
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const fraction = match[7] ?? "";
  const zone = match[8] as string;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (zone[0] === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }

  // setUTCFullYear: Date.UTC trataria os anos 0..99 como 1900..1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3).padEnd(3, "0")));
  date.setTime(date.getTime() - offsetMinutes * 60_000);
  return date.toISOString();
}
