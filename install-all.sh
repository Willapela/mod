#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then exec sudo -E bash "$0" "$@"; fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SRC="$ROOT/dtunnel-server"
BUILDER_SRC="$ROOT/dtunnel-mod"
SERVER_DST="${DT_INSTALL_DIR:-/opt/dtunnel-server}"
BUILDER_DST="${DT_APK_BUILDER_DIR:-/root/apk-build/dtunnel-mod}"
BUILD_ENV_FILE="${DT_APK_BUILD_ENV_FILE:-/etc/dtunnel-apk-build.env}"
[ -d "$SERVER_SRC/src" ] && [ -d "$BUILDER_SRC/patch" ] || { echo "[ERRO] extraia o ZIP completo antes de executar."; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SERVER_DST" "$BUILDER_DST"
if [ -d "$SERVER_DST/src" ] || [ -d "$SERVER_DST/public" ]; then
  BACKUP="/root/dtunnel-source-backup-$STAMP.tar.gz"
  backup_files=()
  for f in src public protos package.json package-lock.json install.sh start.sh; do
    [ ! -e "$SERVER_DST/$f" ] || backup_files+=("$f")
  done
  if [ "${#backup_files[@]}" -gt 0 ]; then
    tar -czf "$BACKUP" -C "$SERVER_DST" "${backup_files[@]}"
    echo "Backup de código existente: $BACKUP"
  fi
fi
# Atualiza só código. Não remove nem copia dados, certificados, APKs ou keystores existentes.
for f in src public protos templates; do [ ! -d "$SERVER_SRC/$f" ] || cp -a "$SERVER_SRC/$f" "$SERVER_DST/"; done
for f in README.md DEPLOY.md package.json package-lock.json install.sh install_deps.sh start.sh restart.sh setup.sh uninstall.sh gen_keys.sh deploy_node_server.sh; do
  [ ! -f "$SERVER_SRC/$f" ] || cp -a "$SERVER_SRC/$f" "$SERVER_DST/"
done
mkdir -p "$SERVER_DST/data" "$SERVER_DST/keys"
for f in configs categories cdns app_configs texts; do
  if [ ! -f "$SERVER_DST/data/$f.json" ]; then cp "$SERVER_DST/templates/data/$f.json" "$SERVER_DST/data/$f.json"; chmod 600 "$SERVER_DST/data/$f.json"; fi
done
# Copy builder source assets without deleting externally supplied apk/, keys/, or patch/*.jks.
mkdir -p "$BUILDER_DST/patch" "$BUILDER_DST/apk" "$BUILDER_DST/keys"
for f in README.md make_mod.sh sync_keys.sh install_deps.sh .gitignore; do [ ! -f "$BUILDER_SRC/$f" ] || cp -a "$BUILDER_SRC/$f" "$BUILDER_DST/"; done
for f in patch apk keys; do cp -a "$BUILDER_SRC/$f/." "$BUILDER_DST/$f/"; done
chmod +x "$SERVER_DST"/*.sh "$BUILDER_DST"/*.sh 2>/dev/null || true
if [ -f "$SERVER_DST/templates/dtunnel-apk-build.env.example" ] && [ ! -f "$BUILD_ENV_FILE" ]; then
  install -D -m 600 "$SERVER_DST/templates/dtunnel-apk-build.env.example" "$BUILD_ENV_FILE"
  echo "Modelo criado em $BUILD_ENV_FILE; edite-o para configurar APK/keystore."
fi
if command -v npm >/dev/null 2>&1; then
  (cd "$SERVER_DST" && npm install --omit=dev --no-audit --no-fund)
else
  echo "[AVISO] Node.js/npm não estão instalados; instale Node.js 18+ e rode npm install no servidor."
fi
cat <<EOF

Código instalado em: $SERVER_DST
Builder instalado em: $BUILDER_DST
Nenhum serviço foi reiniciado automaticamente.
Para habilitar Build APK, obtenha legalmente o APK base e configure a keystore privada
fora do Git em /etc/dtunnel-apk-build.env. Não coloque esses arquivos/senhas no GitHub.
Depois reinicie somente o processo Node do painel para ele carregar as variáveis.
EOF
