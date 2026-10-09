import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, type Failure, type Policy } from "../src/domain/retry.ts";
import { parseRetryAfter } from "../src/domain/retry-after.ts";

const policy: Policy = { maxAttempts: 4, baseDelayMs: 200, maxBackoffMs: 5000, maxRetryAfterMs: 30_000 };
const transient = (kind: Failure["kind"]): Failure => ({ kind });

describe("política de retry", () => {
  it.each(["timeout", "network", "server"] as const)("falha transitória (%s) tenta de novo com espera exponencial: 200, 400, 800 ms", (kind) => {
    expect(decide(transient(kind), 1, policy)).toEqual({ action: "retry", waitMs: 200 });
    expect(decide(transient(kind), 2, policy)).toEqual({ action: "retry", waitMs: 400 });
    expect(decide(transient(kind), 3, policy)).toEqual({ action: "retry", waitMs: 800 });
  });

  it("depois da última tentativa permitida, desiste: não há laço infinito", () => {
    expect(decide(transient("timeout"), 4, policy)).toEqual({ action: "fail" });
    expect(decide(transient("server"), 5, policy)).toEqual({ action: "fail" });
  });

  it("a espera exponencial tem teto", () => {
    const wide = { ...policy, maxAttempts: 20 };
    expect(decide(transient("timeout"), 6, wide)).toEqual({ action: "retry", waitMs: 5000 });
    expect(decide(transient("timeout"), 15, wide)).toEqual({ action: "retry", waitMs: 5000 });
  });

  it.each(["client", "invalid_payload"] as const)("%s não adianta repetir: falha na hora", (kind) => {
    expect(decide({ kind }, 1, policy)).toEqual({ action: "fail" });
  });

  describe("429 com Retry-After", () => {
    const limited = (retryAfterMs: number | null): Failure => ({ kind: "rate_limited", retryAfterMs });

    it("espera exatamente o que o provedor mandou (não o backoff)", () => {
      expect(decide(limited(7000), 1, policy)).toEqual({ action: "retry", waitMs: 7000 });
      expect(decide(limited(1500), 3, policy)).toEqual({ action: "retry", waitMs: 1500 });
    });

    it("no teto exato ainda espera; um milissegundo acima, adia sem esperar", () => {
      expect(decide(limited(30_000), 1, policy)).toEqual({ action: "retry", waitMs: 30_000 });
      expect(decide(limited(30_001), 1, policy)).toEqual({ action: "defer", retryAfterMs: 30_001 });
    });

    it("Retry-After 0 tenta de novo na hora, mas ainda gasta uma tentativa", () => {
      expect(decide(limited(0), 1, policy)).toEqual({ action: "retry", waitMs: 0 });
      expect(decide(limited(0), 4, policy)).toEqual({ action: "defer", retryAfterMs: 0 });
    });

    it("esgotadas as tentativas, adia para quando o provedor mandou em vez de falhar", () => {
      expect(decide(limited(7000), 4, policy)).toEqual({ action: "defer", retryAfterMs: 7000 });
    });

    it("sem Retry-After usa o backoff, e esgotadas as tentativas falha", () => {
      expect(decide(limited(null), 1, policy)).toEqual({ action: "retry", waitMs: 200 });
      expect(decide(limited(null), 2, policy)).toEqual({ action: "retry", waitMs: 400 });
      expect(decide(limited(null), 4, policy)).toEqual({ action: "fail" });
    });
  });

  it("só o 429 usa o Retry-After: o mesmo valor numa falha de servidor é ignorado e vale o backoff", () => {
    expect(decide({ kind: "server", retryAfterMs: 25_000 }, 1, policy)).toEqual({ action: "retry", waitMs: 200 });
    expect(decide({ kind: "timeout", retryAfterMs: 25_000 }, 2, policy)).toEqual({ action: "retry", waitMs: 400 });
    expect(decide({ kind: "server", retryAfterMs: 999_999 }, 4, policy)).toEqual({ action: "fail" });
  });

  it("propriedade: a espera nunca passa do maior entre o teto do backoff e o teto do Retry-After, e as tentativas têm limite", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Failure["kind"]>("timeout", "network", "server", "rate_limited", "client", "invalid_payload"),
        fc.option(fc.integer({ min: 0, max: 120_000 }), { nil: null }),
        fc.integer({ min: 1, max: 10 }),
        (kind, retryAfterMs, attempt) => {
          const result = decide({ kind, retryAfterMs }, attempt, policy);
          if (attempt >= policy.maxAttempts) expect(result.action).not.toBe("retry");
          if (result.action === "retry") expect(result.waitMs).toBeLessThanOrEqual(Math.max(policy.maxBackoffMs, policy.maxRetryAfterMs));
          if (result.action === "defer") expect(result.retryAfterMs).toBe(retryAfterMs);
        },
      ),
    );
  });
});

describe("Retry-After: segundos ou data HTTP", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");

  it.each([
    ["7", 7000],
    ["0", 0],
    ["120", 120_000],
    [" 5 ", 5000],
  ])("segundos %j viram %i ms", (value, ms) => {
    expect(parseRetryAfter(value, now)).toBe(ms);
  });

  it("data HTTP vira a diferença para agora", () => {
    expect(parseRetryAfter("Mon, 01 Jun 2026 12:00:10 GMT", now)).toBe(10_000);
  });

  it("data HTTP já passada vira 0, não um tempo negativo", () => {
    expect(parseRetryAfter("Mon, 01 Jun 2026 11:59:00 GMT", now)).toBe(0);
  });

  it.each(["", "abc", "-5", "1.5", "5s", "NaN", "Infinity", "99999999999999999999"])("valor inválido %j é ausente (null), não um número", (value) => {
    expect(parseRetryAfter(value, now)).toBeNull();
  });

  it.each([
    "xx Mon, 01 Jun 2026 12:00:10 GMT",
    "Mon, 01 Jun 2026 12:00:10 GMT extra",
    "Mon, 01 Jun 2026 12:00:10",
    "Mon, 01 Jun 2026 12:00:10 PST",
  ])("data HTTP com lixo ao redor ou fora do formato (%j) é inválida", (value) => {
    expect(parseRetryAfter(value, now)).toBeNull();
  });

  it("ausente é null", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
  });
});
