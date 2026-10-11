# Resumo da mutação (Stryker)

Gerado por `node verificacao/resumo-mutacao.mjs` a partir de `reports/mutation.json` de cada projeto
(`npm run mutation` dentro da pasta). Os JSON completos estão ao lado deste arquivo. O Stryker não usa semente:
o resultado depende do código, dos testes e da versão do Node (esta rodada: ver `matriz-node.log`).

## vendas-shopify: 407/471 (86.4%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/store.ts` | 179/197 | 90.9% |
| `src/app.ts` | 159/204 | 77.9% |
| `src/attribution.ts` | 34/34 | 100.0% |
| `src/money.ts` | 27/28 | 96.4% |
| `src/refunds.ts` | 8/8 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/store.ts`**

- linha 283 · UnaryOperator · NoCoverage · `const attributedGroups = groups.filter((g) => g.creator !== null).sort((a, b) => (a.creator! < b.creator! ? -1` → `+1`
- linha 194 · ConditionalExpression · Survived · `if (!/integer overflow/i.test(String(error))) throw error;` → `false`
- linha 244 · MethodExpression · Survived · `return (statement.all() as Group[]).filter((g) => g.orders > 0n);` → `statement.all() as Group[]`
- linha 244 · EqualityOperator · Survived · `return (statement.all() as Group[]).filter((g) => g.orders > 0n);` → `g.orders >= 0n`
- linha 244 · ConditionalExpression · Survived · `return (statement.all() as Group[]).filter((g) => g.orders > 0n);` → `true`
- linha 246 · ConditionalExpression · Survived · `if (!/integer overflow/i.test(String(error))) throw error;` → `false`
- linha 283 · ConditionalExpression · Survived · `const attributedGroups = groups.filter((g) => g.creator !== null).sort((a, b) => (a.creator! < b.creator! ? -1` → `false`
- linha 283 · EqualityOperator · Survived · `const attributedGroups = groups.filter((g) => g.creator !== null).sort((a, b) => (a.creator! < b.creator! ? -1` → `a.creator! <= b.creator!`
- linha 281 · BooleanLiteral · Survived · `const total = sumGroups(counted(db, false));` → `true`
- linha 283 · MethodExpression · Survived · `const attributedGroups = groups.filter((g) => g.creator !== null).sort((a, b) => (a.creator! < b.creator! ? -1` → `groups.filter(g => g.creator !== null)`
- linha 283 · ArrowFunction · Survived · `const attributedGroups = groups.filter((g) => g.creator !== null).sort((a, b) => (a.creator! < b.creator! ? -1` → `() => undefined`
- linha 287 · ConditionalExpression · Survived · `total.orders === attributed.orders + unattributed.orders &&` → `true`
- linha 287 · ConditionalExpression · Survived · `total.orders === attributed.orders + unattributed.orders &&` → `true`
- linha 287 · LogicalOperator · Survived · `total.orders === attributed.orders + unattributed.orders &&` → `total.orders === attributed.orders + unattributed.`
- linha 287 · LogicalOperator · Survived · `total.orders === attributed.orders + unattributed.orders &&` → `total.orders === attributed.orders + unattributed.`
- linha 287 · ConditionalExpression · Survived · `total.orders === attributed.orders + unattributed.orders &&` → `true`
- linha 288 · ConditionalExpression · Survived · `total.gross === attributed.gross + unattributed.gross &&` → `true`
- linha 289 · ConditionalExpression · Survived · `total.refunded === attributed.refunded + unattributed.refunded;` → `true`

**`src/app.ts`**

- linha 8 · MethodExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `v`
- linha 8 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `true`
- linha 8 · StringLiteral · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `"Stryker was here!"`
- linha 8 · MethodExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `v`
- linha 8 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `false`
- linha 8 · LogicalOperator · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `typeof v === "number" || Number.isFinite(v)`
- linha 8 · EqualityOperator · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `typeof v !== "number"`
- linha 8 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `true`
- linha 26 · StringLiteral · Survived · `return c.json({ error: "database_busy", retryable: true, message: "o banco está ocupado; nada foi gravado, rep` → `""`
- linha 8 · StringLiteral · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `""`
- linha 12 · ConditionalExpression · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `true`
- linha 12 · StringLiteral · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `"Stryker was here!"`
- linha 12 · MethodExpression · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `v`
- linha 36 · ObjectLiteral · Survived · `if (!id || !coupon || !utm) return c.json({ error: "id, coupon_code e utm_handle são obrigatórios" }, 400);` → `{}`
- linha 36 · StringLiteral · Survived · `if (!id || !coupon || !utm) return c.json({ error: "id, coupon_code e utm_handle são obrigatórios" }, 400);` → `""`
- linha 32 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 45 · ObjectLiteral · Survived · `if (!id) return c.json({ error: "id é obrigatório (texto ou inteiro seguro)" }, 400);` → `{}`
- linha 45 · StringLiteral · Survived · `if (!id) return c.json({ error: "id é obrigatório (texto ou inteiro seguro)" }, 400);` → `""`
- linha 42 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 51 · ObjectLiteral · Survived · `if (totalCents === null) return c.json({ error: "total_price inválido" }, 400);` → `{}`
- linha 51 · StringLiteral · Survived · `if (totalCents === null) return c.json({ error: "total_price inválido" }, 400);` → `""`
- linha 46 · OptionalChaining · Survived · `if (b?.currency !== undefined && b?.currency !== null) {` → `b.currency`
- linha 54 · ArrayDeclaration · Survived · `: [];` → `["Stryker was here"]`
- linha 46 · OptionalChaining · Survived · `if (b?.currency !== undefined && b?.currency !== null) {` → `b.currency`
- linha 53 · OptionalChaining · Survived · `? b.discount_codes.map((d: { code?: unknown }) => str(d?.code)).filter((x: string | null): x is string => !!x)` → `d.code`
- linha 52 · OptionalChaining · Survived · `const codes = Array.isArray(b?.discount_codes)` → `b.discount_codes`
- linha 53 · MethodExpression · Survived · `? b.discount_codes.map((d: { code?: unknown }) => str(d?.code)).filter((x: string | null): x is string => !!x)` → `b.discount_codes.map((d: {   code?: unknown; }) =>`
- linha 61 · OptionalChaining · Survived · `financialStatus: str(b?.financial_status) ?? "pending",` → `b.financial_status`
- linha 62 · OptionalChaining · Survived · `createdAt: str(b?.created_at),` → `b.created_at`
- linha 75 · ObjectLiteral · Survived · `if (!id || !orderId) return c.json({ error: "id e order_id são obrigatórios (texto ou inteiro seguro)" }, 400)` → `{}`
- linha 75 · StringLiteral · Survived · `if (!id || !orderId) return c.json({ error: "id e order_id são obrigatórios (texto ou inteiro seguro)" }, 400)` → `""`
- linha 63 · OptionalChaining · Survived · `signals: { couponCodes: codes, utmHandle: str(b?.utm_parameters?.utm_content) },` → `b.utm_parameters`
- linha 71 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 76 · ObjectLiteral · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `{}`
- linha 76 · StringLiteral · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `""`
- linha 78 · StringLiteral · Survived · `if (outcome.result === "conflict") return c.json({ error: "refund_conflict", refund_id: id, message: "já exist` → `""`
- linha 76 · ConditionalExpression · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `false`
- linha 89 · ObjectLiteral · Survived · `return refund ? c.json(refund) : c.json({ error: "estorno não encontrado" }, 404);` → `{}`
- linha 89 · StringLiteral · Survived · `return refund ? c.json(refund) : c.json({ error: "estorno não encontrado" }, 404);` → `""`
- linha 84 · StringLiteral · Survived · `return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);` → `""`
- linha 84 · ObjectLiteral · Survived · `return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);` → `{}`
- linha 94 · ConditionalExpression · Survived · `if (status !== undefined && status !== "pending" && status !== "applied" && status !== "clamped") {` → `true`
- linha 94 · StringLiteral · Survived · `if (status !== undefined && status !== "pending" && status !== "applied" && status !== "clamped") {` → `""`
- linha 95 · StringLiteral · Survived · `return c.json({ error: "status deve ser pending, applied ou clamped" }, 400);` → `""`
- linha 95 · ObjectLiteral · Survived · `return c.json({ error: "status deve ser pending, applied ou clamped" }, 400);` → `{}`

**`src/money.ts`**

- linha 4 · ConditionalExpression · Survived · `if (!Number.isFinite(value)) return null;` → `false`

## origem-cadastros: 334/338 (98.8%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/decide-origin.ts` | 128/130 | 98.5% |
| `src/instant.ts` | 114/116 | 98.3% |
| `src/link.ts` | 31/31 | 100.0% |
| `src/store.ts` | 61/61 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/decide-origin.ts`**

- linha 76 · ConditionalExpression · Survived · `if (a.cid !== b.cid) return a.cid < b.cid ? -1 : 1;` → `true`
- linha 76 · EqualityOperator · Survived · `if (a.cid !== b.cid) return a.cid < b.cid ? -1 : 1;` → `a.cid <= b.cid`

**`src/instant.ts`**

- linha 30 · ConditionalExpression · Survived · `if (zone !== "Z") {` → `true`
- linha 30 · StringLiteral · Survived · `if (zone !== "Z") {` → `""`

## rastreio-envio: 522/542 (96.3%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/alerts.ts` | 49/54 | 90.7% |
| `src/aggregator/trackhub/mapper.ts` | 78/78 | 100.0% |
| `src/config.ts` | 93/95 | 97.9% |
| `src/domain/delay.ts` | 27/27 | 100.0% |
| `src/domain/dialects.ts` | 24/24 | 100.0% |
| `src/domain/normalize.ts` | 18/19 | 94.7% |
| `src/domain/status.ts` | 50/60 | 83.3% |
| `src/instant.ts` | 114/116 | 98.3% |
| `src/store.ts` | 69/69 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/alerts.ts`**

- linha 24 · BlockStatement · NoCoverage · `async notify(alert: DelayAlert) {` → `{}`
- linha 25 · StringLiteral · NoCoverage · `console.warn('[atraso] ${alert.tracking_code}: ${alert.elapsed_hours.toFixed(1)}h (limite ${alert.threshold_ho` → `''`
- linha 99 · OptionalChaining · Survived · `discard.run(nowIso, shipment?.status === "delivered" ? "delivered" : "within_threshold", row.id);` → `shipment.status`
- linha 98 · ConditionalExpression · Survived · `if (!shipment || !delay || !delay.delayed) {` → `false`
- linha 98 · LogicalOperator · Survived · `if (!shipment || !delay || !delay.delayed) {` → `!shipment && !delay`

**`src/config.ts`**

- linha 16 · StringLiteral · Survived · `super('Configuração inválida:\n${problems.map((problem) => '- ${problem}').join("\n")}');` → `""`
- linha 55 · StringLiteral · Survived · `if (protocol !== "http:" && protocol !== "https:") throw new Error("protocolo");` → `""`

**`src/domain/normalize.ts`**

- linha 16 · MethodExpression · Survived · `dedupeKey: '${carrier}|${event.rawStatus.trim().toUpperCase()}|${occurredAt}',` → `event.rawStatus.trim().toLowerCase()`

**`src/domain/status.ts`**

- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `true`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `false`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey <= b.dedupeKey`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `true`
- linha 41 · UnaryOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `+1`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey >= b.dedupeKey`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `false`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey >= b.dedupeKey`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey <= b.dedupeKey`
- linha 15 · ObjectLiteral · Survived · `const TIE_PRIORITY: Record<Status, number> = {` → `{}`

**`src/instant.ts`**

- linha 30 · ConditionalExpression · Survived · `if (zone !== "Z") {` → `true`
- linha 30 · StringLiteral · Survived · `if (zone !== "Z") {` → `""`

## revisao-roteiro: 353/393 (89.8%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/app.ts` | 132/166 | 79.5% |
| `src/domain/deadline.ts` | 64/69 | 92.8% |
| `src/domain/transitions.ts` | 10/10 | 100.0% |
| `src/store.ts` | 147/148 | 99.3% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/app.ts`**

- linha 92 · ObjectLiteral · NoCoverage · `if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return c.json({ error: "not_found" }, 404);` → `{}`
- linha 92 · StringLiteral · NoCoverage · `if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return c.json({ error: "not_found" }, 404);` → `""`
- linha 21 · ConditionalExpression · Survived · `if (value === undefined || value === null) return undefined;` → `false`
- linha 14 · ConditionalExpression · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `false`
- linha 22 · ConditionalExpression · Survived · `return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;` → `true`
- linha 14 · StringLiteral · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `"Stryker was here!"`
- linha 25 · ConditionalExpression · Survived · `if (value === undefined || value === null) return undefined;` → `false`
- linha 26 · ConditionalExpression · Survived · `return typeof value === "string" && value.length >= 1 && value.length <= max ? value : null;` → `true`
- linha 26 · EqualityOperator · Survived · `return typeof value === "string" && value.length >= 1 && value.length <= max ? value : null;` → `value.length > 1`
- linha 26 · EqualityOperator · Survived · `return typeof value === "string" && value.length >= 1 && value.length <= max ? value : null;` → `value.length < max`
- linha 58 · StringLiteral · Survived · `if (!missionId) return invalid(c, "mission_id", "mission_id é obrigatório");` → `""`
- linha 59 · StringLiteral · Survived · `if (!content) return invalid(c, "content", "content é obrigatório");` → `""`
- linha 69 · StringLiteral · Survived · `if (!reason) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");` → `""`
- linha 70 · StringLiteral · Survived · `if (!deadlineDate) return invalid(c, "deadline_date", "deadline_date é obrigatório, no formato YYYY-MM-DD e co` → `""`
- linha 55 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 77 · StringLiteral · Survived · `if (!content) return invalid(c, "content", "content é obrigatório");` → `""`
- linha 79 · StringLiteral · Survived · `if (changeRequestId === null) return invalid(c, "change_request_id", "change_request_id deve ser o id inteiro ` → `""`
- linha 66 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 81 · StringLiteral · Survived · `if (submissionId === null) return invalid(c, "submission_id", 'submission_id deve ser um texto de 1 a ${MAX_SU` → `''`
- linha 86 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 87 · OptionalChaining · Survived · `const reason = required(body?.reason);` → `body.reason`
- linha 75 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 88 · OptionalChaining · Survived · `const by = required(body?.cancelled_by, 200);` → `body.cancelled_by`
- linha 89 · StringLiteral · Survived · `if (!reason) return invalid(c, "reason", "o motivo do cancelamento é obrigatório");` → `""`
- linha 89 · StringLiteral · Survived · `if (!reason) return invalid(c, "reason", "o motivo do cancelamento é obrigatório");` → `""`
- linha 78 · OptionalChaining · Survived · `const changeRequestId = optionalPositiveInteger(body?.change_request_id);` → `body.change_request_id`
- linha 90 · StringLiteral · Survived · `if (!by) return invalid(c, "cancelled_by", "cancelled_by (quem cancela) é obrigatório");` → `""`
- linha 90 · StringLiteral · Survived · `if (!by) return invalid(c, "cancelled_by", "cancelled_by (quem cancela) é obrigatório");` → `""`
- linha 80 · OptionalChaining · Survived · `const submissionId = optionalText(body?.submission_id, MAX_SUBMISSION_ID);` → `body.submission_id`
- linha 92 · ConditionalExpression · Survived · `if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return c.json({ error: "not_found" }, 404);` → `false`
- linha 92 · LogicalOperator · Survived · `if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return c.json({ error: "not_found" }, 404);` → `!/^[1-9]\d*$/.test(raw) && !Number.isSafeInteger(N`
- linha 92 · Regex · Survived · `if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return c.json({ error: "not_found" }, 404);` → `/^[1-9]\d*/`
- linha 92 · Regex · Survived · `if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return c.json({ error: "not_found" }, 404);` → `/[1-9]\d*$/`
- linha 92 · Regex · Survived · `if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return c.json({ error: "not_found" }, 404);` → `/^[1-9]\D*$/`

**`src/domain/deadline.ts`**

- linha 8 · StringLiteral · Survived · `const BRAND_ZONE = "America/Sao_Paulo";` → `""`
- linha 10 · StringLiteral · Survived · `const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit` → `""`
- linha 10 · StringLiteral · Survived · `const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit` → `""`
- linha 10 · StringLiteral · Survived · `const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit` → `""`
- linha 10 · StringLiteral · Survived · `const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit` → `""`

**`src/store.ts`**

- linha 185 · ConditionalExpression · Survived · `if (target === null) return stateFailure(script);` → `false`

## metricas-redes: 649/677 (95.9%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/config.ts` | 66/69 | 95.7% |
| `src/domain/retry-after.ts` | 37/38 | 97.4% |
| `src/domain/retry.ts` | 45/45 | 100.0% |
| `src/instant.ts` | 114/116 | 98.3% |
| `src/providers/adapters.ts` | 124/129 | 96.1% |
| `src/providers/http.ts` | 106/119 | 89.1% |
| `src/store.ts` | 92/95 | 96.8% |
| `src/sync.ts` | 65/66 | 98.5% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/config.ts`**

- linha 11 · StringLiteral · Survived · `super('Configuração inválida:\n${problems.map((problem) => '- ${problem}').join("\n")}');` → `""`
- linha 38 · MethodExpression · Survived · `if (env.DB_PATH.trim() === "") problems.push("DB_PATH não pode ser vazio");` → `env.DB_PATH`
- linha 46 · StringLiteral · Survived · `if (protocol !== "http:" && protocol !== "https:") throw new Error("protocolo");` → `""`

**`src/domain/retry-after.ts`**

- linha 5 · Regex · Survived · `const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;` → `/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}`

**`src/instant.ts`**

- linha 30 · StringLiteral · Survived · `if (zone !== "Z") {` → `""`
- linha 30 · ConditionalExpression · Survived · `if (zone !== "Z") {` → `true`

**`src/providers/adapters.ts`**

- linha 33 · ConditionalExpression · Survived · `if (typeof value === "string" && /^\d+$/.test(value)) {` → `true`
- linha 42 · ConditionalExpression · Survived · `if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;` → `false`
- linha 48 · ConditionalExpression · Survived · `if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;` → `false`
- linha 59 · ConditionalExpression · Survived · `if (name === undefined || item[name] === undefined) return 0;` → `false`
- linha 25 · StringLiteral · Survived · `tiktok: { id: "video_id", publishedAt: "create_time", asOf: "snapshot_time", time: "epoch", views: "play_count` → `""`

**`src/providers/http.ts`**

- linha 49 · StringLiteral · Survived · `throw new ProviderError("network", 'não foi possível falar com o provedor: ${(error as Error).message}');` → `''`
- linha 56 · StringLiteral · Survived · `if (response.status === 408) throw new ProviderError("timeout", "o provedor respondeu 408", 408);` → `""`
- linha 47 · StringLiteral · Survived · `throw new ProviderError("timeout", 'o provedor não respondeu em ${this.timeoutMs} ms');` → `''`
- linha 54 · StringLiteral · Survived · `throw new ProviderError("rate_limited", "o provedor respondeu 429", 429, retryAfterMs);` → `""`
- linha 57 · StringLiteral · Survived · `if (response.status >= 500) throw new ProviderError("server", 'o provedor respondeu ${response.status}', respo` → `''`
- linha 58 · StringLiteral · Survived · `if (!response.ok) throw new ProviderError("client", 'o provedor respondeu ${response.status}', response.status` → `''`
- linha 66 · StringLiteral · Survived · `throw new ProviderError("timeout", 'o provedor não terminou de enviar o corpo em ${this.timeoutMs} ms');` → `''`
- linha 68 · StringLiteral · Survived · `throw new ProviderError("network", 'a conexão com o provedor caiu durante o corpo: ${(error as Error).message}` → `''`
- linha 73 · BlockStatement · Survived · `} catch {` → `{}`
- linha 74 · StringLiteral · Survived · `throw new ProviderError("invalid_payload", "o provedor devolveu um corpo que não é JSON");` → `""`
- linha 77 · StringLiteral · Survived · `throw new ProviderError("invalid_payload", "o corpo do provedor não tem a lista data");` → `""`
- linha 76 · ConditionalExpression · Survived · `if (typeof body !== "object" || body === null || !Array.isArray((body as { data?: unknown }).data)) {` → `false`
- linha 81 · StringLiteral · Survived · `throw new ProviderError("invalid_payload", "next_cursor não é texto");` → `""`

**`src/store.ts`**

- linha 214 · ConditionalExpression · Survived · `last_checked_at: posts.reduce<string | null>((latest, p) => (latest === null || p.last_checked_at > latest ? p` → `true`
- linha 214 · EqualityOperator · Survived · `last_checked_at: posts.reduce<string | null>((latest, p) => (latest === null || p.last_checked_at > latest ? p` → `p.last_checked_at >= latest`
- linha 215 · EqualityOperator · Survived · `last_fetched_at: posts.reduce<string | null>((latest, p) => (latest === null || p.fetched_at > latest ? p.fetc` → `p.fetched_at >= latest`

**`src/sync.ts`**

- linha 63 · StringLiteral · Survived · `error: 'rate_limited: o provedor pediu para esperar ${decision.retryAfterMs} ms',` → `''`

## revisao-video: 605/723 (83.7%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/app.ts` | 220/306 | 71.9% |
| `src/store.ts` | 326/357 | 91.3% |
| `src/domain/approval.ts` | 31/31 | 100.0% |
| `src/domain/pieces.ts` | 21/22 | 95.5% |
| `src/domain/versions.ts` | 7/7 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/app.ts`**

- linha 39 · ObjectLiteral · NoCoverage · `app.get("/health", (c) => c.json({ ok: true }));` → `{}`
- linha 39 · BooleanLiteral · NoCoverage · `app.get("/health", (c) => c.json({ ok: true }));` → `false`
- linha 141 · StringLiteral · NoCoverage · `if (n === null) return notFound(c, "version");` → `""`
- linha 144 · StringLiteral · NoCoverage · `if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "fr` → `""`
- linha 144 · StringLiteral · NoCoverage · `if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "fr` → `""`
- linha 15 · LogicalOperator · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `trimmed === "" && trimmed.length > max`
- linha 15 · ConditionalExpression · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `false`
- linha 15 · StringLiteral · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `"Stryker was here!"`
- linha 15 · EqualityOperator · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `trimmed.length >= max`
- linha 15 · ConditionalExpression · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `false`
- linha 36 · ObjectLiteral · Survived · `const unknownPiece = (c: Context) => c.json({ error: "unknown_piece", allowed: PIECE_TYPES }, 404);` → `{}`
- linha 36 · StringLiteral · Survived · `const unknownPiece = (c: Context) => c.json({ error: "unknown_piece", allowed: PIECE_TYPES }, 404);` → `""`
- linha 15 · ConditionalExpression · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `false`
- linha 37 · ObjectLiteral · Survived · `const notFound = (c: Context, what: string) => c.json({ error: "not_found", what }, 404);` → `{}`
- linha 37 · StringLiteral · Survived · `const notFound = (c: Context, what: string) => c.json({ error: "not_found", what }, 404);` → `""`
- linha 44 · StringLiteral · Survived · `if (!requiredPieces) return invalid(c, "required_pieces", "required_pieces deve ser uma lista não vazia, sem r` → `""`
- linha 50 · StringLiteral · Survived · `return campaign ? c.json(campaign) : notFound(c, "campaign");` → `""`
- linha 34 · ConditionalExpression · Survived · `return raw !== undefined && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;` → `true`
- linha 56 · StringLiteral · Survived · `if (!campaignId) return invalid(c, "campaign_id", "campaign_id é obrigatório");` → `""`
- linha 56 · StringLiteral · Survived · `if (!campaignId) return invalid(c, "campaign_id", "campaign_id é obrigatório");` → `""`
- linha 34 · Regex · Survived · `return raw !== undefined && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;` → `/^[1-9]\D*$/`
- linha 43 · OptionalChaining · Survived · `const requiredPieces = parseRequiredPieces(body?.required_pieces);` → `body.required_pieces`
- linha 42 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 76 · StringLiteral · Survived · `if (!url) return invalid(c, "url", "url é obrigatória");` → `""`
- linha 76 · StringLiteral · Survived · `if (!url) return invalid(c, "url", "url é obrigatória");` → `""`
- linha 54 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 55 · OptionalChaining · Survived · `const campaignId = required(body?.campaign_id, 200);` → `body.campaign_id`
- linha 79 · StringLiteral · Survived · `if (type !== "video") return invalid(c, "duration_seconds", "só o vídeo tem duração");` → `""`
- linha 79 · StringLiteral · Survived · `if (type !== "video") return invalid(c, "duration_seconds", "só o vídeo tem duração");` → `""`
- linha 74 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 75 · OptionalChaining · Survived · `const url = required(body?.url, 2000);` → `body.url`
- linha 78 · ConditionalExpression · Survived · `if (duration !== undefined && duration !== null) {` → `true`
- linha 80 · StringLiteral · Survived · `if (!Number.isSafeInteger(duration) || duration <= 0) return invalid(c, "duration_seconds", "duration_seconds ` → `""`
- linha 77 · OptionalChaining · Survived · `const duration = body?.duration_seconds;` → `body.duration_seconds`
- linha 83 · ConditionalExpression · Survived · `if (submissionId !== undefined && submissionId !== null && (typeof submissionId !== "string" || submissionId.l` → `true`
- linha 83 · EqualityOperator · Survived · `if (submissionId !== undefined && submissionId !== null && (typeof submissionId !== "string" || submissionId.l` → `submissionId.length <= 1`
- linha 83 · EqualityOperator · Survived · `if (submissionId !== undefined && submissionId !== null && (typeof submissionId !== "string" || submissionId.l` → `submissionId.length >= MAX_SUBMISSION_ID`
- linha 84 · StringLiteral · Survived · `return invalid(c, "submission_id", 'submission_id deve ser um texto de 1 a ${MAX_SUBMISSION_ID} caracteres');` → `''`
- linha 82 · OptionalChaining · Survived · `const submissionId = body?.submission_id;` → `body.submission_id`
- linha 100 · StringLiteral · Survived · `if (n === null) return notFound(c, "version");` → `""`
- linha 99 · ConditionalExpression · Survived · `if (!type) return unknownPiece(c);` → `false`
- linha 100 · ConditionalExpression · Survived · `if (n === null) return notFound(c, "version");` → `false`
- linha 109 · StringLiteral · Survived · `if (n === null) return notFound(c, "version");` → `""`
- linha 88 · ConditionalExpression · Survived · `{ deliveryId: c.req.param("id"), piece: type, url, durationSeconds: typeof duration === "number" ? duration : ` → `true`
- linha 114 · StringLiteral · Survived · `if (!text) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");` → `""`
- linha 114 · StringLiteral · Survived · `if (!text) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");` → `""`
- linha 108 · ConditionalExpression · Survived · `if (!type) return unknownPiece(c);` → `false`
- linha 109 · ConditionalExpression · Survived · `if (n === null) return notFound(c, "version");` → `false`
- linha 112 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 127 · StringLiteral · Survived · `if (n === null) return notFound(c, "version");` → `""`
- linha 113 · OptionalChaining · Survived · `const text = required(body?.reason);` → `body.reason`
- linha 130 · StringLiteral · Survived · `if (!text) return invalid(c, "text", "text é obrigatório");` → `""`
- linha 130 · StringLiteral · Survived · `if (!text) return invalid(c, "text", "text é obrigatório");` → `""`
- linha 126 · ConditionalExpression · Survived · `if (!type) return unknownPiece(c);` → `false`
- linha 127 · ConditionalExpression · Survived · `if (n === null) return notFound(c, "version");` → `false`
- linha 129 · OptionalChaining · Survived · `const text = required(body?.text);` → `body.text`
- linha 128 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 131 · OptionalChaining · Survived · `const second = body?.second;` → `body.second`
- linha 132 · StringLiteral · Survived · `if (second !== undefined && second !== null && (!Number.isSafeInteger(second) || second < 0)) return invalid(c` → `""`
- linha 132 · ConditionalExpression · Survived · `if (second !== undefined && second !== null && (!Number.isSafeInteger(second) || second < 0)) return invalid(c` → `true`
- linha 140 · ConditionalExpression · Survived · `if (!type) return unknownPiece(c);` → `false`
- linha 143 · OptionalChaining · Survived · `const from = body?.from_version;` → `body.from_version`
- linha 142 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 141 · ConditionalExpression · Survived · `if (n === null) return notFound(c, "version");` → `false`
- linha 144 · LogicalOperator · Survived · `if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "fr` → `(typeof from !== "number" || !Number.isSafeInteger`
- linha 144 · ConditionalExpression · Survived · `if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "fr` → `false`
- linha 144 · ConditionalExpression · Survived · `if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "fr` → `false`
- linha 144 · LogicalOperator · Survived · `if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "fr` → `typeof from !== "number" && !Number.isSafeInteger(`
- linha 144 · ConditionalExpression · Survived · `if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "fr` → `false`
- linha 144 · ConditionalExpression · Survived · `if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) return invalid(c, "from_version", "fr` → `false`
- linha 145 · OptionalChaining · Survived · `const ids = body?.comment_ids;` → `body.comment_ids`
- linha 133 · OptionalChaining · Survived · `const out = addComment(db, { deliveryId: c.req.param("id") as string, piece: type, number: n, second: typeof s` → `body.author`
- linha 146 · ConditionalExpression · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `true`
- linha 146 · EqualityOperator · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `ids.length < 200`
- linha 146 · MethodExpression · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `ids.some((x: unknown) => typeof x === "number" && `
- linha 146 · ConditionalExpression · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `true`
- linha 146 · LogicalOperator · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `typeof x === "number" && Number.isSafeInteger(x) |`
- linha 146 · LogicalOperator · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `typeof x === "number" || Number.isSafeInteger(x)`
- linha 146 · ConditionalExpression · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `true`
- linha 146 · ConditionalExpression · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `true`
- linha 146 · EqualityOperator · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `x >= 0`
- linha 146 · ConditionalExpression · Survived · `const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((x: unknown) => typeof x ` → `true`
- linha 147 · StringLiteral · Survived · `if (!valid) return invalid(c, "comment_ids", "comment_ids deve ser uma lista de 1 a 200 ids de comentário, sem` → `""`
- linha 147 · StringLiteral · Survived · `if (!valid) return invalid(c, "comment_ids", "comment_ids deve ser uma lista de 1 a 200 ids de comentário, sem` → `""`
- linha 39 · ArrowFunction · Survived · `app.get("/health", (c) => c.json({ ok: true }));` → `() => undefined`
- linha 39 · StringLiteral · Survived · `app.get("/health", (c) => c.json({ ok: true }));` → `""`

**`src/store.ts`**

- linha 359 · StringLiteral · NoCoverage · `if (!findDelivery(db, input.deliveryId)) return fail("not_found", { what: "delivery" });` → `""`
- linha 359 · ObjectLiteral · NoCoverage · `if (!findDelivery(db, input.deliveryId)) return fail("not_found", { what: "delivery" });` → `{}`
- linha 359 · StringLiteral · NoCoverage · `if (!findDelivery(db, input.deliveryId)) return fail("not_found", { what: "delivery" });` → `""`
- linha 193 · ConditionalExpression · Survived · `const isCurrent = previous.version_number === currentNumber(db, input.deliveryId, input.piece);` → `false`
- linha 64 · ArrowFunction · Survived · `const ordered = [...required, ...PIECE_TYPES.filter((type) => !required.includes(type))];` → `() => undefined`
- linha 221 · ObjectLiteral · Survived · `logEvent(db, input.deliveryId, "invalidated", input.piece, number, { reason: "new_version_of_required_piece" }` → `{}`
- linha 221 · StringLiteral · Survived · `logEvent(db, input.deliveryId, "invalidated", input.piece, number, { reason: "new_version_of_required_piece" }` → `""`
- linha 249 · ConditionalExpression · Survived · `return { ok: true as const, version: versionView(version, version.number === current, commentsCount), delivery` → `false`
- linha 259 · ObjectLiteral · Survived · `if (before === "in_review" && after === "approved") logEvent(db, input.deliveryId, "restored", input.piece, ve` → `{}`
- linha 259 · StringLiteral · Survived · `if (before === "in_review" && after === "approved") logEvent(db, input.deliveryId, "restored", input.piece, ve` → `""`
- linha 270 · ObjectLiteral · Survived · `if (!delivery) return fail("not_found", { what: "delivery" });` → `{}`
- linha 270 · StringLiteral · Survived · `if (!delivery) return fail("not_found", { what: "delivery" });` → `""`
- linha 293 · StringLiteral · Survived · `if (!delivery) return fail("not_found", { what: "delivery" });` → `""`
- linha 295 · StringLiteral · Survived · `if (!version) return fail("not_found", { what: "version" });` → `""`
- linha 259 · ConditionalExpression · Survived · `if (before === "in_review" && after === "approved") logEvent(db, input.deliveryId, "restored", input.piece, ve` → `true`
- linha 324 · StringLiteral · Survived · `if (!findDelivery(db, input.deliveryId)) return fail("not_found", { what: "delivery" });` → `""`
- linha 329 · ObjectLiteral · Survived · `if (input.second === null) return fail("validation_error", { field: "second", message: "o comentário do vídeo ` → `{}`
- linha 329 · StringLiteral · Survived · `if (input.second === null) return fail("validation_error", { field: "second", message: "o comentário do vídeo ` → `""`
- linha 329 · StringLiteral · Survived · `if (input.second === null) return fail("validation_error", { field: "second", message: "o comentário do vídeo ` → `""`
- linha 331 · StringLiteral · Survived · `return fail("validation_error", { field: "second", message: 'o vídeo tem ${version.duration_seconds} s: o segu` → `""`
- linha 334 · StringLiteral · Survived · `return fail("validation_error", { field: "second", message: "só o comentário do vídeo é preso a um segundo" })` → `""`
- linha 344 · LogicalOperator · Survived · `(db.prepare("SELECT v.number AS n FROM comments c JOIN piece_versions v ON v.id = c.version_id WHERE c.id = ?"` → `(db.prepare("SELECT v.number AS n FROM comments c `
- linha 344 · OptionalChaining · Survived · `(db.prepare("SELECT v.number AS n FROM comments c JOIN piece_versions v ON v.id = c.version_id WHERE c.id = ?"` → `(db.prepare("SELECT v.number AS n FROM comments c `
- linha 359 · ConditionalExpression · Survived · `if (!findDelivery(db, input.deliveryId)) return fail("not_found", { what: "delivery" });` → `false`
- linha 361 · ObjectLiteral · Survived · `if (!target) return fail("not_found", { what: "version" });` → `{}`
- linha 361 · StringLiteral · Survived · `if (!target) return fail("not_found", { what: "version" });` → `""`
- linha 364 · StringLiteral · Survived · `return fail("validation_error", { field: "from_version", message: "from_version deve ser outra versão existent` → `""`
- linha 370 · StringLiteral · Survived · `if (!row) return fail("validation_error", { field: "comment_ids", message: 'o comentário ${id} não existe na v` → `''`
- linha 378 · ConditionalExpression · Survived · `const outOfRange = fresh.filter((c) => c.second !== null && target.duration_seconds !== null && c.second > tar` → `true`
- linha 382 · StringLiteral · Survived · `message: 'há comentários em segundos que o vídeo da versão ${target.number} (${target.duration_seconds} s) não` → `''`
- linha 343 · ArrowFunction · Survived · `const originVersionOf = (db: DatabaseSync, commentId: number): number | null =>` → `() => undefined`

**`src/domain/pieces.ts`**

- linha 8 · ConditionalExpression · Survived · `export const isPieceType = (value: unknown): value is PieceType => typeof value === "string" && (PIECE_TYPES a` → `true`

## views-suspeitas: 868/935 (92.8%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/dataset/readme.ts` | 101/102 | 99.0% |
| `src/domain/classify.ts` | 272/281 | 96.8% |
| `src/domain/signals.ts` | 406/463 | 87.7% |
| `src/dataset/evaluate.ts` | 55/55 | 100.0% |
| `src/domain/stats.ts` | 34/34 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/dataset/readme.ts`**

- linha 63 · StringLiteral · Survived · `if (!region) problems.push('faltam os marcadores ${START} e ${END} da tabela de métricas');` → `''`

**`src/domain/classify.ts`**

- linha 26 · ArrayDeclaration · Survived · `const claimed: Array<[number, number]> = [];` → `["Stryker was here"]`
- linha 27 · EqualityOperator · Survived · `const overlaps = (from: number, to: number) => claimed.some(([a, b]) => from <= b && to >= a);` → `to > a`
- linha 27 · EqualityOperator · Survived · `const overlaps = (from: number, to: number) => claimed.some(([a, b]) => from <= b && to >= a);` → `from < b`
- linha 52 · ConditionalExpression · Survived · `add(peakFinding(peak, baseline), peak.kind !== "organic_decay");` → `false`
- linha 83 · EqualityOperator · Survived · `for (let h = 1; h < series.length; h += 1) if (series[h]! > series[hour]!) hour = h;` → `h <= series.length`
- linha 103 · EqualityOperator · Survived · `const step = '${found.step! > 0 ? "+" : "-"}${fmt(Math.abs(found.step!))}';` → `found.step! >= 0`
- linha 115 · EqualityOperator · Survived · `const suspicious = plateau.regularity < T.plateau_regularity_suspicious;` → `plateau.regularity <= T.plateau_regularity_suspici`
- linha 117 · ArithmeticOperator · Survived · `const std = stdDev(series.slice(plateau.from, plateau.to + 1));` → `plateau.to - 1`
- linha 153 · StringLiteral · Survived · `signal: { name: "organic_decay", effect: "organic", measured: peak.tail, threshold: T.organic_min_tail_hours, ` → `''`

**`src/domain/signals.ts`**

- linha 113 · ArithmeticOperator · Survived · `candidates.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);` → `a.from + b.from`
- linha 34 · EqualityOperator · Survived · `for (let i = 0; i < n; ) {` → `i <= n`
- linha 36 · EqualityOperator · Survived · `while (j + 1 < n && series[j + 1] === series[i]) j += 1;` → `j + 1 <= n`
- linha 36 · ConditionalExpression · Survived · `while (j + 1 < n && series[j + 1] === series[i]) j += 1;` → `true`
- linha 36 · ArithmeticOperator · Survived · `while (j + 1 < n && series[j + 1] === series[i]) j += 1;` → `j - 1`
- linha 42 · EqualityOperator · Survived · `for (let i = 0; i + 1 < n; ) {` → `i + 1 <= n`
- linha 42 · ArithmeticOperator · Survived · `for (let i = 0; i + 1 < n; ) {` → `i - 1`
- linha 45 · EqualityOperator · Survived · `while (j + 1 < n && series[j + 1]! - series[j]! === step) j += 1;` → `j + 1 <= n`
- linha 45 · ConditionalExpression · Survived · `while (j + 1 < n && series[j + 1]! - series[j]! === step) j += 1;` → `true`
- linha 45 · ArithmeticOperator · Survived · `while (j + 1 < n && series[j + 1]! - series[j]! === step) j += 1;` → `j - 1`
- linha 46 · ConditionalExpression · Survived · `if (step !== 0 && j - i + 1 >= T.progression_min_run && series.slice(i, j + 1).every((v) => v >= min)) take({ ` → `true`
- linha 46 · MethodExpression · Survived · `if (step !== 0 && j - i + 1 >= T.progression_min_run && series.slice(i, j + 1).every((v) => v >= min)) take({ ` → `series`
- linha 47 · EqualityOperator · Survived · `i = step === 0 ? j + 1 : j;` → `step !== 0`
- linha 47 · ConditionalExpression · Survived · `i = step === 0 ? j + 1 : j;` → `false`
- linha 52 · EqualityOperator · Survived · `for (let i = p; i < n; ) {` → `i <= n`
- linha 58 · ConditionalExpression · Survived · `while (j + 1 < n && series[j + 1] === series[j + 1 - p]) j += 1;` → `true`
- linha 58 · EqualityOperator · Survived · `while (j + 1 < n && series[j + 1] === series[j + 1 - p]) j += 1;` → `j + 1 <= n`
- linha 58 · ArithmeticOperator · Survived · `while (j + 1 < n && series[j + 1] === series[j + 1 - p]) j += 1;` → `j - 1`
- linha 62 · ConditionalExpression · Survived · `if (repeats >= T.cycle_min_repeats && window.every((v) => v >= min) && new Set(window).size > 1) take({ kind: ` → `true`
- linha 62 · EqualityOperator · Survived · `if (repeats >= T.cycle_min_repeats && window.every((v) => v >= min) && new Set(window).size > 1) take({ kind: ` → `new Set(window).size >= 1`
- linha 86 · EqualityOperator · Survived · `for (let j = start + 1; j < n; j += 1) {` → `j <= n`
- linha 95 · EqualityOperator · Survived · `if (lastGood < 0) return undefined;` → `lastGood <= 0`
- linha 99 · EqualityOperator · Survived · `if (next === undefined || next > (1 - T.cliff_drop) * avg) return undefined; // sem queda seca logo depois` → `next >= (1 - T.cliff_drop) * avg`
- linha 109 · EqualityOperator · Survived · `for (let start = 0; start < series.length; start += 1) {` → `start <= series.length`
- linha 116 · EqualityOperator · Survived · `if (!chosen.some((other) => candidate.from <= other.to && candidate.to >= other.from)) chosen.push(candidate);` → `candidate.from < other.to`
- linha 116 · EqualityOperator · Survived · `if (!chosen.some((other) => candidate.from <= other.to && candidate.to >= other.from)) chosen.push(candidate);` → `candidate.to > other.from`
- linha 130 · ArithmeticOperator · Survived · `const order = series.map((_, h) => h).sort((a, b) => series[b]! - series[a]! || a - b);` → `a + b`
- linha 140 · ConditionalExpression · Survived · `while (from > 0 && !claimed.has(from - 1) && series[from - 1]! > tailThreshold) from -= 1;` → `true`
- linha 140 · EqualityOperator · Survived · `while (from > 0 && !claimed.has(from - 1) && series[from - 1]! > tailThreshold) from -= 1;` → `from >= 0`
- linha 140 · ArithmeticOperator · Survived · `while (from > 0 && !claimed.has(from - 1) && series[from - 1]! > tailThreshold) from -= 1;` → `from + 1`
- linha 141 · ConditionalExpression · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `true`
- linha 141 · LogicalOperator · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `to + 1 < series.length || !claimed.has(to + 1)`
- linha 141 · ConditionalExpression · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `true`
- linha 141 · EqualityOperator · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `to + 1 <= series.length`
- linha 141 · ArithmeticOperator · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `to - 1`
- linha 141 · ArithmeticOperator · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `to - 1`
- linha 146 · ConditionalExpression · Survived · `const abruptEnd = next !== undefined && next <= (1 - T.drop_fraction) * series[to]!;` → `true`
- linha 146 · EqualityOperator · Survived · `const abruptEnd = next !== undefined && next <= (1 - T.drop_fraction) * series[to]!;` → `next < (1 - T.drop_fraction) * series[to]!`
- linha 151 · ConditionalExpression · Survived · `} else if (value >= T.organic_min_lift * baseline && to - hour >= T.organic_min_tail_hours && isGradual(series` → `true`
- linha 151 · ArithmeticOperator · Survived · `} else if (value >= T.organic_min_lift * baseline && to - hour >= T.organic_min_tail_hours && isGradual(series` → `T.organic_min_lift / baseline`
- linha 165 · EqualityOperator · Survived · `if (series[h]! <= (1 - T.drop_fraction) * series[h - 1]!) return false;` → `series[h]! < (1 - T.drop_fraction) * series[h - 1]`
- linha 178 · ArithmeticOperator · Survived · `for (let s = w; s <= n - w; s += 1) {` → `n + w`
- linha 184 · EqualityOperator · Survived · `for (let h = s - w; h <= s + w; h += 1) {` → `h < s + w`
- linha 185 · EqualityOperator · Survived · `if (h < 3 || h + 6 > n) continue;` → `h <= 3`
- linha 185 · ConditionalExpression · Survived · `if (h < 3 || h + 6 > n) continue;` → `false`
- linha 185 · EqualityOperator · Survived · `if (h < 3 || h + 6 > n) continue;` → `h + 6 >= n`
- linha 185 · ArithmeticOperator · Survived · `if (h < 3 || h + 6 > n) continue;` → `h - 6`
- linha 186 · EqualityOperator · Survived · `if (series[h - 1]! >= mid || !series.slice(h, h + 6).every((v) => v >= mid)) continue;` → `series[h - 1]! > mid`
- linha 186 · ConditionalExpression · Survived · `if (series[h - 1]! >= mid || !series.slice(h, h + 6).every((v) => v >= mid)) continue;` → `false`
- linha 186 · EqualityOperator · Survived · `if (series[h - 1]! >= mid || !series.slice(h, h + 6).every((v) => v >= mid)) continue;` → `v > mid`
- linha 187 · ConditionalExpression · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `false`
- linha 187 · LogicalOperator · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `series[h - 3]! > mid && series[h + 2]! < 0.8 * aft`
- linha 187 · ConditionalExpression · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `false`
- linha 187 · EqualityOperator · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `series[h - 3]! >= mid`
- linha 187 · ConditionalExpression · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `false`
- linha 187 · EqualityOperator · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `series[h + 2]! <= 0.8 * after`
- linha 187 · ArithmeticOperator · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `0.8 / after`
