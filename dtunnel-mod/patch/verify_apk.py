#!/usr/bin/env python3
"""Confere que o APK final tem todos os patches e o host/porta corretos.

Decodifica o APK com o apktool e verifica:
  - os 5 patches de smali estao presentes
  - wz.f (host), wz.g (porta) e wz.h (chave publica) estao corretos

Sai com codigo != 0 se algo estiver errado.
"""
import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

APKTOOL = os.environ.get("APKTOOL") or os.path.expanduser("~/tools/apktool/apktool.jar")
if not os.path.exists(APKTOOL):
    APKTOOL = shutil.which("apktool") or APKTOOL

CHECKS = [
    ("smali/c.smali", "bypass Remote channel unavailable",
     [r"\.method public static synthetic r\(Ljava/lang/String;\)V",
      r"\.locals 0",
      r"return-void"]),
    ("smali/c41.smali", "bypass assinatura do reply",
     # o apktool/smali renomeia os labels no build (goto :cond_8 vira goto :goto_2),
     # entao verificamos o EFEITO: depois de :goto_1 nao pode ter mais um
     # "if-nez v3, ..." (o bypass esta no "goto" incondicional logo em seguida)
     [r":goto_1\s*\n\s*goto :\w+"]),
    # NOTA: o bypass da assinatura do BUNDLE (xt.smali) nao e aplicado de
    # proposito: o app valida o CONTEUDO do bundle (checksum/decrypt), nao
    # apenas a assinatura. Pular so a assinatura faz o app descartar o
    # bundle e ficar sem config ("Missing udpServer").
    ("smali_classes2/qx1.smali", "bypass verificacao de hostname",
     [r"method public final verify\(Ljava/lang/String;Ljavax/net/ssl/SSLSession;\)Z\s*\n"
      r"\s*\.locals 1\s*\n\s*const/4 v0, 0x1"]),
    ("smali/p6.smali", "bypass verificacao de certificado TLS",
     [r"Ly91;"]),
]


def decode(apk, out):
    if APKTOOL.endswith(".jar"):
        cmd = ["java", "-jar", APKTOOL, "d", apk, "-o", out, "-f"]
    else:
        cmd = [APKTOOL, "d", apk, "-o", out, "-f"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-800:])
        print(r.stderr[-800:])
        raise SystemExit("[ERRO] falha ao decodificar o APK")


def read_wz(project):
    path = os.path.join(project, "smali_classes2", "wz.smali")
    content = open(path, encoding="utf-8").read()
    lines = content.split("\n")
    cur, field = None, {}
    for line in lines:
        s = line.strip()
        if s.startswith("fill-array-data"):
            cur = s.split(":")[-1]
        m = re.match(r"sput-object v0, Lwz;->(\w):", s)
        if m:
            field[m.group(1)] = cur
            cur = None
    arrays = {}
    for m in re.finditer(
        r"^\s*:(array_\w+)\n\s+\.array-data 4\n((?:\s+0x[0-9a-fA-F]+\n)+)\s+\.end array-data",
        content, re.M,
    ):
        vals = [int(x, 16) for x in re.findall(r"0x([0-9a-fA-F]+)", m.group(2))]
        arrays[m.group(1)] = "".join(chr(v ^ 0x86) for v in vals)
    return field, arrays


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk", required=True)
    ap.add_argument("--host", required=True)
    ap.add_argument("--port", required=True)
    ap.add_argument("--reply-pub-file", default=None,
                    help="opcional: com o bypass da assinatura a chave nao e exigida")
    ap.add_argument("--plaintext", action="store_true",
                    help="APK em modo plaintext (sem TLS): nao exige CA/NSC")
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix="verify_apk_")
    try:
        decode(args.apk, tmp)
        errs = []

        print("  patches:")
        for rel, label, needles in CHECKS:
            path = os.path.join(tmp, rel)
            ok = False
            if os.path.exists(path):
                content = open(path, encoding="utf-8").read()
                ok = all(re.search(n, content) for n in needles)
            print(f"    {'ok  ' if ok else 'FALTA'}  {label}")
            if not ok:
                errs.append(label)

        print("  configuracao:")
        field, arrays = read_wz(tmp)
        host = arrays.get(field.get("f"))
        port = arrays.get(field.get("g"))
        pub = arrays.get(field.get("h"))
        if args.reply_pub_file and os.path.exists(args.reply_pub_file):
            want_pub = json.load(open(args.reply_pub_file))["pub_b64"]
        else:
            want_pub = None

        ok = host == args.host
        print(f"    {'ok  ' if ok else 'FALTA'}  host = {host} (esperado {args.host})")
        if not ok:
            errs.append("host")

        ok = port == args.port
        print(f"    {'ok  ' if ok else 'FALTA'}  porta = {port} (esperado {args.port})")
        if not ok:
            errs.append("porta")

        if want_pub is None:
            print("    --   chave publica do reply (opcional: assinatura bypassada)")
        else:
            ok = pub == want_pub
            print(f"    {'ok  ' if ok else 'FALTA'}  chave publica do reply")
            if not ok:
                errs.append("chave publica")

        print("  integridade:")
        cx = os.path.join(tmp, "smali", "cx.smali")
        ok = False
        if os.path.exists(cx):
            txt = open(cx, encoding="utf-8").read()
            # o apktool renomeia os labels na redecodificacao, entao
            # procuramos o PADRAO (cmp-long + goto), nao o nome do label
            ok = "if-gtz p0, :" not in txt and bool(
                re.search(r"cmp-long p0, v3, v6[\s\S]{0,80}?\n\s*goto", txt)
            )
        print(f"    {'ok  ' if ok else 'FALTA'}  bypass da verificacao da assinatura do reply")
        if not ok:
            errs.append("bypass da assinatura do reply")

        if args.plaintext:
            # Modo "sem CA": o canal gRPC continua em TLS, mas o app ignora
            # a validacao do certificado (qx1 = hostname, p6 = trust manager).
            # O patch de PLAINTEXT (tx1/qo1) NAO e aplicado: ele forca h2c
            # em todas as conexoes OkHttp, inclusive a do PROXY do tunel
            # (modo SSL_PROXY), e o tunel sobe mas nao passa trafego.
            print("  tls (sem CA: o app ignora o certificado do servidor):")
            qx1 = os.path.join(tmp, "smali_classes2", "qx1.smali")
            p6 = os.path.join(tmp, "smali", "p6.smali")
            ok_qx1 = os.path.exists(qx1) and "const/4 v0, 0x1" in open(qx1, encoding="utf-8").read()
            ok_p6 = os.path.exists(p6) and "Ly91;" in open(p6, encoding="utf-8").read()
            print(f"    {'ok  ' if ok_qx1 else 'FALTA'}  bypass verificacao de hostname (TLS do proxy)")
            if not ok_qx1:
                errs.append("bypass verificacao de hostname")
            print(f"    {'ok  ' if ok_p6 else 'FALTA'}  bypass verificacao de certificado TLS")
            if not ok_p6:
                errs.append("bypass verificacao de certificado TLS")
        else:
            print("  tls (CA do servidor embutida):")
            ca_path = os.path.join(tmp, "res", "raw", "dtca.pem")
            ok = os.path.exists(ca_path) and "BEGIN CERTIFICATE" in open(ca_path, encoding="utf-8").read()
            print(f"    {'ok  ' if ok else 'FALTA'}  res/raw/dtca.pem (CA do servidor)")
            if not ok:
                errs.append("CA do servidor (dtca.pem)")

            nsc_path = os.path.join(tmp, "res", "xml", "network_security_config.xml")
            ok = os.path.exists(nsc_path) and "@raw/dtca" in open(nsc_path, encoding="utf-8").read()
            print(f"    {'ok  ' if ok else 'FALTA'}  network_security_config.xml (trust anchor)")
            if not ok:
                errs.append("network_security_config.xml")

            man = os.path.join(tmp, "AndroidManifest.xml")
            ok = os.path.exists(man) and "networkSecurityConfig" in open(man, encoding="utf-8").read()
            print(f"    {'ok  ' if ok else 'FALTA'}  manifest: android:networkSecurityConfig")
            if not ok:
                errs.append("manifest sem networkSecurityConfig")

        if errs:
            print(f"\n[ERRO] problemas: {', '.join(errs)}")
            raise SystemExit(1)
        print("\n  tudo certo")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
