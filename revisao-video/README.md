# Revisão de vídeo

API de revisão das peças de uma entrega: **roteiro, vídeo, capa e legenda**, em versões, com comentários presos a um segundo do vídeo. A campanha declara quais peças exige, e a entrega só é aprovada quando cada peça **exigida** tem a **versão atual** aprovada. Upload real é só uma URL: o que não pode ser falso é a regra.

```bash
npm install
npm test            # 83 testes: regras puras, API, modelo de referência com propriedades, e2e HTTP, corrida entre conexões
npm run typecheck
npm run mutation    # Stryker (relatório em reports/)
npm start           # http://127.0.0.1:3015   (DB_PATH=arquivo.db para persistir)
```

Node 22.13+ (verificado em 22.15 e 24.7). Sem autenticação nem papéis.

## A regra, em uma tela

| | |
|---|---|
| **Peças exigidas** | são **dado da campanha** (`campaign_required_pieces`), não um `if`. Campanha só de vídeo declara `["video"]` e pronto: roteiro, capa e legenda não são exigidos. Peça que a campanha não pediu pode ser enviada, e **não bloqueia**. |
| **Versão** | cada envio é a versão `n+1` da peça; a anterior continua legível (`superseded: true`). Só a **versão atual** pode ser aprovada ou receber pedido de alteração. Aprovada e "alteração pedida" são estados finais da versão: o próximo passo é uma versão nova. |
| **Aprovar a entrega** | exige cada peça exigida com a versão atual aprovada. Senão, **409 `pieces_pending`** listando cada peça que falta e o motivo (`no_version`, `pending_review`, `changes_requested`). |
| **Versão nova numa peça de entrega aprovada** | a entrega deixa de estar aprovada (`in_review`) **até a nova versão ser aprovada**; aprovar a nova a devolve a `approved` sozinha, sem aprovar a entrega de novo. |
| **Comentário** | preso a **uma versão** e, no vídeo, a um **segundo** dela. É visível na versão em que foi feito e **não migra** para a versão nova. |

O status da entrega é **derivado**, nunca guardado: [`src/domain/approval.ts`](src/domain/approval.ts).

| `status` | Significa |
|---|---|
| `in_production` | ninguém aprovou a entrega ainda |
| `approved` | foi aprovada e cada peça exigida tem a versão atual aprovada |
| `in_review` | foi aprovada, mas uma peça exigida recebeu versão nova que ainda não está aprovada (`approval.invalidated: true`) |

Um **log append-only** (`events`) explica cada mudança: `approved` (com as versões aprovadas naquele momento), `invalidated` (qual peça e versão desfez) e `restored` (qual aprovação devolveu). Versão nova de peça **não exigida** não desfaz nada.

## Rotas

| Rota | O que faz |
|---|---|
| `POST /campaigns` `{required_pieces}` | cria a campanha. Lista não vazia, sem repetição, de `script`, `video`, `cover`, `caption`. |
| `POST /deliveries` `{campaign_id}` / `GET /deliveries/:id` | cria / mostra a entrega: status, pendências, as quatro peças com todas as versões e o log. |
| `POST /deliveries/:id/pieces/:piece/versions` `{url, duration_seconds?}` | envia uma versão (a duração só existe no vídeo). Responde com a versão e o `delivery_status` resultante. |
| `GET /deliveries/:id/pieces/:piece/versions/:n` | uma versão, com os comentários dela (ordenados pelo segundo). |
| `POST …/versions/:n/approve` | aprova a versão atual (repetir é inofensivo). |
| `POST …/versions/:n/request-changes` `{reason}` | pede alteração na versão atual (o motivo é obrigatório). |
| `POST …/versions/:n/comments` `{second, text, author?}` | comenta. No vídeo o `second` é obrigatório (inteiro ≥ 0 e ≤ `duration_seconds`, se houver); nas outras peças o comentário vale para a peça toda e `second` é recusado. |
| `POST /deliveries/:id/approve` | aprova a entrega (409 `pieces_pending` se faltar peça; repetir é inofensivo). |

Erros: `400 validation_error` (com `field`), `404 not_found` (com `what`: campanha, entrega ou versão) e `unknown_piece`, `409 pieces_pending` / `version_superseded` / `version_not_pending`.

## Exemplo

Aprovar com peça pendente:

```http
POST /deliveries/5c1e…/approve
```
```json
{ "error": "pieces_pending",
  "pending": [ { "piece": "video", "reason": "pending_review", "current_version": 1 },
               { "piece": "cover", "reason": "no_version" } ] }
```

Uma entrega aprovada que recebe versão nova do vídeo:

```http
POST /deliveries/5c1e…/pieces/video/versions
{ "url": "https://arquivos.example/v2.mp4", "duration_seconds": 55 }
```
```json
{ "version": { "number": 2, "state": "pending", "superseded": false, "comments_count": 0, … }, "delivery_status": "in_review" }
```
```json
{ "status": "in_review",
  "approval": { "approved_at": "2026-10-09T19:20:32.123Z", "invalidated": true },
  "pending": [ { "piece": "video", "reason": "pending_review", "current_version": 2 } ] }
```

Depois de `POST …/video/versions/2/approve` a entrega volta a `approved`, e o log fica `[approved, invalidated(video v2), restored(video v2)]`. O comentário da v1 (`{"second": 12, "text": "Cortar aqui"}`) continua na v1 e a v2 começa sem nenhum.

## Testes

- **Regras puras** ([`domain.test.ts`](test/domain.test.ts)): peças exigidas, estados da versão, pendências e status, com uma propriedade (aprovada se e só se houve aprovação explícita e nenhuma peça exigida está pendente).
- **API** ([`review.test.ts`](test/review.test.ts)): aprovar com peça pendente, campanha só de vídeo, peça não exigida, versão que substitui a anterior, entrega aprovada que recebe versão nova (e o log), comentários (segundo, duração, não migram), estados da versão, validações e 404.
- **Modelo de referência** ([`model.test.ts`](test/model.test.ts)): um modelo escrito direto do enunciado roda lado a lado com a API em sequências aleatórias de ações (enviar, aprovar, pedir alteração, aprovar a entrega) em campanhas aleatórias; depois de cada ação, status, pendências e versões têm que coincidir, e **aprovada nunca convive com peça exigida pendente**.
- **E2E por HTTP real** ([`e2e.test.ts`](test/e2e.test.ts)) e **corrida** ([`concurrency.test.ts`](test/concurrency.test.ts)), com `worker_threads` largando juntos numa barreira: quatro conexões enviando versões do mesmo vídeo (numeração 1…200, única e sem lacunas, só a última é a atual); aprovar a entrega × versão nova em 120 entregas (nunca aprovada com a versão atual pendente, e o log bate com o que aconteceu); aprovar a versão 1 × versão nova.

## Verificação

- 83 testes em Node 22.15.0 e 24.7.0; relatório e script para repetir em [`../verificacao`](../verificacao/README.md).
- Mutação (Stryker): ver o resumo em [`../verificacao/mutacao`](../verificacao/mutacao/RESUMO.md). O domínio (`approval`, `versions`) está em 100% e `pieces` em 95,5% (o vivo é equivalente: `typeof value === "string"` antes de `includes`, que já recusa o que não é texto). `store.ts` está em 92,4% e `app.ts` em 71,7% (no total, 431 de 507 = 85,0%): os vivos de `app.ts` são o texto das mensagens de erro (os testes afirmam `error`, `field` e `what`, não a frase), `body?.x` (equivale a `undefined` e cai na mesma validação) e a checagem `n === null`, que cai em 404 do mesmo jeito. Alguns mutantes do `store.ts` (por exemplo o evento `restored` sempre registrado) o Stryker mantém vivos, mas aplicados à mão derrubam 6 testes; registro a divergência em vez de esconder.
- Mutação manual nos pontos críticos, todos pegos: peça não exigida bloqueando, exigida sem versão não bloqueando, entrega aprovada sem aprovação explícita, status ignorando as pendências, alteração pedida não bloqueando, versão aprovada recebendo alteração, versão com alteração aprovável, lista de peças com repetição ou vazia, versão antiga aprovável, evento de desfazer ou de restaurar ausente ou sempre presente, aprovação repetida duplicando o evento, numeração a partir de 0, comentário sem checar a duração, segundo `>` por `>=`, comentário do vídeo sem segundo, comentário com segundo fora do vídeo, comentários migrando entre versões, pendência sem `current_version` e ordem das peças ignorada.
- `BEGIN IMMEDIATE` por `BEGIN` (em todas as ocorrências do `db.ts`) faz os testes de corrida falharem, 3 de 3: aqui as transações **leem antes de escrever** (conferem a entrega e o estado), então o lock tomado na primeira instrução é o que impede dois processos de decidirem sobre o mesmo estado.

## Decisões minhas e o que ficou de fora

1. **A aprovação volta sozinha.** O enunciado diz que a entrega deixa de estar aprovada "até a nova versão ser aprovada", então aprovar a nova versão a devolve, sem uma segunda assinatura. A alternativa (exigir `POST /deliveries/:id/approve` de novo) é razoável se a marca quiser uma confirmação final sobre o conjunto; é uma política, não um bug de um dos lados. O log guarda quais versões estavam aprovadas em cada momento, então dá para trocar a política depois sem perder a história.
2. **Estados finais da versão.** Aprovada e "alteração pedida" não voltam; segue-se com uma versão nova. Não há "desaprovar".
3. **Dá para comentar qualquer versão**, inclusive uma já substituída (a marca pode estar revisando a v1 quando a v2 chega). O comentário fica na v1.
4. **Comentário fora do vídeo não tem segundo**; valem para a peça toda.
5. As quatro peças são um conjunto fixo no código e no banco. Quais são exigidas é dado; uma peça nova exigiria acrescentar o tipo.
6. Sem autenticação nem papéis (quem é marca, quem é criador), sem upload de verdade (a URL é só texto), sem apagar ou resolver comentários, sem paginação e sem pagamento (a aprovação da entrega é o fato que um serviço de pagamento consumiria).
7. O banco padrão é em memória; `DB_PATH` aponta para um arquivo.

## Uso de IA

Este projeto foi escrito com o Claude Code (Claude Sonnet 5.5), seguindo um plano que eu aprovei antes de qualquer código. A IA propôs o desenho, escreveu os testes antes do código, a implementação, o README, rodou a mutação (Stryker e à mão) e as suítes em Node 22.15 e 24.7. A política de aprovação (decisão 1 acima) é uma escolha minha que ainda preciso endossar.

**Eu (Dante) preciso confirmar antes de enviar** *(marque o que de fato revisou; a revisão humana ainda não foi feita)*:

- [ ] Concordo com a aprovação voltar sozinha quando a versão nova é aprovada (e não exigir nova assinatura da entrega).
- [ ] Li `src/domain/approval.ts` e `src/store.ts` (`submitVersion`, `decideVersion`, `approveDelivery`).
- [ ] Rodei `npm test` e `npm run mutation` localmente.
- [ ] Revisei os testes e confirmei que descrevem comportamento, não implementação.
