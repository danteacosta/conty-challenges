import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * O processo de verdade, do mesmo jeito que `npm start` o sobe (tsx): configuração inválida derruba a inicialização
 * com uma mensagem, em vez de rodar com NaN.
 */
function start(env: Record<string, string>) {
  const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
  return spawnSync(process.execPath, [tsx, "src/index.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("inicialização do servidor", () => {
  it.each([
    [{ TRANSIT_THRESHOLD_HOURS: "abc" }, /TRANSIT_THRESHOLD_HOURS/],
    [{ TRANSIT_THRESHOLD_HOURS: "-1" }, /TRANSIT_THRESHOLD_HOURS/],
    [{ PORT: "99999" }, /PORT/],
    [{ TRACKHUB_URL: "não é url" }, /TRACKHUB_URL/],
  ])("%j: sai com erro e diz o que está errado", (env, message) => {
    const result = start(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(result.stdout).not.toMatch(/rastreio-envio em http/);
  });
});
