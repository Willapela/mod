#!/usr/bin/env python3
"""Embute a CA do servidor no APK e habilita o trust anchor no Android.

Sem isso o app aborta o update em silencio: o TLS com o servidor e
validado pela platforma (network security config) e a CA do servidor
precisa estar em res/raw/dtca.pem, referenciada pelo manifest.

Uso:
  python3 tls_embed.py --project build/dt --ca keys/ca.pem
  python3 tls_embed.py --project build/dt --ca keys/ca.pem --plaintext
"""
import argparse
import os
import re
import shutil
import sys

NSC = """<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="@raw/dtca" />
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
"""


def die(msg):
    print(f"[ERRO] {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="projeto decodificado pelo apktool")
    ap.add_argument("--ca", required=True, help="arquivo ca.pem (CA do servidor)")
    ap.add_argument("--no-nsc", action="store_true", help="nao instala o network security config")
    args = ap.parse_args()

    if not os.path.isfile(args.ca):
        die(f"CA nao encontrada: {args.ca}")

    with open(args.ca, "r", encoding="utf-8", errors="ignore") as fh:
        ca = fh.read().strip()
    if "BEGIN CERTIFICATE" not in ca:
        die(f"{args.ca} nao parece um certificado PEM")

    raw = os.path.join(args.project, "res", "raw")
    os.makedirs(raw, exist_ok=True)
    with open(os.path.join(raw, "dtca.pem"), "w", encoding="utf-8") as fh:
        fh.write(ca + "\n")
    print("  [+] res/raw/dtca.pem instalado (CA do servidor)")

    if args.no_nsc:
        return

    xml_dir = os.path.join(args.project, "res", "xml")
    os.makedirs(xml_dir, exist_ok=True)
    nsc_path = os.path.join(xml_dir, "network_security_config.xml")
    with open(nsc_path, "w", encoding="utf-8") as fh:
        fh.write(NSC)
    print("  [+] res/xml/network_security_config.xml criado (trust anchor @raw/dtca)")

    manifest = os.path.join(args.project, "AndroidManifest.xml")
    with open(manifest, "r", encoding="utf-8") as fh:
        text = fh.read()

    if "android:networkSecurityConfig" in text:
        print("  [.] manifest ja referencia networkSecurityConfig")
    else:
        m = re.search(r"<application\b[^>]*?>", text, re.S)
        if not m:
            die("nao achei a tag <application> no AndroidManifest.xml")
        tag = m.group(0)
        new_tag = tag[:-1] + ' android:networkSecurityConfig="@xml/network_security_config">'
        text = text[:m.start()] + new_tag + text[m.end():]
        with open(manifest, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("  [+] manifest: android:networkSecurityConfig adicionado")


if __name__ == "__main__":
    main()
