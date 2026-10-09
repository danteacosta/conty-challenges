# Como reproduzir a verificação

Tudo aqui pode ser rodado de novo; nada depende de confiar no meu relato.

## Suítes e typecheck em Node 22 e 24

```bash
N22_BIN=~/.nvm/versions/node/v22.15.0/bin \
N24_BIN=/opt/homebrew/bin \
DEBUG_REPO=/caminho/para/o/clone/do/fork-de-debug \   # opcional
./verificacao/matriz-node.sh 6
```

Roda `npm run typecheck` e `vitest run` completo de cada projeto, `N` vezes (padrão 6) em cada versão de Node, e sai com código ≠ 0 se houver falha. A saída da minha rodada de 09/10/2026 está em [`matriz-node.log`](matriz-node.log): 48 execuções (vendas 83, origem 105, rastreio 127 e debug 46 testes; 6 repetições em Node 22.15.0 e em 24.7.0), 0 falhas. As repetições existem porque parte da suíte é concorrente e baseada em propriedades. O fast-check usa uma semente aleatória a cada execução; quando uma propriedade falha, o vitest imprime a semente e o caminho, e o replay de um caso real da auditoria (`seed: 559970327`) está fixado em `rastreio-envio/test/status.test.ts`.

## Mutação (Stryker)

```bash
cd vendas-shopify        # ou origem-cadastros, rastreio-envio
npm run mutation         # escreve reports/mutation.json
cd .. && node verificacao/resumo-mutacao.mjs   # copia (sem caminhos locais) e resume em verificacao/mutacao/
```

- Relatórios completos: [`mutacao/*.json`](mutacao/) (formato mutation-testing-report-schema, abre no [Stryker Dashboard/HTML reporter](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)).
- Resumo por arquivo e **lista de cada mutante vivo**: [`mutacao/RESUMO.md`](mutacao/RESUMO.md). O Stryker não usa semente. O resultado depende do código, dos testes e da versão do Node (rodada em 24.7).
- Os percentuais só valem para os arquivos listados em cada `stryker.config.json` (`mutate`); o que não está lá (`db.ts`, rotas de transporte exceto onde indicado) não é atestado pela mutação.
- Alguns sobreviventes são equivalentes e outros são texto de mensagens de erro ou ruído da ferramenta. Em pontos do `rastreio-envio` (`alerts.ts`, `status.ts`) o Stryker mantém vivos mutantes que, aplicados à mão, derrubam os testes. Isso está descrito nos READMEs e por isso a avaliação é por módulo, não um "todos equivalentes".

## O que esta pasta não prova

Revisão humana, a submissão na plataforma e nada que dependa de outra máquina. Node 22.0 a 22.12 não foi verificado (`engines` é `>=22.13`).
