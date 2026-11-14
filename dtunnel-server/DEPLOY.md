# Deploy e execução

1. Faça checkout/extraia o repositório na VPS e execute `./install-all.sh` como root. O instalador preserva arquivos `data/`, `keys/`, APKs e keystores já existentes.
2. Configure host/portas e senha forte no instalador do servidor: `cd /opt/dtunnel-server && ./install.sh HOST 8443 8080 'SENHA_FORTE' auto`.
3. Libere a porta gRPC e a porta do painel no firewall conforme sua infraestrutura.
4. Para compilar pelo painel, coloque os assets autorizados no diretório configurado, carregue `DT_APK_*` no ambiente do processo Node e reinicie o Node do painel.

Não use `proto-server.service` para reiniciar o painel Node. Antes de atualizar uma instalação existente, faça backup de `public/` e `src/`; nunca sobrescreva os JSONs de produção ou as chaves locais.
