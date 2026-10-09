/** O formato único que o resto do sistema conhece, qualquer que seja a rede de origem. */
export type PostSnapshot = {
  postId: string;
  /** Quando o post foi publicado (UTC, ISO-8601). */
  publishedAt: string;
  /** Quando o PROVEDOR mediu estes números (UTC, ISO-8601). Não é quando nós buscamos. */
  asOf: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};
