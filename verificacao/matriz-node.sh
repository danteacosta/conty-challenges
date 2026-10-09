#!/usr/bin/env bash
# Roda a suíte completa (npm test via vitest) e o typecheck de cada projeto, em cada versão de Node, N vezes.
#
#   N22_BIN=~/.nvm/versions/node/v22.15.0/bin N24_BIN=/opt/homebrew/bin ./verificacao/matriz-node.sh [repeticoes]
#
# Variáveis: N22_BIN e N24_BIN (diretórios com o executável `node` de cada versão), DEBUG_REPO (opcional: clone do
# fork de debug, para incluí-lo na matriz). Repetições: padrão 6. O fast-check usa uma semente aleatória a cada
# execução; quando uma propriedade falha, a semente e o caminho aparecem na saída do vitest.
set -u
REPS="${1:-6}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
N22_BIN="${N22_BIN:-$HOME/.nvm/versions/node/v22.15.0/bin}"
N24_BIN="${N24_BIN:-$(dirname "$(command -v node)")}"
PROJECTS=("$ROOT/vendas-shopify" "$ROOT/origem-cadastros" "$ROOT/rastreio-envio" "$ROOT/revisao-roteiro" "$ROOT/metricas-redes" "$ROOT/revisao-video" "$ROOT/views-suspeitas")
[ -n "${DEBUG_REPO:-}" ] && PROJECTS+=("$DEBUG_REPO")

echo "data: $(date -u +%Y-%m-%dT%H:%M:%SZ)  repetições por projeto e versão: $REPS"
GRAND_FAILS=0; GRAND_TOTAL=0
for BIN in "$N22_BIN" "$N24_BIN"; do
  VERSION="$("$BIN/node" -v)"
  FAILS=0; TOTAL=0; TYPE_ERRORS=0
  echo; echo "== node $VERSION ($BIN)"
  for DIR in "${PROJECTS[@]}"; do
    NAME="$(basename "$DIR")"
    if (cd "$DIR" && PATH="$BIN:$PATH" npm run typecheck >/dev/null 2>&1); then TC="typecheck ok"; else TC="TYPECHECK FALHOU"; TYPE_ERRORS=$((TYPE_ERRORS+1)); fi
    LAST=""
    for ((i = 1; i <= REPS; i++)); do
      TOTAL=$((TOTAL+1))
      OUT="$(cd "$DIR" && PATH="$BIN:$PATH" NODE_OPTIONS='--disable-warning=ExperimentalWarning' npx vitest run 2>&1 | grep -E '^ +Tests ' | tr -s ' ')"
      LAST="$OUT"
      case "$OUT" in *failed*) FAILS=$((FAILS+1)); echo "   FALHA ($NAME, repetição $i):$OUT";; esac
    done
    printf '   %-22s%s | %s\n' "$NAME" "$LAST" "$TC"
  done
  echo "   -> node $VERSION: $TOTAL suítes completas, $FAILS com falha, $TYPE_ERRORS projeto(s) com erro de typecheck"
  GRAND_FAILS=$((GRAND_FAILS+FAILS)); GRAND_TOTAL=$((GRAND_TOTAL+TOTAL))
done
echo; echo "TOTAL: $GRAND_TOTAL execuções completas, $GRAND_FAILS com falha"
[ "$GRAND_FAILS" -eq 0 ]
