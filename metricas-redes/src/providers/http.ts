import { parseRetryAfter } from "../domain/retry-after.ts";
import { normalizeItem, type Provider } from "./adapters.ts";
import { ProviderError, type FetchRequest, type FetchResult, type MetricsProvider } from "./port.ts";

export type HttpProviderOptions = {
  baseUrl: string;
  network: Provider;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Relógio usado para converter um Retry-After em data HTTP em milissegundos. */
  now?: () => Date;
};

const DEFAULT_TIMEOUT_MS = 5000;

/** Contexto seguro de uma falha de transporte: a classe do erro e o código de sistema (ECONNREFUSED...), sem a mensagem, que pode ter URL e credenciais. */
function transportContext(error: unknown): string {
  const simple = (value: unknown, fallback: string) => (typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(value) ? value : fallback);
  const name = simple((error as { name?: unknown } | null)?.name, "Error");
  const code = simple(((error as { cause?: { code?: unknown } } | null)?.cause?.code ?? (error as { code?: unknown } | null)?.code) as unknown, "");
  return code ? `${name}, ${code}` : name;
}

/** Cliente HTTP de uma rede, atrás da interface MetricsProvider. Converte o que a rede diz em falhas tipadas. */
export class HttpMetricsProvider implements MetricsProvider {
  private readonly options: HttpProviderOptions;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;
  private readonly now: () => Date;

  constructor(options: HttpProviderOptions) {
    this.options = options;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.doFetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async fetchPosts(request: FetchRequest): Promise<FetchResult> {
    const url = new URL(`${this.baseUrl}/v1/${this.options.network}/posts`);
    url.searchParams.set("account", request.account);
    url.searchParams.set("since", request.since);
    url.searchParams.set("until", request.until);
    if (request.cursor !== null) url.searchParams.set("cursor", request.cursor);

    let response: Response;
    try {
      response = await this.doFetch(url, {
        headers: { authorization: `Bearer ${request.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ProviderError("timeout", `o provedor não respondeu em ${this.timeoutMs} ms`);
      }
      throw new ProviderError("network", `não foi possível falar com o provedor (${transportContext(error)})`);
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), this.now());
      throw new ProviderError("rate_limited", "o provedor respondeu 429", 429, retryAfterMs);
    }
    if (response.status === 408) throw new ProviderError("timeout", "o provedor respondeu 408", 408);
    if (response.status >= 500) throw new ProviderError("server", `o provedor respondeu ${response.status}`, response.status);
    if (!response.ok) throw new ProviderError("client", `o provedor respondeu ${response.status}`, response.status);

    // Ler o corpo e interpretá-lo são duas falhas diferentes: a primeira é de transporte (vale repetir), a segunda é do provedor.
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ProviderError("timeout", `o provedor não terminou de enviar o corpo em ${this.timeoutMs} ms`);
      }
      throw new ProviderError("network", `a conexão com o provedor caiu durante o corpo (${transportContext(error)})`);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderError("invalid_payload", "o provedor devolveu um corpo que não é JSON");
    }
    if (typeof body !== "object" || body === null || !Array.isArray((body as { data?: unknown }).data)) {
      throw new ProviderError("invalid_payload", "o corpo do provedor não tem a lista data");
    }
    const { data, next_cursor: nextCursor } = body as { data: unknown[]; next_cursor?: unknown };
    if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== "string") {
      throw new ProviderError("invalid_payload", "next_cursor não é texto");
    }

    const items = [];
    let invalid = 0;
    for (const raw of data) {
      const item = normalizeItem(this.options.network, raw);
      if (item) items.push(item);
      else invalid += 1;
    }
    return { items, invalid, nextCursor: nextCursor ?? null };
  }
}
