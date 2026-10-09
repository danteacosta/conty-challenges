# Métricas das redes do criador

Serviço que, dada uma conexão **já autorizada** (token fictício), sincroniza as métricas dos posts de Instagram, TikTok, YouTube e X a partir de um **provedor simulado**. Sobrevive a timeout, resposta duplicada e limite de taxa (429 com `Retry-After`), e duas sincronizações com janelas que se sobrepõem **não contam o mesmo post duas vezes**. OAuth real está fora de escopo.

```bash
npm install
npm test            # 218 testes: retry, Retry-After, adapters, sync, cliente HTTP, configuração, e2e nas 4 redes, corrida
npm run typecheck
npm run mutation    # Stryker (relatório em reports/)

npm run simulator   # provedor simulado em http://127.0.0.1:4011 (conta "demo" nas 4 redes)
npm start           # API em http://127.0.0.1:3014   (variáveis abaixo)
```

Node 22.13+ (verificado em 22.15 e 24.7).

### Configuração (validada na subida)

| Variável | Padrão | Aceita |
|---|---|---|
| `PORT` | 3014 | inteiro de 1 a 65535 |
| `PROVIDER_URL` | `http://127.0.0.1:4011` | URL `http` ou `https` |
| `PROVIDER_TIMEOUT_MS` | 5000 | inteiro de 100 a 120000 |
| `MAX_RETRY_AFTER_MS` | 30000 | inteiro de 0 (adiar sempre) a 3600000 |
| `DB_PATH` | `:memory:` | caminho não vazio |

Valor inválido derruba a subida com **todos** os problemas numa mensagem. Em especial `MAX_RETRY_AFTER_MS`: se virasse `NaN`, `retryAfterMs > NaN` seria sempre falso e o serviço esperaria qualquer `Retry-After`, que é exatamente o que o teto existe para impedir. O banco padrão é em memória (escolha explícita): sem `DB_PATH`, um processo novo começa vazio.

## Como está dividido

```
regra de negócio            fronteira                    o mundo de fora
src/sync.ts  ───────►  src/providers/port.ts  ◄───  src/providers/http.ts  ──►  provedor (HTTP)
src/domain/retry.ts      MetricsProvider              src/providers/adapters.ts   src/providers/simulator.ts
src/store.ts             PostSnapshot, ProviderError  (formato de cada rede)
```

- A regra (`sync`, `retry`, `store`) só conhece a interface `MetricsProvider` e o formato único `PostSnapshot`. Ela nunca vê o JSON de uma rede.
- O formato de cada rede (Instagram, TikTok, YouTube, X: nomes de campo, tipos, datas em ISO ou em segundos desde 1970, contadores em texto) vive só em [`adapters.ts`](src/providers/adapters.ts). Rede nova = uma linha na tabela.
- O cliente HTTP ([`http.ts`](src/providers/http.ts)) traduz o que a rede responde em falhas tipadas: `timeout`, `network`, `server` (5xx), `client` (4xx), `rate_limited` (429, com o `Retry-After` já em milissegundos) e `invalid_payload`.
- O provedor simulado ([`simulator.ts`](src/providers/simulator.ts)) fala o formato das quatro redes e falha sob comando: timeout, 429, 5xx, itens duplicados e itens inválidos. Nada de regra mora nele.
- Relógio e `sleep` são injetados, então os testes de espera usam **relógio controlado** e não esperam de verdade.

## Rotas

| Rota | O que faz |
|---|---|
| `POST /connections` `{provider, account_id, token}` | cadastra a conexão (`instagram`, `tiktok`, `youtube` ou `x`). O token **entra e nunca mais sai**: nenhuma resposta o devolve. 409 se a conta já está cadastrada. |
| `POST /connections/:id/sync` `{since, until}` | sincroniza os posts **publicados** entre `since` e `until` (ISO-8601 com fuso). 200 `succeeded`, 202 `deferred`, 502 `failed`. |
| `GET /connections/:id/metrics` | o número atual de cada post, os totais, e **quando cada métrica foi buscada**. |
| `GET /connections/:id/syncs` | o histórico de sincronizações (da mais nova para a mais antiga) com tentativas, esperas e resultado. |

## Como a idempotência funciona

Três tabelas com papéis diferentes ([`db.ts`](src/db.ts)):

| Tabela | Chave | Papel |
|---|---|---|
| `metric_snapshots` | `(conexão, post, as_of)` | histórico append-only. O **mesmo snapshot entra uma vez só**, venha de onde vier. |
| `posts` | `(conexão, post)` | o **número atual** do post: o snapshot de maior `as_of`. |
| `sync_runs` | id | cada execução: janela, tentativas, esperas, contagens, status. |

`as_of` é o horário em que o **provedor** mediu os números. A identidade do snapshot é conexão + post + `as_of`, e **não** a janela da busca: duas janelas que se sobrepõem devolvem o mesmo post com o mesmo `as_of`, que é o mesmo snapshot.

Quando um post chega de novo:

- **mesmo snapshot** (mesmo `as_of`: janela sobreposta, resposta repetida, item duplicado dentro da resposta ou entre páginas): ignorado e contado em `duplicates`;
- **snapshot mais novo** (contadores maiores, `as_of` maior): entra no histórico e **atualiza** o número atual; não soma;
- **snapshot mais antigo que o atual** (chegou atrasado): entra no histórico, mas **não substitui** o número atual, e é contado em `stale`.

Os **totais somam `posts`, nunca os snapshots**. Por isso nenhum post conta duas vezes, nem em sincronizações simultâneas: a gravação de cada página é uma transação curta com `ON CONFLICT DO NOTHING` e `WHERE excluded.as_of > posts.as_of`, e a rede e a espera acontecem **fora** de qualquer transação.

**Quando foi buscado.** Cada post traz `as_of` (do provedor) e `fetched_at` (do **nosso** relógio, quando buscamos); são coisas diferentes. A resposta de métricas traz também `last_fetched_at`, e `GET /syncs` mostra cada execução com `started_at`/`finished_at`.

Exemplo: o post `instagram_2` está nas janelas A (19–26/05) e B (24–31/05). Com os totais abaixo, ele aparece uma vez (`posts: 3`, `views: 7400 = 1200 + 5400 + 800`):

```http
POST /connections/59896ddd-…/sync
{ "since": "2026-05-24T00:00:00Z", "until": "2026-05-31T00:00:00Z" }
```
```json
{ "run_id": 2, "status": "succeeded", "attempts": 1, "pages": 1, "received": 2, "new_snapshots": 1, "duplicates": 1, "stale": 0, "invalid": 0, "waits_ms": [], "retry_at": null, "error": null }
```
```json
{
  "last_fetched_at": "2026-10-09T19:08:24.064Z",
  "totals": { "posts": 3, "views": 7400, "likes": 555, "comments": 43, "shares": 22 },
  "posts": [{ "post_id": "instagram_2", "published_at": "2026-05-25T10:00:00.000Z", "as_of": "2026-10-09T19:08:22.006Z",
              "fetched_at": "2026-10-09T19:08:24.022Z", "snapshots": 1, "metrics": { "views": 5400, "likes": 410, "comments": 32, "shares": 18 } }]
}
```

## O que acontece com falhas e com 429

A decisão é uma função pura, [`decide`](src/domain/retry.ts), por página:

| Falha | Decisão |
|---|---|
| timeout, rede, 5xx | tenta de novo com espera exponencial **200, 400, 800 ms…** (teto de 5 s), até **4 tentativas** por página. Depois falha (`failed`, 502). |
| 4xx (token recusado) e payload inválido | não adianta repetir: falha na primeira tentativa. |
| **429 com `Retry-After`** | espera **exatamente** o que o provedor mandou, e tenta de novo. |
| 429 com `Retry-After` **acima do teto de espera** (`maxRetryAfterMs`, padrão 30 s), ou com as tentativas esgotadas | **não espera além do teto e não tenta antes do que o provedor pediu**: a sync termina `deferred` (202) com `retry_at = agora + Retry-After`. |
| 429 sem `Retry-After`, ou com valor inválido | trata como falha transitória (backoff). |

`Retry-After` aceita segundos inteiros ou data HTTP (`Mon, 01 Jun 2026 12:00:10 GMT`, convertida pela diferença para agora; data passada vira 0). Todo 429 conta nas tentativas.

Com o relógio controlado ([`sync.test.ts`](test/sync.test.ts)): um `Retry-After: 7` faz o serviço dormir exatamente 7000 ms, e a segunda chamada ao provedor acontece 7 s depois da primeira (a diferença entre as duas chamadas é conferida); um `Retry-After` de 10.001 ms com teto de 10.000 adia sem dormir e sem uma segunda tentativa; 429 repetidos terminam adiados depois de 4 tentativas, em vez de em laço.

A rede e as esperas acontecem fora das transações. Se a **segunda página** falha, a primeira já foi gravada, e rodar a sync de novo completa sem duplicar. Cursor que se repete (`pagination_loop`) e provedor que nunca para de dar páginas (`too_many_pages`, teto de 50) também terminam em `failed`, com o que já chegou guardado.

## Testes

- **Regras puras**: política de retry (incluindo uma propriedade: a espera nunca passa do teto e as tentativas têm limite), `Retry-After`, adapters das quatro redes e datas estritas.
- **Sync pela API**, com provedor em memória e relógio controlado: idempotência (mesma janela, janelas sobrepostas, número mais novo, snapshot atrasado, item duplicado, paginação), retry, 429, entradas inválidas, token que nunca volta.
- **Cliente HTTP contra o simulador real** (porta efêmera): mapeamento de cada status, `Retry-After` em segundos e em data, timeout de verdade, rede fora do ar, payload malformado.
- **E2E por HTTP** nas quatro redes: duas janelas sobrepostas, 429, timeout, duplicata, 401.
- **Corrida** com `worker_threads` e barreira: 4 sincronizações simultâneas da mesma conexão, com janelas sobrepostas e com snapshot novo e atrasado do mesmo post, 10 vezes em bancos novos; cada snapshot entra uma vez e o número final é sempre o do mais novo.

## Verificação

- 218 testes em Node 22.15.0 e 24.7.0. Relatório e script para repetir em [`../verificacao`](../verificacao/README.md).
- Mutação (Stryker): 599 de 623 (96,1%): `retry` 100%, `retry-after` 97,4%, `store` 98,3%, `sync` 98,5%, `instant` 98,3%, `adapters` 96,1%, `config` 95,7%, `http` 89,1%. Os vivos de `http.ts` são sobretudo o texto das mensagens de erro (os testes afirmam o tipo da falha, não a frase) e dois ramos equivalentes (`catch {}` do JSON e `typeof body` antes de ler `data`, que dão `invalid_payload` de qualquer jeito). Em `store.ts`, `>=` no lugar de `>` do `as_of` é equivalente: um snapshot com o mesmo `as_of` já foi barrado antes como duplicado.
- Mutação manual nos pontos críticos, todos pegos: tentativas (`>`/`>=`), teto do `Retry-After`, backoff, erro do cliente repetido, data passada do `Retry-After`, unidade (ms), época em segundos, contador negativo, 500/408, cursor, leitura do cabeçalho errado, snapshot atrasado substituindo o atual, "sempre substitui", `retry_at` no passado, espera não registrada ou não feita, tentativas não contadas, cursor repetido, teto de páginas, erro inesperado, token devolvido, códigos 202/502 e janela invertida.
- **`BEGIN IMMEDIATE` por `BEGIN` não é detectado, e é equivalente aqui**: toda transação deste projeto começa por uma escrita (`INSERT`/`UPDATE`), então o lock é tomado na primeira instrução de qualquer jeito. O `IMMEDIATE` fica como defesa para uma transação futura que leia antes de escrever. O que a corrida protege (e os testes provam) é a idempotência por chave: sem `ON CONFLICT` ou com "sempre substitui" o teste de concorrência falha.

## Decisões e o que ficou de fora

- **A janela é de publicação.** `since`/`until` filtram posts pela data em que foram publicados (no provedor). Uma janela por `as_of` mudaria quais posts voltam.
- **Retry-After acima do teto adia em vez de esperar o teto e tentar.** Tentar antes do que o provedor pediu arrisca outro 429 e contraria o pedido dele. O custo: a sync fica incompleta até `retry_at`, e **o agendamento dessa nova tentativa não existe aqui** (quem chama usa o `retry_at`).
- **Mesmo `as_of` com contadores diferentes**: vale o primeiro. É o mesmo snapshot pela chave; se um provedor republicar números diferentes com o mesmo `as_of`, o segundo é descartado.
- **Sem cooldown persistente**: o `retry_at` de uma sync adiada não impede outra sync de tentar antes (ela mesma receberia outro 429). Um cooldown por conexão, guardado no banco, é o próximo passo.
- **Sem orçamento total de espera por sync**: o teto é por espera e as tentativas são por página, então uma sync de muitas páginas pode demorar. Um orçamento total é o próximo passo.
- Sem OAuth real, renovação de token, autenticação das rotas, agendamento das sincronizações nem métricas por vídeo/story. O token é guardado em texto no SQLite, o que só é aceitável porque é fictício.
- O `parseInstant` está copiado em outros projetos da pasta: cada um é independente.

## Uso de IA

Este projeto foi escrito com o Claude Code (Claude Sonnet 5.5), seguindo um plano que eu aprovei antes de qualquer código. A IA propôs o desenho, escreveu os testes antes do código, a implementação, o README, rodou a mutação (Stryker e à mão) e as suítes em Node 22.15 e 24.7. As decisões da seção acima são escolhas minhas que ainda preciso endossar.

**Eu (Dante) preciso confirmar antes de enviar** *(marque o que de fato revisou; a revisão humana ainda não foi feita)*:

- [ ] Concordo com a identidade do snapshot (conexão + post + `as_of`) e com os totais somando só o número atual de cada post.
- [ ] Concordo com adiar a sync (`deferred`) quando o `Retry-After` passa do teto, em vez de esperar o teto.
- [ ] Li `src/domain/retry.ts`, `src/store.ts` e `src/sync.ts`.
- [ ] Rodei `npm test` e `npm run mutation` localmente.
