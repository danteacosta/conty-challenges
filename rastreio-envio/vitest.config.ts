import { defineConfig } from "vitest/config";

// Node 22.15 no macOS: a coleta de código WebAssembly numa thread de worker derruba o processo-filho do vitest com SIGSEGV
// (uv_async_send em WasmEngine::TriggerGC), e o vitest só relata ERR_IPC_CHANNEL_CLOSED. Reproduzido em estresse e sem a flag
// por 9 vezes em 450 execuções; ver verificacao/ipc/. A flag vale só para esse ambiente e é V8 (vale para o processo todo,
// os workers a herdam; test/spawn-worker.ts não a repassa em execArgv, o que daria ERR_WORKER_INVALID_EXEC_ARGV).
const affected = process.version === "v22.15.0" && process.platform === "darwin";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { execArgv: affected ? ["--no-wasm-code-gc"] : [] } },
  },
});
