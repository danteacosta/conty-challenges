#!/usr/bin/env bash
# Prova que a matriz falha fechado: com executáveis falsos que saem com 1 sem imprimir resumo, ela tem de sair com código
# diferente de 0 e contar as falhas. E com executáveis falsos que passam, tem de sair com 0.
#   ./verificacao/autoteste-matriz.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/ruim" "$TMP/bom" "$TMP/projeto"
fake() { # $1 = pasta, $2 = código de saída do npx/npm, $3 = imprime resumo?
  printf '#!/bin/sh\necho v0.0.0\n' > "$1/node"
  if [ "$3" = sim ]; then printf '#!/bin/sh\necho "      Tests  1 passed (1)"\nexit %s\n' "$2" > "$1/npx"; else printf '#!/bin/sh\nexit %s\n' "$2" > "$1/npx"; fi
  printf '#!/bin/sh\nexit %s\n' "$2" > "$1/npm"
  chmod +x "$1/node" "$1/npx" "$1/npm"
}
run() { PROJECT_DIRS="$TMP/projeto" N22_BIN="$1" N24_BIN="$1" LOG_DIR="$TMP/logs" "$ROOT/verificacao/matriz-node.sh" 2 >"$TMP/saida.txt" 2>&1; echo $?; }
ok=0
fake "$TMP/ruim" 1 nao;  [ "$(run "$TMP/ruim")" -ne 0 ] && grep -q "8 com falha\|4 com falha\|2 com falha" "$TMP/saida.txt" && echo "ok: runner e typecheck que falham sem resumo => matriz falha" || { echo "ERRO: a matriz deu verde com runner quebrado"; ok=1; }
fake "$TMP/bom" 1 sim;   [ "$(run "$TMP/bom")" -ne 0 ] && echo "ok: resumo verde mas código de saída 1 => matriz falha" || { echo "ERRO: ignorou o código de saída"; ok=1; }
fake "$TMP/bom" 0 nao;   [ "$(run "$TMP/bom")" -ne 0 ] && echo "ok: código 0 sem resumo de testes => matriz falha" || { echo "ERRO: aceitou saída sem resumo"; ok=1; }
printf '#!/bin/sh\nexit 1\n' > "$TMP/bom/npm"; printf '#!/bin/sh\necho "      Tests  1 passed (1)"\nexit 0\n' > "$TMP/bom/npx"
[ "$(run "$TMP/bom")" -ne 0 ] && grep -q "TYPECHECK FALHOU" "$TMP/saida.txt" && echo "ok: só o typecheck falha => matriz falha" || { echo "ERRO: typecheck não derrubou o resultado"; ok=1; }
printf '#!/bin/sh\nexit 0\n' > "$TMP/bom/npm"
[ "$(run "$TMP/bom")" -eq 0 ] && echo "ok: tudo passa => matriz passa" || { echo "ERRO: falso vermelho"; ok=1; }
exit $ok
