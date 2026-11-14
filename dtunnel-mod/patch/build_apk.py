#!/usr/bin/env python3
"""Constroi e assina o APK modado do DTunnel.

Fluxo:
  1. apktool b  (projeto smali -> dex)
  2. calcula o hash do conteudo e atualiza assets/.checksum + AndroidManifest.xml
  3. zipalign
  4. apksigner (keystore dt2.jks)

Uso:
  python3 build_apk.py --project /caminho/dt --out dist/dt_patched_signed.apk
"""
import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def find_apktool():
    for c in [
        os.environ.get("APKTOOL"),
        os.path.expanduser("~/tools/apktool/apktool.jar"),
        shutil.which("apktool"),
    ]:
        if c and os.path.exists(c):
            return c
    return None


def find_build_tools():
    """Localiza o build-tools do Android SDK (apksigner/zipalign)."""
    roots = [os.environ.get("ANDROID_SDK_ROOT"), os.environ.get("ANDROID_HOME"),
             os.path.expanduser("~/Android/Sdk")]
    for r in roots:
        if not r:
            continue
        bt = os.path.join(r, "build-tools")
        if os.path.isdir(bt):
            vers = sorted([d for d in os.listdir(bt) if os.path.isdir(os.path.join(bt, d))], reverse=True)
            for v in vers:
                p = os.path.join(bt, v)
                if os.path.exists(os.path.join(p, "apksigner")):
                    return p
    # fallback: procura no PATH
    for tool in ("apksigner", "zipalign"):
        w = shutil.which(tool)
        if w:
            return os.path.dirname(w)
    return None


def run(cmd, **kw):
    print("+", " ".join(cmd) if isinstance(cmd, list) else cmd)
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        raise SystemExit("comando falhou")
    return r


def matches(name):
    """Arquivos cujo conteudo entra no hash (igual ao build original)."""
    if name == "assets/.checksum":
        return False
    if name.endswith(".dex"):
        return True
    if name.startswith("lib/") and name.endswith(".so"):
        return True
    if name.startswith("assets/"):
        return True
    return False


def compute_hash(zpath):
    z = zipfile.ZipFile(zpath)
    names = sorted(n for n in z.namelist() if not z.getinfo(n).is_dir() and matches(n))
    h = hashlib.sha256()
    for n in names:
        h.update(z.read(n))
    z.close()
    return h.hexdigest(), len(names)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="pasta do projeto apktool")
    ap.add_argument("--out", required=True, help="APK final assinado")
    ap.add_argument("--keystore", default=os.path.join(HERE, "dt2.jks"))
    ap.add_argument("--ks-pass", default=os.environ.get("APK_KEYSTORE_PASS", ""))
    ap.add_argument("--ks-alias", default="dt")
    args = ap.parse_args()

    apktool = find_apktool()
    if not apktool:
        raise SystemExit("[ERRO] apktool nao encontrado (defina APKTOOL= ou ~/tools/apktool/apktool.jar)")
    bt = find_build_tools()
    if not bt:
        raise SystemExit("[ERRO] build-tools nao encontrado (defina ANDROID_SDK_ROOT=)")
    if not os.path.exists(args.keystore):
        raise SystemExit(f"[ERRO] keystore nao encontrado: {args.keystore}")
    if not args.ks_pass:
        raise SystemExit("[ERRO] defina APK_KEYSTORE_PASS no ambiente (não versionar a senha).")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmpdir = os.path.join(os.path.dirname(os.path.abspath(args.out)), "_build_tmp")
    os.makedirs(tmpdir, exist_ok=True)
    build = os.path.join(tmpdir, "build.apk")
    staged = os.path.join(tmpdir, "staged.apk")
    aligned = os.path.join(tmpdir, "aligned.apk")

    if os.path.exists(build):
        os.remove(build)

    if apktool.endswith(".jar"):
        run(["java", "-jar", apktool, "b", args.project, "-o", build])
    else:
        run([apktool, "b", args.project, "-o", build])

    H, cnt = compute_hash(build)
    print(f"[+] hash={H} ({cnt} arquivos)")

    old = open(os.path.join(args.project, "assets", ".checksum")).read().strip()

    zin = zipfile.ZipFile(build, "r")
    zout = zipfile.ZipFile(staged, "w")
    patched = False
    for item in zin.infolist():
        if item.is_dir():
            continue
        data = zin.read(item.filename)
        ctype = item.compress_type
        if item.filename == "assets/.checksum":
            data = H.encode()
            ctype = zipfile.ZIP_STORED
        elif item.filename == "AndroidManifest.xml":
            ob = old.encode("utf-16-le")
            nb = H.encode("utf-16-le")
            if ob in data:
                data = data.replace(ob, nb)
                patched = True
            else:
                print("[!] hash antigo nao encontrado no manifest (pool)")
        elif item.filename == "resources.arsc":
            ctype = zipfile.ZIP_STORED
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        zi.compress_type = ctype
        zi.external_attr = item.external_attr
        zout.writestr(zi, data)
    zout.close()
    zin.close()
    print(f"[+] manifest atualizado: {patched}")

    for p in (aligned, args.out):
        if os.path.exists(p):
            os.remove(p)
    run([os.path.join(bt, "zipalign"), "-p", "-f", "4", staged, aligned])
    run([os.path.join(bt, "apksigner"), "sign", "--ks", args.keystore,
         "--ks-pass", f"pass:{args.ks_pass}", "--ks-key-alias", args.ks_alias,
         "--key-pass", f"pass:{args.ks_pass}", "--out", args.out, aligned])

    H2, _ = compute_hash(args.out)
    print(f"[+] hash final={H2} -> {'MATCH' if H2 == H else 'MISMATCH'}")
    print(f"[+] APK: {args.out}")
    shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
