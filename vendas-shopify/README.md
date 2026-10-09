# Vendas atribuídas ao criador

Ingestão de webhook de pedido (formato próximo ao do Shopify) com atribuição a **no máximo um criador**, idempotência e estornos rastreáveis.

```bash
npm install
npm test            # 113 testes: aceitação, entrada, pendente→pago, estorno em conflito, agregados exatos, propriedades, concorrência, e2e HTTP
npm run typecheck
npm run mutation    # Stryker nas regras de negócio (relatório em reports/)
npm start           # http://127.0.0.1:3010 (DB_PATH=arquivo.db para persistir)
```

Node 22.13+ (a partir daí `node:sqlite` não precisa de flag). Suíte completa verificada em 22.15.0 e 24.7.0. Dinheiro sempre em centavos inteiros.

Em Node 22 os workers dos testes de concorrência são `.ts`, que só carregam com `--experimental-strip-types`; `test/spawn-worker.ts` passa a flag ao `Worker` (no 24 ela já é o padrão), então `npm test` e `npx vitest` direto funcionam nas duas versões.

## API

| Rota | O que faz |
|---|---|
| `POST /creators` `{id, coupon_code, utm_handle}` | Cadastra o criador. Cupom e UTM são únicos (409 se já usados). |
| `POST /webhooks/orders` | Pedido: `{id, total_price, currency, financial_status, discount_codes:[{code}], utm_parameters:{utm_content}}`. 201 `created`; 200 `credited` (um pedido não pago que chegou pago), `updated` (mudou entre status não pagos) ou `duplicate`. |
| `POST /webhooks/refunds` | Estorno: `{id, order_id, amount}`. 200 `applied`/`clamped`/`duplicate`, **202 `pending`** se o pedido ainda não chegou **ou ainda não foi creditado**, **409 `refund_conflict`** se o `id` já existe para outro pedido ou outro valor (nada muda). `duplicate` exige o mesmo pedido e o mesmo valor (`1.0` e `1.00` são o mesmo); pedido repetido com conteúdo diferente continua `duplicate`, porque o status de um pedido evolui. |
| `GET /refunds/:id`, `GET /refunds?status=&order_id=` | Consulta de um estorno (inclusive o pendente, mesmo quando o pedido nem existe) e listagem por status (`pending`, `applied`, `clamped`) e por pedido. |
| `GET /orders/:id` | Pedido, atribuição (regra e conflito), estornos (pedido × aplicado × status), líquido. |
| `GET /creators/:id/sales` | Pedidos, bruto, estornado e líquido do criador. `gross_cents`, `refunded_cents` e `net_cents` são números enquanto cabem exatamente num número JSON (até 9.007.199.254.740.991 centavos); acima disso valem `null`, e `exact` traz os três como texto, sempre. A soma é feita em BigInt (91 pedidos de 999.999.999.999,99 passam do limite; antes isso dava 500). |

### Entrada validada

- **Moeda**: só BRL. `currency` ausente vale BRL; qualquer outra (`USD`, vazia, número) responde 400 `unsupported_currency` e o pedido não é gravado, para nunca somar reais com dólares.
- **Ids** (`id` do pedido, `id` e `order_id` do estorno, `id` do criador): texto não vazio ou inteiro seguro (`Number.isSafeInteger`). Um número fora da faixa segura já chega arredondado do JSON, e dois pedidos distintos (`...992` e `...993`) virariam o mesmo; por isso é 400. Em texto, ids com muitos dígitos continuam distintos. `1001` e `"1001"` são o mesmo pedido.

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
- **Antes do pedido, ou com o pedido ainda não creditado**: fica `pending` (e pode ser consultado em `GET /refunds/:id`) e é aplicado, na ordem de chegada, na mesma transação em que o crédito nasce.

## Pedido pendente que depois é pago

O **crédito** da venda nasce no primeiro evento pago do pedido (`paid`, `partially_refunded` ou `refunded`), e só nele:

| Chega | Pedido ainda não existe | Pedido existe, não pago | Pedido já creditado |
|---|---|---|---|
| **não pago** (`pending`, `authorized`, `voided`...) | grava, **não conta** (`created`) | muda o status se for outro (`updated`), senão `duplicate` | `duplicate`: um pendente atrasado **não desfaz** o pago |
| **pago** | já nasce creditado (`created`) e aplica os estornos que chegaram antes | **o crédito nasce agora** (`credited`) | `duplicate` |

- A **atribuição é calculada com os sinais do evento pago e congelada** nesse momento (cupom vence UTM, como sempre); o valor creditado é o `total_price` do evento pago. Depois do crédito, nenhum reenvio, com o conteúdo que for, altera valor, criador ou estornos.
- Os **estornos antecipados** são aplicados **uma vez**, na ordem de chegada e respeitando o teto, quando o crédito nasce; reenviar o pago ou o estorno não aplica de novo.
- Pedido pendente que nunca for pago nunca conta, e seus estornos ficam `pending`.

## Concorrência

A idempotência é garantida pelo banco, não por "consulta e depois insere": `PRIMARY KEY` / `UNIQUE` com `ON CONFLICT DO NOTHING`, dentro de `BEGIN IMMEDIATE` (WAL + `busy_timeout`). Pedido gravado e estornos pendentes aplicados são atômicos. [`test/concurrency.test.ts`](test/concurrency.test.ts) sobe 4 `worker_threads`, cada um com sua conexão ao mesmo arquivo, reenviando pedido e estornos: o resultado não duplica e não passa do teto.

## Testes

- Aceitação por HTTP ([`orders`](test/orders.test.ts), [`refunds`](test/refunds.test.ts)): pedido duplicado, estorno parcial, repetido, antes do pedido, teto.
- Propriedades (fast-check, [`properties`](test/properties.test.ts)): para qualquer ordem de chegada, `estornado = min(total, soma pedida)`; reenviar eventos não muda nada.
- E2E por servidor HTTP real em porta efêmera ([`e2e`](test/e2e.test.ts)).
- Mutação (Stryker, 293 de 338 = 86,7%; relatório em [`verificacao/mutacao`](../verificacao/mutacao/RESUMO.md)): 100% em `attribution` e `refunds` e em `store`, 96,4% em `money` (o sobrevivente é equivalente: `Number.isFinite` antes de um regex que já recusa `NaN`/`Infinity`). `src/app.ts` entra na mutação com 76,5% (o `store.ts`, onde mora a regra do crédito, está em 98,8%): os sobreviventes são sobretudo o texto das mensagens de erro (os testes afirmam o status, não a frase) e helpers de módulo (`str`, `idOf`); os mutantes de `idOf` e da checagem de moeda eu refiz à mão e todos morrem.
- Concorrência: os workers largam juntos (barreira). Um teste usa cupom conhecido (a atribuição lê o cadastro antes de gravar) e outro dispara pendente e pago de 250 pedidos por 4 conexões, com estorno antecipado em cada um: cada crédito nasce uma vez e cada estorno é aplicado uma vez. Trocar `BEGIN IMMEDIATE` por `BEGIN` (em todas as ocorrências do `db.ts`) faz esses testes falharem; verificado à mão, 3 de 3 com 250 pedidos por worker e 5 de 5 com apenas 30.

## Fora de escopo (decisões declaradas)

- Reabrir ou desfazer um crédito: pago nunca volta a pendente (cancelamento depois do pagamento é um estorno, não um status). Mudar o valor de um pedido já creditado também não é suportado.
- Assinatura HMAC do Shopify, moeda diferente de BRL (agora recusada com 400, não convertida), autenticação das rotas e leitura de UTM a partir de `landing_site`.
- Reembolso de itens do Shopify (`refund_line_items`): aqui o estorno é só `amount`.

## Uso de IA

Este projeto foi escrito com o Claude Code (Claude Sonnet 5.5), seguindo plano aprovado por mim: o modelo propôs o desenho, escreveu os testes antes do código, a implementação, o README e rodou a mutação.

**Depois da primeira entrega**, uma auditoria automatizada (feita com o Codex) apontou lacunas; as correções acima foram escritas pelo Claude Code, com regressões antes das correções, e verificadas com a suíte completa em Node 22.15 e 24.7. Isso não substitui a minha revisão: as caixas abaixo continuam desmarcadas até eu ler e rodar.

**Eu (Dante) preciso confirmar antes de enviar** *(marque o que de fato revisou)*:

- [ ] Li e concordo com a regra "cupom vence UTM" e seus motivos.
- [ ] Conferi a lógica de teto/`clamped` e a aplicação de pendentes em `src/store.ts`.
- [ ] Rodei `npm test` e `npm run mutation` localmente.
- [ ] Revisei os testes e confirmei que descrevem comportamento, não implementação.
