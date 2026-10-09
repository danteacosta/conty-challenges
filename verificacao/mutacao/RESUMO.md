# Resumo da mutação (Stryker)

Gerado por `node verificacao/resumo-mutacao.mjs` a partir de `reports/mutation.json` de cada projeto
(`npm run mutation` dentro da pasta). Os JSON completos estão ao lado deste arquivo. O Stryker não usa semente:
o resultado depende do código, dos testes e da versão do Node (esta rodada: ver `matriz-node.log`).

## vendas-shopify: 245/283 (86.6%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/app.ts` | 115/152 | 75.7% |
| `src/attribution.ts` | 34/34 | 100.0% |
| `src/money.ts` | 27/28 | 96.4% |
| `src/refunds.ts` | 8/8 | 100.0% |
| `src/store.ts` | 61/61 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/app.ts`**

- linha 7 · MethodExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `v`
- linha 7 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `true`
- linha 7 · StringLiteral · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `"Stryker was here!"`
- linha 7 · MethodExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `v`
- linha 7 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `true`
- linha 7 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `false`
- linha 7 · LogicalOperator · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `typeof v === "number" || Number.isFinite(v)`
- linha 7 · EqualityOperator · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `typeof v !== "number"`
- linha 7 · StringLiteral · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `""`
- linha 11 · ConditionalExpression · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `true`
- linha 11 · MethodExpression · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `v`
- linha 11 · StringLiteral · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `"Stryker was here!"`
- linha 22 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 26 · ObjectLiteral · Survived · `if (!id || !coupon || !utm) return c.json({ error: "id, coupon_code e utm_handle são obrigatórios" }, 400);` → `{}`
- linha 26 · StringLiteral · Survived · `if (!id || !coupon || !utm) return c.json({ error: "id, coupon_code e utm_handle são obrigatórios" }, 400);` → `""`
- linha 35 · ObjectLiteral · Survived · `if (!id) return c.json({ error: "id é obrigatório (texto ou inteiro seguro)" }, 400);` → `{}`
- linha 35 · StringLiteral · Survived · `if (!id) return c.json({ error: "id é obrigatório (texto ou inteiro seguro)" }, 400);` → `""`
- linha 32 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 36 · OptionalChaining · Survived · `if (b?.currency !== undefined && b?.currency !== null) {` → `b.currency`
- linha 36 · OptionalChaining · Survived · `if (b?.currency !== undefined && b?.currency !== null) {` → `b.currency`
- linha 41 · ObjectLiteral · Survived · `if (totalCents === null) return c.json({ error: "total_price inválido" }, 400);` → `{}`
- linha 41 · StringLiteral · Survived · `if (totalCents === null) return c.json({ error: "total_price inválido" }, 400);` → `""`
- linha 44 · ArrayDeclaration · Survived · `: [];` → `["Stryker was here"]`
- linha 43 · OptionalChaining · Survived · `? b.discount_codes.map((d: { code?: unknown }) => str(d?.code)).filter((x: string | null): x is string => !!x)` → `d.code`
- linha 42 · OptionalChaining · Survived · `const codes = Array.isArray(b?.discount_codes)` → `b.discount_codes`
- linha 43 · MethodExpression · Survived · `? b.discount_codes.map((d: { code?: unknown }) => str(d?.code)).filter((x: string | null): x is string => !!x)` → `b.discount_codes.map((d: {   code?: unknown; }) =>`
- linha 51 · OptionalChaining · Survived · `financialStatus: str(b?.financial_status) ?? "pending",` → `b.financial_status`
- linha 52 · OptionalChaining · Survived · `createdAt: str(b?.created_at),` → `b.created_at`
- linha 53 · OptionalChaining · Survived · `signals: { couponCodes: codes, utmHandle: str(b?.utm_parameters?.utm_content) },` → `b.utm_parameters`
- linha 61 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 65 · ObjectLiteral · Survived · `if (!id || !orderId) return c.json({ error: "id e order_id são obrigatórios (texto ou inteiro seguro)" }, 400)` → `{}`
- linha 65 · StringLiteral · Survived · `if (!id || !orderId) return c.json({ error: "id e order_id são obrigatórios (texto ou inteiro seguro)" }, 400)` → `""`
- linha 66 · ObjectLiteral · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `{}`
- linha 66 · StringLiteral · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `""`
- linha 66 · ConditionalExpression · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `false`
- linha 73 · StringLiteral · Survived · `return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);` → `""`
- linha 73 · ObjectLiteral · Survived · `return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);` → `{}`

**`src/money.ts`**

- linha 4 · ConditionalExpression · Survived · `if (!Number.isFinite(value)) return null;` → `false`

## origem-cadastros: 324/328 (98.8%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/decide-origin.ts` | 128/130 | 98.5% |
| `src/instant.ts` | 114/116 | 98.3% |
| `src/link.ts` | 31/31 | 100.0% |
| `src/store.ts` | 51/51 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/decide-origin.ts`**

- linha 61 · ConditionalExpression · Survived · `if (a.cid !== b.cid) return a.cid < b.cid ? -1 : 1;` → `true`
- linha 61 · EqualityOperator · Survived · `if (a.cid !== b.cid) return a.cid < b.cid ? -1 : 1;` → `a.cid <= b.cid`

**`src/instant.ts`**

- linha 30 · ConditionalExpression · Survived · `if (zone !== "Z") {` → `true`
- linha 30 · StringLiteral · Survived · `if (zone !== "Z") {` → `""`

## rastreio-envio: 291/311 (93.6%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/alerts.ts` | 49/54 | 90.7% |
| `src/aggregator/trackhub/mapper.ts` | 78/81 | 96.3% |
| `src/domain/delay.ts` | 27/27 | 100.0% |
| `src/domain/dialects.ts` | 24/24 | 100.0% |
| `src/domain/normalize.ts` | 18/19 | 94.7% |
| `src/domain/status.ts` | 50/60 | 83.3% |
| `src/store.ts` | 45/46 | 97.8% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/alerts.ts`**

- linha 24 · BlockStatement · NoCoverage · `async notify(alert: DelayAlert) {` → `{}`
- linha 25 · StringLiteral · NoCoverage · `console.warn('[atraso] ${alert.tracking_code}: ${alert.elapsed_hours.toFixed(1)}h (limite ${alert.threshold_ho` → `''`
- linha 98 · ConditionalExpression · Survived · `if (!shipment || !delay || !delay.delayed) {` → `false`
- linha 99 · OptionalChaining · Survived · `discard.run(nowIso, shipment?.status === "delivered" ? "delivered" : "within_threshold", row.id);` → `shipment.status`
- linha 98 · LogicalOperator · Survived · `if (!shipment || !delay || !delay.delayed) {` → `!shipment && !delay`

**`src/aggregator/trackhub/mapper.ts`**

- linha 16 · StringLiteral · Survived · `if (typeof payload !== "object" || payload === null) throw invalid("o corpo não é um objeto");` → `""`
- linha 16 · ConditionalExpression · Survived · `if (typeof payload !== "object" || payload === null) throw invalid("o corpo não é um objeto");` → `false`
- linha 35 · ConditionalExpression · Survived · `const time = typeof checkpoint.time === "string" ? Date.parse(checkpoint.time) : Number.NaN;` → `true`

**`src/domain/normalize.ts`**

- linha 16 · MethodExpression · Survived · `dedupeKey: '${carrier}|${event.rawStatus.trim().toUpperCase()}|${occurredAt}',` → `event.rawStatus.trim().toLowerCase()`

**`src/domain/status.ts`**

- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `true`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `true`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `false`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey >= b.dedupeKey`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `false`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey >= b.dedupeKey`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey <= b.dedupeKey`
- linha 41 · UnaryOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `+1`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey <= b.dedupeKey`
- linha 15 · ObjectLiteral · Survived · `const TIE_PRIORITY: Record<Status, number> = {` → `{}`

**`src/store.ts`**

- linha 49 · OptionalChaining · Survived · `return findShipment(db, shipment.code)?.carrier === shipment.carrier ? ("exists" as const) : ("conflict" as co` → `findShipment(db, shipment.code).carrier`
