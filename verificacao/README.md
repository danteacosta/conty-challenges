# Como reproduzir a verificação

Tudo aqui pode ser rodado de novo; nada depende de confiar no meu relato.

## Suítes e typecheck em Node 22 e 24

```bash
N22_BIN=~/.nvm/versions/node/v22.15.0/bin \
N24_BIN=/opt/homebrew/bin \
DEBUG_REPO=/caminho/para/o/clone/do/fork-de-debug \
OPTIMIZE_REPO=/caminho/para/o/clone/do/fork-de-otimizacao \
./verificacao/matriz-node.sh 6
```

`DEBUG_REPO` e `OPTIMIZE_REPO` são opcionais: sem eles, a matriz roda só os sete projetos deste repositório.

A matriz falha fechado: o resultado vem do código de saída de cada `vitest` e de cada `typecheck`, e saída sem a linha "Tests" conta como falha. `./verificacao/autoteste-matriz.sh` prova isso com executáveis falsos.

Roda `npm run typecheck` e `vitest run` completo de cada projeto, `N` vezes (padrão 6) em cada versão de Node, e sai com código ≠ 0 se houver falha. A saída da minha rodada de 11/10/2026 (a segunda desse dia, depois das últimas correções) está em [`matriz-node.log`](matriz-node.log): **108 execuções completas, 0 falhas e 0 erros de typecheck** (vendas 127, origem 117, rastreio 274, roteiro 165, métricas 326, vídeo 123, views 199, debug 94 e otimização 43 testes; 6 repetições em Node 22.15.0 e em 24.7.0). A rodada anterior do mesmo dia teve 107 de 108: uma falha `ERR_IPC_CHANNEL_CLOSED` em roteiro/22.15.0, que é a que [`ipc/`](ipc/README.md) diagnostica; ela fica registrada ali e nas NOTAS, e esta rodada passou com a mitigação restrita ao Node 22.15/macOS ligada (debug e otimização são forks fora deste repositório e rodam sem ela). As repetições existem porque parte da suíte é concorrente e baseada em propriedades. O fast-check usa uma semente aleatória a cada execução; quando uma propriedade falha, o vitest imprime a semente e o caminho, e o replay de um caso real da auditoria (`seed: 559970327`) está fixado em `rastreio-envio/test/status.test.ts`.

## Mutação (Stryker)

```bash
cd vendas-shopify        # ou qualquer outro projeto
npm run mutation         # escreve reports/mutation.json
cd .. && node verificacao/resumo-mutacao.mjs   # copia (sem caminhos locais) e resume em verificacao/mutacao/
```

- Relatórios completos: [`mutacao/*.json`](mutacao/) (formato mutation-testing-report-schema, abre no [Stryker Dashboard/HTML reporter](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)).
- Resumo por arquivo e **lista de cada mutante vivo**: [`mutacao/RESUMO.md`](mutacao/RESUMO.md). O Stryker não usa semente. O resultado depende do código, dos testes e da versão do Node (rodada em 24.7).
- Os percentuais só valem para os arquivos listados em cada `stryker.config.json` (`mutate`); o que não está lá (`db.ts`, rotas de transporte exceto onde indicado) não é atestado pela mutação.
- Alguns sobreviventes são equivalentes e outros são texto de mensagens de erro ou ruído da ferramenta. Em pontos do `rastreio-envio` (`alerts.ts`, `status.ts`) o Stryker mantém vivos mutantes que, aplicados à mão, derrubam os testes. Isso está descrito nos READMEs e por isso a avaliação é por módulo, não um "todos equivalentes".

## Mutação manual dos limiares de views

```bash
node verificacao/mutacao-manual-views.mjs    # 68 mutantes, numa cópia; escreve verificacao/mutacao/views-limiares-manual.md
node verificacao/autoteste-mutacao.mjs       # prova, com runners falsos, que IPC/timeout/sem testes/comando ausente invalidam a rodada
```

Um mutante só conta como morto com resultado estruturado do vitest: mesma quantidade de testes da baseline e ao menos um teste reprovado por asserção. Nada disso é aceito como morte: saída sem testes, suíte que falha sem teste reprovado, timeout, `ERR_IPC_CHANNEL_CLOSED`, comando ausente ou sinal de processo.

## IPC no Node 22.15 / macOS

Diagnóstico, números do estresse (com os cinco timeouts preservados), excertos dos crashes e a mitigação restrita: [`ipc/README.md`](ipc/README.md).

## O que esta pasta não prova

Revisão humana, a submissão na plataforma e nada que dependa de outra máquina. Node 22.0 a 22.12 não foi verificado (`engines` é `>=22.13`).
