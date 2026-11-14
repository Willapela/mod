# DTunnel-MOD — painel e fonte do builder

Este repositório reúne o servidor gRPC/painel, a interface web com temas e editor HTML, as rotas do Build APK e os scripts de patch/compilação Android.

## Instalação

Extraia o ZIP no Linux e rode como root:

```bash
git clone https://github.com/Willapela/mod.git
cd mod
sudo bash ./install-all.sh

```

O instalador atualiza `/opt/dtunnel-server` e `/root/apk-build/dtunnel-mod` (personalizáveis com `DT_INSTALL_DIR` e `DT_APK_BUILDER_DIR`), cria apenas os JSONs que estiverem faltando e preserva os dados e assets locais. Ele não reinicia serviços. Depois, configure o servidor conforme `dtunnel-server/README.md` e `DEPLOY.md`.

## Build APK

O painel conserva a página Build APK, as rotas assíncronas de compilação, log e download. O builder está em `dtunnel-mod/` e utiliza `make_mod.sh`, scripts Python de patch, apktool, Java e Android build-tools (`zipalign`/`apksigner`). `dtunnel-mod/install_deps.sh` verifica parte dessas dependências.

**O ZIP não inclui dois insumos externos necessários ao build real:** (1) o APK base DTunnel 5.0.0, cuja redistribuição não está autorizada neste pacote, e (2) a keystore privada de assinatura, que não deve ser publicada. Coloque o APK obtido de fonte autorizada em `dtunnel-mod/apk/DTunnel_5.0.0.apk` (ou configure `DT_APK_ORIG`) e configure `DT_APK_SIGNING_KEY`, `DT_APK_SIGNING_KEY_ALIAS` e `DT_APK_SIGNING_KEY_PASS` em `/etc/dtunnel-apk-build.env`. O `start.sh` carrega esse arquivo; proteja-o com permissão `600`. Use a mesma keystore em todos os builds se precisar preservar atualizações sem desinstalar o APK anterior.

As rotas do painel também aceitam `DT_APK_BUILDER_DIR` para apontar ao diretório do builder. Depois de editar as variáveis, reinicie apenas o processo Node do painel para carregá-las. Nunca comite `.env`, keystore, senhas, chaves de assinatura do servidor, certificados específicos de VPS ou dados de `data/`.

## Estrutura

- `dtunnel-server/`: servidor, API, painel web e scripts de instalação.
- `dtunnel-mod/`: scripts do builder e patches Android; diretórios para adicionar localmente APK e keystore.
- `install-all.sh`: copia código sem sobrescrever `data/`, `keys/`, APKs ou keystores.
