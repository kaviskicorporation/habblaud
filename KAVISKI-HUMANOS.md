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

### 1b — boneco, andar e presença ao vivo (2026-11-06) ✅
- **Meu boneco**: o "visitante" que o `Sim` já tem (`client/src/world/sim/visitor.ts`, o da cena Visita do Habblaud World)
  — chega pelo elevador da recepção, anda com setas/WASD (Shift corre, com colisão) ou clique (A*), a câmera segue. Com o
  boneco no escritório as teclas são dele (a câmera continua no arrastar/roda). Botão **Andar/Sair do escritório** na
  lista de online (lembrado no navegador; padrão: entra).
- **Aparência na conta**: "Meu boneco" abre as mesmas peças do editor de personagem (`AppearanceFields`) + cor do crachá;
  `GET|POST /api/kaviski/humanos/profile` guarda `{seed, look, parts, color}` no perfil (`users.json`; a conta do `.env`
  em `builtinProfile`). Quem nunca escolheu ganha um boneco sorteado pelo id.
- **Os outros**: "bonecos de corda" (`Character` do Sim) desenhados pelo mesmo renderer (o `people()` do `Sim` é
  embrulhado em tempo de execução) e indo suavemente até a última posição recebida. Etiqueta sempre com o nome e um selo
  (EQUIPE / CLIENTE, ou OCUPADO / AUSENTE).
- **Presença ao vivo: SSE + POST, não WebSocket** (decisão técnica): o servidor não tem biblioteca de WebSocket e, com
  HTTPS na porta remota, o servidor TLS fica escondido dentro do `remote.ts` (precisaria de mais ganchos no original); o
  SSE já passa pelo login e pelo iframe do TwiCC. `GET /api/kaviski/humanos/presence` (evento `people`, ~10/s no máximo,
  só quando muda) e `POST` `{pos, status}` (~8/s andando; limite 25/s). Fechou a última página: some depois de 8 s.
- **Posição independente do prédio** (`shared/kaviski-presence.ts`, `client/src/kaviski/humanos/pos.ts`): o cliente vê
  menos salas e as colunas mudam de lugar, então a posição vai relativa à sala (espelhada se ela está do outro lado do
  corredor), à coluna da sala no corredor, ou absoluta no núcleo (igual em todo prédio).
- **Quem vê quem (no servidor)**: equipe/admin veem todos; cliente vê equipe/admin e só os clientes que dividem uma sala
  com ele; posição dentro de sala que ele não vê não chega (a pessoa aparece na lista "fora do escritório"). Cliente não
  consegue dizer que está numa sala que não é dele.
- **Quem está online**: o chip "Nome · papel" do topo abre a lista (status disponível/ocupado/ausente, onde cada um está;
  clicar leva a câmera até a pessoa).
- Código: `server/kaviski/humanos/presence.ts`, `shared/kaviski-presence.ts`,
  `client/src/kaviski/humanos/{presence,world,online,pos}.ts` (+ `pos.test.ts`). Depuração: `habblaud.kvPeople` no console.

### 1c — voz e vídeo (LiveKit) (2026-11-06) ✅ (falta só o endereço público)
- **Uma chamada por área** do escritório: cada sala de projeto, cada área comum do núcleo (recepção, copa, banheiros,
  lounge) e o corredor. Entrou na área (parado ~0,7 s), entra na chamada dela; saiu, sai. Dentro de sala de projeto,
  volume cheio; nas áreas comuns e no corredor, **volume pela distância** entre os bonecos (cheio até 3 tiles, some em 11).
- **Barra de voz** no topo (só com o boneco no escritório): "Na chamada: <área>", microfone, câmera e compartilhar tela.
  Microfone e câmera começam desligados (escolha lembrada no navegador). Câmera = bolinha com o vídeo em cima do boneco
  (some quando a pessoa está longe demais para ser ouvida); tela compartilhada = quadro flutuante (clique amplia).
- **Segurança no servidor**: o token do LiveKit (`POST /api/kaviski/humanos/livekit-token {area}`, JWT HS256 assinado
  com `node:crypto`, 2 h) só sai para áreas que a pessoa pode ouvir — cliente: as salas dele, as áreas comuns e o
  corredor. O nome da chamada é um resumo (hash) da área, sem o caminho da pasta. `GET /api/kaviski/humanos/livekit` diz se
  está ligado.
- **Variáveis** (no `.env`, nunca no git): `HABBLAUD_LIVEKIT_URL` (endereço que o NAVEGADOR usa: `wss://...`),
  `HABBLAUD_LIVEKIT_KEY`, `HABBLAUD_LIVEKIT_SECRET` (32+ caracteres). Sem elas: sem barra de voz, o resto funciona.
- **Navegador**: `livekit-client` (Apache 2.0, `devDependencies`, ~150 kB gzip) carregado sob demanda, só quando a voz
  está ligada. Microfone/câmera exigem HTTPS (ou localhost).
- **LiveKit na VM** (teste/rede local): container `habblaud-livekit` (`livekit/livekit-server:v1.13.11`), sinalização em
  `127.0.0.1:7880`, mídia em `7881/TCP` e `50000-50100/UDP`, `node_ip` 192.168.1.220; config e chaves em
  `~/.config/habblaud/livekit.yaml` e `livekit.env` (600, fora do git). Testado com dois navegadores (Chromium com
  microfone/câmera falsos): mesma chamada, áudio e vídeo dos dois lados.
- Código: `server/kaviski/humanos/livekit.ts`, `client/src/kaviski/humanos/media.ts`.

### Endereço público (decisão do Vitor, 2026-11-06: "já quero o endereço público")
DNS, túnel e firewall são do Vitor. O que fica pronto no repositório: `deploy/kaviski/` (`livekit-compose.yml`,
`livekit.yaml.example`, `nginx-escritorio.conf.example`). Passo a passo:
1. **Nomes** (DNS → VPS 31.97.27.13): um para o escritório (ex.: `escritorio.<dominio>`) e um para o LiveKit
   (ex.: `lk.<dominio>`); certificados com o `certbot`.
2. **Túnel** do VPS até a porta remota do Habblaud na VM (`4748`, HTTP; o HTTPS fica no nginx do VPS).
3. **LiveKit no VPS** (recomendado: o VPS tem IP público, a mídia vai direto): pasta
   `~/Projetos/KaviskiCorporation/Docker_Projects/habblaud-livekit/` com o `livekit-compose.yml` e um `livekit.yaml`
   (chave/segredo novos), `docker compose up -d`; **liberar no firewall do VPS 7881/TCP e 50000-50100/UDP**.
4. **nginx do VPS**: `nginx-escritorio.conf.example` (o SSE precisa de `proxy_buffering off`; o LiveKit de `Upgrade`).
5. **`.env` do Habblaud na VM**: o nome do escritório em `HABBLAUD_ALLOWED_HOSTS` (senão o guard recusa o Host),
   `HABBLAUD_LIVEKIT_URL=wss://lk.<dominio>`, `HABBLAUD_LIVEKIT_KEY` e `HABBLAUD_LIVEKIT_SECRET` iguais aos do
   `livekit.yaml` do VPS; depois `python3 ~/base/scripts/kc-habblaud.py subir`.
6. Com o LiveKit no VPS, o container `habblaud-livekit` da VM pode sair (`docker rm -f habblaud-livekit`).

## Como desenvolver sem derrubar o escritório
- Desenvolver numa **segunda instância** (`HABBLAUD_PORT=4757`, `HABBLAUD_REMOTE_PORT=4758`,
  `HABBLAUD_DATA_DIR=~/.habblaud-dev`), sem mexer no serviço `habblaud` em produção.
- Antes de cada commit: `npm run typecheck && npm test && npm run i18n:check && npm run build` (pt-BR primeiro; os
  outros idiomas pelo `i18n:check`).
- Só depois de testado: `python3 ~/base/scripts/kc-habblaud.py subir --build`.
- Commit e push direto na `main` do fork, mudanças pequenas.
