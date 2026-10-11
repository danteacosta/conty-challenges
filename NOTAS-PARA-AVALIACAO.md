# Notas para quem avalia

## Por onde começar (10 minutos)

1. **A regra, não a casca.** Em cada desafio a regra de negócio mora num arquivo puro, sem I/O:
   - Vendas: [`src/attribution.ts`](vendas-shopify/src/attribution.ts) (cupom × UTM) e [`src/refunds.ts`](vendas-shopify/src/refunds.ts) (teto do estorno).
   - Origem: [`src/decide-origin.ts`](origem-cadastros/src/decide-origin.ts) (janela, qual toque vence, desempates).
   - Rastreio: [`src/domain/status.ts`](rastreio-envio/src/domain/status.ts) (status a partir do histórico), [`delay.ts`](rastreio-envio/src/domain/delay.ts) (atraso) e [`dialects.ts`](rastreio-envio/src/domain/dialects.ts) (tradução).
   - Roteiro: [`src/domain/transitions.ts`](revisao-roteiro/src/domain/transitions.ts) (tabela de estados) e [`deadline.ts`](revisao-roteiro/src/domain/deadline.ts) (dia civil em America/Sao_Paulo).
   - Métricas: [`src/domain/retry.ts`](metricas-redes/src/domain/retry.ts) e [`retry-after.ts`](metricas-redes/src/domain/retry-after.ts) (quando tentar de novo, quando adiar) e [`src/providers/adapters.ts`](metricas-redes/src/providers/adapters.ts) (o formato de cada rede, só ali).
   - Vídeo: [`src/domain/approval.ts`](revisao-video/src/domain/approval.ts) (estado derivado da entrega), [`pieces.ts`](revisao-video/src/domain/pieces.ts) e [`versions.ts`](revisao-video/src/domain/versions.ts).
   - Views: [`src/domain/criteria.ts`](views-suspeitas/src/domain/criteria.ts) (todos os limiares e a lista do que não detecta), [`signals.ts`](views-suspeitas/src/domain/signals.ts) (detectores) e [`classify.ts`](views-suspeitas/src/domain/classify.ts) (decisão e motivo).
2. **Os testes que respondem ao enunciado**, pelos nomes (descrevem comportamento):
   - Vendas: [`orders.test.ts`](vendas-shopify/test/orders.test.ts) e [`refunds.test.ts`](vendas-shopify/test/refunds.test.ts).
   - Origem: [`decide-origin.test.ts`](origem-cadastros/test/decide-origin.test.ts) e [`api.test.ts`](origem-cadastros/test/api.test.ts).
   - Rastreio: [`shipments.test.ts`](rastreio-envio/test/shipments.test.ts) (fora de ordem, repetido, status inventado), [`delays.test.ts`](rastreio-envio/test/delays.test.ts) (atraso com data controlada) e [`trackhub.test.ts`](rastreio-envio/test/trackhub.test.ts) (cliente HTTP e exemplo bruto → normalizado).
   - Roteiro: [`deadline.test.ts`](revisao-roteiro/test/deadline.test.ts) (último instante do dia vale, o primeiro do dia seguinte não, com relógio controlado) e [`flow.test.ts`](revisao-roteiro/test/flow.test.ts).
   - Métricas: [`sync.test.ts`](metricas-redes/test/sync.test.ts) (janelas sobrepostas, duplicata, 429 com relógio controlado) e [`e2e.test.ts`](metricas-redes/test/e2e.test.ts) (as quatro redes por HTTP real contra o simulador).
   - Vídeo: [`review.test.ts`](revisao-video/test/review.test.ts) (peça pendente bloqueia, versão nova desfaz a aprovação, comentário não migra) e [`model.test.ts`](revisao-video/test/model.test.ts).
   - Views: [`classify.test.ts`](views-suspeitas/test/classify.test.ts) (séries montadas à mão: pico orgânico × comprado com o mesmo pico, o caso em que prefere não acusar) e [`readme.test.ts`](views-suspeitas/test/readme.test.ts) (falha quando um número do README diverge do medido).
3. **Idempotência e concorrência** nos projetos com banco (vendas, origem, rastreio, roteiro, métricas, vídeo): `test/concurrency.test.ts` sobe 4 `worker_threads` com conexões separadas ao mesmo arquivo SQLite. A garantia vem do banco (`UNIQUE` + `ON CONFLICT DO NOTHING` em `BEGIN IMMEDIATE`), não de consultar antes de inserir. Parte desses testes usa uma barreira para largar juntos (vendas, debug, a migração do rastreio, roteiro, métricas e vídeo); em origem e rastreio os workers competem sem barreira. Cada README diz qual é o caso.
4. **A fronteira do agregador (rastreio):** só `src/aggregator/trackhub/` conhece o formato do fornecedor; o resto usa a interface [`TrackingAggregator`](rastreio-envio/src/aggregator/port.ts). O e2e roda o mesmo fluxo com o cliente HTTP real e com um agregador em memória.
5. **O PR de debug:** [PR #1 no fork](https://github.com/danteacosta/conty-challenge-debug/pull/1). A tabela do corpo liga cada linha do `logs/incident.jsonl` à causa e à correção; o caso que só o log mostra é a chave com U+200B (`msn_2044`), que `trim()` não remove.
6. **O PR de otimização:** [PR #1 no fork](https://github.com/danteacosta/conty-challenge-optimize/pull/1). O bench está no corpo; o oráculo está em `test/reference-list-creators.ts`.
7. **Views suspeitas:** o número de falso positivo do README é gerado por `npm run dataset` e conferido por teste; leia primeiro a seção "O que ele NÃO detecta" e a tabela por família do README, que mostra onde o classificador erra.
8. **Como reproduzir os números** (suítes, matriz de Node e mutação): [`verificacao/`](verificacao/README.md).

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
| Versão de roteiro enviada depois do prazo do pedido | **Aceita e marcada `late`** | Recusar bloquearia o fluxo; marcar deixa a marca decidir. | `transitions.ts` |
| Prazo do pedido de alteração | **Dia civil em America/Sao_Paulo, inclusive**; passado é recusado | "Último instante vale" só faz sentido no fuso da marca. | `deadline.ts` |
| `Retry-After` maior que o teto de espera | **Adia (`deferred`) com `retry_at`**, sem tentar antes | Esperar além do teto prende a requisição; tentar antes ignora o provedor. | `retry.ts` |
| Identidade de um snapshot de métrica | **conexão + post + `as_of` do provedor**; os totais somam o último snapshot de cada post | Janelas sobrepostas e respostas duplicadas não contam duas vezes. | `store.ts` |
| Peças exigidas pela campanha | **Dado da campanha**, não `if` no código | Campanha só de vídeo não exige roteiro, sem ramificar. | `pieces.ts` |
| Entrega aprovada que recebe versão nova numa peça | **Deixa de estar aprovada** e **volta sozinha** quando a versão nova for aprovada; o log diz por quê | O estado é derivado das peças, nunca um flag que alguém esquece de limpar. | `approval.ts` |
| Série de views ambígua (patamar com variação natural, viral cortado, degrau, volume baixo) | **`inconclusive`**, não `suspicious` | Acusar errado custa mais que não concluir; a taxa de abstenção sai junto com a de falso positivo. | `criteria.ts` |

## O que ficou de fora (de propósito)

- **Segurança de borda:** nenhuma das APIs tem autenticação, e o webhook não valida a assinatura HMAC do Shopify. Em produção isso é obrigatório (sem HMAC qualquer um forja pedidos).
- **Vendas:** pedido repetido com outro conteúdo (o status evolui de não pago para pago, mas valor e criador ficam congelados no primeiro evento pago, e um pendente atrasado não desfaz o pago); moeda ≠ BRL; itens de reembolso do Shopify (`refund_line_items`); UTM lida só de `utm_parameters.utm_content`, não do `landing_site`.
- **Rastreio:** dialetos fictícios; atualização só por consulta (sem webhook de push do agregador); limite de atraso único para todas as transportadoras; aviso reservado que nunca é entregue se o processo morrer no meio (sem expiração da reserva); relógio da transportadora sem correção.
- **Origem:** geração do `cid` e redirecionador; vários usuários no mesmo `install_id`; validação de `touched_at` no futuro.
- **Debug:** guarda por missão e transação implementadas; os lançamentos históricos errados não foram reparados; `PENDING` atrasado ainda regride um repasse pago.
- **Roteiro:** sem autenticação nem papéis (quem pede e quem aprova); sem notificação de prazo; sem edição de pedido já feito.
- **Métricas:** OAuth e renovação de token (a conexão chega autorizada); provedor simulado, não as APIs reais; sem webhook de push.
- **Vídeo:** sem upload de arquivo (a versão guarda uma URL); sem permissões por papel.
- **Views:** dados reais de rede social não foram usados, só o dataset sintético; os limiares são hipóteses medidas contra ele; a compra disfarçada (imita a forma orgânica) passa como orgânica e isso está medido e documentado, não escondido.
- **Otimização:** índices em `src/db.ts` (custo de criação na primeira abertura de um banco grande), sem pré-agregação persistida nem tabelas derivadas; `db.function` exige Node 22.13+.

## Como a qualidade foi checada

- Testes escritos antes do código; vi cada grupo falhar pelo motivo certo antes de implementar.
- Propriedades (fast-check): estorno `= min(total, soma pedida)` em qualquer ordem de chegada; a decisão de origem não depende da ordem dos toques.
- **Mutação (Stryker)**, rodada de 09/10/2026 em Node 24.7, com os relatórios completos em [`verificacao/mutacao`](verificacao/mutacao/RESUMO.md): vendas 407/471 (86,4%), origem 334/338 (98,8%), rastreio 522/542 (96,3%), roteiro 353/393 (89,8%), métricas 649/677 (95,9%), vídeo 605/723 (83,7%) e views 868/935 (92,8%). O escopo da mutação cresceu desde a primeira entrega (`app.ts`, `alerts.ts`, `instant.ts`). **Não afirmo que todo sobrevivente é equivalente**: o `RESUMO.md` lista cada um, e a avaliação é por módulo (equivalentes, texto de mensagem de erro, ruído da ferramenta e lacunas reais já corrigidas estão descritos nos READMEs). Ela apontou testes fracos de verdade (desempate por `cid` e por tipo que passava só por coincidência de ordem, status que contam como venda, conflito de cadastro de criador), que foram corrigidos. Os sobreviventes e suas limitações devem ser avaliados por módulo nos READMEs; o percentual não prova que todos sejam equivalentes. No rastreio, a mutação também mostrou que meu primeiro teste de concorrência de avisos rodava num processo só (onde nada corre em paralelo de verdade); foi trocado por 4 workers com conexões separadas. O desafio 3 teve mutação manual do SQL: 10 de 10 mortos pelo oráculo. Em views, além do Stryker, mutei à mão cada um dos 22 limiares de `criteria.ts` para cima e para baixo (44 mutantes): todos morrem; a primeira rodada do Stryker (73%) apontou testes de borda que faltavam e um defeito real (um pico menor logo depois de um maior reabria horas já usadas e gerava um sinal falso), corrigidos. Um mutante manual meu de `BEGIN IMMEDIATE` → `BEGIN` foi inválido na primeira vez (a substituição pegou um comentário, não o código) e parecia sobreviver; refeito com substituição global em todas as ocorrências, passou a morrer.
- Smoke test: subi cada API de verdade e exercitei com `curl`.

## O que eu NÃO verifiquei

- Os projetos novos foram verificados em **Node 22.15.0 e 24.7.0** (suítes completas, repetidas); não testei 22.0 a 22.12, onde `node:sqlite` ainda pede flag (por isso `engines` é `>=22.13`). O repositório de debug, que não é meu, declara `>=22` e foi testado em 22.15 e 24.7.
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

## Entrega completa dos sete desafios com código

Roteiro, métricas, vídeo e views foram adicionados depois da segunda auditoria. A matriz de Node foi rerodada com os sete projetos e o fork de debug: [`verificacao/matriz-node.log`](verificacao/matriz-node.log), 96 execuções completas (8 projetos × 6 repetições × 2 versões de Node), 0 falhas, `typecheck` limpo. Testes por projeto (depois dos complementos abaixo): vendas 127, origem 117, rastreio 257, roteiro 128, métricas 239, vídeo 120, views 174, debug 46, e 34 na otimização. **Revisão humana: ainda não feita.** As checklists dos READMEs seguem desmarcadas.

## Complementos depois de uma terceira pesquisa

Uma pesquisa em mais repositórios apontou lacunas que eu não tinha coberto. Tratei cinco das seis, cada uma com teste escrito antes e visto falhar:

| Frente | Lacuna | O que mudou |
|---|---|---|
| Vendas | 91 pedidos válidos de 999.999.999.999,99 deixavam `GET /creators/:id/sales` em 500 (a soma passa de 2^53; o driver recusa o número) | Soma em BigInt, com leitura linha a linha se a soma passar de 64 bits no SQLite. `gross_cents`, `refunded_cents` e `net_cents` são números enquanto cabem; acima disso `null`, e `exact` traz os três como texto, sempre. É uma mudança de contrato (campo novo e `null` possível) e está no README |
| Vendas | Mesmo id de estorno com outro pedido ou valor respondia `duplicate` e escondia a colisão | 409 `refund_conflict`, nada muda; `1.0` e `1.00` são o mesmo. Pedido repetido com conteúdo diferente continua `duplicate`, porque o status do pedido evolui |
| Otimização | Página e total em consultas separadas por `await`: uma escrita no meio dava `total: 0` com um criador na página | Campanha, página e total numa leitura síncrona dentro de `BEGIN`/`COMMIT`; continuam 3 queries. O teste de consistência falha contra o código anterior |
| Roteiro | Um retry atrasado, depois de um novo pedido de alteração, criava outra versão e respondia à rodada errada | `change_request_id` (409 `stale_round`) e `submission_id` (o mesmo envio devolve a versão original; conteúdo ou rodada diferente é 409). Opcionais, para não quebrar quem já usa a rota |
| Views | Casos adversariais: pico orgânico grande junto de bloco suspeito menor, ciclo longo com poucas repetições, série cortada no meio do patamar ou da cauda | Testes novos (o classificador já se comportava bem em todos) e estabilidade entre sementes: seis outros pares de sementes, falso positivo de 0% a 0,2% |

**Não implementei**: política para eventos de rastreio com data no futuro (tolerância de relógio e quarentena). O enunciado não define tolerância, e escolher uma sem o Dante endossar seria inventar regra de negócio; fica registrado como melhoria. *(Estado histórico desta rodada; a quarta rodada, abaixo, fechou duas pendências citadas aqui: a corrida de `submission_id` ganhou teste com workers e a otimização entrou na matriz.)* A matriz de Node foi rerodada depois dos complementos ([`verificacao/matriz-node.log`](verificacao/matriz-node.log)): 96 execuções completas, 0 falhas. Ela pegou dois erros que só apareciam no Node 22.15 e que eu só vi ali (o iterador do `node:sqlite` fechava o statement antes da hora num volume grande, e `db.isTransaction` só existe a partir do Node 24); os dois foram corrigidos. Nesta rodada a otimização (30 testes) passava em 22.15 e 24.7 fora do script da matriz.

## Quarta rodada: o que a revisão do estado publicado achou

| Frente | Problema | Correção e verificação |
|---|---|---|
| Matriz de Node | O script ignorava o código de saída dos testes e não deixava um erro de `typecheck` afetar o resultado: com executáveis falsos que falhavam, terminava com "0 falhas" e saída 0. As 96 execuções anteriores não falharam; o script é que não as certificava | Agora cada execução vale pelo código de saída, a saída sem a linha "Tests" é falha e o `typecheck` entra no resultado final; os logs completos ficam em `LOG_DIR`. [`verificacao/autoteste-matriz.sh`](verificacao/autoteste-matriz.sh) prova com executáveis falsos que ela falha fechado (5 casos). Inclui `OPTIMIZE_REPO` |
| Métricas | Cabeçalhos chegavam e o corpo era interrompido por timeout: virava `invalid_payload` e não era repetido | Ler o corpo e interpretá-lo são falhas separadas: `TimeoutError`/`AbortError` é `timeout`, queda de conexão é `network` (repetidos); JSON inválido continua terminal. 6 testes novos, incluindo a sync que termina `succeeded` na segunda tentativa |
| Views | Só o patamar mais longo era avaliado: um patamar ruidoso de 36 h escondia outro, quase fixo, de 12 h (o segundo sozinho era `suspicious`, os dois juntos davam `inconclusive`) | `findPlateauCliffs` devolve todos os patamares sem sobreposição e cada um é avaliado por si: o quase fixo é acusado e o ruidoso continua só dúvida (o motivo cita só o acusado). O dataset/README não mudou de número (a tabela continua em sincronia) |
| Vendas | `GET /orders/:id` lia pedido e estornos em consultas separadas: com um `pending → paid` de outra conexão no meio saía total 100, estornado 140 e líquido −40 | Leitura num retrato único (`readSnapshot`, `BEGIN` fixa o estado em WAL). O teste usa duas conexões num arquivo e uma escrita disparada entre as consultas; falhava antes |
| Roteiro | A corrida do mesmo `submission_id` não tinha teste na suíte | `test/submission-race.test.ts`: 4 workers largando juntos, 12 bancos novos, mesmo conteúdo (uma versão + 3 repetições) e conteúdos conflitantes (um vencedor, 409 para o outro). Trocar `BEGIN IMMEDIATE` por `BEGIN` faz os dois falharem |
| Documentação | O PR da otimização dizia 20 testes e não descrevia o snapshot; as notas diziam que o primeiro registro de vendas vence; o README de vendas dizia 100% de mutação em `store` | PR atualizado (30 testes, snapshot, `engines` `>=22.13`); a frase de vendas foi corrigida (o status evolui de não pago para pago; valor e criador ficam congelados no primeiro evento pago); `store` está em 99,2% e o único sobrevivente está explicado |

**Não implementei** (ideias opcionais da última pesquisa): conflito observável de snapshot de métrica (mesmo post e `as_of` com 100 e depois 999 views hoje conta como `duplicate`, sem corrupção), cancelamento auditado de pedido de alteração, prorrogação de prazo e aprovação de uma versão anterior. As duas últimas mudam regra de produto e dependem de decisão do Dante; as duas primeiras são pequenas e ficam como próximo passo. Eventos de rastreio com data futura também continuam fora.

A matriz foi rerodada com o script corrigido, incluindo o fork da otimização: [`verificacao/matriz-node.log`](verificacao/matriz-node.log), **108 execuções completas** (9 projetos × 6 repetições × 2 versões de Node), 0 falhas e 0 erros de typecheck. **Revisão humana: ainda não feita.**

## Quinta rodada: doze melhorias da pesquisa seguinte

Todas com teste escrito antes e visto falhando pelo motivo certo; cada projeto foi reverificado, o Stryker rodou de novo nos afetados e a matriz de Node (agora com a otimização) foi rerodada: [`verificacao/matriz-node.log`](verificacao/matriz-node.log), **108 execuções completas, 0 falhas e 0 erros de typecheck**.

| # | Projeto | O que mudou |
|---|---|---|
| 1 | Vídeo | `second` e `duration_seconds` só em inteiro seguro: `1e16` era aceito e a consulta dava 500; agora é 400 sem gravar nada |
| 2 | Vídeo | `submission_id` no envio de versão: repetir devolve a versão original (também depois da aprovação, sem reabrir a revisão); outro conteúdo é 409; corrida com 4 conexões testada |
| 3 | Métricas | Mesma identidade de snapshot com contadores diferentes é conflito: o canônico fica, os totais não mudam, uma linha por valor contraditório com contagem de ocorrências, e o lote continua |
| 4 | Métricas | `last_checked_at` separado de `fetched_at` e `as_of`; só avança (MAX), falhas e posts ausentes não o avançam |
| 5 | Vendas | `SQLITE_BUSY`/`SQLITE_LOCKED` viram 503 `database_busy` com `Retry-After`, sem efeito parcial; outros erros de SQL continuam 500 |
| 6 | Rastreio | Outro `creator_id`/`campaign_id` no recadastro é 409 `link_conflict`, o original é preservado e o agregador não é chamado |
| 7 | Rastreio | Cadastros simultâneos iguais compartilham uma chamada externa por código e transportadora, na instância |
| 8 | Roteiro | Cancelar um pedido de alteração com `reason` e `cancelled_by`; o histórico fica, e um envio da rodada cancelada não responde à nova (`round_cancelled`) |
| 9 | Vendas | `GET /reconciliation`: total = atribuído + sem criador, com BigInt/`exact` e o mesmo retrato do banco |
| 10 | Views | Experimento de sensibilidade por volume e duração, com semente própria, publicado no README e conferido por teste. O falso positivo fica entre 0% e 1,3% por faixa de volume e 0% a 0,5% por duração (um falso positivo muda a taxa em 2,5 pontos por célula); com volume muito baixo ele se abstém em todos os legítimos e o recall cai |
| 11 | Vídeo | Copiar comentários escolhidos para outra versão, a pedido: o original fica, a cópia guarda a origem, repetir não duplica, âncora fora da duração recusa tudo e avisa |
| 12 | Otimização | Alcance acima de 2^53 responde 200: soma e ordem exatas, JSON com o número mais próximo. O contrato escolhido está no PR |

**O que a rodada mostrou e eu registro sem esconder:**
- As porcentagens de mutação de vídeo (85,0% → 83,7%) e vendas (87,9% → 86,4%) caíram: o código novo trouxe rotas e mensagens de erro (os testes afirmam o status e o campo, não a frase) e comparações que fecham por construção (`reconciles`). Os sobreviventes relevantes estão descritos em cada README. Em views, o Stryker passou a usar `vitest.stryker.config.ts`, sem os testes que sobem processos ou geram o dataset várias vezes; o número com a suíte inteira é maior, e eu reporto o menor.
- O experimento de sensibilidade encontrou dois falsos positivos (ambos transmissões ao vivo em volume ~100/h, regularidade 1,08 e 1,38) que o `dev` e o `holdout` não mostravam na mesma proporção. Não recalibrei nada contra eles.
- Mudanças de contrato desta rodada (todas aditivas ou com status novo): campos `conflicts` e `last_checked_at` em métricas, `exact` e `reconciliation` em vendas, `submission` e `copied_from` em vídeo, `status`/`cancellation` e `cancel_changes` em roteiro (`allowed_actions` em `changes_requested` ganhou um item e três testes foram atualizados), `latest_reach` na otimização passou a ser a soma exata arredondada.

**Continua de fora**: métrica ausente ≠ zero (muda o contrato para campos `null` e precisa de decisão de compatibilidade), prorrogação de prazo, aprovar uma versão anterior, eventos de rastreio com data futura. **Revisão humana: ainda não feita.**
