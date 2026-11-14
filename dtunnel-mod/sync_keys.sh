#!/usr/bin/env bash
# Sincroniza a chave de assinatura dos replies entre o servidor e o APK.
#
#   ./sync_keys.sh <servidor> [usuario] [porta_ssh]
#
# Quando usar:
#   - voce gerou chaves NOVAS no servidor (apagou keys/ e rodou o install.sh)
#   - o app mostra a lista de conexoes VAZIA sem nenhum erro
#
# O que faz:
#   1. baixa a chave publica (server_reply_key.json) do servidor
#   2. baixa a chave privada (server_reply.key) tambem, paraBackup
#   3. mostra o comando para refazer o APK
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

HOST="${1:?uso: sync_keys.sh <servidor> [usuario] [porta_ssh]}"
USER_NAME="${2:-root}"
SSH_PORT="${3:-22}"
KEYS="${KEYS:-keys}"
# caminho remoto dos arquivos (use $HOME se estiver como root em /root)
REMOTE_KEYS="${REMOTE_KEYS:-}"

SSH_CMD=(sshpass -p "${SSHPASS:-}" scp -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -P "$SSH_PORT")
if [ -z "${SSHPASS:-}" ]; then
  SSH_CMD=(scp -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -P "$SSH_PORT")
fi

echo "=== baixando as chaves de ${USER_NAME}@${HOST} ==="
mkdir -p "$KEYS"

# descobre o caminho remoto das chaves
if [ -z "$REMOTE_KEYS" ]; then
  FOUND=""
  # 1) procura no servidor (cobre qualquer lugar onde o pacote foi extraido)
  # usa o mesmo metodo de autenticacao do resto do script (com senha, se
  # houver). BatchMode=yes falha silenciosamente quando o servidor exige
  # senha - por isso o 'find' era ignorado.
  FOUND="$(sshpass -p "${SSHPASS:-}" ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$USER_NAME@$HOST" \
    "find /root /home /opt /srv /usr/local /etc /tmp /var/tmp -maxdepth 5 -type f -name server_reply_key.json 2>/dev/null | head -1" 2>/dev/null || true)"
  if [ -n "$FOUND" ]; then
    REMOTE_KEYS="$(dirname "$FOUND")"
  else
    # 2) fallback: tenta com senha (BatchMode falha quando ha senha)
    for cand in "$HOME/dtunnel-server/keys" "/root/dtunnel-server/keys" "/home/*/dtunnel-server/keys" "/tmp/dtunnel-server/keys"; do
      if "${SSH_CMD[@]}" "${USER_NAME}@${HOST}:${cand}/server_reply_key.json" "$KEYS/" >/dev/null 2>&1; then
        REMOTE_KEYS="$cand"
        break
      fi
    done
  fi
  if [ -z "$REMOTE_KEYS" ]; then
    echo "[ERRO] nao achei server_reply_key.json no servidor ${HOST}."
    echo "       Procurado em: /root /home /opt /srv /usr/local /etc /tmp /var/tmp (ate 5 niveis)"
    echo "       conferir manualmente:"
    echo "         ssh ${USER_NAME}@${HOST} \"find / -name server_reply_key.json 2>/dev/null | head\""
    echo "       ou aponte direto:  REMOTE_KEYS=/caminho/keys ./sync_keys.sh ${HOST} ${USER_NAME}"
    exit 1
  fi
  echo "[+] chaves em: $REMOTE_KEYS"
fi
"${SSH_CMD[@]}" "${USER_NAME}@${HOST}:${REMOTE_KEYS}/server_reply_key.json" "$KEYS/" || {
  echo "[ERRO] nao consegui baixar server_reply_key.json"
  echo "       conferir o caminho no servidor:  ssh ${USER_NAME}@${HOST} 'ls ~/dtunnel-server/keys/'"
  exit 1
}
# NOTA: a chave PRIVADA (server_reply.key) NAO e baixada de proposito.
# Ela fica so no servidor. Se voce empacotar o dtunnel-mod e enviar para
# o grupo, a privada iria junto (e identifies o servidor). O make_mod.sh
# so precisa da chave PUBLICA.

# CA do servidor: precisa estar embutida no APK (res/raw/dtca.pem) senao o
# Android rejeita o TLS e o app aborta o update em silencio.
if "${SSH_CMD[@]}" "${USER_NAME}@${HOST}:${REMOTE_KEYS}/ca.pem" "$KEYS/" >/dev/null 2>&1; then
  echo "[+] CA do servidor atualizada: $KEYS/ca.pem"
else
  echo "AVISO: nao achei ca.pem em $REMOTE_KEYS (o APK vai ficar sem trust anchor)"
fi

echo "[+] chave publica atualizada: $KEYS/server_reply_key.json"
echo ""
echo "=============================================="
echo "  Agora refaca o APK com a chave nova:"
echo ""
echo "      ./make_mod.sh ${HOST} 8443"
echo ""
echo "  (a chave privada continua so no servidor;"
echo "   aqui em keys/ esta apenas uma copia de backup)"
echo "=============================================="
