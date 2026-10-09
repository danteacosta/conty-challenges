# Resumo da mutação (Stryker)

Gerado por `node verificacao/resumo-mutacao.mjs` a partir de `reports/mutation.json` de cada projeto
(`npm run mutation` dentro da pasta). Os JSON completos estão ao lado deste arquivo. O Stryker não usa semente:
o resultado depende do código, dos testes e da versão do Node (esta rodada: ver `matriz-node.log`).

## vendas-shopify: 331/377 (87.8%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/app.ts` | 146/190 | 76.8% |
| `src/attribution.ts` | 34/34 | 100.0% |
| `src/money.ts` | 27/28 | 96.4% |
| `src/refunds.ts` | 8/8 | 100.0% |
| `src/store.ts` | 116/117 | 99.1% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/app.ts`**

- linha 7 · MethodExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `v`
- linha 7 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `true`
- linha 7 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `false`
- linha 7 · StringLiteral · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `"Stryker was here!"`
- linha 7 · EqualityOperator · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `typeof v !== "number"`
- linha 7 · LogicalOperator · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `typeof v === "number" || Number.isFinite(v)`
- linha 7 · MethodExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `v`
- linha 7 · ConditionalExpression · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `true`
- linha 7 · StringLiteral · Survived · `typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) ` → `""`
- linha 11 · StringLiteral · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `"Stryker was here!"`
- linha 22 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 11 · ConditionalExpression · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `true`
- linha 11 · MethodExpression · Survived · `typeof v === "string" ? (v.trim() !== "" ? v.trim() : null) : Number.isSafeInteger(v) ? String(v) : null;` → `v`
- linha 26 · ObjectLiteral · Survived · `if (!id || !coupon || !utm) return c.json({ error: "id, coupon_code e utm_handle são obrigatórios" }, 400);` → `{}`
- linha 26 · StringLiteral · Survived · `if (!id || !coupon || !utm) return c.json({ error: "id, coupon_code e utm_handle são obrigatórios" }, 400);` → `""`
- linha 35 · ObjectLiteral · Survived · `if (!id) return c.json({ error: "id é obrigatório (texto ou inteiro seguro)" }, 400);` → `{}`
- linha 35 · StringLiteral · Survived · `if (!id) return c.json({ error: "id é obrigatório (texto ou inteiro seguro)" }, 400);` → `""`
- linha 32 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 41 · ObjectLiteral · Survived · `if (totalCents === null) return c.json({ error: "total_price inválido" }, 400);` → `{}`
- linha 41 · StringLiteral · Survived · `if (totalCents === null) return c.json({ error: "total_price inválido" }, 400);` → `""`
- linha 36 · OptionalChaining · Survived · `if (b?.currency !== undefined && b?.currency !== null) {` → `b.currency`
- linha 36 · OptionalChaining · Survived · `if (b?.currency !== undefined && b?.currency !== null) {` → `b.currency`
- linha 44 · ArrayDeclaration · Survived · `: [];` → `["Stryker was here"]`
- linha 43 · OptionalChaining · Survived · `? b.discount_codes.map((d: { code?: unknown }) => str(d?.code)).filter((x: string | null): x is string => !!x)` → `d.code`
- linha 43 · MethodExpression · Survived · `? b.discount_codes.map((d: { code?: unknown }) => str(d?.code)).filter((x: string | null): x is string => !!x)` → `b.discount_codes.map((d: {   code?: unknown; }) =>`
- linha 42 · OptionalChaining · Survived · `const codes = Array.isArray(b?.discount_codes)` → `b.discount_codes`
- linha 51 · OptionalChaining · Survived · `financialStatus: str(b?.financial_status) ?? "pending",` → `b.financial_status`
- linha 52 · OptionalChaining · Survived · `createdAt: str(b?.created_at),` → `b.created_at`
- linha 53 · OptionalChaining · Survived · `signals: { couponCodes: codes, utmHandle: str(b?.utm_parameters?.utm_content) },` → `b.utm_parameters`
- linha 65 · ObjectLiteral · Survived · `if (!id || !orderId) return c.json({ error: "id e order_id são obrigatórios (texto ou inteiro seguro)" }, 400)` → `{}`
- linha 65 · StringLiteral · Survived · `if (!id || !orderId) return c.json({ error: "id e order_id são obrigatórios (texto ou inteiro seguro)" }, 400)` → `""`
- linha 61 · ArrowFunction · Survived · `const b = await c.req.json().catch(() => null);` → `() => undefined`
- linha 66 · ObjectLiteral · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `{}`
- linha 66 · StringLiteral · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `""`
- linha 68 · StringLiteral · Survived · `if (outcome.result === "conflict") return c.json({ error: "refund_conflict", refund_id: id, message: "já exist` → `""`
- linha 66 · ConditionalExpression · Survived · `if (amountCents === null || amountCents <= 0) return c.json({ error: "amount inválido" }, 400);` → `false`
- linha 79 · ObjectLiteral · Survived · `return refund ? c.json(refund) : c.json({ error: "estorno não encontrado" }, 404);` → `{}`
- linha 79 · StringLiteral · Survived · `return refund ? c.json(refund) : c.json({ error: "estorno não encontrado" }, 404);` → `""`
- linha 74 · ObjectLiteral · Survived · `return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);` → `{}`
- linha 74 · StringLiteral · Survived · `return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);` → `""`
- linha 84 · ConditionalExpression · Survived · `if (status !== undefined && status !== "pending" && status !== "applied" && status !== "clamped") {` → `true`
- linha 84 · StringLiteral · Survived · `if (status !== undefined && status !== "pending" && status !== "applied" && status !== "clamped") {` → `""`
- linha 85 · ObjectLiteral · Survived · `return c.json({ error: "status deve ser pending, applied ou clamped" }, 400);` → `{}`
- linha 85 · StringLiteral · Survived · `return c.json({ error: "status deve ser pending, applied ou clamped" }, 400);` → `""`

**`src/money.ts`**

- linha 4 · ConditionalExpression · Survived · `if (!Number.isFinite(value)) return null;` → `false`

**`src/store.ts`**

- linha 189 · ConditionalExpression · Survived · `if (!/integer overflow/i.test(String(error))) throw error;` → `false`

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

## rastreio-envio: 498/519 (96.0%)

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
| `src/store.ts` | 45/46 | 97.8% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/alerts.ts`**

- linha 24 · BlockStatement · NoCoverage · `async notify(alert: DelayAlert) {` → `{}`
- linha 25 · StringLiteral · NoCoverage · `console.warn('[atraso] ${alert.tracking_code}: ${alert.elapsed_hours.toFixed(1)}h (limite ${alert.threshold_ho` → `''`
- linha 98 · ConditionalExpression · Survived · `if (!shipment || !delay || !delay.delayed) {` → `false`
- linha 99 · OptionalChaining · Survived · `discard.run(nowIso, shipment?.status === "delivered" ? "delivered" : "within_threshold", row.id);` → `shipment.status`
- linha 98 · LogicalOperator · Survived · `if (!shipment || !delay || !delay.delayed) {` → `!shipment && !delay`

**`src/config.ts`**

- linha 16 · StringLiteral · Survived · `super('Configuração inválida:\n${problems.map((problem) => '- ${problem}').join("\n")}');` → `""`
- linha 55 · StringLiteral · Survived · `if (protocol !== "http:" && protocol !== "https:") throw new Error("protocolo");` → `""`

**`src/domain/normalize.ts`**

- linha 16 · MethodExpression · Survived · `dedupeKey: '${carrier}|${event.rawStatus.trim().toUpperCase()}|${occurredAt}',` → `event.rawStatus.trim().toLowerCase()`

**`src/domain/status.ts`**

- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `false`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `true`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `true`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey <= b.dedupeKey`
- linha 41 · UnaryOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `+1`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey >= b.dedupeKey`
- linha 41 · ConditionalExpression · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `false`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey >= b.dedupeKey`
- linha 41 · EqualityOperator · Survived · `(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0)` → `a.dedupeKey <= b.dedupeKey`
- linha 15 · ObjectLiteral · Survived · `const TIE_PRIORITY: Record<Status, number> = {` → `{}`

**`src/instant.ts`**

- linha 30 · StringLiteral · Survived · `if (zone !== "Z") {` → `""`
- linha 30 · ConditionalExpression · Survived · `if (zone !== "Z") {` → `true`

**`src/store.ts`**

- linha 49 · OptionalChaining · Survived · `return findShipment(db, shipment.code)?.carrier === shipment.carrier ? ("exists" as const) : ("conflict" as co` → `findShipment(db, shipment.code).carrier`

## revisao-roteiro: 300/325 (92.3%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/app.ts` | 116/136 | 85.3% |
| `src/domain/deadline.ts` | 64/69 | 92.8% |
| `src/domain/transitions.ts` | 9/9 | 100.0% |
| `src/store.ts` | 111/111 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/app.ts`**

- linha 21 · ConditionalExpression · Survived · `if (value === undefined || value === null) return undefined;` → `false`
- linha 14 · ConditionalExpression · Survived · `return trimmed === "" || trimmed.length > MAX_TEXT ? null : trimmed;` → `false`
- linha 14 · StringLiteral · Survived · `return trimmed === "" || trimmed.length > MAX_TEXT ? null : trimmed;` → `"Stryker was here!"`
- linha 22 · ConditionalExpression · Survived · `return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;` → `true`
- linha 25 · ConditionalExpression · Survived · `if (value === undefined || value === null) return undefined;` → `false`
- linha 26 · ConditionalExpression · Survived · `return typeof value === "string" && value.length >= 1 && value.length <= max ? value : null;` → `true`
- linha 26 · EqualityOperator · Survived · `return typeof value === "string" && value.length >= 1 && value.length <= max ? value : null;` → `value.length > 1`
- linha 26 · EqualityOperator · Survived · `return typeof value === "string" && value.length >= 1 && value.length <= max ? value : null;` → `value.length < max`
- linha 56 · StringLiteral · Survived · `if (!missionId) return invalid(c, "mission_id", "mission_id é obrigatório");` → `""`
- linha 57 · StringLiteral · Survived · `if (!content) return invalid(c, "content", "content é obrigatório");` → `""`
- linha 53 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 67 · StringLiteral · Survived · `if (!reason) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");` → `""`
- linha 68 · StringLiteral · Survived · `if (!deadlineDate) return invalid(c, "deadline_date", "deadline_date é obrigatório, no formato YYYY-MM-DD e co` → `""`
- linha 64 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 75 · StringLiteral · Survived · `if (!content) return invalid(c, "content", "content é obrigatório");` → `""`
- linha 77 · StringLiteral · Survived · `if (changeRequestId === null) return invalid(c, "change_request_id", "change_request_id deve ser o id inteiro ` → `""`
- linha 73 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 79 · StringLiteral · Survived · `if (submissionId === null) return invalid(c, "submission_id", 'submission_id deve ser um texto de 1 a ${MAX_SU` → `''`
- linha 76 · OptionalChaining · Survived · `const changeRequestId = optionalPositiveInteger(body?.change_request_id);` → `body.change_request_id`
- linha 78 · OptionalChaining · Survived · `const submissionId = optionalText(body?.submission_id, MAX_SUBMISSION_ID);` → `body.submission_id`

**`src/domain/deadline.ts`**

- linha 8 · StringLiteral · Survived · `const BRAND_ZONE = "America/Sao_Paulo";` → `""`
- linha 10 · StringLiteral · Survived · `const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit` → `""`
- linha 10 · StringLiteral · Survived · `const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit` → `""`
- linha 10 · StringLiteral · Survived · `const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit` → `""`
- linha 10 · StringLiteral · Survived · `const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRAND_ZONE, year: "numeric", month: "2-digit` → `""`

## metricas-redes: 599/623 (96.1%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/config.ts` | 66/69 | 95.7% |
| `src/domain/retry-after.ts` | 37/38 | 97.4% |
| `src/domain/retry.ts` | 45/45 | 100.0% |
| `src/instant.ts` | 114/116 | 98.3% |
| `src/providers/adapters.ts` | 124/129 | 96.1% |
| `src/providers/http.ts` | 90/101 | 89.1% |
| `src/store.ts` | 59/60 | 98.3% |
| `src/sync.ts` | 64/65 | 98.5% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/config.ts`**

- linha 11 · StringLiteral · Survived · `super('Configuração inválida:\n${problems.map((problem) => '- ${problem}').join("\n")}');` → `""`
- linha 38 · MethodExpression · Survived · `if (env.DB_PATH.trim() === "") problems.push("DB_PATH não pode ser vazio");` → `env.DB_PATH`
- linha 46 · StringLiteral · Survived · `if (protocol !== "http:" && protocol !== "https:") throw new Error("protocolo");` → `""`

**`src/domain/retry-after.ts`**

- linha 5 · Regex · Survived · `const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;` → `/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}`

**`src/instant.ts`**

- linha 30 · ConditionalExpression · Survived · `if (zone !== "Z") {` → `true`
- linha 30 · StringLiteral · Survived · `if (zone !== "Z") {` → `""`

**`src/providers/adapters.ts`**

- linha 33 · ConditionalExpression · Survived · `if (typeof value === "string" && /^\d+$/.test(value)) {` → `true`
- linha 42 · ConditionalExpression · Survived · `if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;` → `false`
- linha 48 · ConditionalExpression · Survived · `if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;` → `false`
- linha 59 · ConditionalExpression · Survived · `if (name === undefined || item[name] === undefined) return 0;` → `false`
- linha 25 · StringLiteral · Survived · `tiktok: { id: "video_id", publishedAt: "create_time", asOf: "snapshot_time", time: "epoch", views: "play_count` → `""`

**`src/providers/http.ts`**

- linha 49 · StringLiteral · Survived · `throw new ProviderError("network", 'não foi possível falar com o provedor: ${(error as Error).message}');` → `''`
- linha 47 · StringLiteral · Survived · `throw new ProviderError("timeout", 'o provedor não respondeu em ${this.timeoutMs} ms');` → `''`
- linha 56 · StringLiteral · Survived · `if (response.status === 408) throw new ProviderError("timeout", "o provedor respondeu 408", 408);` → `""`
- linha 57 · StringLiteral · Survived · `if (response.status >= 500) throw new ProviderError("server", 'o provedor respondeu ${response.status}', respo` → `''`
- linha 54 · StringLiteral · Survived · `throw new ProviderError("rate_limited", "o provedor respondeu 429", 429, retryAfterMs);` → `""`
- linha 64 · StringLiteral · Survived · `throw new ProviderError("invalid_payload", "o provedor devolveu um corpo que não é JSON");` → `""`
- linha 63 · BlockStatement · Survived · `} catch {` → `{}`
- linha 58 · StringLiteral · Survived · `if (!response.ok) throw new ProviderError("client", 'o provedor respondeu ${response.status}', response.status` → `''`
- linha 67 · StringLiteral · Survived · `throw new ProviderError("invalid_payload", "o corpo do provedor não tem a lista data");` → `""`
- linha 66 · ConditionalExpression · Survived · `if (typeof body !== "object" || body === null || !Array.isArray((body as { data?: unknown }).data)) {` → `false`
- linha 71 · StringLiteral · Survived · `throw new ProviderError("invalid_payload", "next_cursor não é texto");` → `""`

**`src/store.ts`**

- linha 182 · EqualityOperator · Survived · `last_fetched_at: posts.reduce<string | null>((latest, p) => (latest === null || p.fetched_at > latest ? p.fetc` → `p.fetched_at >= latest`

**`src/sync.ts`**

- linha 63 · StringLiteral · Survived · `error: 'rate_limited: o provedor pediu para esperar ${decision.retryAfterMs} ms',` → `''`

## revisao-video: 431/507 (85.0%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/app.ts` | 142/198 | 71.7% |
| `src/domain/approval.ts` | 31/31 | 100.0% |
| `src/domain/pieces.ts` | 21/22 | 95.5% |
| `src/domain/versions.ts` | 7/7 | 100.0% |
| `src/store.ts` | 230/249 | 92.4% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/app.ts`**

- linha 38 · ObjectLiteral · NoCoverage · `app.get("/health", (c) => c.json({ ok: true }));` → `{}`
- linha 38 · BooleanLiteral · NoCoverage · `app.get("/health", (c) => c.json({ ok: true }));` → `false`
- linha 14 · LogicalOperator · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `trimmed === "" && trimmed.length > max`
- linha 14 · ConditionalExpression · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `false`
- linha 14 · ConditionalExpression · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `false`
- linha 14 · StringLiteral · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `"Stryker was here!"`
- linha 14 · EqualityOperator · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `trimmed.length >= max`
- linha 35 · ObjectLiteral · Survived · `const unknownPiece = (c: Context) => c.json({ error: "unknown_piece", allowed: PIECE_TYPES }, 404);` → `{}`
- linha 35 · StringLiteral · Survived · `const unknownPiece = (c: Context) => c.json({ error: "unknown_piece", allowed: PIECE_TYPES }, 404);` → `""`
- linha 14 · ConditionalExpression · Survived · `return trimmed === "" || trimmed.length > max ? null : trimmed;` → `false`
- linha 36 · ObjectLiteral · Survived · `const notFound = (c: Context, what: string) => c.json({ error: "not_found", what }, 404);` → `{}`
- linha 36 · StringLiteral · Survived · `const notFound = (c: Context, what: string) => c.json({ error: "not_found", what }, 404);` → `""`
- linha 43 · StringLiteral · Survived · `if (!requiredPieces) return invalid(c, "required_pieces", "required_pieces deve ser uma lista não vazia, sem r` → `""`
- linha 33 · ConditionalExpression · Survived · `return raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;` → `true`
- linha 33 · Regex · Survived · `return raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;` → `/^[1-9]\D*$/`
- linha 49 · StringLiteral · Survived · `return campaign ? c.json(campaign) : notFound(c, "campaign");` → `""`
- linha 41 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 55 · StringLiteral · Survived · `if (!campaignId) return invalid(c, "campaign_id", "campaign_id é obrigatório");` → `""`
- linha 55 · StringLiteral · Survived · `if (!campaignId) return invalid(c, "campaign_id", "campaign_id é obrigatório");` → `""`
- linha 42 · OptionalChaining · Survived · `const requiredPieces = parseRequiredPieces(body?.required_pieces);` → `body.required_pieces`
- linha 53 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 54 · OptionalChaining · Survived · `const campaignId = required(body?.campaign_id, 200);` → `body.campaign_id`
- linha 75 · StringLiteral · Survived · `if (!url) return invalid(c, "url", "url é obrigatória");` → `""`
- linha 75 · StringLiteral · Survived · `if (!url) return invalid(c, "url", "url é obrigatória");` → `""`
- linha 73 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 74 · OptionalChaining · Survived · `const url = required(body?.url, 2000);` → `body.url`
- linha 77 · ConditionalExpression · Survived · `if (duration !== undefined && duration !== null) {` → `true`
- linha 78 · StringLiteral · Survived · `if (type !== "video") return invalid(c, "duration_seconds", "só o vídeo tem duração");` → `""`
- linha 78 · StringLiteral · Survived · `if (type !== "video") return invalid(c, "duration_seconds", "só o vídeo tem duração");` → `""`
- linha 79 · StringLiteral · Survived · `if (!Number.isInteger(duration) || duration <= 0) return invalid(c, "duration_seconds", "duration_seconds deve` → `""`
- linha 79 · StringLiteral · Survived · `if (!Number.isInteger(duration) || duration <= 0) return invalid(c, "duration_seconds", "duration_seconds deve` → `""`
- linha 76 · OptionalChaining · Survived · `const duration = body?.duration_seconds;` → `body.duration_seconds`
- linha 88 · ConditionalExpression · Survived · `if (!type) return unknownPiece(c);` → `false`
- linha 89 · ConditionalExpression · Survived · `if (n === null) return notFound(c, "version");` → `false`
- linha 89 · StringLiteral · Survived · `if (n === null) return notFound(c, "version");` → `""`
- linha 98 · StringLiteral · Survived · `if (n === null) return notFound(c, "version");` → `""`
- linha 103 · StringLiteral · Survived · `if (!text) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");` → `""`
- linha 97 · ConditionalExpression · Survived · `if (!type) return unknownPiece(c);` → `false`
- linha 98 · ConditionalExpression · Survived · `if (n === null) return notFound(c, "version");` → `false`
- linha 103 · StringLiteral · Survived · `if (!text) return invalid(c, "reason", "o motivo do pedido de alteração é obrigatório");` → `""`
- linha 101 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 102 · OptionalChaining · Survived · `const text = required(body?.reason);` → `body.reason`
- linha 116 · StringLiteral · Survived · `if (n === null) return notFound(c, "version");` → `""`
- linha 115 · ConditionalExpression · Survived · `if (!type) return unknownPiece(c);` → `false`
- linha 119 · StringLiteral · Survived · `if (!text) return invalid(c, "text", "text é obrigatório");` → `""`
- linha 119 · StringLiteral · Survived · `if (!text) return invalid(c, "text", "text é obrigatório");` → `""`
- linha 117 · ArrowFunction · Survived · `const body = await c.req.json().catch(() => null);` → `() => undefined`
- linha 116 · ConditionalExpression · Survived · `if (n === null) return notFound(c, "version");` → `false`
- linha 118 · OptionalChaining · Survived · `const text = required(body?.text);` → `body.text`
- linha 120 · OptionalChaining · Survived · `const second = body?.second;` → `body.second`
- linha 121 · ConditionalExpression · Survived · `if (second !== undefined && second !== null && (!Number.isInteger(second) || second < 0)) return invalid(c, "s` → `true`
- linha 121 · StringLiteral · Survived · `if (second !== undefined && second !== null && (!Number.isInteger(second) || second < 0)) return invalid(c, "s` → `""`
- linha 121 · StringLiteral · Survived · `if (second !== undefined && second !== null && (!Number.isInteger(second) || second < 0)) return invalid(c, "s` → `""`
- linha 122 · OptionalChaining · Survived · `const out = addComment(db, { deliveryId: c.req.param("id") as string, piece: type, number: n, second: typeof s` → `body.author`
- linha 38 · StringLiteral · Survived · `app.get("/health", (c) => c.json({ ok: true }));` → `""`
- linha 38 · ArrowFunction · Survived · `app.get("/health", (c) => c.json({ ok: true }));` → `() => undefined`

**`src/domain/pieces.ts`**

- linha 8 · ConditionalExpression · Survived · `export const isPieceType = (value: unknown): value is PieceType => typeof value === "string" && (PIECE_TYPES a` → `true`

**`src/store.ts`**

- linha 190 · StringLiteral · Survived · `logEvent(db, input.deliveryId, "invalidated", input.piece, number, { reason: "new_version_of_required_piece" }` → `""`
- linha 190 · ObjectLiteral · Survived · `logEvent(db, input.deliveryId, "invalidated", input.piece, number, { reason: "new_version_of_required_piece" }` → `{}`
- linha 64 · ArrowFunction · Survived · `const ordered = [...required, ...PIECE_TYPES.filter((type) => !required.includes(type))];` → `() => undefined`
- linha 213 · ConditionalExpression · Survived · `return { ok: true as const, version: versionView(version, version.number === current, commentsCount), delivery` → `false`
- linha 223 · ObjectLiteral · Survived · `if (before === "in_review" && after === "approved") logEvent(db, input.deliveryId, "restored", input.piece, ve` → `{}`
- linha 223 · StringLiteral · Survived · `if (before === "in_review" && after === "approved") logEvent(db, input.deliveryId, "restored", input.piece, ve` → `""`
- linha 234 · ObjectLiteral · Survived · `if (!delivery) return fail("not_found", { what: "delivery" });` → `{}`
- linha 234 · StringLiteral · Survived · `if (!delivery) return fail("not_found", { what: "delivery" });` → `""`
- linha 257 · StringLiteral · Survived · `if (!delivery) return fail("not_found", { what: "delivery" });` → `""`
- linha 259 · StringLiteral · Survived · `if (!version) return fail("not_found", { what: "version" });` → `""`
- linha 223 · ConditionalExpression · Survived · `if (before === "in_review" && after === "approved") logEvent(db, input.deliveryId, "restored", input.piece, ve` → `true`
- linha 280 · StringLiteral · Survived · `if (!findDelivery(db, input.deliveryId)) return fail("not_found", { what: "delivery" });` → `""`
- linha 285 · ObjectLiteral · Survived · `if (input.second === null) return fail("validation_error", { field: "second", message: "o comentário do vídeo ` → `{}`
- linha 285 · StringLiteral · Survived · `if (input.second === null) return fail("validation_error", { field: "second", message: "o comentário do vídeo ` → `""`
- linha 285 · StringLiteral · Survived · `if (input.second === null) return fail("validation_error", { field: "second", message: "o comentário do vídeo ` → `""`
- linha 287 · ObjectLiteral · Survived · `return fail("validation_error", { field: "second", message: 'o vídeo tem ${version.duration_seconds} s: o segu` → `{}`
- linha 287 · StringLiteral · Survived · `return fail("validation_error", { field: "second", message: 'o vídeo tem ${version.duration_seconds} s: o segu` → `""`
- linha 287 · StringLiteral · Survived · `return fail("validation_error", { field: "second", message: 'o vídeo tem ${version.duration_seconds} s: o segu` → `''`
- linha 290 · StringLiteral · Survived · `return fail("validation_error", { field: "second", message: "só o comentário do vídeo é preso a um segundo" })` → `""`

## views-suspeitas: 853/916 (93.1%)

| arquivo | mortos / total | % |
|---|---|---|
| `src/dataset/readme.ts` | 101/102 | 99.0% |
| `src/domain/classify.ts` | 273/282 | 96.8% |
| `src/domain/signals.ts` | 390/443 | 88.0% |
| `src/dataset/evaluate.ts` | 55/55 | 100.0% |
| `src/domain/stats.ts` | 34/34 | 100.0% |

Mutantes vivos (cada um precisa ser avaliado por módulo; não assumo que todos são equivalentes):

**`src/dataset/readme.ts`**

- linha 63 · StringLiteral · Survived · `if (!region) problems.push('faltam os marcadores ${START} e ${END} da tabela de métricas');` → `''`

**`src/domain/classify.ts`**

- linha 26 · ArrayDeclaration · Survived · `const claimed: Array<[number, number]> = [];` → `["Stryker was here"]`
- linha 27 · EqualityOperator · Survived · `const overlaps = (from: number, to: number) => claimed.some(([a, b]) => from <= b && to >= a);` → `from < b`
- linha 27 · EqualityOperator · Survived · `const overlaps = (from: number, to: number) => claimed.some(([a, b]) => from <= b && to >= a);` → `to > a`
- linha 51 · ConditionalExpression · Survived · `add(peakFinding(peak, baseline), peak.kind !== "organic_decay");` → `false`
- linha 82 · EqualityOperator · Survived · `for (let h = 1; h < series.length; h += 1) if (series[h]! > series[hour]!) hour = h;` → `h <= series.length`
- linha 102 · EqualityOperator · Survived · `const step = '${found.step! > 0 ? "+" : "-"}${fmt(Math.abs(found.step!))}';` → `found.step! >= 0`
- linha 112 · EqualityOperator · Survived · `const suspicious = plateau.regularity < T.plateau_regularity_suspicious;` → `plateau.regularity <= T.plateau_regularity_suspici`
- linha 114 · ArithmeticOperator · Survived · `const std = stdDev(series.slice(plateau.from, plateau.to + 1));` → `plateau.to - 1`
- linha 150 · StringLiteral · Survived · `signal: { name: "organic_decay", effect: "organic", measured: peak.tail, threshold: T.organic_min_tail_hours, ` → `''`

**`src/domain/signals.ts`**

- linha 34 · EqualityOperator · Survived · `for (let i = 0; i < n; ) {` → `i <= n`
- linha 36 · EqualityOperator · Survived · `while (j + 1 < n && series[j + 1] === series[i]) j += 1;` → `j + 1 <= n`
- linha 36 · ConditionalExpression · Survived · `while (j + 1 < n && series[j + 1] === series[i]) j += 1;` → `true`
- linha 36 · ArithmeticOperator · Survived · `while (j + 1 < n && series[j + 1] === series[i]) j += 1;` → `j - 1`
- linha 42 · EqualityOperator · Survived · `for (let i = 0; i + 1 < n; ) {` → `i + 1 <= n`
- linha 42 · ArithmeticOperator · Survived · `for (let i = 0; i + 1 < n; ) {` → `i - 1`
- linha 45 · ConditionalExpression · Survived · `while (j + 1 < n && series[j + 1]! - series[j]! === step) j += 1;` → `true`
- linha 45 · EqualityOperator · Survived · `while (j + 1 < n && series[j + 1]! - series[j]! === step) j += 1;` → `j + 1 <= n`
- linha 45 · ArithmeticOperator · Survived · `while (j + 1 < n && series[j + 1]! - series[j]! === step) j += 1;` → `j - 1`
- linha 46 · ConditionalExpression · Survived · `if (step !== 0 && j - i + 1 >= T.progression_min_run && series.slice(i, j + 1).every((v) => v >= min)) take({ ` → `true`
- linha 46 · MethodExpression · Survived · `if (step !== 0 && j - i + 1 >= T.progression_min_run && series.slice(i, j + 1).every((v) => v >= min)) take({ ` → `series`
- linha 47 · ConditionalExpression · Survived · `i = step === 0 ? j + 1 : j;` → `false`
- linha 47 · EqualityOperator · Survived · `i = step === 0 ? j + 1 : j;` → `step !== 0`
- linha 52 · EqualityOperator · Survived · `for (let i = p; i < n; ) {` → `i <= n`
- linha 58 · ConditionalExpression · Survived · `while (j + 1 < n && series[j + 1] === series[j + 1 - p]) j += 1;` → `true`
- linha 58 · EqualityOperator · Survived · `while (j + 1 < n && series[j + 1] === series[j + 1 - p]) j += 1;` → `j + 1 <= n`
- linha 58 · ArithmeticOperator · Survived · `while (j + 1 < n && series[j + 1] === series[j + 1 - p]) j += 1;` → `j - 1`
- linha 62 · ConditionalExpression · Survived · `if (repeats >= T.cycle_min_repeats && window.every((v) => v >= min) && new Set(window).size > 1) take({ kind: ` → `true`
- linha 62 · EqualityOperator · Survived · `if (repeats >= T.cycle_min_repeats && window.every((v) => v >= min) && new Set(window).size > 1) take({ kind: ` → `new Set(window).size >= 1`
- linha 82 · EqualityOperator · Survived · `for (let i = 0; i < n; i += 1) {` → `i <= n`
- linha 87 · EqualityOperator · Survived · `for (let j = i + 1; j < n; j += 1) {` → `j <= n`
- linha 96 · EqualityOperator · Survived · `if (lastGood < 0) continue;` → `lastGood <= 0`
- linha 100 · EqualityOperator · Survived · `if (next === undefined || next > (1 - T.cliff_drop) * avg) continue; // sem queda seca logo depois` → `next >= (1 - T.cliff_drop) * avg`
- linha 123 · ArithmeticOperator · Survived · `const order = series.map((_, h) => h).sort((a, b) => series[b]! - series[a]! || a - b);` → `a + b`
- linha 133 · ConditionalExpression · Survived · `while (from > 0 && !claimed.has(from - 1) && series[from - 1]! > tailThreshold) from -= 1;` → `true`
- linha 133 · EqualityOperator · Survived · `while (from > 0 && !claimed.has(from - 1) && series[from - 1]! > tailThreshold) from -= 1;` → `from >= 0`
- linha 133 · ArithmeticOperator · Survived · `while (from > 0 && !claimed.has(from - 1) && series[from - 1]! > tailThreshold) from -= 1;` → `from + 1`
- linha 134 · ConditionalExpression · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `true`
- linha 134 · LogicalOperator · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `to + 1 < series.length || !claimed.has(to + 1)`
- linha 134 · ConditionalExpression · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `true`
- linha 134 · EqualityOperator · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `to + 1 <= series.length`
- linha 134 · ArithmeticOperator · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `to - 1`
- linha 134 · ArithmeticOperator · Survived · `while (to + 1 < series.length && !claimed.has(to + 1) && series[to + 1]! > tailThreshold) to += 1;` → `to - 1`
- linha 139 · ConditionalExpression · Survived · `const abruptEnd = next !== undefined && next <= (1 - T.drop_fraction) * series[to]!;` → `true`
- linha 139 · EqualityOperator · Survived · `const abruptEnd = next !== undefined && next <= (1 - T.drop_fraction) * series[to]!;` → `next < (1 - T.drop_fraction) * series[to]!`
- linha 144 · ConditionalExpression · Survived · `} else if (value >= T.organic_min_lift * baseline && to - hour >= T.organic_min_tail_hours && isGradual(series` → `true`
- linha 144 · ArithmeticOperator · Survived · `} else if (value >= T.organic_min_lift * baseline && to - hour >= T.organic_min_tail_hours && isGradual(series` → `T.organic_min_lift / baseline`
- linha 158 · EqualityOperator · Survived · `if (series[h]! <= (1 - T.drop_fraction) * series[h - 1]!) return false;` → `series[h]! < (1 - T.drop_fraction) * series[h - 1]`
- linha 171 · ArithmeticOperator · Survived · `for (let s = w; s <= n - w; s += 1) {` → `n + w`
- linha 177 · EqualityOperator · Survived · `for (let h = s - w; h <= s + w; h += 1) {` → `h < s + w`
- linha 178 · EqualityOperator · Survived · `if (h < 3 || h + 6 > n) continue;` → `h <= 3`
- linha 178 · EqualityOperator · Survived · `if (h < 3 || h + 6 > n) continue;` → `h + 6 >= n`
- linha 178 · ArithmeticOperator · Survived · `if (h < 3 || h + 6 > n) continue;` → `h - 6`
- linha 179 · ConditionalExpression · Survived · `if (series[h - 1]! >= mid || !series.slice(h, h + 6).every((v) => v >= mid)) continue;` → `false`
- linha 179 · EqualityOperator · Survived · `if (series[h - 1]! >= mid || !series.slice(h, h + 6).every((v) => v >= mid)) continue;` → `series[h - 1]! > mid`
- linha 179 · EqualityOperator · Survived · `if (series[h - 1]! >= mid || !series.slice(h, h + 6).every((v) => v >= mid)) continue;` → `v > mid`
- linha 180 · ConditionalExpression · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `false`
- linha 180 · LogicalOperator · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `series[h - 3]! > mid && series[h + 2]! < 0.8 * aft`
- linha 180 · EqualityOperator · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `series[h - 3]! >= mid`
- linha 180 · ConditionalExpression · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `false`
- linha 180 · ConditionalExpression · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `false`
- linha 180 · EqualityOperator · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `series[h + 2]! <= 0.8 * after`
- linha 180 · ArithmeticOperator · Survived · `if (series[h - 3]! > mid || series[h + 2]! < 0.8 * after) continue; // a subida tem de ser rápida` → `0.8 / after`
