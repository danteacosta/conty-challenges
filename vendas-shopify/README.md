# Vendas atribuídas ao criador

Ingestão de webhook de pedido (formato próximo ao do Shopify) com atribuição a **no máximo um criador**, idempotência e estornos rastreáveis.

```bash
npm install
npm test            # 54 testes: aceitação, propriedades, concorrência, e2e HTTP
npm run typecheck
npm run mutation    # Stryker nas regras de negócio (relatório em reports/)
npm start           # http://127.0.0.1:3010 (DB_PATH=arquivo.db para persistir)
```

Node 22+ (usa `node:sqlite`). Dinheiro sempre em centavos inteiros.

## API

| Rota | O que faz |
|---|---|
| `POST /creators` `{id, coupon_code, utm_handle}` | Cadastra o criador. Cupom e UTM são únicos (409 se já usados). |
| `POST /webhooks/orders` | Pedido: `{id, total_price, currency, financial_status, discount_codes:[{code}], utm_parameters:{utm_content}}`. 201 criado, 200 `duplicate`. |
| `POST /webhooks/refunds` | Estorno: `{id, order_id, amount}`. 200 `applied`/`clamped`/`duplicate`, **202 `pending`** se o pedido ainda não chegou. |
| `GET /orders/:id` | Pedido, atribuição (regra e conflito), estornos (pedido × aplicado × status), líquido. |
| `GET /creators/:id/sales` | Pedidos, bruto, estornado e líquido do criador. |

## Regra de atribuição (um lugar só: [`src/attribution.ts`](src/attribution.ts))

O criador é identificado por **cupom** (`discount_codes[].code`) ou por **UTM** (`utm_parameters.utm_content` = handle do criador).

| Cupom | UTM | Resultado |
|---|---|---|
| criador A | criador A | A (`coupon_and_utm`) |
| criador A | criador B | **A** (`coupon_over_utm`), conflito gravado |
| criador A | desconhecida | A (`coupon`) |
| desconhecido | criador B | B (`utm`) |
| nada reconhecido | | sem criador (`unattributed`) |

**Desempate: o cupom vence.** O cupom é um código emitido para aquele criador e o comprador tem que digitá-lo, então é um sinal explícito e difícil de forjar. A UTM viaja em link, é sobrescrita pelo último clique e pode ser colada em links de terceiros. O conflito é guardado em `attribution.conflict` para auditoria. Com vários cupons, vale o primeiro reconhecido. Cupom e handle ignoram maiúsculas e espaços.

## Estornos

- Tabela **append-only** `refunds`: guarda o valor pedido (`requested_cents`), o aplicado (`applied_cents`) e o status (`pending`, `applied`, `clamped`). Nada é apagado; o líquido é derivado (`total − soma aplicada`) e a atribuição não muda.
- **Parcial**: reduz o líquido. **Repetido** (mesmo `refund.id`): ignorado. **Teto**: se a soma passaria do valor da venda, o excedente é cortado (`clamped`) e o pedido original continua visível no histórico.
- **Antes do pedido**: fica `pending` e é aplicado, na ordem de chegada, na mesma transação em que o pedido é gravado.
- Só pedidos `paid`, `partially_refunded` e `refunded` entram na venda do criador; os demais ficam gravados com `counted: false`.

## Concorrência

A idempotência é garantida pelo banco, não por "consulta e depois insere": `PRIMARY KEY` / `UNIQUE` com `ON CONFLICT DO NOTHING`, dentro de `BEGIN IMMEDIATE` (WAL + `busy_timeout`). Pedido gravado e estornos pendentes aplicados são atômicos. [`test/concurrency.test.ts`](test/concurrency.test.ts) sobe 4 `worker_threads`, cada um com sua conexão ao mesmo arquivo, reenviando pedido e estornos: o resultado não duplica e não passa do teto.

## Testes

- Aceitação por HTTP ([`orders`](test/orders.test.ts), [`refunds`](test/refunds.test.ts)): pedido duplicado, estorno parcial, repetido, antes do pedido, teto.
- Propriedades (fast-check, [`properties`](test/properties.test.ts)): para qualquer ordem de chegada, `estornado = min(total, soma pedida)`; reenviar eventos não muda nada.
- E2E por servidor HTTP real em porta efêmera ([`e2e`](test/e2e.test.ts)).
- Mutação: ~98% nas regras (`attribution`, `refunds`, `money`, `store`). O sobrevivente restante é equivalente (`Number.isFinite` antes de um regex que já recusa `NaN`/`Infinity`).

## Fora de escopo (decisões declaradas)

- Pedido que muda de status depois (ex.: `pending` → `paid`): o primeiro registro vence, repetição não altera.
- Assinatura HMAC do Shopify, moeda diferente de BRL, autenticação das rotas e leitura de UTM a partir de `landing_site`.
- Reembolso de itens do Shopify (`refund_line_items`): aqui o estorno é só `amount`.

## Uso de IA

Este projeto foi escrito com o Claude Code (Claude Sonnet 5.5), seguindo plano aprovado por mim: o modelo propôs o desenho, escreveu os testes antes do código, a implementação, o README e rodou a mutação.

**Eu (Dante) preciso confirmar antes de enviar** *(marque o que de fato revisou)*:

- [ ] Li e concordo com a regra "cupom vence UTM" e seus motivos.
- [ ] Conferi a lógica de teto/`clamped` e a aplicação de pendentes em `src/store.ts`.
- [ ] Rodei `npm test` e `npm run mutation` localmente.
- [ ] Revisei os testes e confirmei que descrevem comportamento, não implementação.
