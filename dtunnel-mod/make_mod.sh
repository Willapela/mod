#!/usr/bin/env bash
# Mod completo do DTunnel em um comando.
#
#   ./make_mod.sh <host> [porta]
#
# O que faz:
#   1. decodifica o APK original com o apktool
#   2. aplica os patches de smali (bypass de assinatura, SSL, etc.)
#   3. grava host/porta do servidor e a chave publica de assinatura do reply
#   4. reconstroi, alinha e assina o APK
#
# Saida: ./dist/dt_patched_signed.apk
set -euo pipefail

HOST="${1:?uso: make_mod.sh <host> [porta]}"
PORT="${2:-443}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

APK_ORIG="${APK_ORIG:-apk/DTunnel_5.0.0.apk}"
PROJECT="${PROJECT:-build/dt}"
OUT="${OUT:-dist/dt_patched_signed.apk}"
KEYS="${KEYS:-keys}"
APK_KEYSTORE="${APK_KEYSTORE:-patch/dt2.jks}"
APK_KEY_ALIAS="${APK_KEY_ALIAS:-dt}"
if [ -z "${APK_KEYSTORE_PASS:-}" ]; then
  echo "[ERRO] configure APK_KEYSTORE_PASS no ambiente; não salve a senha no repositório."
  exit 1
fi
if [ ! -f "$APK_ORIG" ]; then
  echo "[ERRO] APK base não encontrado: $APK_ORIG"
  echo "       obtenha DTunnel_5.0.0.apk de uma fonte autorizada e defina APK_ORIG."
  exit 1
fi
if [ ! -f "$APK_KEYSTORE" ]; then
  echo "[ERRO] keystore de assinatura não encontrada: $APK_KEYSTORE"
  echo "       configure APK_KEYSTORE com uma chave protegida fora do repositório."
  exit 1
fi
export APK_KEYSTORE_PASS

APKTOOL="${APKTOOL:-$HOME/tools/apktool/apktool.jar}"
[ -f "$APKTOOL" ] || APKTOOL="$(command -v apktool || true)"
if [ -z "$APKTOOL" ] || [ ! -f "$APKTOOL" ]; then
  echo "[ERRO] apktool nao encontrado."
  echo "       Instale: https://apktool.org  ou defina APKTOOL=/caminho/apktool.jar"
  exit 1
fi

echo "=== 1/4 decode do APK ==="
# limpeza total: garante que nao reaproveita um projeto antigo
# (reaproveitar quebraria os patches, que rodam sobre o smali decodificado)
rm -rf "$PROJECT" "$HERE/build"
mkdir -p "$(dirname "$PROJECT")"
if [[ "$APKTOOL" == *.jar ]]; then
  java -jar "$APKTOOL" d "$APK_ORIG" -o "$PROJECT" -f
else
  "$APKTOOL" d "$APK_ORIG" -o "$PROJECT" -f
fi

# confere que o decode gerou o que o patch precisa
MISSING=0
for f in smali/c.smali smali/c41.smali smali/p6.smali \
         smali_classes2/xt.smali smali_classes2/qx1.smali smali_classes2/wz.smali; do
  if [ ! -f "$PROJECT/$f" ]; then
    echo "[ERRO] decode incompleto: faltou $f"
    MISSING=1
  fi
done
if [ "$MISSING" = "1" ]; then
  echo "       o APK original pode estar corrompido?  confira apk/DTunnel_5.0.0.apk"
  exit 1
fi

echo "=== 2/4 patches de smali ==="
# A chave publica de assinatura do reply (wz.h) e OPCIONAL: o mod bypassa a
# verificacao da assinatura (patch em cx.smali), entao o app aceita a
# resposta de qualquer servidor. Ela so e precisa se voce quiser manter a
# assinatura ativa no servidor.
if [ -f "$KEYS/server_reply_key.json" ]; then
  HAVE_REPLY_KEY=1
  REPLY_ARG="--reply-pub-file $KEYS/server_reply_key.json"
  VERIFY_REPLY="--reply-pub-file $KEYS/server_reply_key.json"
else
  HAVE_REPLY_KEY=0
  REPLY_ARG=""
  VERIFY_REPLY=""
  echo "[*] sem chave de assinatura: o app aceita a resposta assim mesmo (bypass)"
fi

# TLS ou plaintext. Em "off" o canal gRPC vira h2c puro: sem certificado,
# sem CA no APK e sem network security config.
TLS_MODE="${TLS_MODE:-auto}"
if [ "$TLS_MODE" = "off" ]; then
  # TLS_MODE=off = compilar SEM depender de certificado/CA confiavel.
  # O canal gRPC continua em TLS, mas o app ignora a validacao do
  # certificado (qx1 = hostname, p6 = trust manager) - por isso nao
  # precisa de CA no APK.
  # NAO se aplica o patch de PLAINTEXT (tx1/qo1): ele forca h2c em TODAS
  # as conexoes OkHttp, inclusive a do PROXY do tunel (modo SSL_PROXY),
  # e o tunel sobe mas nao passa trafego.
  python3 patch/patch_mod.py --project "$PROJECT" \
    --host "$HOST" --port "$PORT" \
    --tls off --no-plaintext $REPLY_ARG
else
  python3 patch/patch_mod.py --project "$PROJECT" \
    --host "$HOST" --port "$PORT" $REPLY_ARG
fi

if [ "$TLS_MODE" = "off" ]; then
  echo "=== 2b/4 modo SEM CA (TLS ignorado pelo app) ==="
  echo "  o canal gRPC continua em TLS, mas o app nao valida o certificado"
  echo "  (qx1 = hostname, p6 = trust manager). O servidor pode estar em"
  echo "  DT_TLS=1 ou DT_TLS=auto."
  echo ""
  echo "  NOTA: sem a CA no APK o Android pode abortar o update em silêncio"
  echo "  (a validacao da PLATAFORMA continua valendo). Se a lista ficar"
  echo "  vazia, use o build normal (com CA):  ./make_mod.sh HOST PORTA"
else
  # A CA do servidor precisa estar embutida no APK: o Android valida o TLS do
  # servidor contra res/raw/dtca.pem (network security config). Sem isso o app
  # aborta o update em silencio, sem log nenhum.
  if [ ! -f "$KEYS/ca.pem" ]; then
    echo "=== 2b/4 CA do servidor no APK ==="
    echo "[ERRO] falta $KEYS/ca.pem"
    echo "       Baixe do servidor:  SSHPASS='senha' ./sync_keys.sh $HOST root"
    echo "       (sem a CA no APK o app aborta o update em silencio)"
    echo "       OU compile sem TLS:  TLS_MODE=off ./make_mod.sh $HOST $PORT"
    exit 1
  fi
  echo "=== 2b/4 CA do servidor no APK ==="
  python3 patch/tls_embed.py --project "$PROJECT" --ca "$KEYS/ca.pem"

  # Confere se a CA local assina o certificado que o servidor apresenta.
  # Se nao bater, o app vai abortar o update em silencio -> melhor falhar aqui.
  echo "=== 2c/4 conferindo a CA contra o servidor ==="
  python3 - "$HOST" "$PORT" "$KEYS/ca.pem" << 'PYEOF'
import socket, ssl, sys
host, port, ca = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ctx = ssl.create_default_context(cafile=ca)
try:
    with socket.create_connection((host, port), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            ssock.getpeercert()
            print(f"  [ok] {host}:{port} apresenta um certificado valido para a CA local")
except ssl.SSLCertVerificationError as e:
    print(f"  [ERRO] o servidor nao apresenta um certificado valido para a CA local:")
    print(f"         {e}")
    print("         A CA em keys/ca.pem NAO e a do servidor (ou o host/porta esta errado).")
    print("         Baixe as chaves de novo:  SSHPASS='senha' ./sync_keys.sh HOST root")
    sys.exit(1)
except Exception as e:
    print(f"  [aviso] nao consegui falar com {host}:{port} ({e})")
    print("           se o servidor ainda nao subiu, tudo bem - o build continua.")
PYEOF
fi


# NOTA: o app NAO le host/porta de um JSON em runtime.
# O codigo nativo (liba7c1.so) faz "injecao de dependencia nativa": recria a
# classe wz em runtime, e o <clinit> do DEX NUNCA executa (provado com um
# Log.e injetado que nunca aparece no logcat). So os VALORES dos campos
# (wz.f/wz.g) podem ser trocados - e isso e feito no build, abaixo.
# Para mudar o servidor sem recompilar, use um NOME DE DOMINIO e troque o
# registro DNS (A record) - o APK aponta para o dominio.
echo "  [i] host/porta embutidos no build: $HOST:$PORT"
echo "  [i] para trocar de servidor sem recompilar: use um dominio + DNS (A record)"

echo "=== 3/4 build + assinatura ==="
mkdir -p "$(dirname "$OUT")"
python3 patch/build_apk.py --project "$PROJECT" --out "$OUT" \
  --keystore "$APK_KEYSTORE" --ks-alias "$APK_KEY_ALIAS"

echo "=== 4/4 conferindo os patches no APK ==="
if [ "$TLS_MODE" = "off" ]; then
  python3 patch/verify_apk.py --apk "$OUT" --host "$HOST" --port "$PORT" \
    --plaintext $VERIFY_REPLY
else
  python3 patch/verify_apk.py --apk "$OUT" --host "$HOST" --port "$PORT" $VERIFY_REPLY
fi

echo ""
echo "=============================================="
echo " APK pronto: $OUT"
echo "   servidor : $HOST:$PORT"
echo ""
echo " Instalar no celular:"
echo "   adb install -r $OUT"
echo ""
echo " IMPORTANTE: o servidor precisa usar a MESMA"
echo " chave de assinatura (keys/server_reply.key)."
echo "=============================================="
