import type { CarrierEvent } from "../../domain/types.ts";
import { AggregatorError, type TrackingAggregator } from "../port.ts";
import { mapTrackHubPayload, verifyTrackHubEnvelope } from "./mapper.ts";

export type TrackHubOptions = { baseUrl: string; apiKey: string; timeoutMs?: number; fetch?: typeof fetch };

const DEFAULT_TIMEOUT_MS = 5000;

/** Cliente HTTP do TrackHub atrás da interface TrackingAggregator. */
export class HttpTrackHubClient implements TrackingAggregator {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: TrackHubOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.doFetch = options.fetch ?? fetch;
  }

  async register(code: string, carrier: string): Promise<void> {
    await this.request("POST", "/v1/trackings", { tracking_number: code, courier: carrier });
  }

  async fetchEvents(code: string, carrier: string): Promise<CarrierEvent[]> {
    const response = await this.request("GET", `/v1/trackings/${encodeURIComponent(code)}`, undefined, [404]);
    // 404 = o agregador ainda não conhece o código: não há eventos, o que não é um erro.
    if (response.status === 404) return [];
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AggregatorError("invalid_payload", "o TrackHub devolveu um corpo que não é JSON");
    }
    verifyTrackHubEnvelope(payload, { code, carrier });
    return mapTrackHubPayload(payload);
  }

  private async request(method: string, path: string, body?: unknown, acceptedStatuses: number[] = []): Promise<Response> {
    let response: Response;
    try {
      response = await this.doFetch(this.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new AggregatorError("timeout", `o TrackHub não respondeu em ${this.timeoutMs} ms`);
      }
      throw new AggregatorError("network", `não foi possível falar com o TrackHub: ${(error as Error).message}`);
    }
    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      throw new AggregatorError("http", `o TrackHub respondeu ${response.status}`, response.status);
    }
    return response;
  }
}
