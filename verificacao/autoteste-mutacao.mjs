// Prova que o script de mutação manual não confunde falha de infraestrutura com mutante morto: roda-o contra um projeto de mentira
// e runners falsos. Cada modo de infraestrutura tem de INVALIDAR a rodada (código 2, sem relatório); o modo "good" prova que um
// resultado real é contado como deveria.
//   node verificacao/autoteste-mutacao.mjs
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "verificacao/mutacao-manual-views.mjs");
const base = mkdtempSync(join(tmpdir(), "autoteste-mutacao-"));
const project = join(base, "projeto");
mkdirSync(join(project, "src/domain"), { recursive: true });
writeFileSync(join(project, "src/domain/criteria.ts"), "export const THRESHOLDS = {\n  a: 5,\n  b: 0.5,\n  cycle_periods: [2, 3],\n} as const;\n");

const fake = join(base, "fake-runner.mjs");
writeFileSync(
  fake,
  `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith("--outputFile=")).slice(13);
const files = args.filter((a) => a.endsWith(".test.ts"));
const mode = process.env.FAKE_MODE;
const criteria = readFileSync("src/domain/criteria.ts", "utf8");
const mutated = !/a: 5,\\n  b: 0.5,\\n  cycle_periods: \\[2, 3\\]/.test(criteria);
const suite = (tests, status = tests.some((t) => t.status === "failed") ? "failed" : "passed") => ({ numTotalTests: tests.length, numPassedTests: tests.filter((t) => t.status === "passed").length, numFailedTests: tests.filter((t) => t.status === "failed").length, testResults: [{ name: "fake.test.ts", status, assertionResults: tests }] });
const ok = [1, 2, 3].map((n) => ({ fullName: "t" + n, status: "passed", failureMessages: [] }));
const failing = (message) => [{ fullName: "t1", status: "failed", failureMessages: [message] }, ...ok.slice(1)];
let report;
if (mode === "nojson") process.exitCode = 0;
else if (mode === "signal") process.kill(process.pid, "SIGSEGV");
else if (mode === "zero") report = suite([]);
else if (!mutated) report = suite(ok);
else if (mode === "ipc") report = suite(failing("Error: Channel closed"));
else if (mode === "timeout") report = suite(failing("Error: Test timed out in 5000ms."));
else if (mode === "suitefail") report = { numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, testResults: [{ name: "x.test.ts", status: "failed", assertionResults: [] }] };
else if (mode === "fewer") report = suite(ok.slice(0, 2));
else if (mode === "exit1green") report = suite(ok);
else if (mode === "failexit0") report = suite(failing("AssertionError: x"));
else if (mode === "skipped") report = { numTotalTests: 3, numPassedTests: 0, numFailedTests: 1, testResults: [{ name: "fake.test.ts", status: "failed", assertionResults: [{ fullName: "t1", status: "failed", failureMessages: ["AssertionError: x"] }, { fullName: "t2", status: "skipped", failureMessages: [] }, { fullName: "t3", status: "skipped", failureMessages: [] }] }] };
else if (mode === "good") {
  if (criteria.includes("a: 6,")) report = suite(failing("AssertionError: expected 1 to be 2"));
  else if (criteria.includes("a: 4,") && files.length === 0) report = suite(failing("AssertionError: readme"));
  else report = suite(ok);
} else throw new Error("modo desconhecido " + mode);
if (mode !== "nojson") writeFileSync(out, JSON.stringify(report));
process.exitCode = mode === "exit1green" ? 1 : mode === "failexit0" ? 0 : report.numFailedTests ? 1 : 0;
`,
);
chmodSync(fake, 0o755);

const run = (mode, extra = {}) => {
  const out = join(base, `${mode}.md`);
  const result = spawnSync("node", [script], {
    encoding: "utf8",
    env: { ...process.env, MUT_PROJECT: project, MUT_RUNNER: fake, MUT_OUT: out, MUT_BEHAVIOR: "test/a.test.ts", FAKE_MODE: mode, ...extra },
  });
  return { status: result.status, stderr: result.stderr, out, report: existsSync(out) ? readFileSync(out, "utf8") : null };
};

let failed = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "ok  " : "FALHOU"} ${name}${condition ? "" : ` ${detail}`}`);
  if (!condition) failed += 1;
};

for (const [mode, pattern] of [
  ["nojson", /não escreveu o relatório JSON/],
  ["zero", /nenhum teste foi executado/],
  ["signal", /terminou por sinal/],
  ["ipc", /infraestrutura/],
  ["timeout", /infraestrutura/],
  ["suitefail", /sem teste reprovado/],
  ["fewer", /rodou 2 testes, a baseline 3/],
  ["exit1green", /relatório não tem teste reprovado, mas o processo saiu com 1/],
  ["skipped", /2 de 3 testes não foram executados/],
]) {
  const r = run(mode);
  check(`${mode}: rodada inválida (código 2), sem relatório`, r.status === 2 && r.report === null && pattern.test(r.stderr), `código ${r.status}: ${r.stderr.slice(0, 200)}`);
}
{
  // mutante "reprovado" com código de saída 0: o JSON e o processo discordam
  const r = run("failexit0");
  check("falha no JSON com saída 0: rodada inválida", r.status === 2 && r.report === null, r.stderr.slice(0, 200));
}
{
  // Vitest real: um teste passa, o teardown do globalSetup lança, o JSON sai verde e o processo sai com 1
  const real = join(base, "vitest-real");
  mkdirSync(join(real, "src/domain"), { recursive: true });
  mkdirSync(join(real, "test"), { recursive: true });
  writeFileSync(join(real, "src/domain/criteria.ts"), "export const THRESHOLDS = {\n  a: 5,\n} as const;\n");
  writeFileSync(join(real, "test/a.test.ts"), 'import { it, expect } from "vitest";\nit("passa", () => expect(1).toBe(1));\n');
  writeFileSync(join(real, "setup.ts"), 'export default function setup() {\n  return () => {\n    throw new Error("teardown completed unsuccessfully");\n  };\n}\n');
  writeFileSync(join(real, "vitest.config.ts"), 'export default { test: { include: ["test/**/*.test.ts"], globalSetup: ["./setup.ts"] } };\n');
  const modules = join(root, "views-suspeitas/node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(real, "node_modules"));
  const out = join(base, "vitest-real.md");
  const result = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, MUT_PROJECT: real, MUT_OUT: out, MUT_BEHAVIOR: "test/a.test.ts" } });
  check("Vitest real, teardown que lança: JSON verde, saída 1, rodada inválida", existsSync(modules) && result.status === 2 && !existsSync(out) && /saiu com 1/.test(result.stderr), `código ${result.status}: ${result.stderr.slice(0, 300)}`);
}
{
  const r = run("good", { MUT_RUNNER: join(base, "nao-existe") });
  check("comando ausente: rodada inválida", r.status === 2 && r.report === null && /não rodou/.test(r.stderr), r.stderr.slice(0, 200));
}
{
  const r = run("good");
  check("resultado real: relatório publicado", r.status === 0 && r.report !== null, r.stderr.slice(0, 200));
  check("resultado real: 7 mutantes, 1 comportamento, 1 só completa, 5 sobreviventes", /7 mutantes: 1 mortos por teste de comportamento, 1 só pela suíte completa \(trava de métricas\/README\), 5 sobreviventes/.test(r.report ?? ""), (r.report ?? "").split("\n").find((l) => l.includes("mutantes:")));
}
console.log(failed === 0 ? "\nautoteste do script de mutação: ok" : `\n${failed} verificação(ões) falharam`);
process.exitCode = failed === 0 ? 0 : 1;
