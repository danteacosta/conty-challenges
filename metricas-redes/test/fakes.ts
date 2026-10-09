import type { PostSnapshot } from "../src/domain/types.ts";
import { ProviderError, type FetchRequest, type FetchResult, type MetricsProvider } from "../src/providers/port.ts";

/** Relógio controlado: `sleep` não espera de verdade, só anda o relógio e registra quanto foi pedido. */
export class FakeClock {
  readonly waits: number[] = [];
  private t: number;
  constructor(iso: string) {
    this.t = Date.parse(iso);
  }
  now = () => new Date(this.t);
  sleep = async (ms: number) => {
    this.waits.push(ms);
    this.t += ms;
  };
  set(iso: string) {
    this.t = Date.parse(iso);
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** Provedor simulado em memória (a mesma interface do cliente HTTP, sem rede): serve posts por janela e falha sob comando. */
export class FakeProvider implements MetricsProvider {
  readonly calls: Array<FetchRequest & { at: Date }> = [];
  posts: PostSnapshot[] = [];
  pageSize = Number.POSITIVE_INFINITY;
  duplicateEachItem = false;
  invalidPerPage = 0;
  stuckCursor = false;
  private failures: Error[] = [];
  private failuresAtCall = new Map<number, Error>();
  private readonly clock: FakeClock;
  constructor(clock: FakeClock) {
    this.clock = clock;
  }

  failNext(...errors: Error[]) {
    this.failures.push(...errors);
  }
  failOnCall(callNumber: number, error: Error) {
    this.failuresAtCall.set(callNumber, error);
  }

  async fetchPosts(req: FetchRequest): Promise<FetchResult> {
    this.calls.push({ ...req, at: this.clock.now() });
    const scripted = this.failuresAtCall.get(this.calls.length) ?? this.failures.shift();
    if (scripted) throw scripted;
    const inWindow = this.posts.filter((p) => p.publishedAt >= req.since && p.publishedAt <= req.until);
    const start = req.cursor ? Number(req.cursor) : 0;
    const end = Math.min(inWindow.length, start + this.pageSize);
    let items = inWindow.slice(start, end);
    if (this.duplicateEachItem) items = items.flatMap((item) => [item, { ...item }]);
    const nextCursor = this.stuckCursor ? "0" : end < inWindow.length ? String(end) : null;
    return { items, invalid: this.invalidPerPage, nextCursor };
  }
}

export const snap = (postId: string, publishedAt: string, asOf: string, views: number, extra: Partial<PostSnapshot> = {}): PostSnapshot => ({
  postId,
  publishedAt,
  asOf,
  views,
  likes: 0,
  comments: 0,
  shares: 0,
  ...extra,
});

export const timeout = () => new ProviderError("timeout", "sem resposta");
export const network = () => new ProviderError("network", "conexão recusada");
export const server = (status = 500) => new ProviderError("server", `o provedor respondeu ${status}`, status);
export const client = (status = 401) => new ProviderError("client", `o provedor respondeu ${status}`, status);
export const limited = (retryAfterMs: number | null) => new ProviderError("rate_limited", "429", 429, retryAfterMs);
