import type { NormalizedEvent, Status } from "./types.ts";

/**
 * Status atual de um envio, calculado SEMPRE a partir do histórico inteiro (nada é atualizado "aos poucos"),
 * então a ordem em que os eventos chegaram não muda o resultado.
 *
 * - Vale o evento de maior data de ocorrência (não o de chegada): evento antigo que chega depois não regride nada.
 * - Empate de horário: entregue > exceção > saiu para entrega > em trânsito > postado.
 * - Empate também no status (duas exceções no mesmo instante): vence o evento com motivo, ou seja, o código que a
 *   transportadora inventou (a anomalia continua visível para completar o mapeamento), e por fim a dedupeKey.
 *   A ordem é total, então o resultado nunca depende da ordem de chegada.
 * - Entregue é terminal: eventos posteriores à entrega ficam no histórico, marcados, sem mudar o status.
 * - Exceção seguida de um evento mais novo se recupera (a tentativa falha de hoje vira a entrega de amanhã).
 */
const TIE_PRIORITY: Record<Status, number> = {
  posted: 0,
  in_transit: 1,
  out_for_delivery: 2,
  exception: 3,
  delivered: 4,
};

export type Fold = {
  status: Status | null;
  reason: string | null;
  startedAt: string | null;
  lastEventAt: string | null;
  deliveredAt: string | null;
  /** dedupeKey dos eventos posteriores à entrega. */
  afterDelivered: Set<string>;
};

const at = (event: NormalizedEvent) => Date.parse(event.occurredAt);

/** Ordem total e crescente: o último elemento é o que vale. */
function byTimeThenPriority(a: NormalizedEvent, b: NormalizedEvent): number {
  return (
    at(a) - at(b) ||
    TIE_PRIORITY[a.status] - TIE_PRIORITY[b.status] ||
    Number(a.reason !== null) - Number(b.reason !== null) ||
    (a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)
  );
}

export function foldEvents(events: NormalizedEvent[]): Fold {
  if (events.length === 0) {
    return { status: null, reason: "no_events_yet", startedAt: null, lastEventAt: null, deliveredAt: null, afterDelivered: new Set() };
  }
  const ordered = [...events].sort(byTimeThenPriority);
  const first = ordered[0] as NormalizedEvent;
  const last = ordered[ordered.length - 1] as NormalizedEvent;
  const delivered = ordered.find((event) => event.status === "delivered");

  if (delivered) {
    const after = ordered.filter((event) => at(event) > at(delivered) && event.status !== "delivered");
    return {
      status: "delivered",
      reason: delivered.reason,
      startedAt: first.occurredAt,
      lastEventAt: last.occurredAt,
      deliveredAt: delivered.occurredAt,
      afterDelivered: new Set(after.map((event) => event.dedupeKey)),
    };
  }
  return {
    status: last.status,
    reason: last.reason,
    startedAt: first.occurredAt,
    lastEventAt: last.occurredAt,
    deliveredAt: null,
    afterDelivered: new Set(),
  };
}
