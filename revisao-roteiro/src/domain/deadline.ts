/**
 * O prazo de um pedido de alteração é um DIA no fuso da marca (America/Sao_Paulo), e o último instante desse dia ainda vale.
 *
 * O dia é sempre o dia civil em São Paulo, nunca o dia em UTC: às 01:30Z de 13/03 ainda são 22:30 de 12/03 em São Paulo,
 * e cortar o ISO nos 10 primeiros caracteres (`slice(0, 10)`) dá o dia errado. `Intl` também respeita o horário de verão
 * que o Brasil tinha até 2019, em vez de fixar -03:00.
 */
const BRAND_ZONE = "America/Sao_Paulo";

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function civilDayInBrandZone(instant: Date): string {
  const parts = Object.fromEntries(dayFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Depois do último instante do dia do prazo, ou seja, a partir do primeiro instante do dia seguinte em São Paulo. */
function isAfterDeadlineDay(deadlineDate: string, instant: Date): boolean {
  return civilDayInBrandZone(instant) > deadlineDate;
}

/** Um pedido com prazo que já passou não vale. */
export const isDeadlineInPast = isAfterDeadlineDay;

/** Uma versão enviada depois do dia do prazo é tardia. */
export const isLateFor = isAfterDeadlineDay;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `YYYY-MM-DD` de uma data que existe no calendário. `2026-02-30` não existe, e não vira 2 de março em silêncio. */
export function parseCalendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return value;
}
