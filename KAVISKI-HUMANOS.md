# Fork Kaviski: pessoas no escritório (plano)

Projeto: `Interno/Sistemas/04.Habblaud` (TwiCC: 04.Habblaud). Objetivo: o Habblaud vira o escritório onde **pessoas e agentes de IA trabalham juntos**, no estilo Gather, com o
design e a identidade do Habblaud. Decisões do Vitor (2026-11-05):

- **No próprio fork** `kaviskicorporation/habblaud` (`~/habblaud`), puxando as versões novas do original por merge
  (`kc-habblaud.py atualizar`), como o resto do `KAVISKI.md`.
- **Usuários: equipe Kaviski + clientes.** Cliente entra e vê só as salas dos projetos dele.
- **Voz e vídeo desde a fase 1** (LiveKit no servidor).

## Licenças (regra)

- Habblaud: **MIT** — manter o aviso de autoria (LICENSE).
- WorkAdventure: **AGPL v3 + Commons Clause**. Decisão do Vitor (2026-11-06): **pode reaproveitar** código e elementos
  dele, porque o produto é gratuito (nunca vendido) e vai ser aberto como open source. Consequências que valem enquanto
  houver código do WorkAdventure aqui:
  - o fork inteiro passa a ser distribuído sob **AGPL v3** (código MIT pode entrar numa obra AGPL; o contrário não);
    o código-fonte tem de ficar disponível a quem usa pela rede (o repositório já é público);
  - **Commons Clause**: não pode cobrar pelo produto nem por um serviço cujo valor venha dele;
  - manter os avisos de copyright do WorkAdventure nos arquivos copiados e registrar a origem em `KAVISKI.md`;
  - código copiado fica em pastas próprias (`client/src/kaviski/humanos/wa/`, `server/kaviski/humanos/wa/`) com o
    LICENSE deles ao lado.
- Bibliotecas abertas permissivas (MIT/Apache/BSD) podem ser usadas: LiveKit (Apache 2.0).

## Regra para continuar recebendo o original

- Código novo só em pastas nossas: `server/kaviski/humanos/`, `client/src/kaviski/humanos/`,
  `shared/kaviski-humanos.ts` (+ testes ao lado).
- Nos arquivos originais: só ganchos curtos marcados `// fork Kaviski`, listados neste arquivo.
- Reaproveitar **importando** (sem copiar) o que já existe: editor de personagem (`client/src/ui/character-editor.ts`,
  `shared/appearance.ts`), jogador e entrada do Habblaud World (`client/src/world/city/players.ts`, `input.ts`,
  `path/` A*, `social.ts`, `greetings.ts`), login remoto (`server/http/remote.ts`).
- Tudo desligado sem `HABBLAUD_HUMANOS=1`: sem a variável, o comportamento é o original.

## Fases

### 1. Pessoas no escritório + voz e vídeo
- **Contas** (`<dataDir>/kaviski/users.json`, senhas scrypt como `server/remote/password.ts`): usuário, nome, papel
  `admin | equipe | cliente`, salas permitidas (lista de caminhos ou prefixos, ex.: `/home/hostadmin/projetos/Clientes/12-Rarm/`).
  O login atual (`HABBLAUD_REMOTE_USER`) continua valendo como admin.
- **Sessão por pessoa**: o cookie da porta remota passa a carregar o id da pessoa; `trusted()` passa a perguntar o
  papel (cliente: sem terminal, sem spawn, só as salas dele; equipe: tudo menos administração; admin: tudo).
- **Filtro por sala no snapshot/SSE**: o cliente só recebe salas e agentes permitidos (no servidor, nunca só escondido no
  navegador).
- **Boneco próprio** salvo na conta (aparência do `shared/appearance.ts`), nome e cor.
- **Andar no escritório**: setas/WASD e clique (A* do World), dentro e entre as salas permitidas.
- **Presença ao vivo**: posição, sala e status (disponível, ocupado, ausente) por WebSocket
  (`/api/kaviski/humanos/ws`); lista "quem está online".
- **Voz e vídeo**: LiveKit (container `livekit` em `127.0.0.1`, porta UDP para mídia); token emitido pelo servidor
  do Habblaud por sala (`/api/kaviski/humanos/livekit-token`); áudio por **sala** (entrou na sala, entra na chamada) e por
  **proximidade** (volume pela distância); câmera em bolinha sobre/ao lado do boneco; compartilhar tela.
  Microfone e câmera exigem HTTPS ou localhost no navegador: com acesso por VPN, usar HTTPS na porta remota
  (certificado do `remote:setup`) ou um nome com certificado.
- Tela de administração (admin): criar/editar contas, papéis e salas.

### 2. Conversa
Chat de texto por sala e por proximidade, balões sobre o boneco, cumprimentos/curtidas (reaproveitar `social` do World),
histórico curto por sala.

### 3. Pessoa + agente (o diferencial)
Chegar perto de um agente abre o painel dele (conversa, aprovar, terminal conforme o papel); "chamar agente para a minha
mesa"; registro de quem aprovou/pediu o quê; cliente pode pedir tarefa ao agente da sala dele (se o admin liberar).

### 4. Produto
Permissões finas por sala e por ação, auditoria, convites por link, várias empresas no mesmo servidor (se for vender).

## Estado (o que já funciona)

### 1a — contas por pessoa, papéis e filtro de salas (2026-11-06) ✅
Liga com `HABBLAUD_HUMANOS=1` (e a porta remota configurada, como hoje). Sem a variável, nada muda.

- **Contas** em `<dataDir>/kaviski/users.json` (permissão 600; senha só como hash scrypt). A conta do `.env`
  (`HABBLAUD_REMOTE_USER`, hoje `kavisvi`) é a **admin embutida**: senha e papel vêm do `.env`, só o nome muda pela tela.
- **Login por pessoa** na porta remota (`server/kaviski/humanos/gate.ts`, na frente do gate original): a conta do `.env`
  recebe o mesmo token `v1` de antes (quem já estava logado continua); as outras, um token `h1.<id>.<validade>.<assinatura>`
  cuja chave mistura o hash da senha (trocar a senha ou apagar a conta derruba as sessões da pessoa). Mesmo freio de
  tentativas do original; o scrypt roda sempre (não dá para descobrir quais usuários existem).
- **Papéis** (`shared/kaviski-humanos.ts`): `admin` = tudo + tela de Pessoas; `equipe` = o que `HABBLAUD_REMOTE_ALLOW`
  e `HABBLAUD_REMOTE_PTY` liberam, menos Pessoas; `cliente` = só ver. O gancho é `allows(feature, req)` no `trusted()` de
  `http/app.ts` + `kvRemotePtyFor(req)` + o `canAnswer` do Hub.
- **Cliente: filtro no servidor.** Só passam `GET /api/stream` (cada evento reescrito: só as salas dele, sem terminais,
  contas, World, e feed/avisos só das salas dele — `stream-filter.ts`), `/api/snapshot` (filtrado), `/api/access`,
  `/api/updates` e `GET /api/agents/:id` de agente das salas dele. **Todo o resto da API responde 403** (lista fechada:
  rota nova do original não vaza). Timelapse e Meu dia somem da tela dele (são da empresa toda).
- **Salas do cliente** = lista de pastas; cada uma vale para ela e tudo dentro (ex.: `/home/hostadmin/projetos/Clientes/14-FPF`
  cobre todos os projetos da FPF). Equipe e admin veem todas.
- **Tela de Pessoas** (botão com dois bonecos no topo, só admin; pela porta local `http://localhost:4747` também): criar,
  editar (nome, papel, salas, senha) e apagar. Rotas `GET|POST /api/kaviski/humanos/users`,
  `POST|DELETE /api/kaviski/humanos/users/:id`, `GET /api/kaviski/humanos/me`. Chip "Nome · papel" no topo.
- Código: `server/kaviski/humanos/{index,gate,users,request,stream-filter}.ts` (+ `humanos.test.ts`),
  `shared/kaviski-humanos.ts`, `shared/locales/kaviski-humanos.ts` (traduções), `client/src/kaviski/humanos/{index,people}.ts`
  + `humanos.css`. Ganchos listados no `KAVISKI.md`.

## Como desenvolver sem derrubar o escritório
- Desenvolver numa **segunda instância** (`HABBLAUD_PORT=4757`, `HABBLAUD_REMOTE_PORT=4758`,
  `HABBLAUD_DATA_DIR=~/.habblaud-dev`), sem mexer no serviço `habblaud` em produção.
- Antes de cada commit: `npm run typecheck && npm test && npm run i18n:check && npm run build` (pt-BR primeiro; os
  outros idiomas pelo `i18n:check`).
- Só depois de testado: `python3 ~/base/scripts/kc-habblaud.py subir --build`.
- Commit e push direto na `main` do fork, mudanças pequenas.
