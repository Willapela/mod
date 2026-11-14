#!/usr/bin/env bash
# Instala/verifica as dependencias para compilar o mod do DTunnel.
#
#   ./install_deps.sh
#
# Dependencias:
#   - java (JDK 17+)          -> para o apktool
#   - apktool                 -> decode/rebuild do APK
#   - Android SDK build-tools -> zipalign + apksigner
#   - adb                     -> instalar no celular
#   - python3                 -> scripts de patch
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="${TOOLS_DIR:-$HOME/tools}"

ok=0; fail=0
check() { if eval "$2" >/dev/null 2>&1; then echo "[ok]   $1"; ok=$((ok+1)); else echo "[FALTA] $1"; fail=$((fail+1)); fi; }

echo "=== verificando dependencias ==="
check "java"          "command -v java"
check "python3"       "command -v python3"
check "curl"          "command -v curl"
check "unzip"         "command -v unzip"
check "adb"           "command -v adb"

# --- apktool ---
if [ -f "$TOOLS_DIR/apktool/apktool.jar" ] || command -v apktool >/dev/null 2>&1; then
  echo "[ok]   apktool"
  ok=$((ok+1))
else
  echo "[FALTA] apktool  -> instalando..."
  mkdir -p "$TOOLS_DIR/apktool"
  if curl -fsSL -o "$TOOLS_DIR/apktool/apktool.jar" \
       https://github.com/iBotPeaches/Apktool/releases/latest/download/apktool.jar; then
    echo "[ok]   apktool instalado em $TOOLS_DIR/apktool/apktool.jar"
    ok=$((ok+1))
  else
    echo "[-] falha ao baixar o apktool. Baixe manualmente em:"
    echo "    https://apktool.org  ->  $TOOLS_DIR/apktool/apktool.jar"
    fail=$((fail+1))
  fi
fi

# --- build-tools ---
SDK=""
for cand in "${ANDROID_SDK_ROOT:-}" "${ANDROID_HOME:-}" "$HOME/Android/Sdk" "$HOME/android-sdk" /usr/lib/android-sdk /opt/android-sdk; do
  [ -n "$cand" ] && [ -d "$cand/build-tools" ] && { SDK="$cand"; break; }
done
if [ -n "$SDK" ]; then
  BT="$(ls -1 "$SDK/build-tools" 2>/dev/null | sort -V | tail -1)"
  if [ -n "$BT" ] && [ -x "$SDK/build-tools/$BT/apksigner" ]; then
    echo "[ok]   build-tools ($BT) em $SDK"
    ok=$((ok+1))
  else
    echo "[FALTA] build-tools sem apksigner em $SDK"
    fail=$((fail+1))
  fi
else
  echo "[FALTA] Android SDK nao encontrado (procure em \$ANDROID_SDK_ROOT ou ~/Android/Sdk)"
  fail=$((fail+1))
fi

echo ""
echo "=== resumo: $ok ok, $fail faltando ==="
if [ "$fail" -gt 0 ]; then
  echo ""
  echo "Instalacao manual sugerida (Debian/Ubuntu):"
  echo "  sudo apt-get install -y default-jdk python3 curl unzip adb"
  echo "  # build-tools: baixe o Android SDK command-line-tools e rode:"
  echo "  #   sdkmanager 'build-tools;34.0.0' 'platform-tools'"
  exit 1
fi
echo "Tudo pronto. Agora:  ./make_mod.sh SEU_IP 443"
