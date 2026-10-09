import { AggregatorError, type TrackingAggregator } from "../src/aggregator/port.ts";
import type { CarrierEvent } from "../src/domain/types.ts";
import type { DelayAlert, Notifier } from "../src/alerts.ts";

/** Agregador em memória: mesma interface do cliente HTTP, sem formato de fornecedor nenhum. */
export class InMemoryAggregator implements TrackingAggregator {
  readonly registered: Array<{ code: string; carrier: string }> = [];
  private events = new Map<string, CarrierEvent[]>();
  private failure: AggregatorError | null = null;

  script(code: string, events: CarrierEvent[]) {
    this.events.set(code, events);
  }
  failWith(error: AggregatorError | null) {
    this.failure = error;
  }
  async register(code: string, carrier: string) {
    if (this.failure) throw this.failure;
    this.registered.push({ code, carrier });
  }
  async fetchEvents(code: string) {
    if (this.failure) throw this.failure;
    return this.events.get(code) ?? [];
  }
}

export class RecordingNotifier implements Notifier {
  readonly sent: DelayAlert[] = [];
  fail = false;
  async notify(alert: DelayAlert) {
    if (this.fail) throw new Error("destino fora do ar");
    this.sent.push(alert);
  }
}
