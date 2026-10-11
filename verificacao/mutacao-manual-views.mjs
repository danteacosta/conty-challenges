// Mutação manual (scriptada) dos limiares de views-suspeitas/src/domain/criteria.ts: cada constante numérica sobe e desce, e
// `cycle_periods` perde cada período e ganha um vizinho.
//   node verificacao/mutacao-manual-views.mjs
//
// Como o resultado é certificado:
//  - roda numa CÓPIA do projeto (o checkout não é tocado, e outras suítes podem rodar ao lado);
//  - usa a saída JSON do vitest: um mutante só está "morto" se a execução rodou o mesmo número de testes da baseline e pelo menos
//    um teste falhou por asserção/exceção do próprio teste. Saída sem testes, falha de suíte inteira, timeout, canal IPC fechado,
//    comando ausente ou sinal de processo INVALIDAM a rodada: o script aborta com o log, sem publicar relatório;
//  - cada mutante roda duas suítes, "comportamento" e "completa"; morto só pela completa = pego apenas pela trava de métricas/README.
// Variáveis (usadas pelo autoteste com runners falsos): MUT_PROJECT, MUT_RUNNER, MUT_BEHAVIOR (lista separada por vírgula), MUT_OUT.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.env.MUT_PROJECT ?? join(root, "views-suspeitas");
const runner = process.env.MUT_RUNNER ?? "npx";
const BEHAVIOR = (process.env.MUT_BEHAVIOR ?? "test/classify.test.ts,test/classify-boundaries.test.ts,test/signals.test.ts,test/validate.test.ts,test/app.test.ts").split(",");
const outFile = process.env.MUT_OUT ?? join(root, "verificacao/mutacao/views-limiares-manual.md");
const work = mkdtempSync(join(tmpdir(), "mutacao-views-"));
const copy = join(work, "projeto");
const logs = join(work, "logs");
mkdirSync(logs);

class InvalidRound extends Error {}
const invalid = (message) => {
  throw new InvalidRound(message);
};

cpSync(source, copy, { recursive: true, filter: (from) => !/(^|\/)(node_modules|reports|\.stryker-tmp|coverage)(\/|$)/.test(from.slice(source.length)) });
if (existsSync(join(source, "node_modules"))) symlinkSync(join(source, "node_modules"), join(copy, "node_modules"));
const file = join(copy, "src/domain/criteria.ts");
const original = readFileSync(file, "utf8");

const INFRA = /ERR_IPC_CHANNEL_CLOSED|Channel closed|timed out|Timeout|ERR_WORKER|ECONN|ENOENT|EMFILE|Failed to (load|resolve|import)|Cannot find (module|package)|Unhandled (Rejection|Error)|out of memory/i;

/** Roda o vitest e devolve a contagem de testes, ou lança InvalidRound se a execução não prova nada. */
function run(label, files) {
  const output = join(logs, `${label.replace(/[^\w.-]+/g, "_")}.json`);
  const args = ["vitest", "run", "--reporter=json", `--outputFile=${output}`, ...files];
  const result = spawnSync(runner, args, { cwd: copy, encoding: "utf8", timeout: 300_000, env: { ...process.env, NODE_OPTIONS: "--disable-warning=ExperimentalWarning" } });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(join(logs, `${label.replace(/[^\w.-]+/g, "_")}.txt`), text);
  if (result.error) invalid(`${label}: o comando não rodou (${result.error.code ?? result.error.message})`);
  if (result.signal) invalid(`${label}: o processo terminou por sinal ${result.signal}`);
  if (!existsSync(output)) invalid(`${label}: o vitest não escreveu o relatório JSON (código ${result.status})`);
  let report;
  try {
    report = JSON.parse(readFileSync(output, "utf8"));
  } catch {
    invalid(`${label}: relatório JSON ilegível`);
  }
  if (!Number.isInteger(report.numTotalTests) || report.numTotalTests <= 0) invalid(`${label}: nenhum teste foi executado`);
  // numTotalTests inclui os pulados, pendentes e "todo": só passado + reprovado foi de fato executado
  const executed = report.numPassedTests + report.numFailedTests;
  if (executed !== report.numTotalTests) invalid(`${label}: ${report.numTotalTests - executed} de ${report.numTotalTests} testes não foram executados (pulados, pendentes ou todo)`);
  const failures = [];
  for (const suite of report.testResults ?? []) {
    const tests = suite.assertionResults ?? [];
    if (suite.status === "failed" && tests.every((t) => t.status !== "failed")) invalid(`${label}: a suíte ${suite.name} falhou sem teste reprovado (erro de carga ou de infraestrutura)`);
    for (const t of tests) {
      if (t.status !== "failed") continue;
      // só a primeira linha de cada mensagem (o erro em si): a pilha cita setTimeout, caminhos e módulos que não dizem nada
      const heads = (t.failureMessages ?? []).map((m) => String(m).split("\n")[0]);
      if (heads.some((head) => INFRA.test(head))) invalid(`${label}: falha de infraestrutura no teste "${t.fullName}": ${heads.join(" | ").slice(0, 200)}`);
      failures.push(t.fullName);
    }
  }
  if (INFRA.test(text) && /ERR_IPC_CHANNEL_CLOSED|Channel closed|Unhandled/i.test(text)) invalid(`${label}: erro de infraestrutura na saída do runner`);
  if (report.numFailedTests !== failures.length) invalid(`${label}: contagem de falhas inconsistente (${report.numFailedTests} x ${failures.length})`);
  // o código de saída conta junto do JSON: o vitest pode escrever JSON verde e sair com 1 (erro de teardown, de globalSetup...).
  // Sem teste reprovado o código tem de ser 0; com teste reprovado, diferente de 0.
  if (failures.length === 0 && result.status !== 0) invalid(`${label}: o relatório não tem teste reprovado, mas o processo saiu com ${result.status} (erro de runner, teardown ou globalSetup)`);
  if (failures.length > 0 && result.status === 0) invalid(`${label}: o relatório tem ${failures.length} teste(s) reprovado(s), mas o processo saiu com 0`);
  return { total: report.numTotalTests, failed: failures.length, passed: report.numPassedTests, failures };
}

const baseline = {};
const rows = [];
let aborted = false;
try {
  for (const [name, files] of [["comportamento", BEHAVIOR], ["completa", []]]) {
    const result = run(`baseline-${name}`, files);
    if (result.failed !== 0 || result.passed !== result.total) invalid(`baseline ${name}: a suíte já falha sem mutante (${result.failures.slice(0, 3).join("; ")})`);
    baseline[name] = result.total;
  }

  const verdict = (label) => {
    const behavior = run(`${label}-comportamento`, BEHAVIOR);
    if (behavior.total !== baseline.comportamento) invalid(`${label}: a suíte de comportamento rodou ${behavior.total} testes, a baseline ${baseline.comportamento}`);
    if (behavior.failed > 0) return { status: "morto por teste de comportamento", by: behavior.failures.slice(0, 2) };
    const full = run(`${label}-completa`, []);
    if (full.total !== baseline.completa) invalid(`${label}: a suíte completa rodou ${full.total} testes, a baseline ${baseline.completa}`);
    return full.failed > 0 ? { status: "morto só pela suíte completa", by: full.failures.slice(0, 2) } : { status: "SOBREVIVEU", by: [] };
  };

  const block = original.slice(original.indexOf("export const THRESHOLDS"), original.indexOf("} as const;"));
  const entries = [...block.matchAll(/^  (\w+): (-?[\d_.]+),/gm)].map((m) => ({ key: m[1], text: m[2], value: Number(m[2].replace(/_/g, "")) }));
  if (entries.length === 0) invalid("nenhuma constante numérica encontrada em criteria.ts");
  for (const e of entries) {
    const step = Number.isInteger(e.value) ? 1 : e.value * 0.1;
    for (const [dir, v] of [["↑", e.value + step], ["↓", Math.max(0, e.value - step)]]) {
      if (v === e.value) continue;
      const shown = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
      const mutated = original.replace(new RegExp(`^(  ${e.key}: )${e.text.replace(".", "\\.")},`, "m"), `$1${shown},`);
      if (mutated === original) invalid(`não consegui aplicar o mutante ${e.key} ${dir}`);
      writeFileSync(file, mutated);
      rows.push({ key: e.key, dir, from: e.text, to: shown, ...verdict(`${e.key}-${dir === "↑" ? "up" : "down"}`) });
      console.log(rows.at(-1));
    }
  }
  const periods = original.match(/^  cycle_periods: \[([\d, ]+)\],/m);
  if (periods) {
    const list = periods[1].split(",").map((x) => Number(x.trim()));
    const variants = [...list.map((p) => [`−${p}`, list.filter((x) => x !== p)]), [`+${Math.max(...list) + 1}`, [...list, Math.max(...list) + 1]]];
    for (const [label, next] of variants) {
      writeFileSync(file, original.replace(periods[0], `  cycle_periods: [${next.join(", ")}],`));
      rows.push({ key: "cycle_periods", dir: label, from: `[${list.join(", ")}]`, to: `[${next.join(", ")}]`, ...verdict(`cycle-${label}`) });
      console.log(rows.at(-1));
    }
  }
} catch (error) {
  if (!(error instanceof InvalidRound)) throw error;
  console.error(`RODADA INVÁLIDA: ${error.message}\nLogs completos em ${logs}`);
  // exitCode, não process.exit(): o Node 24.7 deste ambiente derruba o processo com SIGSEGV em parte das saídas por process.exit
  process.exitCode = 2;
  aborted = true;
} finally {
  writeFileSync(file, original);
}

if (!aborted) writeReport();

function writeReport() {
const count = (s) => rows.filter((r) => r.status === s).length;
const out = [
  "# Mutação manual dos limiares de views (criteria.ts)",
  "",
  "Gerado por `node verificacao/mutacao-manual-views.mjs`, numa cópia do projeto, com o resultado estruturado do vitest (ver o cabeçalho do script).",
  "Cada constante numérica sobe e desce (±1 nos inteiros, ±10% nos fracionários); `cycle_periods` perde cada período e ganha um vizinho.",
  `Baseline: ${baseline.comportamento} testes na suíte de comportamento e ${baseline.completa} na completa, todos passando; cada mutante rodou o mesmo número de testes.`,
  "",
  `${rows.length} mutantes: ${count("morto por teste de comportamento")} mortos por teste de comportamento, ${count("morto só pela suíte completa")} só pela suíte completa (trava de métricas/README), ${count("SOBREVIVEU")} sobreviventes.`,
  "",
  "| constante | mutação | resultado | primeiro teste que falhou |",
  "|---|---|---|---|",
  ...rows.map((r) => `| \`${r.key}\` | ${r.dir} ${r.from} → ${r.to} | ${r.status} | ${r.by[0] ? r.by[0].replace(/\|/g, "\\|").slice(0, 110) : ""} |`),
  "",
];
mkdirSync(dirname(outFile), { recursive: true });
const tmp = `${outFile}.tmp`;
writeFileSync(tmp, out.join("\n"));
renameSync(tmp, outFile);
rmSync(work, { recursive: true, force: true });
console.log(`relatório em ${outFile}`);
}
