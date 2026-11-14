# DTunnel-MOD — servidor, painel e builder APK

Este repositório reúne o servidor gRPC, o painel web, o editor de layouts HTML, a gestão de temas do aplicativo e as rotas para compilar APKs na VPS.

> **Importante:** o código-fonte do builder está incluído, mas o APK base do DTunnel e a keystore privada de assinatura não estão. O build real só funciona depois que você obtiver o APK base de uma fonte autorizada e configurar sua própria keystore fora do GitHub.

## Índice

- [Requisitos](#requisitos)
- [Instalação inicial](#instalação-inicial)
- [Acesso ao painel e firewall](#acesso-ao-painel-e-firewall)
- [Build APK pelo painel](#build-apk-pelo-painel)
- [Atualizar uma instalação existente](#atualizar-uma-instalação-existente)
- [Backups, dados e segurança](#backups-dados-e-segurança)
- [Diagnóstico](#diagnóstico)
- [Estrutura do repositório](#estrutura-do-repositório)

## Requisitos

Para o servidor e o painel:

- VPS Ubuntu ou Debian com acesso `root` ou `sudo`.
- Node.js 18 ou mais recente e npm.
- Um IP público ou domínio apontando para a VPS.
- Acesso TCP à porta gRPC (padrão `8443`) e à porta web do painel (padrão `8080`). Se a VPS usar firewall do provedor, libere as portas também nesse painel de controle.

Para usar **Build APK**, além dos itens acima:

- Java/JDK, Python 3, `curl`, `unzip`, Android SDK Build-Tools (incluindo `zipalign` e `apksigner`), `adb` e apktool.
- APK base DTunnel obtido legalmente/autorizado.
- Keystore própria e privada, com alias e senha. Use a mesma keystore para builds posteriores se quiser atualizar o mesmo aplicativo sem desinstalá-lo.

## Instalação inicial

### 1. Baixe o repositório na VPS

```bash
git clone https://github.com/Willapela/mod.git
cd mod
```

### 2. Instale os arquivos do painel e do builder

```bash
sudo bash ./install-all.sh
```

O instalador copia o servidor para `/opt/dtunnel-server` e o builder para `/root/apk-build/dtunnel-mod` por padrão. É possível mudar os destinos com `DT_INSTALL_DIR` e `DT_APK_BUILDER_DIR`. Ele cria apenas os arquivos JSON de dados que estiverem faltando e não sobrescreve os dados e chaves existentes. O instalador não reinicia um servidor que já esteja em execução.

### 3. Configure e inicie o servidor

```bash
cd /opt/dtunnel-server
sudo bash ./install.sh SEU_IP_OU_DOMINIO 8443 8080
```

O instalador pedirá uma senha do painel de forma interativa. Crie uma senha forte com pelo menos 12 caracteres. Os argumentos são, nesta ordem: host público, porta gRPC, porta web do painel, senha (opcional se informada interativamente) e modo TLS. O padrão recomendado para TLS é `auto`; se quiser defini-lo explicitamente junto com a senha, use:

```bash
sudo bash ./install.sh SEU_IP_OU_DOMINIO 8443 8080 'SUA_SENHA_FORTE' auto
```

Evite colocar a senha diretamente no comando: ela pode ficar no histórico do terminal ou visível temporariamente na lista de processos. A forma interativa acima é preferível.

Na primeira instalação, o servidor gera os certificados e as chaves locais em `keys/`. Guarde um backup seguro desses arquivos: não os publique. Ao concluir, o instalador informa o endereço e as credenciais do painel. O usuário do painel é `panel`.

## Acesso ao painel e firewall

Abra no navegador `http://SEU_IP_OU_DOMINIO:8080` e entre com o usuário `panel` e a senha criada. A porta gRPC padrão do aplicativo é `8443/tcp`.

O instalador tenta liberar as portas usando UFW, quando o UFW está ativo. Verifique também o firewall da empresa de hospedagem. **Proteja o painel:** o acesso HTTP não cifra as credenciais. Restrinja a porta `8080` ao seu IP administrativo ou coloque o painel atrás de um proxy HTTPS com autenticação adequada. Não exponha o painel publicamente sem proteção.

O painel inclui gerenciamento de conexões, categorias, endpoints e textos; configurações do aplicativo; temas/layouts múltiplos; editor de HTML com prévia isolada; e a área de Build APK.

## Build APK pelo painel

O botão Build APK compila o aplicativo na VPS, mostra o andamento/log e permite baixar o arquivo gerado. O repositório **não** contém os insumos proprietários ou secretos necessários ao build.

### 1. Instale/verifique as dependências do Android

O instalador geral copia o builder para `/root/apk-build/dtunnel-mod`. Instale as dependências básicas e execute o verificador:

```bash
sudo apt-get update
sudo apt-get install -y default-jdk python3 curl unzip adb
sudo bash /root/apk-build/dtunnel-mod/install_deps.sh
```

O script verifica Java, Python, `curl`, `unzip`, `adb`, apktool e Android SDK Build-Tools. Ele tenta baixar o apktool, mas não instala automaticamente o Android SDK completo. Se o verificador indicar falta de Build-Tools, instale Android SDK Command-line Tools e, usando `sdkmanager`, instale por exemplo:

```bash
sdkmanager 'platform-tools' 'build-tools;34.0.0'
```

Se o SDK estiver em um local não detectado automaticamente, configure `ANDROID_SDK_ROOT` e `ANDROID_HOME` no ambiente do processo Node.

### 2. Coloque os insumos privados na VPS

Obtenha o APK base DTunnel 5.0.0 somente de uma fonte autorizada e coloque-o, por padrão, em:

```text
/root/apk-build/dtunnel-mod/apk/DTunnel_5.0.0.apk
```

Crie ou copie a sua keystore para um caminho privado fora do repositório, por exemplo `/root/secure/dtunnel-signing.jks`. Não use nem publique a keystore de outra pessoa.

### 3. Configure o ambiente do build

O instalador cria o modelo `/etc/dtunnel-apk-build.env` se o arquivo ainda não existir. Edite-o na VPS:

```bash
sudo nano /etc/dtunnel-apk-build.env
```

Preencha os caminhos, host e credenciais locais. Exemplo (substitua os valores):

```bash
DT_PUBLIC_HOST=SEU_IP_OU_DOMINIO
GRPC_PORT=8443
DT_APK_BUILDER_DIR=/root/apk-build/dtunnel-mod
DT_APK_ORIG=/root/apk-build/dtunnel-mod/apk/DTunnel_5.0.0.apk
DT_APK_SIGNING_KEY=/root/secure/dtunnel-signing.jks
DT_APK_SIGNING_KEY_ALIAS=ALIAS_DA_KEYSTORE
DT_APK_SIGNING_KEY_PASS='SENHA_DA_KEYSTORE'
```

Proteja o arquivo, pois ele contém uma senha:

```bash
sudo chmod 600 /etc/dtunnel-apk-build.env
```

O arquivo é lido pelo `start.sh` quando o processo Node inicia. Depois de alterá-lo, reinicie **o processo Node do DTunnel**, não o `proto-server.service`. Se houver uma unidade systemd chamada `dtunnel.service`, use:

```bash
sudo systemctl restart dtunnel
```

Caso não exista essa unidade, inicie/reinicie pelo script do projeto:

```bash
sudo bash /opt/dtunnel-server/start.sh
```

### 4. Verifique e compile

Entre no painel, abra a aba **Build APK** e confira o estado dos arquivos e da configuração. A API de diagnóstico é `/api/build-info` no mesmo host do painel. Se a compilação falhar, verifique as dependências, os caminhos configurados, as permissões da keystore e o log apresentado na área de Build APK.

O APK é assinado com a keystore configurada. Uma keystore diferente normalmente impede atualizar por cima uma instalação anterior do aplicativo.

## Atualizar uma instalação existente

Faça um backup antes de atualizar e não execute o instalador sobre outro diretório sem conferir `DT_INSTALL_DIR` e `DT_APK_BUILDER_DIR`.

```bash
sudo tar -czf "/root/dtunnel-backup-$(date +%Y%m%d-%H%M%S).tar.gz" \
  -C /opt/dtunnel-server data keys
cd ~/mod
git pull --ff-only
sudo bash ./install-all.sh
```

O instalador geral cria também um backup dos arquivos de código existentes e preserva `data/`, `keys/`, APKs e keystores. Após a atualização, reinicie o serviço do painel/servidor conforme o método que sua VPS usa: `sudo systemctl restart dtunnel` se essa unidade existir; caso contrário, `sudo bash /opt/dtunnel-server/start.sh`. Não use `proto-server.service` para reiniciar o painel Node.

## Backups, dados e segurança

- Nunca publique `.env`, senhas, APKs, keystores (`.jks`/`.keystore`), chaves privadas, certificados da VPS ou dados reais de `data/`.
- Mantenha `data/` e `keys/` somente na VPS e faça backups privados, com acesso restrito.
- Não troque/regere `server_reply.key` sem entender o impacto nos APKs já distribuídos.
- O `.gitignore` da raiz exclui arquivos locais sensíveis. Confira `git status` antes de fazer commit ou upload.
- O APK base não é distribuído neste repositório; obtenha-o de forma autorizada e respeite as licenças e direitos aplicáveis.

## Diagnóstico

Verifique se o processo está ativo e confira o log padrão:

```bash
ps aux | grep '[n]ode.*src/index.js'
sudo tail -n 100 /tmp/dtunnel-server.log
```

A localização do log pode ser personalizada com `DT_LOG_FILE`. Para problemas de Build APK, confirme também se o endpoint `/api/build-info` indica que o builder está pronto e se os arquivos do APK e da keystore são legíveis pelo mesmo usuário que executa o Node.

## Estrutura do repositório

- `dtunnel-server/`: servidor gRPC, API REST, painel web e scripts de instalação.
- `dtunnel-server/public/`: interface web e estilos.
- `dtunnel-server/src/app-themes.js`: armazenamento e aplicação de perfis de temas.
- `dtunnel-server/templates/`: modelos vazios e exemplo de configuração; não são dados de produção.
- `dtunnel-mod/`: scripts de build e patches Android.
- `install-all.sh`: instalador que copia o código e preserva os dados/segredos já existentes.
