/**
 * Configuração do processo, lida do ambiente e validada na inicialização. Um valor ruim derruba a subida com uma
 * mensagem em vez de virar NaN e fazer o serviço rodar sem nunca avisar de atraso.
 */
export type Config = {
  port: number;
  dbPath: string;
  trackhubUrl: string;
  trackhubApiKey: string;
  trackhubTimeoutMs: number;
  thresholdHours: number;
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração inválida:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const MAX_THRESHOLD_HOURS = 24 * 365;

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

function nonBlank(env: Env, name: string, fallback: string, problems: string[]): string {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (raw.trim() === "") {
    problems.push(`${name} não pode ser vazio`);
    return fallback;
  }
  return raw.trim();
}

export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const port = integerIn(env, "PORT", 3012, 1, 65_535, problems);
  const trackhubTimeoutMs = integerIn(env, "TRACKHUB_TIMEOUT_MS", 5000, 100, 120_000, problems);
  const dbPath = nonBlank(env, "DB_PATH", ":memory:", problems);
  const trackhubApiKey = nonBlank(env, "TRACKHUB_API_KEY", "dev-key", problems);

  const trackhubUrl = nonBlank(env, "TRACKHUB_URL", "http://127.0.0.1:4010", problems);
  try {
    const protocol = new URL(trackhubUrl).protocol;
    if (protocol !== "http:" && protocol !== "https:") throw new Error("protocolo");
  } catch {
    problems.push(`TRACKHUB_URL deve ser uma URL http ou https (recebido: ${JSON.stringify(trackhubUrl)})`);
  }

  let thresholdHours = 168;
  const rawThreshold = env.TRANSIT_THRESHOLD_HOURS;
  if (rawThreshold !== undefined) {
    const parsed = /^\d+(\.\d+)?$/.test(rawThreshold.trim()) ? Number(rawThreshold) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_THRESHOLD_HOURS) {
      problems.push(`TRANSIT_THRESHOLD_HOURS deve ser um número de horas maior que 0 e até ${MAX_THRESHOLD_HOURS} (recebido: ${JSON.stringify(rawThreshold)})`);
    } else thresholdHours = parsed;
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return { port, dbPath, trackhubUrl, trackhubApiKey, trackhubTimeoutMs, thresholdHours };
}
