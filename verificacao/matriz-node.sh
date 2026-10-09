#!/usr/bin/env bash
# Roda a suíte completa (vitest) e o typecheck de cada projeto, em cada versão de Node, N vezes. Falha fechado: o resultado
# vem do código de saída de cada comando, não de um texto filtrado.
#
#   N22_BIN=~/.nvm/versions/node/v22.15.0/bin N24_BIN=/opt/homebrew/bin ./verificacao/matriz-node.sh [repeticoes]
#
# Variáveis: N22_BIN e N24_BIN (diretórios com o executável `node` de cada versão); DEBUG_REPO e OPTIMIZE_REPO (opcionais:
# clones dos forks, para incluí-los); PROJECT_DIRS (lista separada por ":" que substitui a lista padrão, usada pelo
# autoteste). Repetições: padrão 6. O fast-check usa uma semente aleatória a cada execução; quando uma propriedade falha,
# a semente e o caminho aparecem no log completo de cada execução, guardado em LOG_DIR.
#
# Uma execução conta como falha se o vitest sair com código diferente de 0, se a saída não trouxer a linha "Tests" (o
# runner nem subiu) ou se trouxer "failed". Um typecheck com código diferente de 0 também derruba o resultado final.
set -u
REPS="${1:-6}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
N22_BIN="${N22_BIN:-$HOME/.nvm/versions/node/v22.15.0/bin}"
N24_BIN="${N24_BIN:-$(dirname "$(command -v node)")}"
LOG_DIR="${LOG_DIR:-$(mktemp -d)}"; mkdir -p "$LOG_DIR"
if [ -n "${PROJECT_DIRS:-}" ]; then
  IFS=':' read -r -a PROJECTS <<< "$PROJECT_DIRS"
else
  PROJECTS=("$ROOT/vendas-shopify" "$ROOT/origem-cadastros" "$ROOT/rastreio-envio" "$ROOT/revisao-roteiro" "$ROOT/metricas-redes" "$ROOT/revisao-video" "$ROOT/views-suspeitas")
  [ -n "${DEBUG_REPO:-}" ] && PROJECTS+=("$DEBUG_REPO")
  [ -n "${OPTIMIZE_REPO:-}" ] && PROJECTS+=("$OPTIMIZE_REPO")
fi

echo "data: $(date -u +%Y-%m-%dT%H:%M:%SZ)  repetições por projeto e versão: $REPS  logs completos em: $LOG_DIR"
GRAND_FAILS=0; GRAND_TOTAL=0; GRAND_TYPE_ERRORS=0
for BIN in "$N22_BIN" "$N24_BIN"; do
  VERSION="$("$BIN/node" -v)"
  FAILS=0; TOTAL=0; TYPE_ERRORS=0
  echo; echo "== node $VERSION ($BIN)"
  for DIR in "${PROJECTS[@]}"; do
    NAME="$(basename "$DIR")"
    TC_LOG="$LOG_DIR/$NAME-$VERSION-typecheck.log"
    if (cd "$DIR" && PATH="$BIN:$PATH" npm run typecheck >"$TC_LOG" 2>&1); then TC="typecheck ok"; else TC="TYPECHECK FALHOU (ver $TC_LOG)"; TYPE_ERRORS=$((TYPE_ERRORS+1)); fi
    LAST=""
    for ((i = 1; i <= REPS; i++)); do
      TOTAL=$((TOTAL+1))
      RUN_LOG="$LOG_DIR/$NAME-$VERSION-$i.log"
      (cd "$DIR" && PATH="$BIN:$PATH" NODE_OPTIONS='--disable-warning=ExperimentalWarning' npx vitest run >"$RUN_LOG" 2>&1)
      STATUS=$?
      SUMMARY="$(grep -E '^ +Tests ' "$RUN_LOG" | tr -s ' ')"
      LAST="${SUMMARY:- sem resumo de testes}"
      if [ "$STATUS" -ne 0 ] || [ -z "$SUMMARY" ] || [[ "$SUMMARY" == *failed* ]]; then
        FAILS=$((FAILS+1)); echo "   FALHA ($NAME, repetição $i, código de saída $STATUS):${LAST}  (log: $RUN_LOG)"
      fi
    done
    printf '   %-22s%s | %s\n' "$NAME" "$LAST" "$TC"
  done
  echo "   -> node $VERSION: $TOTAL suítes completas, $FAILS com falha, $TYPE_ERRORS projeto(s) com erro de typecheck"
  GRAND_FAILS=$((GRAND_FAILS+FAILS)); GRAND_TOTAL=$((GRAND_TOTAL+TOTAL)); GRAND_TYPE_ERRORS=$((GRAND_TYPE_ERRORS+TYPE_ERRORS))
done
echo; echo "TOTAL: $GRAND_TOTAL execuções completas, $GRAND_FAILS com falha, $GRAND_TYPE_ERRORS erro(s) de typecheck"
[ "$GRAND_FAILS" -eq 0 ] && [ "$GRAND_TYPE_ERRORS" -eq 0 ]
