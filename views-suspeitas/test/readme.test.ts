import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate, type Report } from "../src/dataset/evaluate.ts";
import { generateDataset } from "../src/dataset/generate.ts";
import { applyToReadme, checkReadme, formatPercent, inlineMetrics, renderMetricsTable } from "../src/dataset/readme.ts";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const report = evaluate(generateDataset());

describe("os números do README saem do comando, não de uma estimativa escrita à mão", () => {
  it("a tabela de métricas e cada número citado no README coincidem com o que o dataset mede agora", () => {
    expect(checkReadme(readme, report)).toEqual([]);
  });

  it("o README tem a região da tabela e os números citados", () => {
    expect(readme).toContain("<!-- metrics:start -->");
    expect(readme).toContain("<!-- metrics:end -->");
    for (const name of Object.keys(inlineMetrics(report))) expect(readme, name).toContain(`<!--m:${name}-->`);
  });

  it("FALHA quando um número do README diverge do medido (a trava funciona)", () => {
    const wrong = readme.replace(/<!--m:holdout_fpr-->[^<]*<!--\/m-->/, "<!--m:holdout_fpr-->99,9%<!--/m-->");
    expect(wrong).not.toBe(readme);
    const problems = checkReadme(wrong, report);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/holdout_fpr/);
    expect(problems[0]).toMatch(/99,9%/);
  });

  it("FALHA quando a tabela é editada à mão", () => {
    const wrong = readme.replace(/(<!-- metrics:start -->[\s\S]*?\| )(\d)/, "$1" + "9");
    expect(wrong).not.toBe(readme);
    expect(checkReadme(wrong, report).some((p) => /tabela/i.test(p))).toBe(true);
  });

  it("FALHA quando falta a região ou um número citado", () => {
    expect(checkReadme("# README sem nada", report).length).toBeGreaterThan(0);
    expect(checkReadme(readme.replaceAll("<!--m:holdout_recall-->", "<!--x:holdout_recall-->"), report).some((p) => /holdout_recall/.test(p))).toBe(true);
  });
});

describe("formato e atualização", () => {
  it.each([
    [0, "0,0%"],
    [1, "100,0%"],
    [0.5, "50,0%"],
    [1 / 3, "33,3%"],
    [0.0449, "4,5%"],
    [0.0004, "0,0%"],
  ])("%d vira %s (vírgula decimal, uma casa)", (value, text) => {
    expect(formatPercent(value)).toBe(text);
  });

  it("aplicar o relatório num README velho atualiza a tabela e os números citados, e só eles", () => {
    const stale = "# Título\n\nO FPR é <!--m:holdout_fpr-->50,0%<!--/m-->.\n\n<!-- metrics:start -->\nlixo\n<!-- metrics:end -->\n\nFim.\n";
    const updated = applyToReadme(stale, report);
    expect(updated).toContain(`<!--m:holdout_fpr-->${inlineMetrics(report).holdout_fpr}<!--/m-->`);
    expect(updated).toContain(renderMetricsTable(report));
    expect(updated.startsWith("# Título\n\nO FPR é")).toBe(true);
    expect(updated.endsWith("\n\nFim.\n")).toBe(true);
    expect(updated).not.toContain("lixo");
  });

  it("um número citado em mais de um lugar é conferido e atualizado em todos", () => {
    const twice = "A <!--m:holdout_fpr-->1,0%<!--/m--> e de novo <!--m:holdout_fpr-->2,0%<!--/m-->.";
    const problems = checkReadme(twice, report).filter((p) => /holdout_fpr/.test(p) && !/falta/.test(p));
    expect(problems).toHaveLength(2);
    const fixed = applyToReadme(twice, report);
    expect(fixed.match(/<!--m:holdout_fpr-->([^<]*)<!--\/m-->/g)).toEqual([`<!--m:holdout_fpr-->${inlineMetrics(report).holdout_fpr}<!--/m-->`, `<!--m:holdout_fpr-->${inlineMetrics(report).holdout_fpr}<!--/m-->`]);
  });

  it("aplicar duas vezes dá o mesmo resultado", () => {
    const once = applyToReadme(readme, report);
    expect(applyToReadme(once, report)).toBe(once);
  });
});

describe("o mapeamento do relatório para o README, com um relatório montado à mão", () => {
  const metrics = (n: number) => ({ legit_total: 10 * n, false_positive: n, false_positive_rate: 0.1, legit_inconclusive: 2 * n, legit_inconclusive_rate: 0.2, suspicious_total: 5 * n, detected: 3 * n, recall: 0.6, suspicious_inconclusive: n, suspicious_missed: 7 * n });
  const manual: Report = { dev: metrics(1), holdout: metrics(2), overall: metrics(3), families: { "a$&b": { label: "legit", total: 4, organic: 3, inconclusive: 1, suspicious: 0 } } };

  it("cada número vai para o seu nome (inconclusivos e tidos como orgânicos não se trocam)", () => {
    expect(inlineMetrics(manual)).toMatchObject({ holdout_fp: "2", holdout_legit: "20", holdout_detected: "6", holdout_suspicious: "10", holdout_susp_inconclusive: "2", holdout_susp_missed: "14", holdout_fpr: "10,0%", holdout_abstain: "20,0%", holdout_recall: "60,0%", dev_recall: "60,0%" });
  });

  it("as linhas da tabela seguem a ordem do cabeçalho", () => {
    const lines = renderMetricsTable(manual).split("\n");
    expect(lines[0]).toBe("| Parte | Legítimos | Falsos positivos (FPR) | Abstenções em legítimos | Suspeitos | Acusados (recall) | Suspeitos inconclusivos | Suspeitos tidos como orgânicos |");
    expect(lines[3]).toBe("| holdout (número a citar) | 20 | 2 (10,0%) | 4 (20,0%) | 10 | 6 (60,0%) | 2 | 14 |");
    expect(lines.at(-1)).toBe("| a$&b | legítimo | 4 | 3 | 1 | 0 |");
  });

  it("$&, $1 e afins nos valores entram literais, sem virar padrão de substituição", () => {
    const readme = "x\n<!-- metrics:start -->\nvelho\n<!-- metrics:end -->\ny <!--m:holdout_fpr-->0<!--/m-->";
    const updated = applyToReadme(readme, manual);
    expect(updated).toContain("| a$&b | legítimo |");
    expect(checkReadme(applyToReadme(updated, manual), manual).filter((p) => !/falta o marcador/.test(p))).toEqual([]);
  });

  it("sem região ou sem marcador, aplicar não muda nada (e a checagem acusa)", () => {
    expect(applyToReadme("# nada", manual)).toBe("# nada");
    expect(checkReadme("# nada", manual).length).toBeGreaterThan(0);
  });
});
