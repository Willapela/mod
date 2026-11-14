# DTunnel-MOD — servidor e painel

Servidor Node.js com API REST autenticada, serviços gRPC e painel web. Inclui gerenciamento de conexões/categorias/endpoints/textos, temas múltiplos, editor HTML em iframe isolado, build APK assíncrono, logs e downloads.

## Requisitos
- Ubuntu/Debian e Node.js 18+ com npm.
- Portas gRPC e painel liberadas no firewall.
- Chaves/certificados gerados localmente por `install.sh`.
- Para compilar APK: builder Android em `/root/apk-build/dtunnel-mod` (ou `DT_APK_BUILDER_DIR`), APK base obtido de fonte autorizada, uma keystore privada própria e Java/apktool/Android build-tools.

## Instalação
Na raiz do repositório, rode `./install-all.sh` como root para instalar fontes e criar somente arquivos JSON de dados ausentes. Os dados existentes não são copiados por cima. Depois: `cd /opt/dtunnel-server` e rode `./install.sh SEU_HOST 8443 8080 'SENHA_FORTE_DE_12_OU_MAIS_CARACTERES' auto`. O instalador não assume senha-padrão.

## Build APK
Configure `/etc/dtunnel-apk-build.env` (modelo em `templates/dtunnel-apk-build.env.example`) com `DT_APK_BUILDER_DIR`, `DT_APK_ORIG`, `DT_APK_SIGNING_KEY`, `DT_APK_SIGNING_KEY_ALIAS` e `DT_APK_SIGNING_KEY_PASS`. `start.sh` lê esse arquivo; restrinja-o com `chmod 600`. Adicione localmente o APK base e a keystore, reinicie somente o processo Node do painel e confirme `/api/build-info`.

Não versionar `.apk`, `.jks`, `.env`, senhas, `server_reply.key`, certificados/chaves específicos ou dados de produção. O `.gitignore` da raiz exclui esses itens.
