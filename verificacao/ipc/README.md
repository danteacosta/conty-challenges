# `ERR_IPC_CHANNEL_CLOSED`: diagnóstico e mitigação

## O que acontece

Nas suítes com workers (`revisao-roteiro`, `revisao-video`, ...) em **Node 22.15.0 no macOS**, parte das execuções termina com
`Unhandled Rejection: Error: Channel closed / ERR_IPC_CHANNEL_CLOSED` e o vitest sai com código 1, mesmo com todos os testes
verdes até ali.

## Quem fecha primeiro

O processo-filho do vitest (o fork que roda os testes) morre antes, com **SIGSEGV dentro do próprio Node**; o vitest principal só
vê o canal fechado ao tentar falar com ele. Os relatórios de crash do macOS ([`crashes-excertos.json`](crashes-excertos.json)) têm
sempre a mesma pilha, numa thread de worker:

```
uv_async_send
v8::internal::wasm::WasmEngine::TriggerGC
v8::internal::wasm::WasmEngine::PotentiallyFinishCurrentGC
v8::internal::wasm::WasmEngine::ReportLiveCodeForGC
v8::internal::wasm::WasmEngine::ReportLiveCodeFromStackForGC
node::PerIsolatePlatformData::RunForegroundTask ... node::worker::Worker::Run
```

Ou seja: coleta de lixo de **código WebAssembly** (o carregamento de `.ts` com `--experimental-strip-types` usa wasm) acionada em
worker, com `EXC_BAD_ACCESS` em 0x78. O processo irmão do mesmo vitest fica órfão e é abortado por falta de memória minutos
depois (SIGABRT, `ppid 1`), o que explica relatórios de OOM sem teste falhando.

Limite do que está provado: a pilha, a correlação 1 a 1 entre as 3 falhas do estresse de 13:12–13:16 e 3 relatórios, e o efeito da
flag abaixo. **Não** provei qual módulo wasm dispara nem reportei o defeito ao Node.

## Isolado × carga

| Condição (Node 22.15.0, `revisao-roteiro`) | Execuções | Falhas IPC |
|---|---|---|
| 1 vitest por vez | 8 | 0 |
| 5 vitests em paralelo, sem flag | 450 + 300 | 9 + 3 |
| 5 vitests em paralelo, `--no-wasm-code-gc` | 445 válidas + 300 | 0 + 0 |

As 450 do braço sem flag e as 445 do braço com flag são da sessão anterior ([`execucoes-sessao-anterior.json`](execucoes-sessao-anterior.json));
nelas a flag entrava por `v8.setFlagsFromString` num setupFile. As 300 + 300 seguintes
([`execucoes-v2.json`](execucoes-v2.json), [`estresse-v2-resumo.txt`](estresse-v2-resumo.txt)) usam a configuração definitiva
(`poolOptions.forks.execArgv`), alternando braços: com flag 0 de 300; sem flag 3 de 300.

**Os cinco timeouts ficam registrados.** Na rodada 28 de um braço com flag da sessão anterior, 5 execuções simultâneas estouraram o
timeout de 5 s de teste, sem crash e sem IPC. Coincidiram com a queda da sessão (a máquina parou) e por isso não os atribuo à flag
nem os apago: 445 passaram, 5 deram timeout, nenhuma deu IPC.

## Mitigação (restrita)

- `vitest.config.ts` dos seis projetos com workers passa `--no-wasm-code-gc` aos forks **só** quando `process.version ===
  "v22.15.0"` e `process.platform === "darwin"`. Nada muda em Node 24 nem em produção.
- A flag é de V8 e vale para o processo; os workers a herdam. `test/spawn-worker.ts` a filtra de `execArgv`
  (`ERR_WORKER_INVALID_EXEC_ARGV` caso contrário) e mantém `--experimental-strip-types`.
- Sem retry e sem aumento de timeout.
- Os workers de teste agora fecham o banco (`db.close()`) antes de responder.

## Outra assinatura, só no Node 24.7.0 (homebrew), não corrigida

1. Relatórios de crash com `sqlite3_finalize < DatabaseSync::FinalizeStatements < ~DatabaseSync` na limpeza do ambiente. Nenhuma
   suíte da matriz falhou por isso.
2. Medição direta: o próprio binário do Node 24.7.0 deste ambiente termina com SIGSEGV em parte das saídas por `process.exit`:
   `node -e "process.exit(0)"` 15 falhas em 40; `import('node:fs').then(() => process.exit(0))` 8 em 40; escrever um arquivo e
   sair 3 em 40; script vazio (saída natural) 0 em 40. O Node 22.15.0 fez `process.exit(0)` 40 vezes sem falha. Os relatórios dessas
   saídas aparecem como `X509_get_subject_name` (limpeza do OpenSSL). Por isso os scripts de `verificacao/` usam `process.exitCode`
   em vez de `process.exit()`.

Isso é do binário deste ambiente, não do código dos projetos. Não generalizo para outras instalações do Node 24.
