#!/usr/bin/env python3
"""Aplica todos os patches de smali do mod DTunnel em um projeto apktool.

Idempotente: pode rodar varias vezes sem efeito colateral.

Patches:
  1) dt/smali/c.smali          -> c.r() deixa de lancar IllegalStateException
                                  (evita "Remote channel unavailable" no boot)
  2) dt/smali/c41.smali        -> ignora a assinatura do reply gRPC
  3) dt/smali_classes2/xt.smali-> ignora a assinatura do config bundle
  4) dt/smali/p6.smali         -> injeta trust manager que aceita qualquer
                                  certificado TLS (bypass de SSL)
  5) dt/smali_classes2/qx1.smali -> HostnameVerifier sempre verdadeiro
  6) dt/smali_classes2/wz.smali -> host/porta do servidor + chave publica de
                                  assinatura do reply (wz.h)

Uso:
  python3 patch_mod.py --project /caminho/para/dt
  python3 patch_mod.py --project ... --host 1.2.3.4 --port 443
  python3 patch_mod.py --project ... --reply-pub-b64 <base64>
"""
import argparse
import base64
import json
import os
import re
import sys

XOR = 0x86

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()

def write(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def sub_once(content, pattern, repl, label, flags=re.S):
    """Substitui pattern; se ja substituido, nao faz nada (idempotente)."""
    new, n = re.subn(pattern, repl, content, count=1, flags=flags)
    if n == 0:
        # ja aplicado?
        if isinstance(repl, str) and repl in content:
            return content, False
        raise SystemExit(f"[ERRO] nao encontrei o alvo para: {label}")
    return new, True

def replace_method(content, signature, new_body, label):
    """Substitui um metodo inteiro (assinatura -> new_body)."""
    pattern = r"^\.method " + re.escape(signature) + r"\n(?:.*\n)*?^\.end method"
    if new_body.strip() in content:
        return content, False
    new, n = re.subn(pattern, lambda _: new_body, content, count=1, flags=re.M)
    if n == 0:
        raise SystemExit(f"[ERRO] nao encontrei o metodo para: {label}")
    return new, True

# --------------------------------------------------------------------------- #
# patches
# --------------------------------------------------------------------------- #

def patch_c(path):
    """c.r(String) deixa de lancar IllegalStateException."""
    content = read(path)
    if "method public static synthetic r(Ljava/lang/String;)V\n    .locals 0\n    return-void" in content:
        return False
    pattern = (
        r"(\.method public static synthetic r\(Ljava/lang/String;\)V\n)"
        r"    \.locals 1\n"
        r".*?"
        r"(\.end method)"
    )
    repl = r"\1    .locals 0\n    return-void\n\2"
    content, changed = sub_once(content, pattern, repl, "c.r()")
    write(path, content)
    return changed

def patch_c41(path):
    """Ignora a verificacao de assinatura do reply."""
    content = read(path)
    if re.search(r":goto_1\s*\n\s*goto :cond_8", content):
        return False
    pattern = r"(:goto_1\s*\n\s*)if-nez v3, :cond_8"
    content, changed = sub_once(content, pattern, r"\1goto :cond_8", "c41 assinatura do reply")
    write(path, content)
    return changed

def patch_xt(path):
    """Ignora a verificacao de assinatura do config bundle."""
    content = read(path)
    if re.search(r"\.line 1522\s*\n\s*nop", content):
        return False
    pattern = r"(\.line 1522\s*\n\s*)if-eqz v2, :cond_3c"
    content, changed = sub_once(content, pattern, r"\1nop", "xt assinatura do bundle")
    write(path, content)
    return changed

def patch_qx1(path):
    """HostnameVerifier sempre retorna true."""
    content = read(path)
    if re.search(
        r"method public final verify\(Ljava/lang/String;Ljavax/net/ssl/SSLSession;\)Z\s*\n"
        r"\s*\.locals 1\s*\n\s*const/4 v0, 0x1", content):
        return False
    pattern = (
        r"(\.method public final verify\(Ljava/lang/String;Ljavax/net/ssl/SSLSession;\)Z\n)"
        r"    \.locals 1\n"
        r".*?"
        r"(\.end method)"
    )
    repl = r"\1    .locals 1\n    const/4 v0, 0x1\n    return v0\n\2"
    content, changed = sub_once(content, pattern, repl, "qx1 HostnameVerifier")
    write(path, content)
    return changed

P6_K_NEW = """    .method public final k()Ljavax/net/ssl/SSLContext;
    .locals 3

    .line 1
    const-string p0, "newSSLContext"

    .line 2
    .line 3
    invoke-static {p0}, Landroid/os/StrictMode;->noteSlowCall(Ljava/lang/String;)V

    .line 4
    .line 5
    .line 6
    const-string p0, "TLS"

    .line 7
    .line 8
    .line 9
    invoke-static {p0}, Ljavax/net/ssl/SSLContext;->getInstance(Ljava/lang/String;)Ljavax/net/ssl/SSLContext;

    .line 10
    .line 11
    .line 12
    move-result-object v0

    .line 13
    .line 14
    new-instance v1, Ly91;

    .line 15
    .line 16
    .line 17
    invoke-direct {v1}, Ly91;-><init>()V

    .line 18
    const/4 v2, 0x1

    .line 19
    new-array v1, v2, [Ljavax/net/ssl/TrustManager;

    .line 20
    const/4 v2, 0x0

    .line 21
    aput-object v1, v1, v2

    .line 22
    const/4 v2, 0x0

    .line 23
    const/4 v1, 0x0

    .line 24
    invoke-virtual {v0, v1, v1, v2}, Ljavax/net/ssl/SSLContext;->init([Ljavax/net/ssl/KeyManager;[Ljavax/net/ssl/TrustManager;Ljava/security/SecureRandom;)V

    .line 25
    .line 26
    .line 27
    move-result-object v0

    .line 28
    return-object v0
.end method"""

def patch_p6(path):
    """p6.k() retorna um SSLContext com trust manager que aceita tudo."""
    content = read(path)
    if "Ly91;" in content:
        return False
    content, changed = replace_method(
        content,
        "public final k()Ljavax/net/ssl/SSLContext;",
        P6_K_NEW,
        "p6.k() trust manager",
    )
    write(path, content)
    return changed

def _xor_bytes(s):
    return [(ord(c) ^ XOR) & 0xFFFF for c in s]

def _array_block(name, values):
    lines = [f"    :{name}", "    .array-data 4"]
    lines += [f"        0x{v:x}" for v in values]
    lines += ["    .end array-data"]
    return "\n".join(lines) + "\n"

def _normalize_array_labels(content):
    """O apktool as vezes gera labels com indentacao errada (8 espacos).

    O smali aceita ':array_6' com 4 ou 8 espacos, mas Mixing::gera
    arquivo invalido quando um label novo e inserido no fim. Normaliza
    todos para 4 espacos.
    """
    return re.sub(r"^[ ]+:(array_\d+)\s*$", r"    :\1", content, flags=re.M)

def _set_const_for_array(content, array_name, size):
    """Ajusta o const/16 que precede o new-array/fill-array-data de um array."""
    target = f"fill-array-data v0, :{array_name}"
    idx = content.find(target)
    if idx == -1:
        raise SystemExit(f"[ERRO] nao encontrei {target}")
    window = content[max(0, idx - 600):idx]
    matches = list(re.finditer(r"const/16 v0, 0x[0-9a-fA-F]+", window))
    if not matches:
        raise SystemExit(f"[ERRO] nao encontrei o const/16 do array {array_name}")
    m = matches[-1]
    start = max(0, idx - 600) + m.start()
    end = max(0, idx - 600) + m.end()
    return content[:start] + f"const/16 v0, 0x{size:x}" + content[end:]

def _find_array_for_field(content, field):
    """Descobre o label do array que alimenta o campo wz.<field>."""
    # procura: fill-array-data v0, :LABEL ... sput-object v0, Lwz;-><field>:
    m = re.search(
        r"fill-array-data v0, :(array_\w+)\n(?:[^\n]*\n){0,24}?"
        r"    sput-object v0, Lwz;->" + field + r":",
        content,
    )
    return m.group(1) if m else None

def set_wz_host_port(path, host, port):
    """Grava host (wz.f) e porta (wz.g) no wz.smali.

    Estrutura ORIGINAL:
        wz.f <- array_6  (host)
        wz.g <- inline   (porta)
        wz.h <- array_7  (chave publica de assinatura do reply)
        wz.i <- array_8  (device id)

    O apktool reordena os labels array_N ao reescrever o arquivo, entao
    a porta (inline) vira um label nomeado "array_porta" e o host e
    localizado pelo campo wz.f.
    """
    content = read(path)
    host_b = _xor_bytes(host)
    port_b = _xor_bytes(port)

    # ---- host: array que alimenta wz.f
    host_label = _find_array_for_field(content, "f")
    if not host_label:
        raise SystemExit("[ERRO] nao encontrei o array do host (wz.f) no wz.smali")
    content, _ = sub_once(
        content,
        r":" + re.escape(host_label) + r"\n    \.array-data 4\n(?:        0x[0-9a-fA-F]+\n)+    \.end array-data",
        _array_block(host_label, host_b).rstrip("\n"),
        f"wz {host_label} (host)",
    )
    content = _set_const_for_array(content, host_label, len(host_b))

    # ---- porta: troca o bloco inline por um array dedicado
    inline_pat = re.compile(
        r"    const/16 v0, 0x[0-9a-fA-F]+\n"
        r"(?:    \.line \d+\n|\n)*"
        r"    const/16 v1, 0x[0-9a-fA-F]+\n"
        r"(?:    \.line \d+\n|\n)*"
        r"    filled-new-array \{v0, v0, v1\}, \[I\n"
        r"(?:    \.line \d+\n|\n)*"
        r"    move-result-object v0\n"
        r"(?:    \.line \d+\n|\n)*"
        r"    invoke-static \{v0\}, Lwz;->a\(\[I\)Ljava/lang/String;\n"
        r"(?:    \.line \d+\n|\n)*"
        r"    move-result-object v0\n"
        r"(?:    \.line \d+\n|\n)*"
        r"    sput-object v0, Lwz;->g:Ljava/lang/String;",
        re.M,
    )
    new_port = (
        f"    const/16 v0, 0x{len(port_b):x}\n"
        "\n"
        "    .line 89\n"
        "    .line 90\n"
        "    new-array v0, v0, [I\n"
        "\n"
        "    .line 91\n"
        "    .line 92\n"
        "    fill-array-data v0, :array_porta\n"
        "\n"
        "    .line 93\n"
        "    .line 94\n"
        "    invoke-static {v0}, Lwz;->a([I)Ljava/lang/String;\n"
        "\n"
        "    .line 95\n"
        "    .line 96\n"
        "    move-result-object v0\n"
        "\n"
        "    .line 97\n"
        "    .line 98\n"
        "    sput-object v0, Lwz;->g:Ljava/lang/String;"
    )
    content, n = inline_pat.subn(lambda _: new_port, content, count=1)
    if n == 0:
        raise SystemExit("[ERRO] nao encontrei o bloco inline da porta (wz.g) no wz.smali")

    # insere o array da porta logo apos o array do host (mesmo metodo <clinit>)
    anchor = re.search(
        r"([ \t]*:" + re.escape(host_label) + r"\n[ \t]*\.array-data 4\n(?:[ \t]+0x[0-9a-fA-F]+\n)+[ \t]*\.end array-data\n)",
        content,
    )
    if not anchor:
        raise SystemExit("[ERRO] nao encontrei o array do host para ancorar o da porta")
    indent = anchor.group(1)[:len(anchor.group(1)) - len(anchor.group(1).lstrip())]
    block = (f"{indent}:array_porta\n{indent}.array-data 4\n"
             + "".join(f"{indent}    0x{v:x}\n" for v in port_b)
             + f"{indent}.end array-data\n")
    content = content[:anchor.end()] + block + content[anchor.end():]

    content = _normalize_array_labels(content)
    write(path, content)
    return True

def set_wz_reply_pub(path, pub_b64):
    """Grava a chave publica de assinatura do reply (wz.h).

    Em vez de depender do nome do label (o apktool reordena os array_N ao
    reescrever o arquivo), localizamos o array que alimenta o campo wz.h.
    """
    content = read(path)
    vals = _xor_bytes(pub_b64)

    target_label = _find_array_for_field(content, "h")
    if not target_label:
        raise SystemExit("[ERRO] nao encontrei o array da chave publica (wz.h) no wz.smali")

    content, _ = sub_once(
        content,
        r":" + re.escape(target_label) + r"\n    \.array-data 4\n(?:        0x[0-9a-fA-F]+\n)+    \.end array-data",
        _array_block(target_label, vals).rstrip("\n"),
        f"wz {target_label} (chave publica do reply)",
    )
    content = _set_const_for_array(content, target_label, len(vals))
    content = _normalize_array_labels(content)
    write(path, content)
    return True

# --------------------------------------------------------------------------- #



def patch_cx_reply_sig(path):
    """Desliga a verificacao da assinatura dos replies (cx.smali).

    O metodo cx.a(String) decodifica a chave publica (wz.h), monta a
    PublicKey EC e confere a assinatura do reply. No fim ele tem:

        if-gtz p0, :cond_9      # p0 = digest do bundle confereu -> pula a
                                # verificacao (a assinatura e redundante)
        sget-object p0, Lwz;->h

    Trocando o if-gtz por um goto, a verificacao e SEMPRE pulada: o app
    aceita a resposta de qualquer servidor. Com isso o APK deixa de
    depender da chave de assinatura - reinstalar o servidor nao quebra
    mais nada, e so o host/porta exigem recompilar.
    """
    content = read(path)
    # o label pode ter sido renomeado pelo apktool (:cond_9 -> :goto_5),
    # entao o padrao aceita qualquer :cond_* / :goto_*
    pattern = (
        r"(    if-gtz p0, (:(?:cond|goto)_\w+)\n)"
        r"((?:[ \t]*(?:\.line \d+)?\n)*)"
        r"(    sget-object p0, Lwz;->h:Ljava/lang/String;\n)"
    )
    repl = r"    goto \2\n\3\4"
    content, changed = sub_once(content, pattern, repl, "cx bypass verificacao da assinatura do reply")
    write(path, content)
    return changed


def patch_plaintext(path):
    """Forca o canal gRPC em PLAINTEXT (h2c), sem TLS e sem certificado.

    tx1.<init>(String, int) e o construtor do builder (ofuscado pelo R8);
    ele grava o tipo de negociacao em tx1.g: 1 = TLS, 2 = PLAINTEXT.
    Trocando 1 por 2 o canal passa a falar h2c puro.

    O patch definitivo (que ignora o que o codigo nativo sobrescrever) fica
    em patch_plaintext_build(), no build() do OkHttpChannelBuilder.

    Sem isso o app usa TLS validado pela plataforma (network security config)
    e aborta o update em silencio quando o servidor nao tem CA confiavel.
    """
    content = read(path)
    pattern = (
        r"(\.method public constructor <init>\(Ljava/lang/String;I\)V\n)"
        r"(.*?)"
        r"(    const/4 p2, 0x1\n)"
        r"((?:[ \t]*(?:\.line \d+)?\n)*)"
        r"(    iput p2, p0, Ltx1;->g:I\n)"
    )
    repl = r"\1\2    const/4 p2, 0x2\n\4\5"
    content, changed = sub_once(content, pattern, repl, "tx1 plaintext (sem TLS)")
    write(path, content)
    return changed



def patch_plaintext_build(path):
    """Forca o ramo PLAINTEXT dentro do build() do OkHttpChannelBuilder.

    qo1.b() mapeia o tipo de negociacao e escolhe entre TLS e PLAINTEXT.
    Forcamos o resultado para o ramo PLAINTEXT - assim funciona mesmo se o
    codigo nativo sobrescrever o tipo de negociacao.
    """
    content = read(path)
    pattern = (
        r"(    iget v1, v0, Ltx1;->g:I\n)"
        r"((?:[ \t]*(?:\.line \d+)?\n)*)"
        r"(    invoke-static \{v1\}, Lh20;->A\(I\)I\n)"
        r"((?:[ \t]*(?:\.line \d+)?\n)*)"
        r"(    move-result v1\n)"
    )
    repl = r"\1\2\3\4\5    const/4 v1, 0x1\n"
    content, changed = sub_once(content, pattern, repl, "qo1 build() forcado para plaintext")
    write(path, content)
    return changed

    return changed


def main():
    ap = argparse.ArgumentParser(description="aplica os patches de smali do mod DTunnel")
    ap.add_argument("--project", required=True, help="pasta do projeto apktool (contem smali/ e smali_classes2/)")
    ap.add_argument("--host", help="host do servidor de update (wz.f)")
    ap.add_argument("--port", help="porta do servidor de update (wz.g)")
    ap.add_argument("--reply-pub-b64", help="chave publica de assinatura do reply (base64 SPKI DER) para o wz.h")
    ap.add_argument("--reply-pub-file", help="arquivo .json com {\"pub_b64\": ...}")
    ap.add_argument("--no-plaintext", action="store_true",
                    help="nao aplica os patches de PLAINTEXT (tx1/qo1)")
    ap.add_argument("--tls", choices=["auto", "on", "off"], default="auto",
                    help="auto = TLS se houver CA; off = canal plaintext (sem certificado)")
    args = ap.parse_args()

    p = args.project
    paths = {
        "c":    os.path.join(p, "smali", "c.smali"),
        "c41":  os.path.join(p, "smali", "c41.smali"),
        "xt":   os.path.join(p, "smali_classes2", "xt.smali"),
        "qx1":  os.path.join(p, "smali_classes2", "qx1.smali"),
        "p6":   os.path.join(p, "smali", "p6.smali"),
        "wz":   os.path.join(p, "smali_classes2", "wz.smali"),
        "tx1":  os.path.join(p, "smali_classes2", "tx1.smali"),
        "qo1":  os.path.join(p, "smali", "qo1.smali"),
        "cx":   os.path.join(p, "smali", "cx.smali"),
    }
    for k, v in paths.items():
        if not os.path.exists(v):
            raise SystemExit(f"[ERRO] arquivo nao encontrado: {v}")

    print(f"[*] projeto: {p}")
    changes = []

    if patch_c(paths["c"]):
        changes.append("c.smali  (bypass Remote channel unavailable)")
    if patch_c41(paths["c41"]):
        changes.append("c41.smali (bypass assinatura do reply)")
    # NAO aplicar o bypass do bundle (xt): o app valida o CONTEUDO do bundle
    # (checksum/decrypt), nao apenas a assinatura. Pular so a assinatura faz o
    # app descartar o bundle e ficar sem config ("Missing udpServer").
    if patch_qx1(paths["qx1"]):
        changes.append("qx1.smali (bypass verificacao de hostname)")
    if patch_cx_reply_sig(paths["cx"]):
        changes.append("cx.smali  (bypass verificacao da assinatura do reply)")
    if patch_p6(paths["p6"]):
        changes.append("p6.smali  (bypass verificacao de certificado TLS)")
    if args.tls == "off":
        # O patch do CONSTRUTOR (tx1) e' o suficiente: o codigo nativo le o
        # tipo de negociacao do campo tx1.g. O patch do build() (qo1) forca
        # o ramo PLAINTEXT em TODAS as conexoes OkHttp do app - inclusive
        # a do PROXY do tunel (modo SSL_PROXY), que PRECISA de TLS.
        # Com o qo1 aplicado o tunel sobe ("VPN ESTABELECIDO") mas nao
        # passa trafego.
        # IMPORTANTE: o patch de PLAINTEXT (tx1/qo1) NAO e seguro aqui.
        # O tx1 e' o OkHttpChannelBuilder usado pelo gRPC **e** pelo proxy
        # do tunel (modo SSL_PROXY). Forcar h2c em todas as conexoes faz o
        # tunel subir ("VPN ESTABELECIDO") mas nenhum dado passar.
        # Como o servidor agora aceita TLS e h2c na MESMA porta (DT_TLS=auto),
        # o jeito certo de compilar "sem certificado" e' usar o build normal
        # (TLS) com o patch qx1+p6 (que ignoram a validacao do certificado).
        if not args.no_plaintext:
            if patch_plaintext(paths["tx1"]):
                changes.append("tx1.smali (canal gRPC em PLAINTEXT - sem TLS)")
            if patch_plaintext_build(paths["qo1"]):
                changes.append("qo1.smali (build() forcado para PLAINTEXT)")

    pub = args.reply_pub_b64
    if not pub and args.reply_pub_file and os.path.exists(args.reply_pub_file):
        with open(args.reply_pub_file, encoding="utf-8") as f:
            pub = json.load(f)["pub_b64"]
    if pub:
        if set_wz_reply_pub(paths["wz"], pub):
            changes.append("wz.smali  (chave publica do reply)")

    if args.host and args.port:
        if set_wz_host_port(paths["wz"], args.host, args.port):
            changes.append(f"wz.smali  (host={args.host} porta={args.port})")

    if changes:
        print("[+] patches aplicados:")
        for c in changes:
            print(f"    - {c}")
    else:
        print("[*] nada a fazer (ja estava patchado)")

if __name__ == "__main__":
    main()
