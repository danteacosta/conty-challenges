/**
 * O critério, com todos os limiares num lugar só. Mudou um número, sobe a `CRITERIA_VERSION`.
 *
 * A ideia central: contagem de pessoas tem um ruído mínimo que vem só do acaso (para uma média de M views por hora, o desvio
 * esperado é cerca de √M). Tráfego real varia MAIS que isso (a audiência oscila, a recomendação muda). Um número fixo, ou uma
 * série mais regular que o ruído de contagem, não é gente. E um pico orgânico sobe e desce com cauda; um pico comprado costuma
 * ser um patamar fixo seguido de queda seca, ou um pulso sem cauda.
 */
export const CRITERIA_VERSION = 1;

export const THRESHOLDS = {
  /** Entrada aceita. */
  min_hours: 24,
  max_hours: 1440,
  max_value_per_hour: 1_000_000_000,
  /** Abaixo disso só a repetição mecânica evidente é avaliada: sem contexto não há base nem pico. */
  min_hours_for_context: 48,
  /** Mediana abaixo disso: volume baixo demais, qualquer padrão pode ser acaso. */
  low_volume_median: 20,

  /** Repetição mecânica: só vale acima deste volume (zeros e poucas views repetem por acaso). */
  repetition_min_volume: 30,
  repetition_min_run: 7,
  progression_min_run: 8,
  cycle_periods: [2, 3, 4, 5, 6],
  cycle_min_repeats: 4,

  /** Patamar seguido de queda seca. */
  plateau_min_hours: 6,
  /** O patamar tem de estar pelo menos esta quantidade de vezes acima da base. */
  plateau_min_lift: 4,
  /** Janela do patamar: variação máxima de ±8% em torno da média (acima disso é um pico irregular, não um patamar). */
  plateau_band: 0.08,
  /** Regularidade = desvio observado / desvio esperado só pelo acaso da contagem. Abaixo disto é mais regular que gente: suspeito. */
  plateau_regularity_suspicious: 1.5,
  /** Queda seca: a hora seguinte ao patamar cai pelo menos esta fração. */
  cliff_drop: 0.7,

  /** Pulso sem cauda. */
  pulse_min_lift: 15,
  pulse_min_value: 500,
  /** Quantas horas seguidas acima do limiar de cauda ainda contam como "sem cauda". */
  pulse_max_hours: 3,
  /** O pulso acaba de uma vez: a última hora acima da cauda ainda vale pelo menos esta fração do pico (decaimento passa por níveis intermediários). */
  pulse_end_fraction: 0.25,

  /** Quantos picos no máximo são examinados por série. */
  max_peaks: 5,
  /** A cauda de um pico é o que passa do maior entre este múltiplo da base e esta fração do pico. */
  tail_floor_baselines: 2,
  tail_floor_peak_fraction: 0.1,
  /** Pico orgânico: pelo menos este múltiplo da base e esta cauda. */
  organic_min_lift: 5,
  organic_min_tail_hours: 6,
  /** Fração mínima dos passos da cauda que não crescem mais que 30%: queda gradual. */
  organic_gradual_fraction: 0.75,
  /** Um passo da cauda é calmo se não cresce mais que isto (1,3 = 30%). */
  calm_growth: 1.3,

  /** Queda abrupta: a hora seguinte cai pelo menos esta fração, vindo de um nível ainda alto. */
  drop_fraction: 0.7,
  drop_min_level_vs_peak: 0.25,

  /** Degrau persistente. */
  step_min_lift: 2.5,
  step_window_hours: 24,
  /** O degrau persiste: a mediana do resto da série fica acima desta fração do nível novo. */
  step_persistence: 0.7,

  /** Quantas frases (sinais) entram no motivo. */
  reason_max_sentences: 2,
} as const;

/** O que o classificador NÃO detecta. É parte do contrato: está no README e em GET /criteria. */
export const NOT_DETECTED: readonly string[] = [
  "Compra disfarçada: views entregues com ruído e crescimento que imitam o orgânico (subida lenta, descida lenta, variação natural) passam como orgânicas.",
  "Patamar com variação natural: um patamar comprado com ruído parecido com o de tráfego real (variação acima do ruído de contagem) vira inconclusivo, não suspeito.",
  "Manipulação que ocupa mais da metade da série: a base (mediana) já é a manipulada, e os picos e patamares deixam de se destacar.",
  "Volume baixo (mediana abaixo de 20 views por hora): qualquer padrão pode ser acaso, então só se vê um pulso enorme; no resto o resultado é inconclusivo.",
  "Compra em várias contas ou espalhada em muitos dias com pouca intensidade por hora: não há pico, patamar nem repetição para ver.",
  "Números já suavizados ou arredondados pela plataforma: o critério supõe contagens exatas por hora, com ruído pelo menos igual ao do acaso; dados suavizados parecem regulares demais.",
  "A origem do tráfego: sem dados de geografia, dispositivo ou retenção, um pico orgânico e um pico comprado que imita o formato orgânico são indistinguíveis.",
];
