/**
 * Configuração do processo, lida do ambiente e validada na inicialização. Um valor ruim derruba a subida com uma mensagem.
 * Em especial MAX_RETRY_AFTER_MS: se virasse NaN, `retryAfterMs > NaN` seria sempre falso e o serviço esperaria QUALQUER
 * Retry-After, que é justamente o que o teto existe para impedir.
 */
export type Config = { port: number; dbPath: string; providerUrl: string; providerTimeoutMs: number; maxRetryAfterMs: number };

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Configuração inválida:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

function integerIn(env: Env, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw.trim()) || Number(raw) < min || Number(raw) > max) {
    problems.push(`${name} deve ser um inteiro entre ${min} e ${max} (recebido: ${JSON.stringify(raw)})`);
    return fallback;
  }
  return Number(raw);
}

export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const port = integerIn(env, "PORT", 3014, 1, 65_535, problems);
  const providerTimeoutMs = integerIn(env, "PROVIDER_TIMEOUT_MS", 5000, 100, 120_000, problems);
  // 0 é válido: significa "nunca espere um Retry-After, adie sempre". O teto vai até uma hora.
  const maxRetryAfterMs = integerIn(env, "MAX_RETRY_AFTER_MS", 30_000, 0, 3_600_000, problems);

  let dbPath = ":memory:";
  if (env.DB_PATH !== undefined) {
    if (env.DB_PATH.trim() === "") problems.push("DB_PATH não pode ser vazio");
    else dbPath = env.DB_PATH.trim();
  }

  let providerUrl = "http://127.0.0.1:4011";
  if (env.PROVIDER_URL !== undefined) providerUrl = env.PROVIDER_URL.trim();
  try {
    const protocol = new URL(providerUrl).protocol;
    if (protocol !== "http:" && protocol !== "https:") throw new Error("protocolo");
  } catch {
    problems.push(`PROVIDER_URL deve ser uma URL http ou https (recebido: ${JSON.stringify(providerUrl)})`);
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return { port, dbPath, providerUrl, providerTimeoutMs, maxRetryAfterMs };
}
