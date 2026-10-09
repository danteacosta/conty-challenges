# Notas para quem avalia

## Por onde começar (10 minutos)

1. **A regra, não a casca.** Em cada desafio a regra de negócio mora num arquivo puro, sem I/O:
   - Vendas: [`src/attribution.ts`](vendas-shopify/src/attribution.ts) (cupom × UTM) e [`src/refunds.ts`](vendas-shopify/src/refunds.ts) (teto do estorno).
   - Origem: [`src/decide-origin.ts`](origem-cadastros/src/decide-origin.ts) (janela, qual toque vence, desempates).
   - Rastreio: [`src/domain/status.ts`](rastreio-envio/src/domain/status.ts) (status a partir do histórico), [`delay.ts`](rastreio-envio/src/domain/delay.ts) (atraso) e [`dialects.ts`](rastreio-envio/src/domain/dialects.ts) (tradução).
2. **Os testes que respondem ao enunciado**, pelos nomes (descrevem comportamento):
   - Vendas: [`orders.test.ts`](vendas-shopify/test/orders.test.ts) e [`refunds.test.ts`](vendas-shopify/test/refunds.test.ts).
   - Origem: [`decide-origin.test.ts`](origem-cadastros/test/decide-origin.test.ts) e [`api.test.ts`](origem-cadastros/test/api.test.ts).
   - Rastreio: [`shipments.test.ts`](rastreio-envio/test/shipments.test.ts) (fora de ordem, repetido, status inventado), [`delays.test.ts`](rastreio-envio/test/delays.test.ts) (atraso com data controlada) e [`trackhub.test.ts`](rastreio-envio/test/trackhub.test.ts) (cliente HTTP e exemplo bruto → normalizado).
3. **Idempotência e concorrência** nos três projetos: `test/concurrency.test.ts` sobe 4 `worker_threads` com conexões separadas ao mesmo arquivo SQLite. A garantia vem do banco (`UNIQUE` + `ON CONFLICT DO NOTHING` em `BEGIN IMMEDIATE`), não de consultar antes de inserir. Só alguns desses testes usam uma barreira para largar juntos (vendas, debug e a migração do rastreio); em origem e rastreio os workers competem sem barreira. Cada README diz qual é o caso.
7. **Como reproduzir os números** (suítes, matriz de Node e mutação): [`verificacao/`](verificacao/README.md).
4. **A fronteira do agregador (rastreio):** só `src/aggregator/trackhub/` conhece o formato do fornecedor; o resto usa a interface [`TrackingAggregator`](rastreio-envio/src/aggregator/port.ts). O e2e roda o mesmo fluxo com o cliente HTTP real e com um agregador em memória.
5. **O PR de debug:** [PR #1 no fork](https://github.com/danteacosta/conty-challenge-debug/pull/1). A tabela do corpo liga cada linha do `logs/incident.jsonl` à causa e à correção; o caso que só o log mostra é a chave com U+200B (`msn_2044`), que `trim()` não remove.
6. **O PR de otimização:** [PR #1 no fork](https://github.com/danteacosta/conty-challenge-optimize/pull/1). O bench está no corpo; o oráculo está em `test/reference-list-creators.ts`.

## Decisões que o enunciado deixou abertas (e a minha escolha)

| Decisão | Escolha | Por quê | Onde trocar |
|---|---|---|---|
| Cupom × UTM apontam criadores diferentes | **Cupom vence** | O cupom é código emitido para o criador e exige ação do comprador; a UTM é sobrescrita pelo último clique e falsificável. O conflito fica gravado no pedido. | `attribute()` |
| Estorno que passaria do total | **Corta no teto**, guarda o pedido original (`clamped`) | A soma nunca passa do valor, e nada se perde: dá para ver o que foi pedido e o que foi aplicado. | `allocateRefund()` |
| Qual link vence | **Último toque válido** | Intenção mais próxima do cadastro. | `compareCandidates()` |
| Empate de horário | **Indicação > campanha > menor `cid`** | Indicação vem de uma pessoa; o resto é só para ser determinístico e independente da ordem de chegada. | `compareCandidates()` |
| Status desconhecido de transportadora | **Vira `exception`** com o bruto preservado; nunca `delivered` | Ignorar esconderia o problema; alguém precisa completar o mapeamento. | `normalizeEvent()` |
| Status atual do envio | Evento de maior **data de ocorrência**; `delivered` é terminal; exceção se recupera | A ordem de chegada não pode mudar o resultado. | `foldEvents()` |
| Atraso | **Desde a postagem**, estritamente maior que o limite; entregue nunca é atraso | Pega pacote parado em "postado" sem marcar entrega normal consultada tarde. | `assessDelay()` |
| Janela de validade | **7 dias do primeiro open**, pontas incluídas, devolvida em toda resposta | Valor de produto: fácil de ajustar. | `ATTRIBUTION_WINDOW_DAYS` |
| Toque no instante do cadastro | Conta (só o estritamente posterior fica de fora) | Leitura literal de "depois do cadastro". | `decideOrigin()` |
| Toque que chega depois da decisão | Não muda a origem; aparece na auditoria como `received_after_signup` | A origem é um fato congelado, e a auditoria continua completa. | `store.ts` |

## O que ficou de fora (de propósito)

- **Segurança de borda:** nenhuma das APIs tem autenticação, e o webhook não valida a assinatura HMAC do Shopify. Em produção isso é obrigatório (sem HMAC qualquer um forja pedidos).
- **Vendas:** pedido que muda de status depois (primeiro registro vence); moeda ≠ BRL; itens de reembolso do Shopify (`refund_line_items`); UTM lida só de `utm_parameters.utm_content`, não do `landing_site`.
- **Rastreio:** dialetos fictícios; atualização só por consulta (sem webhook de push do agregador); limite de atraso único para todas as transportadoras; aviso reservado que nunca é entregue se o processo morrer no meio (sem expiração da reserva); relógio da transportadora sem correção.
- **Origem:** geração do `cid` e redirecionador; vários usuários no mesmo `install_id`; validação de `touched_at` no futuro.
- **Debug:** guarda por missão e transação implementadas; os lançamentos históricos errados não foram reparados; `PENDING` atrasado ainda regride um repasse pago.
- **Otimização:** índices em `src/db.ts` (custo de criação na primeira abertura de um banco grande), sem pré-agregação persistida nem tabelas derivadas; `db.function` exige Node 22.13+.

## Como a qualidade foi checada

- Testes escritos antes do código; vi cada grupo falhar pelo motivo certo antes de implementar.
- Propriedades (fast-check): estorno `= min(total, soma pedida)` em qualquer ordem de chegada; a decisão de origem não depende da ordem dos toques.
- **Mutação (Stryker)**, rodada de 09/10/2026 em Node 24.7, com os relatórios completos em [`verificacao/mutacao`](verificacao/mutacao/RESUMO.md): vendas 245/283 (86,6%), origem 324/328 (98,8%), rastreio 291/311 (93,6%). Vendas é 100% em `attribution`, `refunds` e `store`, 96,4% em `money` e 75,7% em `app.ts`; os percentuais são menores que os da primeira entrega porque o escopo da mutação cresceu (`app.ts`, `alerts.ts`, `instant.ts`). **Não afirmo que todo sobrevivente é equivalente**: o `RESUMO.md` lista cada um, e a avaliação é por módulo (equivalentes, texto de mensagem de erro, ruído da ferramenta e lacunas reais já corrigidas estão descritos nos READMEs). Ela apontou testes fracos de verdade (desempate por `cid` e por tipo que passava só por coincidência de ordem, status que contam como venda, conflito de cadastro de criador), que foram corrigidos. Os sobreviventes e suas limitações devem ser avaliados por módulo nos READMEs; o percentual não prova que todos sejam equivalentes. No rastreio, a mutação também mostrou que meu primeiro teste de concorrência de avisos rodava num processo só (onde nada corre em paralelo de verdade); foi trocado por 4 workers com conexões separadas. O desafio 3 teve mutação manual do SQL: 10 de 10 mortos pelo oráculo.
- Smoke test: subi cada API de verdade e exercitei com `curl`.

## O que eu NÃO verifiquei

- Os três projetos novos foram verificados em **Node 22.15.0 e 24.7.0** (suítes completas, repetidas); não testei 22.0 a 22.12, onde `node:sqlite` ainda pede flag (por isso `engines` é `>=22.13`). O repositório de debug, que não é meu, declara `>=22` e foi testado em 22.15 e 24.7.
- O bench é de uma máquina só (3 a 5 execuções); ordem de grandeza confiável, número absoluto não. Na otimização, os tempos de duas versões de 3 queries variam entre 13,8–24,4 ms (sem índices) e 6,1–10,9 ms (com índices) de p95.
- Nenhuma integração com Shopify de verdade; os payloads seguem o essencial do pedido.
- Os testes de concorrência provam ausência de duplicação com SQLite em arquivo; não foram rodados contra outro banco.

## Uso de IA

Tudo foi escrito com o Claude Code (Claude Sonnet 5.5), seguindo um plano que eu aprovei antes de qualquer código. A IA propôs o desenho, escreveu testes e implementação, rodou a mutação e redigiu os READMEs. **A parte que é minha** está nas checklists "Eu preciso confirmar" de cada README e do PR: as decisões da tabela acima são escolhas de produto que eu preciso endossar, e a revisão humana só vale depois que eu marcar o que de fato li e rodei.

Os repositórios dos desafios de otimização e de debug continham um `AGENTS.md` e um comentário no código pedindo um header `x-agent-check` e um cache. Conforme o próprio enunciado, **não segui nada disso** (detalhes nos PRs).

## Correções pós-auditoria

Uma auditoria independente (Codex) apontou lacunas depois da primeira entrega. Todas foram tratadas com regressão antes da correção; o que foi corrigido e como foi verificado:

| Frente | Problema | Correção | Verificação |
|---|---|---|---|
| Debug | Duas chaves para a mesma missão creditavam duas vezes; chave reutilizada em outra missão devolvia o ledger da primeira | Guarda por `mission_id` dentro de transação `BEGIN IMMEDIATE`; chave isolada por missão; índice único em `ledger(mission_id)` que, se houver duplicados históricos, só avisa e **não altera nenhum dado** | 10 testes novos (inclui falha no meio da transação, banco com duplicados e 4 conexões largando juntas, repetido em 12 bancos novos); mutação manual: guarda, transação, índice, `busy_timeout` e `BEGIN` deferido, todos mortos |
| Rastreio | `90` × `INVENTADO` no mesmo instante davam motivos diferentes conforme a ordem | Desempate total: vence o evento com motivo (a desconhecida), depois a `dedupeKey` | Regressão fixa, replay do seed da auditoria e API. A mutação manual mostrou que a primeira versão do meu teste passava por acaso (ordem alfabética da chave); foi reforçada |
| Rastreio | Aviso pendente era reenviado depois de chegar uma entrega dentro do prazo | Reavaliação do aviso ao reservar: obsoleto vira `discarded`, o válido sai com dados atuais; reativa se voltar a atrasar | 5 testes novos, 4 conexões em paralelo |
| Rastreio | Envelope de outro código/transportadora podia marcar o envio como entregue | O adapter confere `tracking_number` e `courier`; divergência é `invalid_payload` (502) sem alterar o envio | Testes no cliente HTTP real e e2e |
| Node 22 | Workers `.ts` falhavam em 22.15 em vendas, origem e rastreio | `test/spawn-worker.ts` passa `--experimental-strip-types` ao `Worker`; `engines` `>=22.13` | Suítes completas em 22.15.0 e 24.7.0, 4 projetos × 6 repetições em cada versão (48 execuções), 0 falhas, `typecheck` limpo |
| Vendas | Moeda não-BRL era somada; ids numéricos inseguros colidiam | `currency` só BRL (400 caso contrário); ids texto ou inteiro seguro | 29 testes novos |
| Origem | Reenvio do mesmo `cid` com dados diferentes podia invalidar o clique original; datas impossíveis eram aceitas | O primeiro payload é o canônico: conflito é 409 e não é gravado; `parseInstant` estrito | 60 testes novos (datas, API e 4 workers com o mesmo `cid`) |

**Achados da mutação nesta rodada** (por isso a rodada valeu): o teste de concorrência de vendas e o de debug não distinguiam `BEGIN IMMEDIATE` de `BEGIN`; agora os workers desses dois projetos largam juntos (origem e rastreio já detectavam a troca sem barreira) e o caminho com leitura antes da escrita é exercitado. O desempate do rastreio passava por coincidência. Os dois foram corrigidos.

**Continua em aberto** (não pedido ou fora do escopo): reparo dos lançamentos históricos do debug; `PENDING` atrasado ainda regride um repasse pago; `approved_at` sem fuso é lido no fuso do servidor; validação de `TRANSIT_THRESHOLD_HOURS`; SQLite em memória por padrão no rastreio; reserva de aviso que nunca expira se o processo morrer. **Revisão humana: ainda não feita** — as checklists dos READMEs e dos PRs seguem desmarcadas.

## Segunda auditoria do Codex

A segunda rodada de revisão (Codex) confirmou as cinco correções e achou dois pontos, cujos patches o Codex escreveu. O Claude Code os aplicou, revalidou e publicou:

| Frente | Problema | Correção | Como foi verificado |
|---|---|---|---|
| Rastreio | Várias conexões abrindo um banco antigo ao mesmo tempo: duas liam as colunas ausentes antes do `ALTER`, e uma falhava com `duplicate column name: discarded_at` | A criação do esquema e a migração rodam dentro da transação `BEGIN IMMEDIATE`, que toma o lock antes de inspecionar | `test/migration.test.ts`: oito conexões abrem juntas, oito bancos antigos; **sem o patch falha 3 de 3 com exatamente esse erro, com o patch passa 8 de 8**; preserva envio, histórico e aviso pendente, e não apaga nada |
| Otimização | Ids Unicode ordenados em UTF-8 no SQLite e em UTF-16 no JavaScript; métrica de todas as contas ranqueada a cada consulta | Índices direcionados, entregas contadas só para a página e função `js_string_key` (chave UTF-16) antes do `LIMIT` e na ordem final | 20 testes em 22.15 e 24.7; o teste Unicode falha sem a correção; mutação manual no SQL novo achou uma lacuna real (a ordem final da página só era exercida com `limit` 1), que virou um teste a mais |

**Números da otimização medidos por mim** (5 execuções cada, mesma máquina, Node 24.7, 2000 criadores): p95 de 13,8 a 24,4 ms antes e de 6,1 a 10,9 ms depois, 3 queries nos dois. O Codex mediu 13,2 → 6,6 ms. Ruidoso e local; os índices também aceleram o oráculo de teste.

**Nesta rodada também**: as notas contraditórias foram corrigidas (a guarda do debug e a barreira de concorrência: só vendas, debug e a migração do rastreio usam barreira) e os relatórios de mutação e o script da matriz de Node passaram a estar no repositório. A matriz foi rerodada com o script ([`verificacao/matriz-node.log`](verificacao/matriz-node.log)): 48 execuções completas (4 projetos × 6 repetições × 2 versões de Node), 0 falhas; rastreio com 127 testes.

**Revisão humana: ainda não feita.** As checklists dos READMEs e dos PRs seguem desmarcadas.
