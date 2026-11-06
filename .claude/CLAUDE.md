# Instruções Kaviski — 04.Habblaud (fork do Habblaud)

Leia primeiro: `/home/hostadmin/base/AGENTS.md`, a ficha `/home/hostadmin/base/04-projetos/interno/Sistemas/04.Habblaud/`,
o `CLAUDE.md` do original (raiz), o `KAVISKI.md` (o que o fork muda) e o `KAVISKI-HUMANOS.md` (plano de pessoas no escritório).

## O que é
Fork `kaviskicorporation/habblaud` (`origin`) do `marmottajr/habblaud` (`upstream`, MIT). É o escritório virtual dos agentes
que roda **em produção nesta VM**: serviço `habblaud` do systemd do usuário, rodando a partir DESTA pasta
(`~/habblaud` é um atalho para cá). Mexer aqui mexe no escritório em uso.

## Regras
- Código novo em pastas nossas (`server/kaviski/`, `client/src/kaviski/`, `shared/kaviski*.ts`); nos arquivos originais
  só ganchos curtos `// fork Kaviski`, listados no `KAVISKI.md`. Assim o `kc-habblaud.py atualizar` (merge do original,
  nunca rebase/force) continua fácil.
- Desenvolver numa segunda instância (`HABBLAUD_PORT=4757 HABBLAUD_REMOTE_PORT=4758 HABBLAUD_DATA_DIR=~/.habblaud-dev`) e
  só publicar com `python3 ~/base/scripts/kc-habblaud.py subir --build` depois de testar.
- Antes do commit: `npm run typecheck && npm test && npm run i18n:check && npm run build`
  (Node: `export NVM_DIR=~/.nvm; . ~/.nvm/nvm.sh`). Falha antiga conhecida: `server/world/uplink.test.ts`.
- Commit e push direto na `main`. `.env` e dados (`~/.habblaud`) nunca no git.
- Mudança na VM (serviços, containers, portas): anotar em `/home/hostadmin/projetos/Server/01-Server/01.Geral/mudancas.md`.
- Não alterar o que o Habblaud envia ao Habblaud World para mandar dados falsos (ver `CLAUDE.md` do original).
