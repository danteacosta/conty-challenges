# Conty: desafios técnicos

| Desafio | Pasta | Resumo |
|---|---|---|
| Vendas atribuídas ao criador | [`vendas-shopify/`](vendas-shopify/) | Webhook de pedido, atribuição a um criador (cupom vence UTM), idempotência e estornos parciais, repetidos e antes do pedido. |
| Origem do cadastro no app | [`origem-cadastros/`](origem-cadastros/) | Contrato de link, primeiro open, janela de 7 dias, qual toque vence e auditoria por cadastro. |
| Rastreio do produto enviado | [`rastreio-envio/`](rastreio-envio/) | Agregador de rastreio atrás de uma interface, 5 status normalizados, eventos fora de ordem e repetidos sem regredir, aviso de atraso sem marcar entrega normal. |
| Repasses que não fecham (debug) | [PR no fork](https://github.com/danteacosta/conty-challenge-debug/pull/1) | Quatro causas pequenas (prazo em UTC, divisão dupla, chave de idempotência suja com U+200B, `PENDING` como pago), corrigidas no arquivo de cada regra. |
| Otimização da listagem | [PR no fork](https://github.com/danteacosta/conty-challenge-optimize/pull/1) | 3.943 queries e p95 ≈ 557 ms viram 3 queries e p95 ≈ 12 ms, com a resposta idêntica. |

Quem avalia: comece por [`NOTAS-PARA-AVALIACAO.md`](NOTAS-PARA-AVALIACAO.md). Cada pasta tem README próprio, com a nota de uso de IA.

Cada projeto roda isolado (`npm install && npm test` dentro da pasta). Node 22.13+ (verificado em 22.15 e 24.7).
