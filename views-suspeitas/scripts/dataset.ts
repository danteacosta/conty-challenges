import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluate } from "../src/dataset/evaluate.ts";
import { datasetHash, generateDataset } from "../src/dataset/generate.ts";
import { applyToReadme, checkReadme, formatPercent } from "../src/dataset/readme.ts";
import { applySensitivity, checkSensitivity, evaluateSensitivity, generateSensitivity } from "../src/dataset/sensitivity.ts";

// VIEWS_ROOT existe para os testes rodarem o comando sobre uma cópia, sem tocar no README e no hash de verdade
const root = process.env.VIEWS_ROOT ? pathToFileURL(`${resolve(process.env.VIEWS_ROOT)}/`) : new URL("../", import.meta.url);
const path = (relative: string) => new URL(relative, root);
const check = process.argv.includes("--check");

const dataset = generateDataset();
const hash = datasetHash(dataset);
const report = evaluate(dataset);
const sensitivity = evaluateSensitivity(generateSensitivity());

if (check) {
  const committed = readFileSync(path("data/dataset.sha256"), "utf8").trim();
  const problems = [...(committed === hash ? [] : [`data/dataset.sha256 (${committed}) difere do hash do dataset gerado (${hash})`]), ...checkReadme(readFileSync(path("README.md"), "utf8"), report), ...checkSensitivity(readFileSync(path("README.md"), "utf8"), sensitivity)];
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log("✓ dataset e README em dia com a medição");
} else {
  mkdirSync(path("data/"), { recursive: true });
  writeFileSync(path("data/dataset.json"), JSON.stringify(dataset));
  writeFileSync(path("data/dataset.sha256"), `${hash}\n`);
  writeFileSync(path("README.md"), applySensitivity(applyToReadme(readFileSync(path("README.md"), "utf8"), report), sensitivity));
  const h = report.holdout;
  console.log(`${dataset.length} casos (hash ${hash.slice(0, 12)}…) gravados em data/dataset.json`);
  console.log(`holdout: falso positivo ${h.false_positive}/${h.legit_total} = ${formatPercent(h.false_positive_rate)}; abstenção em legítimos ${formatPercent(h.legit_inconclusive_rate)}; recall ${formatPercent(h.recall)}`);
  const worst = sensitivity.cells.reduce((a, b) => (b.metrics.false_positive_rate > a.metrics.false_positive_rate ? b : a));
  console.log(`sensibilidade: falso positivo geral ${formatPercent(sensitivity.overall.false_positive_rate)}; pior faixa ${worst.volume} × ${worst.duration} = ${formatPercent(worst.metrics.false_positive_rate)}`);
  console.log("README.md atualizado (tabela, números marcados e sensibilidade)");
}
