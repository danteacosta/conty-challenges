/**
 * As peças que uma entrega pode ter. Quais são EXIGIDAS é dado da campanha (tabela `campaign_required_pieces`),
 * nunca um `if` no código: campanha só de vídeo simplesmente não lista roteiro, capa nem legenda.
 */
export const PIECE_TYPES = ["script", "video", "cover", "caption"] as const;
export type PieceType = (typeof PIECE_TYPES)[number];

export const isPieceType = (value: unknown): value is PieceType => typeof value === "string" && (PIECE_TYPES as readonly string[]).includes(value);

/** A lista de peças exigidas de uma campanha: não vazia, só peças conhecidas, sem repetição. Null se inválida. */
export function parseRequiredPieces(value: unknown): PieceType[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every(isPieceType)) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value];
}
