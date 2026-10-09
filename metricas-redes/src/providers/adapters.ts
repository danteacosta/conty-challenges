import type { PostSnapshot } from "../domain/types.ts";
import { parseInstant } from "../instant.ts";

/**
 * Cada rede chama as mesmas coisas de um jeito: este é o único lugar que sabe como. Uma rede nova é uma linha nova
 * na tabela. Item que não bate com o formato vira null (e é contado como inválido), nunca um número inventado.
 */
export const PROVIDERS = ["instagram", "tiktok", "youtube", "x"] as const;
export type Provider = (typeof PROVIDERS)[number];

type Fields = {
  id: string;
  publishedAt: string;
  asOf: string;
  /** `iso` = texto ISO-8601; `epoch` = segundos desde 1970. */
  time: "iso" | "epoch";
  views: string;
  likes?: string;
  comments?: string;
  shares?: string;
};

const FIELDS: Record<Provider, Fields> = {
  instagram: { id: "id", publishedAt: "timestamp", asOf: "snapshot_at", time: "iso", views: "plays", likes: "like_count", comments: "comments_count", shares: "shares" },
  tiktok: { id: "video_id", publishedAt: "create_time", asOf: "snapshot_time", time: "epoch", views: "play_count", likes: "digg_count", comments: "comment_count", shares: "share_count" },
  youtube: { id: "videoId", publishedAt: "publishedAt", asOf: "retrievedAt", time: "iso", views: "viewCount", likes: "likeCount", comments: "commentCount" },
  x: { id: "tweet_id", publishedAt: "created_at", asOf: "as_of", time: "iso", views: "impression_count", likes: "like_count", comments: "reply_count", shares: "retweet_count" },
};

/** Inteiro ≥ 0, como número ou como texto de dígitos (o YouTube manda contadores como texto). */
function count(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function instant(value: unknown, kind: Fields["time"]): string | null {
  if (kind === "iso") return parseInstant(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeItem(provider: Provider, raw: unknown): PostSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const fields = FIELDS[provider];

  const postId = typeof item[fields.id] === "string" ? (item[fields.id] as string).trim() : "";
  const publishedAt = instant(item[fields.publishedAt], fields.time);
  const asOf = instant(item[fields.asOf], fields.time);
  const views = count(item[fields.views]);
  if (postId === "" || publishedAt === null || asOf === null || views === null) return null;

  const optional = (name: string | undefined): number | null => {
    if (name === undefined || item[name] === undefined) return 0;
    return count(item[name]);
  };
  const likes = optional(fields.likes);
  const comments = optional(fields.comments);
  const shares = optional(fields.shares);
  if (likes === null || comments === null || shares === null) return null;

  return { postId, publishedAt, asOf, views, likes, comments, shares };
}
