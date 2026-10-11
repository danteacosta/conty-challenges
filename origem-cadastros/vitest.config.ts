import { defineConfig } from "vitest/config";

// Node 22.15 no macOS: em estresse, o processo-filho do vitest morre por SIGSEGV dentro do Node (pilha em
// WasmEngine::TriggerGC numa thread de worker) e o vitest só relata ERR_IPC_CHANNEL_CLOSED. Sem a flag houve 12 falhas em 750
// execuções; com ela, 0 IPC em 750 (5 timeouts de teste). A flag é uma mitigação empírica: a causa raiz não foi confirmada
// (ver verificacao/ipc/). Vale só para esse ambiente e é V8 (vale para o processo todo, os workers a herdam;
// test/spawn-worker.ts não a repassa em execArgv, o que daria ERR_WORKER_INVALID_EXEC_ARGV).
const affected = process.version === "v22.15.0" && process.platform === "darwin";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { execArgv: affected ? ["--no-wasm-code-gc"] : [] } },
  },
});
