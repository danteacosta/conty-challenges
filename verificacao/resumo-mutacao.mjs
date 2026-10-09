// Lê reports/mutation.json de cada projeto e escreve verificacao/mutacao/*.json e verificacao/mutacao/RESUMO.md
//   node verificacao/resumo-mutacao.mjs
// Só conta mutantes que o Stryker de fato avaliou (Killed/Timeout contam como mortos; Ignored fica de fora).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "verificacao", "mutacao");
mkdirSync(out, { recursive: true });
const projects = ["vendas-shopify", "origem-cadastros", "rastreio-envio"];
const lines = [
  "# Resumo da mutação (Stryker)",
  "",
  "Gerado por `node verificacao/resumo-mutacao.mjs` a partir de `reports/mutation.json` de cada projeto",
  "(`npm run mutation` dentro da pasta). Os JSON completos estão ao lado deste arquivo. O Stryker não usa semente:",
  "o resultado depende do código, dos testes e da versão do Node (esta rodada: ver `matriz-node.log`).",
  "",
];
for (const project of projects) {
  const source = join(root, project, "reports", "mutation.json");
  // a cópia publicada não carrega o caminho absoluto da máquina que rodou
  writeFileSync(join(out, `${project}.json`), readFileSync(source, "utf8").split(join(root, project)).join(".").split(root).join(".."));
  const report = JSON.parse(readFileSync(source, "utf8"));
  const perFile = new Map();
  for (const [file, data] of Object.entries(report.files)) {
    const code = readFileSync(join(root, project, file), "utf8").split("\n");
    const row = { killed: 0, total: 0, live: [] };
    for (const m of data.mutants) {
      if (m.status === "Ignored") continue;
      row.total += 1;
      if (m.status === "Killed" || m.status === "Timeout") row.killed += 1;
      else row.live.push({ line: m.location.start.line, status: m.status, mutator: m.mutatorName, code: (code[m.location.start.line - 1] ?? "").trim().slice(0, 110), replacement: String(m.replacement ?? "").slice(0, 50) });
    }
    perFile.set(file, row);
  }
  let killed = 0, total = 0;
  for (const row of perFile.values()) { killed += row.killed; total += row.total; }
  lines.push(`## ${project}: ${killed}/${total} (${((100 * killed) / total).toFixed(1)}%)`, "", "| arquivo | mortos / total | % |", "|---|---|---|");
  for (const [file, row] of perFile) lines.push(`| \`${file}\` | ${row.killed}/${row.total} | ${((100 * row.killed) / row.total).toFixed(1)}% |`);
  lines.push("", "Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):", "");
  for (const [file, row] of perFile) {
    if (!row.live.length) continue;
    lines.push(`**\`${file}\`**`, "");
    for (const m of row.live) lines.push(`- linha ${m.line} · ${m.mutator} · ${m.status} · \`${m.code.replace(/`/g, "'")}\` → \`${m.replacement.replace(/`/g, "'").replace(/\n/g, " ")}\``);
    lines.push("");
  }
}
writeFileSync(join(out, "RESUMO.md"), lines.join("\n"));
console.log(lines.filter((l) => l.startsWith("## ")).join("\n"));
