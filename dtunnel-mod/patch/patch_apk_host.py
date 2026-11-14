#!/usr/bin/env python3
"""Troca o host/porta do servidor DIRETAMENTE no APK (sem recompilar).

Como funciona:
  o host e a porta do servidor de update ficam gravados no classes2.dex,
  dentro da classe wz, como dois arrays de ints (um int por caractere,
  cada char XOR 0x86). O script troca esses bytes no lugar.

REGRAS (todas verificadas no aparelho):
  - O TEXTO NOVO tem que ter o MESMO numero de caracteres do original.
    O .so (liba7c1.so) recria a classe wz em runtime e valida a
    ESTRUTURA dela: mudar o tamanho do array faz a injecao falhar e o
    app crasha no startup com
        java.lang.NoSuchFieldError: d
        Could not create instance for '[Singleton: sl0]'
    Ex.: 'SEU-SERVIDOR-IP' (14) -> '203.0.113.10' (13) OK.
         '203.0.113.4'   (12)  -> CRASHA.
  - O checksum interno do DEX (adler32 no offset 8 e sha1 no offset 12)
    tem que ser recalculado, senao o ART recusa o dex:
        Failure to verify dex file ... Bad checksum
  - O guard de integridade do app: `assets/.checksum` (sha256 dos .dex +
    lib/*.so + assets/*) E o mesmo hash dentro do AndroidManifest.xml.
    Se nao forem atualizados, o app se mata sozinho no startup
    ("System.exit called, status: 0").
  - A ORDEM dos arquivos no zip importa e o metodo de compressao de cada
    entrada tambem (res/* e assets/* sao STORED no APK original).
  - NAO rodar zipalign: ele realinha os STORED e o app crasha.

Uso:
  python3 patch_apk_host.py --apk app.apk --host NOVO_IP --port 8443 --out novo.apk
  python3 patch_apk_host.py --apk app.apk --host NOVO_IP --port 8443 --out novo.apk \
      --ks patch/dt2.jks --ks-pass dtpass --ks-alias dt
"""
import argparse
import hashlib
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib

XOR = 0x86
HOST_OFF = 0x18437C   # offset do array do host em classes2.dex
PORT_OFF = 0x1843BC   # offset do array da porta em classes2.dex
HOST_KEEP = 16        # ints totais do array do host
PORT_KEEP = 16        # ints totais do array da porta


def decode_at(dex, off, n):
    vals = struct.unpack_from("<%di" % n, dex, off)
    return "".join(chr(v ^ XOR) for v in vals)


def text_len_at(dex, off, n):
    """Tamanho do texto: os charsyte imprimeveis ate o primeiro byte
    que nao e caractere ASCII valido (o array tem bytes de controle
    depois do texto)."""
    s = decode_at(dex, off, n)
    for i, ch in enumerate(s):
        o = ord(ch)
        # imprimeveis normais (0x20-0x7e) contam; controles nao.
        # o 0x40386 (bytes de controle do dex) NAO conta.
        if o < 0x20 or o > 0x7e:
            return i
    return len(s)


def find_build_tools():
    cands = []
    env = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if env:
        cands.append(os.path.join(env, "build-tools"))
    cands += [
        os.path.expanduser("~/Android/Sdk/build-tools"),
        "/opt/android-sdk/build-tools",
    ]
    for base in cands:
        if not os.path.isdir(base):
            continue
        for v in reversed(sorted(os.listdir(base))):
            p = os.path.join(base, v)
            if os.path.isfile(os.path.join(p, "apksigner")):
                return p
    raise SystemExit("[ERRO] build-tools nao encontrado (defina ANDROID_SDK_ROOT)")


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.stderr.write(p.stdout + p.stderr)
        raise SystemExit("[ERRO] comando falhou: %s" % " ".join(cmd))
    return p


def build_apk(src, dst, host, port, ks, ks_pass, ks_alias, build_tools=None):
    tmp = tempfile.mkdtemp(prefix="patch_apk_")
    zin = zipfile.ZipFile(src)
    try:
        order = [i.filename for i in zin.infolist() if not i.is_dir()]
        ctype = {i.filename: i.compress_type for i in zin.infolist()}

        # ---- 1) troca host e porta no classes2.dex ----
        dex = bytearray(zin.read("classes2.dex"))
        for off, val, keep, label in ((HOST_OFF, host, HOST_KEEP, "host"),
                                      (PORT_OFF, port, PORT_KEEP, "porta")):
            cur = decode_at(dex, off, keep)
            # o texto real: os chars ate o terminador (0x40300). O .so le
            # exatamente esse tanto de ints.
            cur_len = text_len_at(dex, off, keep)
            # o ultimo slot do array e o terminador -> o texto usa
            # (n_slots - 1) slots
            cur_len = min(cur_len, keep - 1)
            print("  [-] %s: %r -> %s" % (label, cur.split("\x00")[0], val))
            if len(val) != cur_len:
                raise SystemExit(
                    "[ERRO] o %s novo tem %d chars, mas o original tem %d.\n"
                    "       O app valida a ESTRUTURA do array no dex: mudar o\n"
                    "       tamanho quebra a injecao nativa e o app crasha no\n"
                    "       startup (NoSuchFieldError: d).\n"
                    "       Use um host/porta com EXATAMENTE o mesmo numero\n"
                    "       de caracteres. (ex.: 'SEU-SERVIDOR-IP' -> "
                    "'203.0.113.10')" % (label, len(val), cur_len))
            body = b"".join(struct.pack("<i", (ord(c) ^ XOR) & 0xFF) for c in val)
            dex[off:off + len(body)] = body

        # ---- 2) recalcula o checksum interno do DEX ----
        # header: magic(8) | adler32(4, off 8) | sha1(20, off 12) | file_size(4, 32)
        # o sha1 cobre o arquivo do offset 32; o adler32, do offset 12.
        dex[12:32] = hashlib.sha1(bytes(dex[32:])).digest()
        dex[8:12] = struct.pack("<I", zlib.adler32(bytes(dex[12:])) & 0xFFFFFFFF)
        dex = bytes(dex)
        if zlib.adler32(dex[12:]) & 0xFFFFFFFF != struct.unpack_from("<I", dex, 8)[0]:
            raise SystemExit("[ERRO] checksum adler32 do dex nao bate")

        # ---- 3) remontar o zip (mesma ordem e mesma compressao) ----
        def matches(n):
            return (n != "assets/.checksum"
                    and (n.endswith(".dex")
                         or (n.startswith("lib/") and n.endswith(".so"))
                         or n.startswith("assets/")))

        staged = os.path.join(tmp, "staged.apk")
        with zipfile.ZipFile(staged, "w", zipfile.ZIP_DEFLATED) as zout:
            for arc in order:
                if arc == "classes2.dex":
                    zout.writestr(arc, dex, ctype.get(arc, zipfile.ZIP_DEFLATED))
                else:
                    zout.writestr(arc, zin.read(arc), ctype.get(arc, zipfile.ZIP_DEFLATED))

        with zipfile.ZipFile(staged) as z:
            names = sorted(n for n in z.namelist()
                           if not z.getinfo(n).is_dir() and matches(n))
            h = hashlib.sha256()
            for n in names:
                h.update(z.read(n))
        digest = h.hexdigest()
        print("  [+] hash de integridade: %s (%d arquivos)" % (digest[:16] + "...", len(names)))

        # ---- 4) grava o .checksum e atualiza o hash no manifest ----
        final = os.path.join(tmp, "final.apk")
        old_digest = None
        with zipfile.ZipFile(staged) as zs:
            if "assets/.checksum" in zs.namelist():
                old_digest = zs.read("assets/.checksum").decode().strip()
            with zipfile.ZipFile(final, "w", zipfile.ZIP_DEFLATED) as zout:
                for arc in order:
                    data = zs.read(arc)
                    ct = ctype.get(arc, zipfile.ZIP_DEFLATED)
                    if arc == "assets/.checksum":
                        zout.writestr(arc, digest.encode(), zipfile.ZIP_STORED)
                    elif arc == "AndroidManifest.xml" and old_digest:
                        ob = old_digest.encode("utf-16-le")
                        nb = digest.encode("utf-16-le")
                        if ob in data:
                            data = data.replace(ob, nb)
                            print("  [+] hash atualizado no AndroidManifest.xml")
                        else:
                            print("  [!] hash antigo nao achou no manifest (pool)")
                        zout.writestr(arc, data, ct)
                    else:
                        zout.writestr(arc, data, ct)

        # ---- 5) assinatura (sem zipalign: ele quebra o app) ----
        bt = build_tools or find_build_tools()
        run([os.path.join(bt, "apksigner"), "sign", "--ks", ks,
             "--ks-pass", "pass:" + ks_pass, "--ks-key-alias", ks_alias,
             "--key-pass", "pass:" + ks_pass, "--out", dst, final])
        print("  [+] APK: %s" % dst)
    finally:
        zin.close()
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk", required=True)
    ap.add_argument("--host", required=True)
    ap.add_argument("--port", default="8443")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ks", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "dt2.jks"))
    ap.add_argument("--ks-pass", default="dtpass")
    ap.add_argument("--ks-alias", default="dt")
    ap.add_argument("--build-tools", default=None)
    args = ap.parse_args()
    build_apk(args.apk, args.out, args.host, args.port,
              args.ks, args.ks_pass, args.ks_alias, args.build_tools)


if __name__ == "__main__":
    main()
