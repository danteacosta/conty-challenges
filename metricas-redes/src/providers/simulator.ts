import { Hono } from "hono";
import { PROVIDERS, type Provider } from "./adapters.ts";

/**
 * Provedor de métricas SIMULADO, no formato de cada rede (Instagram, TikTok, YouTube, X). É o que o serviço usa nos testes e
 * na demonstração no lugar das APIs reais. Pode falhar sob comando: timeout, 429 com Retry-After, 5xx, itens duplicados e
 * itens inválidos. Nada aqui é regra de negócio: ela mora em `src/sync.ts`.
 */
export type SimPost = { id: string; publishedAt: string; views: number; likes?: number; comments?: number; shares?: number };
export type Behavior = "ok" | "timeout" | { status: number; retryAfter?: string; body?: string };
export type SimRequest = { network: string; account: string | undefined; authorization: string | undefined; since: string | undefined; until: string | undefined; cursor: string | null };

class SimulatorState {
  now = new Date();
  pageSize = 100;
  duplicateItems = false;
  corruptItems = 0;
  timeoutDelayMs = 2000;
  behaviors: Behavior[] = [];
  requests: SimRequest[] = [];
  private accounts = new Map<string, SimPost[]>();

  setPosts(network: Provider, account: string, posts: SimPost[]) {
    this.accounts.set(`${network}:${account}`, posts);
  }
  postsOf(network: string, account: string): SimPost[] {
    return this.accounts.get(`${network}:${account}`) ?? [];
  }
  reset() {
    this.now = new Date();
    this.pageSize = 100;
    this.duplicateItems = false;
    this.corruptItems = 0;
    this.timeoutDelayMs = 2000;
    this.behaviors = [];
    this.requests = [];
    this.accounts.clear();
  }
}

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** O formato bruto de cada rede: nomes de campo, tipos e unidades diferentes para a mesma informação. */
function rawItem(network: Provider, post: SimPost, asOf: string): Record<string, unknown> {
  const { views, likes = 0, comments = 0, shares = 0 } = post;
  switch (network) {
    case "instagram":
      return { id: post.id, timestamp: post.publishedAt, snapshot_at: asOf, plays: views, like_count: likes, comments_count: comments, shares };
    case "tiktok":
      return { video_id: post.id, create_time: epoch(post.publishedAt), snapshot_time: epoch(asOf), play_count: views, digg_count: likes, comment_count: comments, share_count: shares };
    case "youtube":
      return { videoId: post.id, publishedAt: post.publishedAt, retrievedAt: asOf, viewCount: String(views), likeCount: String(likes), commentCount: String(comments) };
    case "x":
      return { tweet_id: post.id, created_at: post.publishedAt, as_of: asOf, impression_count: views, like_count: likes, reply_count: comments, retweet_count: shares };
  }
}

export function createSimulator() {
  const state = new SimulatorState();
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/v1/:network/posts", async (c) => {
    const network = c.req.param("network");
    const query = c.req.query();
    state.requests.push({ network, account: query.account, authorization: c.req.header("authorization"), since: query.since, until: query.until, cursor: query.cursor ?? null });

    const behavior = state.behaviors.shift() ?? "ok";
    if (behavior === "timeout") await new Promise((resolve) => setTimeout(resolve, state.timeoutDelayMs));
    else if (behavior !== "ok") {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (behavior.retryAfter !== undefined) headers["retry-after"] = behavior.retryAfter;
      return new Response(behavior.body ?? '{"error":"simulated"}', { status: behavior.status, headers });
    }

    if (!c.req.header("authorization")?.startsWith("Bearer ")) return c.json({ error: "unauthorized" }, 401);
    if (!(PROVIDERS as readonly string[]).includes(network)) return c.json({ error: "unknown network" }, 404);

    const asOf = state.now.toISOString();
    const since = Date.parse(query.since ?? "");
    const until = Date.parse(query.until ?? "");
    const inWindow = state.postsOf(network, query.account ?? "").filter((p) => Date.parse(p.publishedAt) >= since && Date.parse(p.publishedAt) <= until);
    const start = query.cursor ? Number(query.cursor) : 0;
    const end = Math.min(inWindow.length, start + state.pageSize);
    let data: unknown[] = inWindow.slice(start, end).map((post) => rawItem(network as Provider, post, asOf));
    if (state.duplicateItems) data = data.flatMap((item) => [item, { ...(item as object) }]);
    for (let i = 0; i < state.corruptItems; i += 1) data.push({ lixo: true });
    return c.json({ data, next_cursor: end < inWindow.length ? String(end) : null });
  });

  return { app, state };
}
