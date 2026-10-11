import { defineConfig } from "vitest/config";

// Só para a mutação: fora os testes que sobem processos ou geram o dataset várias vezes (cli, sensibilidade, estabilidade).
// Eles continuam em `npm test`; nenhum mutante dos módulos mutados dependia só deles.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], exclude: ["test/cli.test.ts", "test/sensitivity.test.ts", "test/stability.test.ts"] } });
