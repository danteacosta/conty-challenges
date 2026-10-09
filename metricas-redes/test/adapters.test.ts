import { describe, expect, it } from "vitest";
import { normalizeItem, PROVIDERS } from "../src/providers/adapters.ts";

describe("cada rede fala do seu jeito; o resto do sistema vê um formato só", () => {
  it("Instagram", () => {
    expect(
      normalizeItem("instagram", { id: "ig_1", timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: 1200, like_count: 90, comments_count: 7, shares: 3 }),
    ).toEqual({ postId: "ig_1", publishedAt: "2026-05-30T10:00:00.000Z", asOf: "2026-06-01T12:00:00.000Z", views: 1200, likes: 90, comments: 7, shares: 3 });
  });

  it("TikTok (datas em segundos desde 1970)", () => {
    expect(
      normalizeItem("tiktok", { video_id: "tt_1", create_time: 1_780_000_000, snapshot_time: 1_780_086_400, play_count: 5000, digg_count: 400, comment_count: 20, share_count: 11 }),
    ).toEqual({ postId: "tt_1", publishedAt: "2026-05-28T20:26:40.000Z", asOf: "2026-05-29T20:26:40.000Z", views: 5000, likes: 400, comments: 20, shares: 11 });
  });

  it("YouTube (contadores como texto, sem compartilhamentos)", () => {
    expect(
      normalizeItem("youtube", { videoId: "yt_1", publishedAt: "2026-05-30T10:00:00Z", retrievedAt: "2026-06-01T12:00:00Z", viewCount: "98000", likeCount: "3100", commentCount: "250" }),
    ).toEqual({ postId: "yt_1", publishedAt: "2026-05-30T10:00:00.000Z", asOf: "2026-06-01T12:00:00.000Z", views: 98000, likes: 3100, comments: 250, shares: 0 });
  });

  it("X (impressões contam como views)", () => {
    expect(
      normalizeItem("x", { tweet_id: "x_1", created_at: "2026-05-30T10:00:00Z", as_of: "2026-06-01T12:00:00Z", impression_count: 777, like_count: 30, reply_count: 4, retweet_count: 9 }),
    ).toEqual({ postId: "x_1", publishedAt: "2026-05-30T10:00:00.000Z", asOf: "2026-06-01T12:00:00.000Z", views: 777, likes: 30, comments: 4, shares: 9 });
  });

  it("as quatro redes estão cobertas", () => {
    expect([...PROVIDERS].sort()).toEqual(["instagram", "tiktok", "x", "youtube"]);
  });

  it.each([
    ["sem id", "instagram", { timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: 1 }],
    ["id vazio", "instagram", { id: "  ", timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: 1 }],
    ["sem views", "instagram", { id: "a", timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z" }],
    ["views negativas", "instagram", { id: "a", timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: -1 }],
    ["views fracionárias", "instagram", { id: "a", timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: 1.5 }],
    ["views em texto não numérico", "youtube", { videoId: "a", publishedAt: "2026-05-30T10:00:00Z", retrievedAt: "2026-06-01T12:00:00Z", viewCount: "muitas" }],
    ["data de publicação impossível", "instagram", { id: "a", timestamp: "2026-02-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: 1 }],
    ["data do snapshot ausente", "x", { tweet_id: "a", created_at: "2026-05-30T10:00:00Z", impression_count: 1 }],
    ["época fracionária", "tiktok", { video_id: "a", create_time: 1.5, snapshot_time: 1_780_086_400, play_count: 1 }],
    ["item que não é objeto", "x", "texto"],
    ["item nulo", "x", null],
  ])("item inválido (%s) vira null, não um número inventado", (_name, provider, raw) => {
    expect(normalizeItem(provider as "x", raw)).toBeNull();
  });

  it.each([
    ["texto vazio", ""],
    ["só espaço", " "],
    ["dígitos seguidos de letras", "12abc"],
    ["letras seguidas de dígitos", "abc12"],
    ["dois números", "1 2"],
    ["notação científica", "1e3"],
    ["hexadecimal", "0x10"],
    ["negativo em texto", "-5"],
    ["decimal em texto", "1.5"],
  ])("contador em texto inválido (%s: %j) invalida o item em vez de virar 0 ou outro número", (_name, value) => {
    expect(normalizeItem("youtube", { videoId: "a", publishedAt: "2026-05-30T10:00:00Z", retrievedAt: "2026-06-01T12:00:00Z", viewCount: value })).toBeNull();
    expect(normalizeItem("youtube", { videoId: "a", publishedAt: "2026-05-30T10:00:00Z", retrievedAt: "2026-06-01T12:00:00Z", viewCount: "10", likeCount: value })).toBeNull();
  });

  it("contador em texto de dígitos válido, inclusive com zeros à esquerda e zero, vale", () => {
    const base = { videoId: "a", publishedAt: "2026-05-30T10:00:00Z", retrievedAt: "2026-06-01T12:00:00Z" };
    expect(normalizeItem("youtube", { ...base, viewCount: "0" })).toMatchObject({ views: 0 });
    expect(normalizeItem("youtube", { ...base, viewCount: "007" })).toMatchObject({ views: 7 });
  });

  it("TikTok: a época 0 (1970) é uma data válida; negativa, em texto ou fracionária não", () => {
    const item = (create_time: unknown) => ({ video_id: "a", create_time, snapshot_time: 1_780_086_400, play_count: 1 });
    expect(normalizeItem("tiktok", item(0))).toMatchObject({ publishedAt: "1970-01-01T00:00:00.000Z" });
    expect(normalizeItem("tiktok", item(-1))).toBeNull();
    expect(normalizeItem("tiktok", item("1780000000"))).toBeNull();
    expect(normalizeItem("tiktok", item(1.5))).toBeNull();
    expect(normalizeItem("tiktok", item(Number.MAX_SAFE_INTEGER))).toBeNull();
  });

  it("item que é uma lista também é inválido", () => {
    expect(normalizeItem("x", [])).toBeNull();
    expect(normalizeItem("x", [{ tweet_id: "a" }])).toBeNull();
  });

  it.each([
    ["comentários", { comments_count: "x" }],
    ["compartilhamentos", { shares: -1 }],
    ["curtidas", { like_count: 1.5 }],
  ])("%s inválidos invalidam o item, cada um por si", (_name, extra) => {
    expect(normalizeItem("instagram", { id: "a", timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: 5, ...extra })).toBeNull();
  });

  it("contador opcional ausente vale 0, mas presente e inválido invalida o item", () => {
    expect(normalizeItem("instagram", { id: "a", timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: 5 })).toMatchObject({ likes: 0, comments: 0, shares: 0 });
    expect(normalizeItem("instagram", { id: "a", timestamp: "2026-05-30T10:00:00Z", snapshot_at: "2026-06-01T12:00:00Z", plays: 5, like_count: -3 })).toBeNull();
  });
});
