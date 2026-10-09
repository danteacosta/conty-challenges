# Origem do cadastro no app

Contrato de atribuição de origem: o que viaja no link, o que o app grava no primeiro open, como o cadastro consome isso e como auditar por que aquele cadastro recebeu aquela origem.

```bash
npm install
npm test            # 45 testes: regra, API, propriedades, concorrência, e2e HTTP
npm run typecheck
npm run mutation    # Stryker em decide-origin, link e store (relatório em reports/)
npm start           # http://127.0.0.1:3011 (DB_PATH=arquivo.db para persistir)
```

Node 22+ (usa `node:sqlite`).

## O contrato

**1. No link** (tudo na própria URL, então não depende de referrer; serve para webview):

| Parâmetro | Significado |
|---|---|
| `src` | `campaign` ou `referral` |
| `ref` | id da campanha, ou id do usuário que convidou |
| `cid` | id do clique, gerado pelo redirecionador a cada clique |

```
Campanha:   https://conty.app/l?src=campaign&ref=verao-2026&cid=clk_01
Indicação:  https://conty.app/l?src=referral&ref=usr_ana&cid=clk_02
```

`buildCampaignLink`, `buildReferralLink` e `parseLink` estão em [`src/link.ts`](src/link.ts).

**2. No primeiro open, o app grava e envia**

- `POST /installs {install_id, opened_at}`: o primeiro registro vence e nunca é movido (reenvio devolve `duplicate` com o `first_open_at` original). É daqui que a janela é medida.
- `POST /touches {install_id, src, ref, cid, touched_at}`: um toque por vez em que um link chegou ao app. Todo envio é guardado (log append-only), inclusive repetidos; a deduplicação é regra de decisão e aparece na auditoria.

**3. No cadastro**

- `POST /signups {user_id, install_id, signed_up_at}`: decide a origem, grava e devolve a resposta de auditoria. Idempotente por `user_id`: repetir devolve a decisão original (200, `duplicate`).
- `GET /signups/:user_id/origin`: a mesma resposta, mais os toques que chegaram depois do cadastro.

## A regra (um lugar só: [`src/decide-origin.ts`](src/decide-origin.ts))

**Janela de validade: 7 dias a partir do primeiro open**, com as duas pontas incluídas: `first_open_at ≤ toque ≤ first_open_at + 7d`. A janela é devolvida em toda resposta (`window`).

Um toque só concorre se: não é repetição de clique, não é anterior ao primeiro open, **não é estritamente posterior ao cadastro**, está dentro da janela e não é uma auto-indicação (`ref` igual ao próprio usuário).

**Entre os que concorrem, vence o mais recente** (último toque: é a intenção mais próxima do cadastro).

**Empate de horário**, nesta ordem:
1. indicação vence campanha (vem de uma pessoa, é um sinal mais forte que um anúncio);
2. menor `cid`;
3. menor id de entrega.

O resultado não depende da ordem em que os toques chegaram.

**Clique repetido**: o mesmo `cid` conta uma vez só. O primeiro (menor horário, depois menor id de entrega) vale; os outros viram `duplicate_click`.

**Sem origem válida, o cadastro é orgânico com motivo**, nunca um campo vazio: `no_install` (app sem primeiro open conhecido), `no_touches` (nenhum link) ou `all_touches_rejected` (havia links, nenhum valeu).

**A origem é congelada no cadastro.** Toque que chega depois da decisão não a muda; aparece na auditoria como `received_after_signup`.

## Auditoria: a resposta do cadastro

```json
{
  "result": "created",
  "user_id": "usr_9",
  "origin": { "type": "referral", "ref": "usr_ana", "touch_id": "3", "reason": "latest_valid_touch" },
  "window": { "starts_at": "2026-06-01T12:00:00.000Z", "ends_at": "2026-06-08T12:00:00.000Z", "days": 7 },
  "considered": [
    { "touch_id": "1", "cid": "clk_1", "src": "campaign", "ref": "verao-2026", "touched_at": "2026-06-01T12:00:01.000Z", "verdict": "lost",     "reason": "superseded_by_later_touch" },
    { "touch_id": "2", "cid": "clk_1", "src": "campaign", "ref": "verao-2026", "touched_at": "2026-06-01T12:00:01.000Z", "verdict": "rejected", "reason": "duplicate_click" },
    { "touch_id": "3", "cid": "clk_2", "src": "referral", "ref": "usr_ana",    "touched_at": "2026-06-02T09:00:00.000Z", "verdict": "winner",   "reason": "latest_valid_touch" }
  ]
}
```

| `verdict` | `reason` |
|---|---|
| `winner` | `latest_valid_touch`, `won_tiebreak_referral_priority`, `won_tiebreak_cid_order` |
| `lost` | `superseded_by_later_touch`, `lost_tiebreak_referral_priority`, `lost_tiebreak_cid_order` |
| `rejected` | `duplicate_click`, `before_first_open`, `after_signup`, `outside_window`, `self_referral`, `no_install`, `received_after_signup` |

## Concorrência

Primeiro open e cadastro são idempotentes por `PRIMARY KEY` + `ON CONFLICT DO NOTHING`, e o cadastro roda em `BEGIN IMMEDIATE` (decisão e gravação na mesma transação). [`test/concurrency.test.ts`](test/concurrency.test.ts) sobe 4 `worker_threads`, cada um com sua conexão ao mesmo arquivo, disparando primeiro open, toque e cadastro do mesmo usuário: sai um cadastro, um primeiro open e uma origem.

## Testes

- Regra pura ([`decide-origin.test.ts`](test/decide-origin.test.ts)): dois links, empate de horário (inclusive com a ordem de chegada contrária à de desempate), bordas da janela (exatamente no início, no fim, ±1 ms), toque depois do cadastro, clique repetido, auto-indicação, orgânico com cada motivo, e propriedades (a decisão não depende da ordem de entrada; no máximo um vencedor, sempre dentro da janela e antes do cadastro).
- API ([`api.test.ts`](test/api.test.ts)) e jornada por HTTP real em porta efêmera ([`e2e.test.ts`](test/e2e.test.ts)).
- Mutação: ~99% em `decide-origin`, `link` e `store`. Os 2 sobreviventes são equivalentes (em `compareCandidates`, `cid` iguais nunca chegam ao comparador porque o clique repetido já foi eliminado).

## Decisões que são minhas (o enunciado não fixa)

- **Janela de 7 dias** e **último toque vence**: escolhas de produto, fáceis de trocar (`ATTRIBUTION_WINDOW_DAYS` e `compareCandidates`).
- Toque exatamente no instante do cadastro conta; só o estritamente posterior fica de fora.
- A origem é congelada no cadastro, em vez de recalculada a cada consulta.

## Fora de escopo

- Autenticação das rotas e assinatura dos links (um `cid` forjado seria aceito).
- Vários usuários no mesmo `install_id` (aqui cada um recebe a mesma decisão).
- Geração do `cid` e o redirecionador em si; aqui só o contrato e a leitura do link.
- Toques com horário no futuro em relação ao servidor (confia-se no `touched_at` do app).

## Uso de IA

Este projeto foi escrito com o Claude Code (Claude Sonnet 5.5), seguindo plano aprovado por mim: o modelo propôs o contrato, escreveu os testes antes do código, a implementação, o README e rodou a mutação (que apontou testes fracos nos desempates, corrigidos).

**Eu (Dante) preciso confirmar antes de enviar** *(marque o que de fato revisou)*:

- [ ] Concordo com a janela de 7 dias e com "último toque vence" (ou ajustei).
- [ ] Concordo com "indicação vence campanha" no empate de horário.
- [ ] Li `src/decide-origin.ts` e `src/store.ts`.
- [ ] Rodei `npm test` e `npm run mutation` localmente.
