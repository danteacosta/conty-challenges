# Views que não parecem humanas

API que recebe a série de **views por hora** de um vídeo e responde se ela parece orgânica, suspeita ou se **não dá para concluir**, com um motivo em português e os sinais que levaram à conclusão. O classificador é uma lista de regras com limiar escrito e medido, sem modelo opaco: para cada resposta dá para apontar a hora, o número e o limite.

Os números de acerto abaixo são medidos **no meu dataset sintético**, gerado por um comando. Eles não dizem nada sobre tráfego real de nenhuma rede social: dizem como o critério se comporta contra os casos que eu mesmo escrevi, os difíceis inclusos.

```bash
npm install
npm test               # 174 testes: casos óbvios à mão, bordas de cada limiar, API, servidor e comando de verdade, dataset, avaliação e a trava do README
npm run typecheck
npm run mutation       # Stryker (relatório em reports/)

npm run dataset        # gera o dataset, calcula as taxas e reescreve a tabela e os números deste README
npm run dataset:check  # o mesmo, sem escrever: falha se o README ou data/dataset.sha256 estiverem desatualizados
npm start              # API em http://127.0.0.1:3000 (PORT muda a porta)
```

Node 22.13+ (verificado em 22.15 e 24.7).

## Uso

| Rota | O que faz |
|---|---|
| `POST /classify` `{ "series": [ ... ] }` | classifica a série. 400 `validation_error` se tiver menos de 24 ou mais de 1.440 horas (60 dias), ou algum valor que não seja inteiro entre 0 e 1 bilhão. |
| `GET /criteria` | os limiares em uso e a lista do que o classificador **não** detecta. |
| `GET /health` | `{ "ok": true }` |

Série de 168 horas com um patamar de ~6.200 views por hora entre as horas 60 e 77 e queda seca na 78 (resposta real, com a série omitida):

```json
{
  "classification": "suspicious",
  "criteria_version": 1,
  "reason": "Suspeito: 18 horas seguidas (horas 60 a 77) com contagens quase fixas em torno de 6.203 views por hora (desvio de 0,2% entre as horas, só 0,1× os 1,3% que o acaso da contagem sozinho já produz; tráfego real passa de 1,5×) e, logo depois, queda seca de 91% na hora 78. Tráfego real varia mais que isso, e uma compra entregue a ritmo constante e interrompida tem exatamente este formato.",
  "signals": [
    { "name": "plateau_then_cliff", "effect": "suspicious", "measured": 0.144, "threshold": 1.5, "from_hour": 60, "to_hour": 77,
      "detail": "18 horas em ~6.203 views por hora (12,3× a base); regularidade 0,14 contra limiar 1,5 (menor = mais regular que o acaso)" }
  ],
  "summary": { "hours": 168, "baseline_per_hour": 504, "peak": { "hour": 61, "value": 6219 } }
}
```

`classification` é `organic`, `suspicious` ou `inconclusive`. Cada sinal tem `effect`: `suspicious` (conta como acusação), `weak` (só levanta dúvida e leva a `inconclusive`) ou `organic` (evidência a favor).

## O critério

Uma ideia só sustenta todas as regras: **contagem de pessoas tem ruído**. Mesmo sem nenhuma variação de audiência, o número de views numa hora oscila em torno de √média só pelo acaso da contagem. Tráfego real varia *mais* que isso (a audiência muda, a recomendação muda). Um número fixo, uma progressão exata ou uma série mais regular que o ruído de contagem não é gente. E um pico orgânico sobe e desce com cauda, enquanto um pico comprado costuma ser um patamar ou um pulso que acaba de uma vez.

A **base** de uma série é a mediana das horas (aguenta picos e patamares que ocupam menos da metade da série).

| Sinal | Efeito | O que dispara (limiares em [`criteria.ts`](src/domain/criteria.ts)) |
|---|---|---|
| `mechanical_repetition` | suspeito | 7+ horas com o **mesmo valor**, 8+ em **progressão aritmética** exata, ou um **ciclo** exato de 2 a 6 horas repetido 4+ vezes. Só acima de 30 views por hora: zeros e poucas views repetem por acaso. |
| `plateau_then_cliff` | suspeito ou fraco | 6+ horas dentro de ±8% da média, a média 4+ vezes a base, e a hora seguinte cai 70%+. **Regularidade** = desvio entre as horas ÷ √média. Até 1,5: mais regular que gente, suspeito. Acima: pode ser transmissão ao vivo que acabou, então só levanta dúvida. |
| `pulse_without_decay` | suspeito | pico de 15+ vezes a base e 500+ views ocupando no máximo 3 horas acima da cauda, e que acaba de uma vez (a última hora ainda vale 25%+ do pico). Quem decai por níveis intermediários não entra. |
| `abrupt_drop` | fraco | nível alto e irregular por 4+ horas que despenca 70%+ numa hora: pode ser conteúdo cortado pela plataforma. |
| `step_without_return` | fraco | o nível sobe 2,5+ vezes em poucas horas e fica: pode ser incorporação num site grande. |
| `organic_decay` | orgânico | pico de 5+ vezes a base com subida e **cauda de 6+ horas** em que 75%+ dos passos não crescem mais de 30% e nenhum desaba. |
| `low_volume` | fraco | mediana abaixo de 20 views por hora: qualquer padrão pode ser acaso. Só repetição mecânica e pulso enorme ainda são avaliados. |
| `short_series` | fraco | menos de 48 horas: sem base de comparação. Só repetição mecânica evidente é avaliada. |

Sinais correlacionados saem agrupados: o patamar e a queda dele são **um** sinal, e quedas e degraus que caem dentro de um patamar ou de uma repetição já achados não viram sinais extras. A decisão: qualquer sinal `suspicious` → `suspicious`; senão qualquer `weak` → `inconclusive`; senão `organic` (com `organic_decay`, a frase diz que o formato é de pico orgânico; sem nenhum sinal, diz que não achou nada).

### Pico orgânico versus pico comprado

Os dois testes abaixo usam o **mesmo pico de 14.000** e acabam em respostas diferentes, com motivos e sinais diferentes (`test/classify.test.ts`):

- **orgânico**: sobe em 3 horas e desce 12% por hora durante 19 horas → `organic`, sinal `organic_decay`, "cauda de 19 horas de queda gradual".
- **comprado**: patamar de 14.000 por 12 horas quase fixo e queda para a base → `suspicious`, sinal `plateau_then_cliff`.
- **pulso**: 14.000 numa hora só e volta à base → `suspicious`, sinal `pulse_without_decay`, outro motivo.

### O caso em que prefere não acusar

Uma transmissão ao vivo de 8 horas num patamar alto, com variação natural de ±6%, que termina de uma vez. O patamar e a queda seca são os mesmos de uma compra, mas a variação (4,6% entre as horas, 3,3 vezes o ruído de contagem) é de tráfego real:

```json
{
  "classification": "inconclusive",
  "reason": "Inconclusivo: 8 horas (horas 70 a 77) num patamar em torno de 5.195 views por hora, seguido de queda seca de 90% na hora 78. A variação entre as horas (4,6%) é de tráfego real, então isso também é o que uma transmissão ao vivo que terminou ou um destaque que saiu da página inicial produzem; o padrão não é suficiente para acusar.",
  "signals": [ { "name": "plateau_then_cliff", "effect": "weak", "measured": 3.312, "threshold": 1.5, "from_hour": 70, "to_hour": 77 } ]
}
```

O mesmo patamar com ±0,3% de variação é `suspicious`: o que separa os dois é a naturalidade da variação, e o teste mostra os dois lados.

## O que ele NÃO detecta

Isto também sai em `GET /criteria` (campo `not_detected`).

1. **Compra disfarçada**: views entregues com ruído e uma forma que imita o orgânico (subida lenta, descida gradual, variação natural) passam como orgânicas. A família `disguised_buy` do dataset existe para mostrar isso, e o classificador erra todas.
2. **Patamar com variação natural**: um patamar comprado com ruído parecido com o de tráfego real (família `noisy_bought_plateau`) vira inconclusivo, nunca suspeito.
3. **Manipulação que ocupa mais da metade da série**: a base (mediana) já é a manipulada, e os picos e patamares deixam de se destacar.
4. **Volume baixo** (mediana abaixo de 20 views por hora): só se vê repetição mecânica ou um pulso enorme; o resto é inconclusivo.
5. **Compra espalhada** em várias contas ou em muitos dias com pouca intensidade por hora: não há pico, patamar nem repetição.
6. **Dados já suavizados ou arredondados pela plataforma**: o critério supõe contagens exatas por hora, e dados suavizados parecem regulares demais.
7. **A origem do tráfego**: sem geografia, dispositivo ou retenção, um pico comprado que imita o formato orgânico é indistinguível do orgânico.

Também não é "sinal de má-fé": suspeito quer dizer "o padrão é típico de entrega automática", e a resposta diz qual padrão.

## O dataset sintético e a taxa de falso positivo

`npm run dataset` gera o dataset com um gerador pseudoaleatório semeado ([`rng.ts`](src/dataset/rng.ts), [`families.ts`](src/dataset/families.ts), [`generate.ts`](src/dataset/generate.ts)). Nada vem de rede social, de relógio ou de `Math.random`; a distribuição normal sai da soma de 12 uniformes, sem funções transcendentes, para o mesmo resultado em qualquer máquina. O arquivo `data/dataset.json` (~1,6 MB) **não é versionado**: o que fica no repositório é o hash `data/dataset.sha256`, e um teste confere que regenerar dá o mesmo hash.

São **16 famílias**, 11 legítimas e 5 suspeitas, 30 casos de cada em cada uma das duas partes:

- legítimas: `steady_daily`, `weekend_dip`, `slow_growth`, `global_audience`, `organic_viral`, `news_double_spike`, e as difíceis, escritas para tentar enganar o classificador: `premiere` (pico agudo e queda rápida), `live_stream` (patamar de poucas horas com fim seco), `viral_interrupted` (alto e irregular, cortado de uma vez), `embed_step` (degrau permanente), `low_volume`;
- suspeitas: `bought_plateau`, `mechanical_repeat`, `pulse_without_decay`, e as difíceis: `disguised_buy` (imita a forma orgânica) e `noisy_bought_plateau` (patamar com ruído natural).

**Duas partes, para o número não ser autoelogio.** Os limiares foram ajustados olhando só a parte `dev`. O `holdout`, gerado com outra semente, só foi olhado **depois** de os limiares estarem congelados, e é o número a citar. O ajuste que fiz foi um só: o limiar de regularidade do patamar (testei 0,7, 1,0, 1,5 e 2,0 no `dev`; 2,0 já acusava um legítimo, então fiquei com 1,5). No `holdout` apareceu **um** falso positivo que o `dev` não tinha (uma transmissão ao vivo com regularidade 1,45, colada no limiar de 1,5), e **não mexi nos limiares depois de ver isso**.

### Resultado

<!-- metrics:start -->
| Parte | Legítimos | Falsos positivos (FPR) | Abstenções em legítimos | Suspeitos | Acusados (recall) | Suspeitos inconclusivos | Suspeitos tidos como orgânicos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dev (limiares ajustados aqui) | 330 | 0 (0,0%) | 116 (35,2%) | 150 | 80 (53,3%) | 38 | 32 |
| holdout (número a citar) | 330 | 1 (0,3%) | 116 (35,2%) | 150 | 83 (55,3%) | 35 | 32 |
| total | 660 | 1 (0,2%) | 232 (35,2%) | 300 | 163 (54,3%) | 73 | 64 |

| Família | Rótulo | Casos | Orgânico | Inconclusivo | Suspeito |
| --- | --- | ---: | ---: | ---: | ---: |
| steady_daily | legítimo | 60 | 60 | 0 | 0 |
| weekend_dip | legítimo | 60 | 60 | 0 | 0 |
| slow_growth | legítimo | 60 | 60 | 0 | 0 |
| global_audience | legítimo | 60 | 60 | 0 | 0 |
| organic_viral | legítimo | 60 | 60 | 0 | 0 |
| news_double_spike | legítimo | 60 | 60 | 0 | 0 |
| premiere | legítimo | 60 | 60 | 0 | 0 |
| live_stream | legítimo | 60 | 6 | 53 | 1 |
| viral_interrupted | legítimo | 60 | 0 | 60 | 0 |
| embed_step | legítimo | 60 | 1 | 59 | 0 |
| low_volume | legítimo | 60 | 0 | 60 | 0 |
| bought_plateau | suspeito | 60 | 0 | 13 | 47 |
| mechanical_repeat | suspeito | 60 | 4 | 0 | 56 |
| pulse_without_decay | suspeito | 60 | 0 | 0 | 60 |
| disguised_buy | suspeito | 60 | 60 | 0 | 0 |
| noisy_bought_plateau | suspeito | 60 | 0 | 60 | 0 |
<!-- metrics:end -->

- **Taxa de falso positivo esperada: <!--m:holdout_fpr-->0,3%<!--/m-->** no `holdout` (<!--m:holdout_fp-->1<!--/m--> legítimo acusado em <!--m:holdout_legit-->330<!--/m-->), e <!--m:dev_fpr-->0,0%<!--/m--> no `dev`. Esses números são do **meu dataset sintético** e saem do comando `npm run dataset`; um teste (`test/readme.test.ts`) falha se qualquer um deles divergir do que o comando mede agora.
- **Abstenção em legítimos: <!--m:holdout_abstain-->35,2%<!--/m-->**. Um classificador pode ter falso positivo baixo só deixando de acusar. Aqui as abstenções são deliberadas: transmissão ao vivo, viral cortado, degrau e canal pequeno viram `inconclusive`, não `suspicious`. É o preço do falso positivo baixo e está na tabela, família por família.
- **Recall: <!--m:holdout_recall-->55,3%<!--/m-->** (<!--m:holdout_detected-->83<!--/m--> de <!--m:holdout_suspicious-->150<!--/m--> suspeitos acusados). Dos que escaparam, <!--m:holdout_susp_inconclusive-->35<!--/m--> ficaram inconclusivos (patamar com ruído natural) e <!--m:holdout_susp_missed-->32<!--/m--> foram tidos como orgânicos (a compra disfarçada, que ele não vê).

Resumo das três taxas por parte (falso positivo / abstenção em legítimos / recall):

| Parte | FPR | Abstenção | Recall |
|---|---:|---:|---:|
| dev | <!--m:dev_fpr-->0,0%<!--/m--> | <!--m:dev_abstain-->35,2%<!--/m--> | <!--m:dev_recall-->53,3%<!--/m--> |
| holdout | <!--m:holdout_fpr-->0,3%<!--/m--> | <!--m:holdout_abstain-->35,2%<!--/m--> | <!--m:holdout_recall-->55,3%<!--/m--> |
| total | <!--m:overall_fpr-->0,2%<!--/m--> | <!--m:overall_abstain-->35,2%<!--/m--> | <!--m:overall_recall-->54,3%<!--/m--> |

### Sensibilidade por volume e duração

As taxas acima misturam volumes e durações. Este experimento mede cada faixa separadamente, com **outra semente** (`SENSITIVITY_SEED`), sem ter servido para ajustar nenhum limiar, e com a mesma regra de leitura: falso positivo, abstenção e recall juntos. Cada combinação de volume típico × duração é gerada com as 15 famílias que não fixam o próprio volume (`low_volume` fica de fora, porque o volume é o ponto dela), 4 casos por família. Continua sendo o meu dataset sintético, não tráfego real.

<!-- sensitivity:start -->
| Volume típico | Legítimos | Falsos positivos (FPR) | Abstenção em legítimos | Suspeitos | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| muito baixo (~10/h) | 160 | 0 (0,0%) | 100,0% | 80 | 18,8% |
| baixo (~100/h) | 160 | 2 (1,3%) | 29,4% | 80 | 68,8% |
| médio (~500/h) | 160 | 0 (0,0%) | 30,0% | 80 | 60,0% |
| alto (~2.000/h) | 160 | 0 (0,0%) | 31,9% | 80 | 52,5% |
| muito alto (~10.000/h) | 160 | 0 (0,0%) | 31,9% | 80 | 45,0% |

| Duração da série | Legítimos | Falsos positivos (FPR) | Abstenção em legítimos | Suspeitos | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3 dias (72 h) | 200 | 0 (0,0%) | 49,5% | 100 | 51,0% |
| 7 dias (168 h) | 200 | 1 (0,5%) | 43,5% | 100 | 48,0% |
| 30 dias (720 h) | 200 | 1 (0,5%) | 42,5% | 100 | 49,0% |
| 60 dias (1.440 h) | 200 | 0 (0,0%) | 43,0% | 100 | 48,0% |

| Volume × duração | Legítimos | Falsos positivos (FPR) | Abstenção em legítimos | Suspeitos | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| muito baixo (~10/h) × 3 dias (72 h) | 40 | 0 (0,0%) | 100,0% | 20 | 20,0% |
| muito baixo (~10/h) × 7 dias (168 h) | 40 | 0 (0,0%) | 100,0% | 20 | 25,0% |
| muito baixo (~10/h) × 30 dias (720 h) | 40 | 0 (0,0%) | 100,0% | 20 | 15,0% |
| muito baixo (~10/h) × 60 dias (1.440 h) | 40 | 0 (0,0%) | 100,0% | 20 | 15,0% |
| baixo (~100/h) × 3 dias (72 h) | 40 | 0 (0,0%) | 35,0% | 20 | 70,0% |
| baixo (~100/h) × 7 dias (168 h) | 40 | 1 (2,5%) | 27,5% | 20 | 60,0% |
| baixo (~100/h) × 30 dias (720 h) | 40 | 1 (2,5%) | 27,5% | 20 | 75,0% |
| baixo (~100/h) × 60 dias (1.440 h) | 40 | 0 (0,0%) | 27,5% | 20 | 70,0% |
| médio (~500/h) × 3 dias (72 h) | 40 | 0 (0,0%) | 37,5% | 20 | 60,0% |
| médio (~500/h) × 7 dias (168 h) | 40 | 0 (0,0%) | 27,5% | 20 | 55,0% |
| médio (~500/h) × 30 dias (720 h) | 40 | 0 (0,0%) | 25,0% | 20 | 60,0% |
| médio (~500/h) × 60 dias (1.440 h) | 40 | 0 (0,0%) | 30,0% | 20 | 65,0% |
| alto (~2.000/h) × 3 dias (72 h) | 40 | 0 (0,0%) | 37,5% | 20 | 55,0% |
| alto (~2.000/h) × 7 dias (168 h) | 40 | 0 (0,0%) | 32,5% | 20 | 55,0% |
| alto (~2.000/h) × 30 dias (720 h) | 40 | 0 (0,0%) | 30,0% | 20 | 50,0% |
| alto (~2.000/h) × 60 dias (1.440 h) | 40 | 0 (0,0%) | 27,5% | 20 | 50,0% |
| muito alto (~10.000/h) × 3 dias (72 h) | 40 | 0 (0,0%) | 37,5% | 20 | 50,0% |
| muito alto (~10.000/h) × 7 dias (168 h) | 40 | 0 (0,0%) | 30,0% | 20 | 45,0% |
| muito alto (~10.000/h) × 30 dias (720 h) | 40 | 0 (0,0%) | 30,0% | 20 | 45,0% |
| muito alto (~10.000/h) × 60 dias (1.440 h) | 40 | 0 (0,0%) | 30,0% | 20 | 40,0% |
<!-- sensitivity:end -->

Como ler: cada célula do cruzamento tem só 40 legítimos e 20 suspeitos, então **um falso positivo a mais ou a menos muda a taxa em 2,5 pontos**; as faixas por volume e por duração (200 e 160 legítimos) são mais estáveis, mas nenhuma é uma estimativa precisa. O que a tabela mostra com clareza: (1) com volume muito baixo o classificador **abstém-se em todos os legítimos** (nada é acusado, e o recall cai para perto de um quinto: a maior parte da compra passa); (2) o recall **cai com o volume**: a regularidade é medida contra o ruído de contagem, e quanto maior o volume mais fácil é uma compra com jitter parecer tráfego real, então ela vira dúvida ou passa; (3) os dois falsos positivos são transmissões ao vivo geradas com volume ~100/h, com regularidade 1,08 e 1,38 (abaixo do limite de 1,5): em volume baixo o ruído de contagem é grande, e a variação de audiência de 4% a 10% que o gerador dá a uma transmissão fica perto dele; é o mesmo mecanismo do falso positivo do `holdout`. Isso não foi usado para recalibrar nada.


**Estabilidade entre sementes.** O número do `holdout` não é uma semente de sorte: rodei o mesmo critério, sem mexer em nada, em seis outros pares de sementes (`test/stability.test.ts`). O falso positivo ficou entre 0% e 0,2% do total, a abstenção em legítimos entre 34% e 35% e o recall entre 56% e 60%. O teste exige falso positivo de no máximo 1%, abstenção entre 30% e 40% e recall entre 45% e 70% em cada uma.

Dois pontos para ler esses números:

- O recall mede o que o critério pega **do que eu defini como suspeito**. A família `disguised_buy` foi escrita para passar despercebida, e passa. Em tráfego real o recall pode ser maior ou menor, e eu não tenho como medir.
- O falso positivo baixo vem em parte de eu ter escrito os legítimos conhecendo o critério. Os casos difíceis reduzem esse viés, mas não o eliminam: a taxa em tráfego real de verdade pode ser maior.

## Como foi verificado

- **Testes primeiro**, vistos falhando pelo motivo certo (módulo inexistente) antes de qualquer código. Os casos óbvios usam séries **montadas à mão** (`test/series.ts`), não o gerador do dataset.
- **Stryker** nos módulos de regra (`stats`, `signals`, `classify`, `evaluate`, `readme`): 868 de 935 mutantes mortos (92,8%, com `vitest.stryker.config.ts`, que deixa de fora os testes que sobem processos ou geram o dataset várias vezes: cli, sensibilidade e estabilidade). A primeira rodada deu 73%: os mutantes vivos apontaram testes que faltavam nas bordas de cada limiar e **um defeito real** (um pico menor logo depois de um pico maior reabria o grupo de horas já usado e gerava um sinal falso; corrigido em `findPeaks` e coberto por teste).
- **Mutação manual dos limiares** de `criteria.ts` (cada um para cima e para baixo, 44 mutantes): todos morrem. Vários só morrem por causa da trava do README (mudar um limiar muda a taxa medida e o teste de sincronia falha), o que é uma função útil dela.
- Os 67 mutantes vivos restantes são, pelo que olhei, de três tipos: bordas de laço (`i < n` contra `i <= n`, que só lê `series[n]` indefinido), igualdade exata de ponto flutuante em limiares (`<` contra `<=` com 1,5 de regularidade) e o texto de algumas frases. Não afirmo que todos são equivalentes: o relatório completo sai de `npm run mutation`.

## Decisões

| Decisão | Motivo |
|---|---|
| Três respostas (`organic`, `suspicious`, `inconclusive`) | acusar errado custa mais que não concluir; a terceira é a abstenção declarada |
| Regras com limiar escrito em vez de modelo treinado | o enunciado pede motivo legível e os sinais usados; cada resposta aponta hora, número e limite |
| Regularidade medida contra √média | o ruído de contagem é o piso do que gente produz; a comparação se adapta ao volume em vez de um percentual fixo |
| Base = mediana | picos e patamares curtos não deslocam a base; o limite (mais da metade da série) está documentado |
| Sinais correlacionados agrupados | patamar e a queda dele são um fato só, não duas "provas" |
| Dataset gerado por semente, hash versionado | o arquivo de ~1,6 MB não precisa ir ao repositório e continua reproduzível e verificável |
| `dev` e `holdout` com sementes diferentes | o número citado vem de dados que não influenciaram os limiares |
| Hand-made séries nos testes dos casos óbvios | se saíssem do gerador, o teste só confirmaria que o classificador concorda com o autor do gerador |
| Números do README entre marcadores, reescritos pelo comando | ninguém digita o número; o teste falha se divergir |

## O que ficou de fora

- Qualquer dado além da contagem por hora (retenção, origem, dispositivo, contas): são os que separariam a compra disfarçada.
- Ajuste de limiares com tráfego real: não tenho dados reais, então os limiares são hipóteses medidas contra o meu dataset.
- Intervalo de confiança nas taxas: com 330 legítimos no `holdout`, um falso positivo a mais ou a menos muda a taxa em 0,3 ponto.
- Autenticação, limite de requisições e persistência: a API é uma função pura atrás de HTTP.
- Séries com mais de 60 dias ou menos de 24 horas.
- Horas sem medição: a série é só a lista de contagens, e `null` é recusado (400) em vez de ser tratado como zero. Uma lacuna real precisaria de timestamps, que este contrato não tem; por isso também não há análise de fuso nem de acumulados.
- Episódios: patamares e picos são examinados um a um, cada um por si (um pico orgânico grande não esconde um bloco comprado menor, e um patamar ruidoso longo não esconde um patamar quase fixo menor: o segundo é acusado e o primeiro continua só dúvida; o motivo cita só o episódio acusado). A repetição mecânica considera a maior repetição da série, não a soma de várias.

## Uso de IA

Escrevi este projeto com o Claude Code: os testes dos casos óbvios foram escritos primeiro, vistos falhando e só então veio o código; o dataset, o critério e os números do README vêm do comando acima. A mutação foi rodada com o Stryker e com mutantes manuais em pontos de limiar.

Checklist de revisão humana (**ainda não feita**):

- [ ] Li o critério (`criteria.ts` e `signals.ts`) e concordo com cada limiar.
- [ ] Li as famílias do dataset e concordo que os casos difíceis são plausíveis.
- [ ] Rodei `npm run dataset:check` e `npm test` na minha máquina.
- [ ] Revisei os motivos de resposta em português.
