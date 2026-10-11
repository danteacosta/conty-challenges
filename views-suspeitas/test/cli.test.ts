import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { classify } from "../src/domain/classify.ts";
import { plateau, steady } from "./series.ts";

const project = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "views-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const copyOfProject = (name: string) => {
  const root = join(dir, name);
  mkdirSync(join(root, "data"), { recursive: true });
  cpSync(join(project, "README.md"), join(root, "README.md"));
  cpSync(join(project, "data", "dataset.sha256"), join(root, "data", "dataset.sha256"));
  cpSync(join(project, "data", "independent-problems.json"), join(root, "data", "independent-problems.json"));
  return root;
};
const execFileAsync = promisify(execFile);
// Assíncrono de propósito: um execFileSync de vários segundos trava o worker do vitest e a suíte inteira cai em timeout de RPC.
const runDataset = async (root: string, ...args: string[]) => {
  try {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", join(project, "scripts", "dataset.ts"), ...args], { env: { ...process.env, VIEWS_ROOT: root }, encoding: "utf8" });
    return { code: 0, out: stdout, err: "" };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout, err: e.stderr };
  }
};

describe("npm run dataset:check (o comando de verdade, sobre uma cópia)", () => {
  it("README e hash em dia: sai com 0", async () => {
    const result = await runDataset(copyOfProject("ok"), "--check");
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/em dia/);
  }, 60_000);

  it("um número do README diferente do medido: sai com 1 e diz qual", async () => {
    const root = copyOfProject("readme");
    const path = join(root, "README.md");
    writeFileSync(path, readFileSync(path, "utf8").replace(/<!--m:holdout_fpr-->[^<]*<!--\/m-->/, "<!--m:holdout_fpr-->99,9%<!--/m-->"));
    const result = await runDataset(root, "--check");
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/holdout_fpr/);
  }, 60_000);

  it("hash versionado diferente do gerado: sai com 1", async () => {
    const root = copyOfProject("hash");
    writeFileSync(join(root, "data", "dataset.sha256"), "0".repeat(64) + "\n");
    const result = await runDataset(root, "--check");
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/dataset\.sha256/);
  }, 60_000);

  it("os casos problemáticos preservados fora de sincronia também derrubam o --check", async () => {
    const root = copyOfProject("problems");
    writeFileSync(join(root, "data", "independent-problems.json"), "[]\n");
    const result = await runDataset(root, "--check");
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/independent-problems/);
  }, 60_000);

  it("sem --check, grava o dataset, o hash e conserta o README", async () => {
    const root = copyOfProject("write");
    const path = join(root, "README.md");
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace(/<!--m:holdout_fpr-->[^<]*<!--\/m-->/, "<!--m:holdout_fpr-->99,9%<!--/m-->"));
    writeFileSync(join(root, "data", "dataset.sha256"), "0\n");
    const result = await runDataset(root);
    expect(result.code).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(readFileSync(join(root, "data", "dataset.sha256"), "utf8")).toBe(readFileSync(join(project, "data", "dataset.sha256"), "utf8"));
    expect(JSON.parse(readFileSync(join(root, "data", "dataset.json"), "utf8"))).toHaveLength(960);
  }, 60_000);
});

describe("o servidor de verdade (src/index.ts)", () => {
  it("sobe na porta pedida e responde ao /classify", async () => {
    const port = 39_000 + Math.floor(Math.random() * 500);
    const server = spawn(process.execPath, ["--import", "tsx", join(project, "src", "index.ts")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
    try {
      let health: Response | undefined;
      for (let attempt = 0; attempt < 50 && !health; attempt += 1) {
        health = await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined);
        if (!health) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await health?.json()).toEqual({ ok: true });
      const res = await fetch(`http://127.0.0.1:${port}/classify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ series: steady() }) });
      expect((await res.json()) as { classification: string }).toMatchObject({ classification: "organic" });
    } finally {
      server.kill();
    }
  }, 30_000);
});

describe("o exemplo do README é a resposta de verdade", () => {
  it("o motivo e o resumo do exemplo são os que o classificador devolve agora", () => {
    const readme = readFileSync(join(project, "README.md"), "utf8");
    const real = classify(plateau(steady(), 60, 77, 6200));
    expect(readme).toContain(JSON.stringify(real.reason));
    const { hours, baseline_per_hour: base, peak } = real.summary;
    expect(readme).toContain(`"summary": { "hours": ${hours}, "baseline_per_hour": ${base}, "peak": { "hour": ${peak.hour}, "value": ${peak.value} } }`);
    expect(readme).toContain(JSON.stringify(real.signals[0]!.detail));
  });
});
