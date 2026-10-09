# Revisão de roteiro

API para a revisão de roteiro de uma missão: o criador manda **versões**, a marca **pede alteração** (com motivo e prazo) ou **aprova**, e a aprovação encerra a revisão. Sem vídeo, upload nem interface.

```bash
npm install
npm test            # 115 testes: prazo, máquina de estados, fluxo, rodadas e retry de envio, e2e HTTP, corrida entre conexões
npm run typecheck
npm run mutation    # Stryker (relatório em reports/)
npm start           # http://127.0.0.1:3013   (DB_PATH=arquivo.db para persistir)
```

Node 22.13+ (verificado em 22.15 e 24.7). Sem autenticação: qualquer chamador pode fazer qualquer ação (veja "O que ficou de fora").

## O estado é explícito

| Estado | Significa | Ações possíveis |
|---|---|---|
| `awaiting_review` | há uma versão para a marca revisar | `approve`, `request_changes` |
| `changes_requested` | a marca pediu alteração; a vez é do criador | `submit_version` |
| `approved` | **terminal**: a revisão acabou e não reabre | nenhuma |

Toda resposta traz `state` e `allowed_actions`, então dá para seguir o fluxo sem adivinhar. A tabela de transições é dado, num arquivo só: [`src/domain/transitions.ts`](src/domain/transitions.ts).

## Rotas

| Rota | O que faz |
|---|---|
| `POST /scripts` `{mission_id, content}` | cria o roteiro com a versão 1 (201). Uma missão tem um roteiro só (409 `mission_already_has_script`). |
| `GET /scripts/:id` | estado, ações possíveis, **todas** as versões e **todos** os pedidos de alteração. |
| `POST /scripts/:id/change-requests` `{reason, deadline_date}` | a marca pede alteração (só em `awaiting_review`). `reason` e `deadline_date` (`YYYY-MM-DD`) são obrigatórios. |
| `POST /scripts/:id/versions` `{content, change_request_id?, submission_id?}` | o criador responde com uma versão nova (só em `changes_requested`). Os dois campos opcionais protegem contra retry atrasado, ver "Qual rodada o envio responde". |
| `POST /scripts/:id/approve` | a marca aprova a versão atual (só em `awaiting_review`). |

Erros: `400 validation_error` (com o `field`), `404 not_found`, `409 invalid_state` / `script_approved` / `mission_already_has_script` (com `state` e `allowed_actions`), `422 deadline_in_past`.

## O prazo

O prazo é **um dia** no fuso da marca, `America/Sao_Paulo`, e o **último instante desse dia ainda vale**. Para um prazo de `2026-03-12`:

| Instante (UTC) | Em São Paulo | Pedido com esse prazo |
|---|---|---|
| `2026-03-13T01:30:00.000Z` | 12/03 22:30 | vale (o UTC já virou, o dia em SP não) |
| `2026-03-13T02:59:59.999Z` | 12/03 23:59:59.999 | **vale** (último instante) |
| `2026-03-13T03:00:00.000Z` | 13/03 00:00:00.000 | **não vale**: 422 `deadline_in_past` |

O dia sai de `Intl` com o fuso ([`src/domain/deadline.ts`](src/domain/deadline.ts)), nunca do corte do ISO em UTC e nunca de um `-03:00` fixo (o Brasil teve horário de verão até 2019, e há um teste com 2018). Tudo é testado com o relógio injetado (`createApp({ db, now })`).

Uma **versão** enviada depois do dia do prazo é **aceita e marcada `late: true`**; nada que o criador mandou se perde, e a marca vê que foi tardia.

## Qual rodada o envio responde

Sem os campos opcionais, o envio responde ao pedido de alteração que estiver aberto. Isso deixa um retry atrasado cair na rodada errada: o envio S1 cria a v2 e responde à rodada A; a marca abre a rodada B; o cliente, sem saber se S1 chegou, repete S1 e a v3 nasce com o texto antigo respondendo à B. Por isso o envio pode declarar:

- `change_request_id`: a rodada que ele responde (o `id` em `change_requests`). Se não for a que está aberta, a resposta é **409 `stale_round`** (com `open_change_request_id`) e nada é gravado.
- `submission_id`: o id do envio, único por roteiro. Repetir o mesmo id com o mesmo conteúdo e a mesma rodada devolve a **versão original** (200, `submission.replayed: true`), em qualquer estado, inclusive depois da aprovação. O mesmo id com outro conteúdo ou outra rodada é **409 `submission_conflict`**.

Não deduplico só pelo texto: conteúdo igual numa rodada nova pode ser intencional. Os campos são opcionais para não quebrar quem já usa a rota; quem os omite continua sujeito ao problema acima. O retry simultâneo do mesmo `submission_id` por várias conexões é serializado pelo `BEGIN IMMEDIATE` e pela chave primária `(script_id, submission_id)`. `test/submission-race.test.ts` dispara 4 workers com conexões separadas largando juntos, 12 vezes em bancos novos: mesmo conteúdo dá uma versão e três repetições; dois conteúdos diferentes dão um vencedor e 409 para o outro, sem versão extra. Trocar `BEGIN IMMEDIATE` por `BEGIN` faz os dois testes falharem.

## Exemplos

Criar:

```http
POST /scripts
{ "mission_id": "msn_1842", "content": "Abertura: criador mostra o produto na mão." }
```
```json
{
  "id": "8b574650-ccfc-439c-bce0-c89f478a5a59",
  "mission_id": "msn_1842",
  "state": "awaiting_review",
  "allowed_actions": ["request_changes", "approve"],
  "current_version": 1,
  "approved": null,
  "versions": [{ "number": 1, "content": "Abertura: criador mostra o produto na mão.", "submitted_at": "2026-10-09T18:30:37.524Z", "late": false }],
  "change_requests": []
}
```

Pedir alteração:

```http
POST /scripts/8b574650-…/change-requests
{ "reason": "Abrir com o produto na mão e tirar o preço", "deadline_date": "2026-10-12" }
```
```json
{
  "state": "changes_requested",
  "allowed_actions": ["submit_version"],
  "current_version": 1,
  "change_requests": [
    { "id": 1, "version_number": 1, "reason": "Abrir com o produto na mão e tirar o preço",
      "deadline_date": "2026-10-12", "created_at": "2026-10-09T18:30:37.608Z", "answered_by_version": null }
  ]
}
```
(o `id`, `mission_id`, `approved` e `versions` do roteiro vêm junto, como no exemplo anterior.)

Sem motivo, ou depois de aprovado:

```json
{ "error": "validation_error", "field": "reason", "message": "o motivo do pedido de alteração é obrigatório" }
{ "error": "script_approved", "state": "approved", "allowed_actions": [] }
```

Aprovar: `{ "state": "approved", "allowed_actions": [], "approved": { "version": 2, "approved_at": "2026-10-09T18:30:37.681Z" }, … }`.

## Regras que os testes provam

- Pedido **sem motivo** (vazio, só espaços, não texto) ou **sem prazo** (ausente, vazio, formato errado, data que não existe como `2026-02-30`) não passa e não grava nada.
- Pedido com **prazo que já passou** não vale, com o relógio controlado no último instante do dia e no primeiro do dia seguinte (e nos casos em que o UTC já virou).
- **Aprovado não aceita versão nova nem novo pedido de alteração**, e repetir a aprovação não muda data nem versão aprovada.
- **Versão antiga não se perde**: versões e pedidos são só acrescentados; o `GET` devolve todos.
- Aprovar e pedir alteração ao mesmo tempo, ou quatro criadores enviando a versão 2 ao mesmo tempo, dão um resultado só e coerente (`BEGIN IMMEDIATE`; o teste usa conexões separadas largando juntas por uma barreira, 12 vezes em bancos novos).

## Verificação

- 115 testes em Node 22.15.0 e 24.7.0. O relatório e o script para repetir estão em [`../verificacao`](../verificacao/README.md).
- Mutação (Stryker): 300 de 325 (92,3%): `transitions` e `store` 100%, `deadline.ts` 92,8%, `app.ts` 85,3%. Os sobreviventes são o texto das mensagens de erro (os testes afirmam `error` e `field`, não a frase), `.catch(() => null)` (equivalente a `undefined`), a checagem de vazio de `required` (o chamador já recusa string vazia) e constantes de módulo de `deadline.ts` (o Stryker as mantém vivas, mas trocar o fuso à mão derruba 12 testes).
- Mutação manual nos pontos críticos, todos pegos: dia em UTC, fuso UTC, `-03:00` fixo, `>=` e `<` no prazo, aprovado reabrindo (versão e pedido), aprovar com alteração pendente, `late` sempre/nunca, pedido que ignora o prazo, aprovação repetida virando erro, versão aprovada errada, pedido na versão errada, motivo sem aparar, data sem validar, mês de 31 dias, bissexto fixo e `BEGIN` no lugar de `BEGIN IMMEDIATE`.

## O que ficou de fora

- **Autenticação e papéis.** Hoje qualquer chamador faz qualquer ação; não há "marca" nem "criador" no sistema.
- Notificações, vídeo, upload, interface, paginação, cancelar ou editar um pedido de alteração.
- Diferença entre versões (`diff`); o conteúdo é só texto.

## Decisões que eu deixaria diferentes com mais tempo

1. **Papéis e autoria.** A máquina de estados já separa a vez da marca da vez do criador, mas sem identidade ela não impede a marca de mandar a versão do criador. Eu amarraria cada ação a um papel e guardaria quem fez.
2. **Versão tardia é aceita e marcada `late`.** Foi uma escolha minha: perder o trabalho do criador por um dia parece pior do que sinalizar. Mas "pedido com prazo que já passou não vale" poderia também significar que o pedido expira e a marca precisa abrir outro. Eu confirmaria com o produto e talvez deixasse configurável.
3. **Aprovar de novo devolve 200 sem mudar nada**, em vez de 409. É mais amigável a retry, mas esconde um erro de quem acha que está aprovando uma versão nova. Com mais tempo eu devolveria a versão aprovada na resposta para o cliente conferir.
4. **O prazo é só uma data.** Não há horário nem fuso por marca; o fuso é fixo em São Paulo. Uma marca em outro fuso precisaria de um campo.
5. **Um pedido por versão, sem cancelar.** Se a marca errar o prazo, hoje não há como corrigir; eu permitiria cancelar o pedido em aberto.
6. **Só aprovo a partir de `awaiting_review`.** Com um pedido pendente, a marca não consegue "desistir e aprovar a versão atual". Seria um quarto caminho a decidir com o produto.
7. **`mission_id` único.** Uma missão tem um roteiro só; uma campanha com refação completa precisaria de outro desenho.

## Uso de IA

Este projeto foi escrito com o Claude Code (Claude Sonnet 5.5), seguindo um plano que eu aprovei antes de qualquer código. A IA propôs o desenho, escreveu os testes antes do código, a implementação, o README, rodou a mutação (Stryker e à mão) e as suítes em Node 22.15 e 24.7. As decisões da seção acima são escolhas de produto minhas que ainda preciso endossar.

**Eu (Dante) preciso confirmar antes de enviar** *(marque o que de fato revisou; a revisão humana ainda não foi feita)*:

- [ ] Li e concordo com a máquina de estados e com as decisões de prazo (último instante vale, versão tardia aceita e marcada).
- [ ] Li `src/domain/deadline.ts`, `src/domain/transitions.ts` e `src/store.ts`.
- [ ] Rodei `npm test` e `npm run mutation` localmente.
- [ ] Revisei os testes e confirmei que descrevem comportamento, não implementação.
