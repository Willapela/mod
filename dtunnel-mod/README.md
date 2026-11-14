# DTunnel — fonte do builder

Este diretório contém `make_mod.sh`, scripts de patch e validação do APK. O Build APK do painel chama esta pasta na VPS; o original, a keystore privada e as chaves do servidor são provisionados separadamente.

## Entradas externas necessárias

- APK base obtido de fonte autorizada: `apk/DTunnel_5.0.0.apk` ou caminho em `DT_APK_ORIG`.
- Keystore privada: `DT_APK_SIGNING_KEY`, mantida fora do Git.
- Senha e alias: `DT_APK_SIGNING_KEY_PASS` e `DT_APK_SIGNING_KEY_ALIAS`, somente em ambiente local protegido.
- Para build TLS: `keys/ca.pem` e `keys/server_reply_key.json` provenientes do servidor por `sync_keys.sh`. Não publique chaves/certificados de VPS.

Exemplo de build manual, com variáveis já carregadas no ambiente:

```bash
./make_mod.sh SEU_HOST 8443
```

Dependências: Java 17+, Python 3, apktool e Android SDK build-tools com `zipalign` e `apksigner`. Rode `./install_deps.sh` para diagnóstico.

A keystore usada deve permanecer a mesma entre builds para assinar atualizações do mesmo app. Se a keystore original foi perdida, uma keystore nova não substitui a assinatura antiga; o Android poderá exigir desinstalar o app existente.
