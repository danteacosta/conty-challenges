# Rastreio do produto enviado ao criador

Integra com um agregador de rastreio (fictício, "TrackHub"), traduz o dialeto de cada transportadora para 5 status estáveis e avisa quando um envio passa do tempo limite. O agregador pode repetir eventos e entregá-los fora de ordem; isso não duplica histórico nem faz o status voltar.

```bash
npm install
npm test            # 257 testes: normalização, status, atraso, aviso, API, cliente HTTP, configuração, datas, reinício, concorrência, migração, e2e
npm run typecheck
npm run mutation    # Stryker nas regras (relatório em reports/)
npm start           # http://127.0.0.1:3012
```

Variáveis do `npm start`: `TRACKHUB_URL`, `TRACKHUB_API_KEY`, `TRACKHUB_TIMEOUT_MS` (5000), `TRANSIT_THRESHOLD_HOURS` (168), `DB_PATH`, `PORT`. Node 22.13+ (a partir daí `node:sqlite` não precisa de flag). Suíte completa verificada em 22.15.0 e 24.7.0.

Em Node 22 os workers dos testes de concorrência são `.ts`, que só carregam com `--experimental-strip-types`; `test/spawn-worker.ts` passa a flag ao `Worker` (no 24 ela já é o padrão), então `npm test` e `npx vitest` direto funcionam nas duas versões.

## API

| Rota | O que faz |
|---|---|
| `POST /shipments` `{tracking_code, carrier, creator_id?, campaign_id?}` | Cadastra o código no agregador e guarda o envio. Idempotente (200 `exists`); transportadora diferente para o mesmo código é 409; transportadora sem dialeto é 400 com a lista das suportadas. |
| `POST /shipments/:code/refresh` | Consulta o agregador, normaliza e grava só o que é novo. Devolve `{added, duplicates, status}`. Agregador fora do ar: 502 e o estado gravado fica como estava. |
| `GET /shipments/:code` | Status, histórico (do mais antigo ao mais novo) e a avaliação de atraso. |
| `POST /jobs/check-delays` | Avalia os envios não entregues e avisa dos atrasados, uma vez só por envio. Antes de enviar, reavalia cada aviso pendente: o que ficou obsoleto é descartado. Devolve `{newly_alerted, notified, discarded}`. Pensado para rodar em cron. |
| `GET /alerts` | Avisos e o estado de cada um: `pending`, `notified` ou `discarded` (com `discard_reason`: `delivered` ou `within_threshold`). |

## Status normalizado

`posted` · `in_transit` · `out_for_delivery` · `delivered` · `exception`. Antes do primeiro evento o envio está sem status (`null`, `reason: no_events_yet`).

### Exemplo: payload bruto do agregador → status normalizado

O agregador (TrackHub) devolve, para `GET /v1/trackings/BR123456789`:

```json
{
  "tracking_number": "BR123456789",
  "courier": "via-rapida",
  "checkpoints": [
    { "id": "chk_9f2", "status_code": "20", "message": "Objeto em trânsito para o centro de distribuição", "time": "2026-06-02T08:15:00-03:00", "city": "Recife" },
    { "id": "chk_9f1", "status_code": "10", "message": "Objeto postado", "time": "2026-06-01T16:40:00-03:00", "city": "São Paulo" },
    { "id": "chk_9f3", "status_code": "SEPARADO_NA_BANCADA", "message": "Em separação", "time": "2026-06-03T09:00:00-03:00", "city": null }
  ]
}
```

O `status_code` está no dialeto da transportadora (`via-rapida`). Depois de normalizado, `GET /shipments/BR123456789` mostra:

```json
{
  "status": "exception",
  "reason": "unmapped_carrier_status",
  "started_at": "2026-06-01T19:40:00.000Z",
  "history": [
    { "status": "posted",     "raw_status": "10",  "occurred_at": "2026-06-01T19:40:00.000Z", "reason": null, "ignored": null },
    { "status": "in_transit", "raw_status": "20",  "occurred_at": "2026-06-02T11:15:00.000Z", "reason": null, "ignored": null },
    { "status": "exception",  "raw_status": "SEPARADO_NA_BANCADA", "occurred_at": "2026-06-03T12:00:00.000Z", "reason": "unmapped_carrier_status", "ignored": null }
  ]
}
```

(`description` e `location` também vêm no histórico; omitidos aqui por brevidade.) Esse exemplo é um teste ([`trackhub.test.ts`](test/trackhub.test.ts)), então a documentação não envelhece.

## Regras

**Tradução** ([`src/domain/dialects.ts`](src/domain/dialects.ts), [`normalize.ts`](src/domain/normalize.ts)). Cada transportadora tem uma tabela código bruto → status. Transportadora nova é uma tabela nova. **Código que não está na tabela (ou transportadora desconhecida) nunca vira `delivered`**: vira `exception`, com `reason` (`unmapped_carrier_status` / `unknown_carrier`) e o código bruto preservado no histórico. Prefiro isso a ignorar: um status inventado pode ser "aguardando retirada" e alguém precisa olhar.

**Status atual** ([`status.ts`](src/domain/status.ts)). É calculado sempre do histórico inteiro, não atualizado aos poucos, então a ordem de chegada não importa:
- vale o evento de maior data de ocorrência (não o de chegada): evento antigo que chega depois não regride nada;
- empate de horário: `delivered` > `exception` > `out_for_delivery` > `in_transit` > `posted`;
- empate também no status (duas `exception` no mesmo instante, como `90` e um `INVENTADO`): vence o evento **com motivo**, ou seja, a desconhecida, para a anomalia continuar visível; por fim a `dedupeKey`. A ordem é total, então `status`, `reason` e histórico nunca dependem da ordem de chegada;
- `delivered` é terminal: evento posterior à entrega fica no histórico com `ignored: "after_delivered"` e não muda o status;
- uma `exception` seguida de evento mais novo se recupera (tentativa falha hoje, entrega amanhã). Por isso não uso "maior status vence".

**Sem duplicar** ([`store.ts`](src/store.ts)). A mesma ocorrência = `transportadora | código bruto | instante` (sem depender do id do evento do agregador, que pode mudar entre consultas). `UNIQUE` + `ON CONFLICT DO NOTHING` em `BEGIN IMMEDIATE`; o status é recalculado do histórico na mesma transação. Reconsultar devolve `added: 0, duplicates: N`.

## Como o atraso é detectado sem marcar entrega normal como atraso

[`src/domain/delay.ts`](src/domain/delay.ts). Um envio está atrasado quando **não foi entregue** e `agora − primeiro evento > limite` (estritamente maior: no limite exato ainda está no prazo). O primeiro evento é a postagem; se ainda não há evento, conta-se do cadastro (código que nunca foi postado também é problema).

O erro clássico é comparar "agora" com o início mesmo para pacotes já entregues, o que marca como atrasada, semanas depois, uma entrega que chegou em 2 dias. Aqui:
- `delivered` nunca está atrasado, não importa quando a verificação rode;
- entrega que levou mais que o limite aparece só como informação (`delay.delivered_late: true`), sem aviso;
- `exception` parada passa a contar como atraso quando ultrapassa o limite;
- o relógio é injetado, e os testes usam data controlada ([`delay.test.ts`](test/delay.test.ts), [`delays.test.ts`](test/delays.test.ts)): limite exato, 1 ms depois, entrega consultada 30 dias depois, exceção parada.

**Aviso obsoleto não é enviado.** Um aviso pode ficar pendente (o destino estava fora do ar) e o mundo mudar antes do reenvio, por exemplo chegando fora de ordem uma entrega que ocorreu dentro do prazo. Ao reservar, o job reavalia cada aviso pendente contra o estado **atual** do envio, na mesma transação: se já não está atrasado (entregue, ou o limite mudou), o aviso vira `discarded` e nunca sai; se continua atrasado, sai com os dados atuais (status e horas decorridas de agora, não de quando foi criado). Se um envio descartado voltar a atrasar, o mesmo aviso é reativado, sem duplicar. Entre a reserva e o envio ainda existe uma janela curta; a garantia é "pelo menos uma vez, e nunca um aviso já sabidamente obsoleto".

**Aviso uma vez só.** `alerts` tem `UNIQUE(tracking_code, kind)`. O job registra, reserva (`claimed_at`) e só então entrega ao `Notifier`; se o destino falha, a reserva é desfeita e o aviso sai na próxima execução. Entrega é pelo menos uma vez e nunca duplicada em execuções normais; se o processo morrer entre a reserva e o envio, o aviso fica reservado (limitação declarada).

## Trocar o agregador

O resto do código só conhece a interface [`TrackingAggregator`](src/aggregator/port.ts) (`register`, `fetchEvents(code, carrier)`) e os `CarrierEvent` internos. O formato do TrackHub vive só em [`src/aggregator/trackhub/`](src/aggregator/trackhub/) (`client.ts` com timeout e erros tipados `http | timeout | network | invalid_payload`, e `mapper.ts`). Um segundo agregador é outra classe que implementa a interface; o teste e2e roda o mesmo fluxo com o cliente HTTP real e com um agregador em memória.

## Recadastro com outro vínculo e cadastros simultâneos

- **Outro vínculo explícito é conflito.** Mesmo código e transportadora com `creator_id` ou `campaign_id` diferente do guardado é **409 `link_conflict`** (com `conflicts: [{ field, stored, provided }]`), e o cadastro original fica como está. Campo omitido não é atualização: recadastrar sem vínculo é 200 `exists`. Informar um vínculo onde o cadastro original não tinha nenhum também é 409 (não há atualização silenciosa por recadastro). A regra vale no caminho rápido e dentro da transação; um conflito já conhecido **não chama o agregador**.
- **Uma chamada externa por código e transportadora.** Dez requisições iguais e simultâneas compartilham uma única chamada ao agregador dentro da instância (um mapa de operações pendentes por `código + transportadora`, limpo ao terminar, com sucesso ou falha). Uma falha chega a todas as que esperavam e a próxima requisição tenta de novo. A transação do banco continua curta e fora da rede; **não há coordenação entre processos**.

## Identidade do envelope

O adapter confere, antes de mapear, que a resposta é do envio pedido: `tracking_number` igual ao código consultado e `courier` igual à transportadora cadastrada (sem diferenciar caixa nem espaços). Ausente, de outro tipo ou diferente é `invalid_payload`: a API responde 502 e o envio consultado **não** é alterado. Sem isso, um envelope de outro código ou de uma transportadora desconhecida seria lido com o dialeto do envio consultado (um `40` qualquer viraria entrega). Só o adapter conhece esses campos; a interface recebe a transportadora esperada justamente para poder conferir.

## Configuração validada na subida

`src/config.ts` lê e valida o ambiente. Valor inválido derruba a inicialização com **todos** os problemas numa mensagem, em vez de virar `NaN` e fazer o serviço rodar sem nunca avisar de atraso:

| Variável | Padrão | Aceita |
|---|---|---|
| `PORT` | 3012 | inteiro de 1 a 65535 |
| `TRANSIT_THRESHOLD_HOURS` | 168 | número decimal maior que 0 e até 8760 (um ano); recusa `abc`, `0`, `-1`, `Infinity`, `1e999`, `0x10`, `1e2`, `72h` |
| `TRACKHUB_TIMEOUT_MS` | 5000 | inteiro de 100 a 120000 |
| `TRACKHUB_URL` | `http://127.0.0.1:4010` | URL `http` ou `https` |
| `TRACKHUB_API_KEY` | `dev-key` | texto não vazio |
| `DB_PATH` | `:memory:` | caminho não vazio |

`createApp` também recusa um `thresholdHours` inválido, mesmo que ele não venha do ambiente.

## Datas estritas na fronteira do agregador

`parseInstant` ([`src/instant.ts`](src/instant.ts)) é o único jeito de ler a data de um checkpoint: ISO-8601 **com fuso** (`Z` ou `±HH:MM`), de uma data que existe. `Date.parse` aceitava `2026-02-30` e o corrigia para março em silêncio, e lia `2026-06-01T12:00:00` (sem fuso) no fuso do servidor, o que dava instantes diferentes em máquinas diferentes. Agora ambos são `invalid_payload`. **Um lote com um checkpoint inválido é recusado inteiro**: a API responde 502 e o histórico que já existia fica intacto (nenhum evento é aproveitado pela metade).

Falha ao **ler** o corpo da resposta (conexão que cai, tempo que acaba no meio) é `network`/`timeout`, que vale tentar de novo; só um corpo que chegou inteiro e não é JSON é `invalid_payload`.

## Persistência e reinício

Com `DB_PATH` apontando para um arquivo, envios, histórico, status e avisos (inclusive o pendente porque o destino estava fora do ar) sobrevivem a reiniciar o processo, e reconsultar depois do reinício não duplica o histórico (`test/restart.test.ts`). **O padrão é SQLite em memória, por escolha explícita**: sem `DB_PATH`, um processo novo começa vazio.

## Testes

- Normalização, status e atraso como regras puras, com propriedades (fast-check): qualquer ordem de chegada dá o mesmo status; reenviar eventos não muda nada; só existe `delivered` se houve um evento de entrega mapeado.
- API: cadastro, reconsulta sem duplicar, fora de ordem, status inventado, falha do agregador, aviso de atraso (limite exato, entrega normal, execução repetida, destino que falha).
- Cliente HTTP contra um servidor TrackHub falso real (porta efêmera): chave de API, 404, 500, JSON malformado, timeout, rede fora do ar.
- Jornada e2e por HTTP.
- Mutação (Stryker): 96,3% (522 de 542; relatório em [`verificacao/mutacao`](../verificacao/mutacao/RESUMO.md)): `mapper` 100%, `delay` e `dialects` 100%, `config` 97,9%, `instant` 98,3%, `store` 100%, `normalize` 94,7%, `alerts` 90,7%, `status` 83,3%. Os vivos de `status.ts` são a `dedupeKey` como último critério do desempate (dentro de um mesmo envio todos os eventos têm a mesma transportadora, então o motivo depende só de haver ou não motivo, e esse critério final não altera nenhum resultado observável). Em `alerts.ts` o Stryker mantém vivos mutantes que, aplicados à mão, derrubam os testes (descarte nunca acontecendo, motivo de descarte fixo): registro a divergência em vez de esconder. Os demais são texto de mensagem, `ConsoleNotifier` (log) e os 2 equivalentes de `instant.ts` (o ramo do fuso `Z`). Um mutante de `index.ts` (sem `process.exit(1)`) é equivalente: o processo cai logo depois no `TypeError`, com a mesma mensagem e o código 1.
- Concorrência: 4 workers com conexões separadas ao mesmo arquivo (a ingestão repetida de eventos e a verificação de atrasos **sem barreira de largada**: eles competem, mas não partem no mesmo instante); cada evento entra uma vez e cada aviso é entregue exatamente uma vez. Só o teste de migração abaixo usa uma barreira (`SharedArrayBuffer`) para largar as oito conexões juntas. Trocar `BEGIN IMMEDIATE` por `BEGIN` faz os testes de concorrência falharem mesmo sem barreira (verificado à mão).
- Migração: oito conexões abrem juntas um banco com o esquema antigo; a inicialização transacional preserva envio, histórico e aviso pendente, e acrescenta as colunas de descarte uma vez. O teste repete a abertura em oito arquivos independentes.

## Decisões minhas (o enunciado não fixa)

- Status desconhecido vira `exception`, e não é ignorado.
- O atraso conta da postagem (primeiro evento), com um limite único para todas as transportadoras (`TRANSIT_THRESHOLD_HOURS`, padrão 168).
- Vale a data de ocorrência informada pela transportadora; não corrijo fuso nem relógio errado dela.

## Fora de escopo

- Os dialetos (`via-rapida`, `correio-norte`) são fictícios; não há integração com transportadora real.
- Webhooks de push do agregador (aqui a atualização é por consulta); autenticação das rotas; assinatura do agregador.
- Limite por transportadora ou por campanha; reabertura do aviso depois de resolvido.
- Evento com `occurred_at` no futuro em relação ao relógio local não é tratado de forma especial.
- O padrão é SQLite em memória (reiniciar sem `DB_PATH` perde os dados); o arquivo é uma escolha explícita.
- O mesmo `parseInstant` existe copiado em `origem-cadastros` e `metricas-redes`: cada projeto é independente, e não criei um pacote compartilhado só para isso.

## Uso de IA

Este projeto foi escrito com o Claude Code (Claude Sonnet 5.5), seguindo plano aprovado por mim: o modelo propôs o desenho, escreveu os testes antes do código, a implementação, o README e rodou a mutação (que apontou testes fracos nos caminhos do `store`, nas mensagens do mapper e na marcação pós-entrega, todos corrigidos).

**Depois da primeira entrega**, uma auditoria automatizada (feita com o Codex) apontou lacunas; as correções acima foram escritas pelo Claude Code, com regressões antes das correções, e verificadas com a suíte completa em Node 22.15 e 24.7. Isso não substitui a minha revisão: as caixas abaixo continuam desmarcadas até eu ler e rodar.

**Eu (Dante) preciso confirmar antes de enviar** *(marque o que de fato revisou)*:

- [ ] Concordo com "status desconhecido vira exceção" e com a regra de atraso contada da postagem.
- [ ] Li `src/domain/status.ts`, `src/domain/delay.ts` e `src/store.ts`.
- [ ] Conferi que nenhum arquivo fora de `src/aggregator/trackhub/` conhece o formato do TrackHub (só `src/index.ts`, que monta a aplicação, escolhe o cliente).
- [ ] Rodei `npm test` e `npm run mutation` localmente.
