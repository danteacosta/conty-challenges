# Mutação manual dos limiares de views (criteria.ts)

Gerado por `node verificacao/mutacao-manual-views.mjs`, numa cópia do projeto, com o resultado estruturado do vitest (ver o cabeçalho do script).
Cada constante numérica sobe e desce (±1 nos inteiros, ±10% nos fracionários); `cycle_periods` perde cada período e ganha um vizinho.
Baseline: 120 testes na suíte de comportamento e 199 na completa, todos passando; cada mutante rodou o mesmo número de testes.

68 mutantes: 68 mortos por teste de comportamento, 0 só pela suíte completa (trava de métricas/README), 0 sobreviventes.

| constante | mutação | resultado | primeiro teste que falhou |
|---|---|---|---|
| `min_hours` | ↑ 24 → 25 | morto por teste de comportamento | POST /classify aceita exatamente 24 horas e exatamente 1.440 |
| `min_hours` | ↓ 24 → 23 | morto por teste de comportamento | POST /classify menos de 24 horas é 400 e diz o que está errado |
| `max_hours` | ↑ 1440 → 1441 | morto por teste de comportamento | POST /classify mais de 1.440 horas (60 dias) é 400 e diz o que está errado |
| `max_hours` | ↓ 1440 → 1439 | morto por teste de comportamento | POST /classify aceita exatamente 24 horas e exatamente 1.440 |
| `max_value_per_hour` | ↑ 1_000_000_000 → 1000000001 | morto por teste de comportamento | validateSeries aceita zero e exatamente 1 bilhão por hora; recusa 1 bilhão e 1 |
| `max_value_per_hour` | ↓ 1_000_000_000 → 999999999 | morto por teste de comportamento | validateSeries aceita zero e exatamente 1 bilhão por hora; recusa 1 bilhão e 1 |
| `min_hours_for_context` | ↑ 48 → 49 | morto por teste de comportamento | fronteiras do classificador 48 horas já bastam para ter base de comparação; 47 não |
| `min_hours_for_context` | ↓ 48 → 47 | morto por teste de comportamento | fronteiras do classificador 48 horas já bastam para ter base de comparação; 47 não |
| `low_volume_median` | ↑ 20 → 21 | morto por teste de comportamento | fronteiras do classificador 48 horas já bastam para ter base de comparação; 47 não |
| `low_volume_median` | ↓ 20 → 19 | morto por teste de comportamento | fronteiras do classificador mediana de 20 views por hora ainda é volume suficiente; 19 já é volume baixo |
| `repetition_min_volume` | ↑ 30 → 31 | morto por teste de comportamento | repetição mecânica: cada limite exatamente na borda 7 horas idênticas valem; 6 não; 30 views valem; 29 não |
| `repetition_min_volume` | ↓ 30 → 29 | morto por teste de comportamento | repetição mecânica: cada limite exatamente na borda 7 horas idênticas valem; 6 não; 30 views valem; 29 não |
| `repetition_min_run` | ↑ 7 → 8 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR repetição idêntica |
| `repetition_min_run` | ↓ 7 → 6 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR repetição idêntica |
| `progression_min_run` | ↑ 8 → 9 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR progressão aritmética |
| `progression_min_run` | ↓ 8 → 7 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR progressão aritmética |
| `cycle_min_repeats` | ↑ 4 → 5 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR ciclo |
| `cycle_min_repeats` | ↓ 4 → 3 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR ciclo |
| `plateau_min_hours` | ↑ 6 → 7 | morto por teste de comportamento | patamar seguido de queda seca: cada limite na borda devolve o patamar medido: horas, média, janela, regularida |
| `plateau_min_hours` | ↓ 6 → 5 | morto por teste de comportamento | patamar seguido de queda seca: cada limite na borda 6 horas valem, 5 não (nem um patamar curto logo antes da q |
| `plateau_min_lift` | ↑ 4 → 5 | morto por teste de comportamento | patamar seguido de queda seca: cada limite na borda devolve o patamar medido: horas, média, janela, regularida |
| `plateau_min_lift` | ↓ 4 → 3 | morto por teste de comportamento | patamar seguido de queda seca: cada limite na borda a média precisa ser 4 vezes a base: 400 vale, 399 não |
| `plateau_band` | ↑ 0.08 → 0.088 | morto por teste de comportamento | patamar seguido de queda seca: cada limite na borda a janela aceita até ±8%: 920/1080 vale (8% exatos), 919/10 |
| `plateau_band` | ↓ 0.08 → 0.072 | morto por teste de comportamento | patamar seguido de queda seca: cada limite na borda a janela aceita até ±8%: 920/1080 vale (8% exatos), 919/10 |
| `plateau_regularity_suspicious` | ↑ 1.5 → 1.65 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR patamar suspeito e patamar com dúvida trazem a regular |
| `plateau_regularity_suspicious` | ↓ 1.5 → 1.35 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR patamar suspeito e patamar com dúvida trazem a regular |
| `cliff_drop` | ↑ 0.7 → 0.77 | morto por teste de comportamento | patamar seguido de queda seca: cada limite na borda devolve o patamar medido: horas, média, janela, regularida |
| `cliff_drop` | ↓ 0.7 → 0.63 | morto por teste de comportamento | patamar seguido de queda seca: cada limite na borda a queda tem de ser de 70% ou mais: 300 vale, 301 não; sem  |
| `pulse_min_lift` | ↑ 15 → 16 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pulso, com a hora e a razão para a base |
| `pulse_min_lift` | ↓ 15 → 14 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pulso, com a hora e a razão para a base |
| `pulse_min_value` | ↑ 500 → 501 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica pulso de uma hora: 15 vezes a base vale, 14,99 não; 500 views val |
| `pulse_min_value` | ↓ 500 → 499 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica pulso de uma hora: 15 vezes a base vale, 14,99 não; 500 views val |
| `pulse_max_hours` | ↑ 3 → 4 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pulso, com a hora e a razão para a base |
| `pulse_max_hours` | ↓ 3 → 2 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pulso, com a hora e a razão para a base |
| `pulse_end_fraction` | ↑ 0.25 → 0.275 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica pulso de duas e de três horas é um pico só; de quatro já não é pu |
| `pulse_end_fraction` | ↓ 0.25 → 0.225 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica o pulso acaba de uma vez: última hora com 25% do pico vale, 24,99 |
| `max_peaks` | ↑ 5 → 6 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica no máximo 5 picos |
| `max_peaks` | ↓ 5 → 4 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica no máximo 5 picos |
| `tail_floor_baselines` | ↑ 2 → 3 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pico orgânico |
| `tail_floor_baselines` | ↓ 2 → 1 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica o pico orgânico precisa de 5 vezes a base: exatamente 5 vale, aba |
| `tail_floor_peak_fraction` | ↑ 0.1 → 0.11 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pico orgânico |
| `tail_floor_peak_fraction` | ↓ 0.1 → 0.09 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pico orgânico |
| `organic_min_lift` | ↑ 5 → 6 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica o pico orgânico precisa de 5 vezes a base: exatamente 5 vale, aba |
| `organic_min_lift` | ↓ 5 → 4 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica o pico orgânico precisa de 5 vezes a base: exatamente 5 vale, aba |
| `organic_min_tail_hours` | ↑ 6 → 7 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pico orgânico |
| `organic_min_tail_hours` | ↓ 6 → 5 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR pico orgânico |
| `organic_gradual_fraction` | ↑ 0.75 → 0.825 | morto por teste de comportamento | cauda gradual passos de até 1,3 vezes o anterior são calmos; 75% de passos calmos bastam, 62,5% não |
| `organic_gradual_fraction` | ↓ 0.75 → 0.675 | morto por teste de comportamento | cauda gradual passos de até 1,3 vezes o anterior são calmos; 75% de passos calmos bastam, 62,5% não |
| `calm_growth` | ↑ 1.3 → 1.43 | morto por teste de comportamento | cauda gradual passos de até 1,3 vezes o anterior são calmos; 75% de passos calmos bastam, 62,5% não |
| `calm_growth` | ↓ 1.3 → 1.17 | morto por teste de comportamento | cauda gradual passos de até 1,3 vezes o anterior são calmos; 75% de passos calmos bastam, 62,5% não |
| `drop_fraction` | ↑ 0.7 → 0.77 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR queda abrupta |
| `drop_fraction` | ↓ 0.7 → 0.63 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR queda abrupta |
| `drop_min_level_vs_peak` | ↑ 0.25 → 0.275 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica queda abrupta: cluster de 4+ horas que acaba de uma vez a partir  |
| `drop_min_level_vs_peak` | ↓ 0.25 → 0.225 | morto por teste de comportamento | picos: pulso, queda abrupta e cauda orgânica queda abrupta: cluster de 4+ horas que acaba de uma vez a partir  |
| `step_min_lift` | ↑ 2.5 → 2.75 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR degrau |
| `step_min_lift` | ↓ 2.5 → 2.25 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR degrau |
| `step_window_hours` | ↑ 24 → 25 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR degrau |
| `step_window_hours` | ↓ 24 → 23 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR degrau |
| `step_persistence` | ↑ 0.7 → 0.77 | morto por teste de comportamento | degrau persistente tem de persistir: subir e voltar não é degrau; metade do tempo no nível alto ainda é (borda |
| `step_persistence` | ↓ 0.7 → 0.63 | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR o degrau só vale se o nível novo persiste: um que vai  |
| `reason_max_sentences` | ↑ 2 → 3 | morto por teste de comportamento | a ordem e o corte do motivo o motivo traz só as duas primeiras acusações, mas os três sinais ficam na lista |
| `reason_max_sentences` | ↓ 2 → 1 | morto por teste de comportamento | a ordem e o corte do motivo o motivo traz só as duas primeiras acusações, mas os três sinais ficam na lista |
| `cycle_periods` | −2 [2, 3, 4, 5, 6] → [3, 4, 5, 6] | morto por teste de comportamento | os sinais carregam o que foi medido, com texto em pt-BR ciclo |
| `cycle_periods` | −3 [2, 3, 4, 5, 6] → [2, 4, 5, 6] | morto por teste de comportamento | repetição mecânica: cada limite exatamente na borda ciclo exato repetido 4 vezes vale, 3 não; conta só as repe |
| `cycle_periods` | −4 [2, 3, 4, 5, 6] → [2, 3, 5, 6] | morto por teste de comportamento | repetição mecânica: cada limite exatamente na borda ciclo de período 4 repetido 4 vezes é repetição mecânica |
| `cycle_periods` | −5 [2, 3, 4, 5, 6] → [2, 3, 4, 6] | morto por teste de comportamento | repetição mecânica: cada limite exatamente na borda ciclo de período 5 repetido 4 vezes é repetição mecânica |
| `cycle_periods` | −6 [2, 3, 4, 5, 6] → [2, 3, 4, 5] | morto por teste de comportamento | casos adversariais: mais de um episódio, observação curta e série cortada ciclo de 6 horas: 3 repetições não b |
| `cycle_periods` | +7 [2, 3, 4, 5, 6] → [2, 3, 4, 5, 6, 7] | morto por teste de comportamento | repetição mecânica: cada limite exatamente na borda ciclo de período 7 não é detectado: a lista de períodos (2 |
