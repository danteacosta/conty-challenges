/** Gerador pseudoaleatório semeado (mulberry32). Só aritmética inteira e de ponto flutuante básica: o mesmo resultado em qualquer máquina. */
export type Rng = {
  /** Uniforme em [0, 1). */
  next(): number;
  /** Inteiro uniforme em [lo, hi], inclusive. */
  int(lo: number, hi: number): number;
  /** Real uniforme em [lo, hi). */
  between(lo: number, hi: number): number;
  /** Aproximadamente normal(0, 1): soma de 12 uniformes menos 6 (Irwin–Hall), sem log nem cos. */
  normal(): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
};

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (lo: number, hi: number) => lo + (hi - lo) * next();
  return {
    next,
    between,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    normal: () => {
      let sum = 0;
      for (let i = 0; i < 12; i += 1) sum += next();
      return sum - 6;
    },
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (probability) => next() < probability,
  };
}

/** Uma semente por caso, derivada da semente da parte (dev/holdout), da família e do índice. */
export const deriveSeed = (seed: number, familyIndex: number, caseIndex: number): number =>
  (Math.imul(seed, 1_000_003) + Math.imul(familyIndex + 1, 7919) + Math.imul(caseIndex + 1, 104_729)) >>> 0;
