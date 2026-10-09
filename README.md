# Conty: desafios técnicos

| Desafio | Pasta | Resumo |
|---|---|---|
| Vendas atribuídas ao criador | [`vendas-shopify/`](vendas-shopify/) | Webhook de pedido, atribuição a um criador (cupom vence UTM), idempotência e estornos parciais, repetidos e antes do pedido. |
| Origem do cadastro no app | [`origem-cadastros/`](origem-cadastros/) | Contrato de link, primeiro open, janela de 7 dias, qual toque vence e auditoria por cadastro. |
| Rastreio do produto enviado | [`rastreio-envio/`](rastreio-envio/) | Agregador de rastreio atrás de uma interface, 5 status normalizados, eventos fora de ordem e repetidos sem regredir, aviso de atraso sem marcar entrega normal. |
| Repasses que não fecham (debug) | [PR no fork](https://github.com/danteacosta/conty-challenge-debug/pull/1) | Quatro causas pequenas (prazo em UTC, divisão dupla, chave de idempotência suja com U+200B, `PENDING` como pago), corrigidas no arquivo de cada regra, e um crédito por missão com a chave isolada por missão e a gravação atômica. |
| Revisão de roteiro | [`revisao-roteiro/`](revisao-roteiro/) | Roteiro em versões com estado explícito, pedido de alteração só com motivo e prazo (dia em America/Sao_Paulo, último instante vale), aprovação terminal, versões antigas preservadas. |
| Métricas das redes do criador | [`metricas-redes/`](metricas-redes/) | Sync de Instagram, TikTok, YouTube e X atrás de uma interface, janelas sobrepostas sem contar o mesmo post duas vezes, retry com teto, `Retry-After` respeitado com teto de espera. |
| Revisão de vídeo | [`revisao-video/`](revisao-video/) | Versões de vídeo com comentários presos a um segundo, peças exigidas como dado da campanha, entrega aprovada só com todas as peças aprovadas e que se desfaz com versão nova. |
| Views que não parecem humanas | [`views-suspeitas/`](views-suspeitas/) | Classificador explicável de série de views por hora (orgânico, suspeito ou inconclusivo), dataset sintético reproduzível e taxa de falso positivo gerada por comando e conferida por teste contra o README. |
| Otimização da listagem | [PR no fork](https://github.com/danteacosta/conty-challenge-optimize/pull/1) | 3.943 queries e p95 ≈ 557 ms viram 3 queries e p95 de ≈ 6 a 11 ms, com a resposta idêntica (inclusive para ids Unicode). |

Para reproduzir os números (suítes em Node 22 e 24, mutação): [`verificacao/`](verificacao/README.md). Quem avalia: comece por [`NOTAS-PARA-AVALIACAO.md`](NOTAS-PARA-AVALIACAO.md). Cada pasta tem README próprio, com a nota de uso de IA.

Cada projeto roda isolado (`npm install && npm test` dentro da pasta). Node 22.13+ (verificado em 22.15 e 24.7).
