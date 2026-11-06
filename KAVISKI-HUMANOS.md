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
Permissões finas por sala e por ação, auditoria, convites por link (✅ feito: ver "Onda Gather" abaixo),
várias empresas no mesmo servidor (se for vender).

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

### 1c — voz e vídeo (LiveKit) (2026-11-06) ✅
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

### Ajustes da fase 1 (2026-11-06) ✅
- **Freio de login por endereço e por usuário** (`KvLoginLimiter` em `gate.ts`): cada chave tem o seu freio (5 falhas,
  depois a espera dobra até 5 min); quem erra muito trava só a si mesmo (o do original era um só para todos). Atrás do
  Caddy, o endereço vem do `X-Forwarded-For` (só quando a conexão chega do loopback).
- **Cliente**: os atalhos L (timelapse), M (Meu dia) e T (terminal) também ficam mudos (os botões já sumiam; o
  servidor já recusava).

### 2 — conversa (2026-11-06) ✅
- **Chat por área**: a mesma área da voz (sala de projeto, área comum do núcleo, corredor). A presença passa a levar a
  área (validada no servidor: cliente nunca está numa sala que não é dele). `POST /api/kaviski/humanos/chat {text}` vai
  como evento `chat` do fluxo de presença **só a quem está na mesma área**. Sala de projeto: a sala toda lê, com
  **histórico curto** (50 falas, 24 h, `<dataDir>/kaviski/chat.json`, `GET /api/kaviski/humanos/chat?area=`). Áreas
  abertas: **por proximidade** (só quem está a até 11 tiles lê; não fica guardado).
- **Balões** em cima do boneco de quem falou (o balão do próprio Sim, `showBubble`).
- **Cumprimentos**: a roda do Habblaud World (`GreetingWheel`, os mesmos 10 cumprimentos, `RateGate`), importada de
  `client/src/world/city/greetings.ts` sem copiar. Abre com **G** (pessoa mais perto) ou clicando numa pessoa; 1–9/0.
- **Barra do topo** (`bar.ts`): área atual, botão da conversa (com contador de não lidas) e, com o LiveKit, microfone,
  câmera e tela. **Enter** abre a conversa (com o foco no escritório).
- Limite: 1 fala a cada 0,8 s e 20 por minuto por pessoa. Texto até 300 caracteres, sem caracteres de controle.
- Código: `server/kaviski/humanos/chat.ts`, `client/src/kaviski/humanos/{chat,bar}.ts`.

### 3 — pessoa + agente (2026-11-06) ✅
- **Chegar perto abre o painel**: parado a até 1,8 tile de um agente por 0,7 s, a gaveta dele abre (com o que o papel
  permite: conversa, aprovar, terminal); afastar além de 3,5 tiles fecha. Gancho: `select`/`selected` no
  `kvAttachWorld` (`client/src/world/index.ts`).
- **"Chamar até mim"** (botão na gaveta, entra pelo `KvTwiccButton` — nenhum gancho novo no `drawer.ts`):
  `POST /api/kaviski/humanos/summon {agentId}` manda o evento `summon` a toda página que vê aquele agente; ele levanta,
  anda até o boneco de quem chamou, fica até 45 s (ou até o status mudar) e volta sozinho. Vai até a mesa fixa de quem
  chamou (`profile.desk`, onda Gather) ou, sem mesa, até onde o boneco está. 1 chamada a cada 15 s por pessoa.
- **Registro** (`audit.ts`, `<dataDir>/kaviski/audit.jsonl`, 600, gira em 5 MB): mensagem, permissão (aprovar/recusar,
  com o título do pedido), novo agente, terminal aberto/fechado, encerrar/assumir, personagem, renomear sala, chamar
  agente — quem, quando, qual agente/sala, o quê e se deu certo. O corpo é copiado enquanto a rota original o lê
  (`kvTapBody`), sem mexer nas rotas. Tela de Pessoas → botão **Registro** (só admin; `GET /api/kaviski/humanos/audit`).
- **Cliente pode pedir tarefas** (opção na conta, o admin liga): ele passa a ter a caixa de mensagem, só para agentes
  das salas dele (`POST /api/messages` e `GET /api/messages/:id` tratados por `humanos/index.ts` com o registro de
  mensagens, `kvHumanos.attachMessages`). Todo o resto continua fechado. `kvRemoteAllows(allowed, req, feature)`.
- Código: `server/kaviski/humanos/{audit,index}.ts`, `client/src/kaviski/humanos/{agent,world,people}.ts`.

### Conversas estilo Teams e cartão de pessoa (2026-11-06) ✅ (pedido do Vitor)
- **Cartão da pessoa** (`person-card.ts`): clicar no boneco de alguém (andando ou não) ou na pessoa na lista de online
  abre um cartão com boneco, nome, papel, status, onde está e os botões de **todas as ações registradas** em
  `person-actions.ts` (registro comum com a sessão d553e49d). Daqui: **Mensagem**, **Cumprimentar** e **Ir até** (o meu
  boneco anda até perto da pessoa).
- **Conversas** (`chat.ts`): janela de duas colunas embaixo da barra do topo, com botão fixo no topo (com as não lidas),
  na barra do boneco e no Enter. À esquerda: "Aqui" (a conversa da área, fase 2) e cada pessoa com quem posso falar
  (online ou não), com bolinha de status, a última fala e quantas não li, e busca. À direita: a conversa (balões, meus à
  direita, falas seguidas agrupadas). Celular: uma coluna, com voltar.
- **Conversa 1:1** (`server/kaviski/humanos/direct.ts`): `GET /api/kaviski/humanos/contacts`,
  `GET|POST /api/kaviski/humanos/dm` (`{to, text, urgent?}`), `POST /api/kaviski/humanos/dm/read`. Evento `dm`
  (`KvDirectMessage`: `{id, at, from:{id,name,role}, to:{id,name}, text, urgent?}`) para quem manda e quem recebe.
  Guardada em `<dataDir>/kaviski/dm.json` (600; 200 falas por conversa, 90 dias) com "lido até aqui". Quem fala com
  quem: equipe/admin com todos; cliente com a equipe e com os clientes da mesma empresa (as pastas se cruzam), nunca
  com outro cliente. Mensagem nova com a janela fechada: contador + aviso pequeno (clique abre; urgente fica até clicar).
  `kvOpenDirect(id)` / `kvPeople.openDirect(id)` abrem a 1:1 (os avisos fora da aba da sessão d553e49d usam).
- **Voz e vídeo**: ao trocar de área, microfone, câmera e tela **continuam** (as faixas passam para a chamada nova sem
  desligar; antes a tela compartilhada caía ao andar); quem compartilha vê a própria tela com **Parar**; "Requested
  device not found" virou "Nenhuma câmera encontrada neste aparelho" (e bloqueada / em uso por outro programa).

### Coisas saindo da cabeça do boneco (2026-11-06) ✅ (pedido do Vitor, como no Gather)
- `client/src/kaviski/humanos/heads.ts`: pilha de miniaturas **ao lado da cabeça** de cada pessoa, acompanhando o boneco
  e a câmera (a bolinha da câmera continua em cima da cabeça). Hoje: a **tela compartilhada** ao vivo em miniatura
  (clique amplia o quadro grande; o quadro do canto continua) e o **começo de uma mensagem 1:1** que acabou de chegar
  (só quem recebe vê, some em 12 s — urgente, 60 s; clique abre a conversa). A conversa da área já aparecia como balão
  do Sim em cima da cabeça. API para outros módulos: `kvHeads.set(pessoa, chave, elemento, {order, ttlMs})` /
  `kvHeads.drop(pessoa, chave)` (`''` = eu).
- **Chamadas separadas por instância**: o nome da chamada no LiveKit passa a incluir a pasta de dados
  (`HABBLAUD_DATA_DIR`). Antes, a instância de teste (4757/4758) e a produção, no mesmo LiveKit, caíam na mesma chamada
  da mesma área.

### Endereço público: https://escritorio.kaviski.com.br (2026-11-06)
Decisão do Vitor: **sem VPS**. O nome só funciona na rede local e pela VPN (Tailscale, que roteia 192.168.1.0/24).
Infraestrutura feita pela sessão `01.Geral` (rede/proxy: não mexer sem avisar):
- **DNS** A `escritorio.kaviski.com.br` → `192.168.1.220`.
- **Caddy** na VM (`/usr/local/bin/caddy` com módulo cloudflare, `/etc/caddy/Caddyfile`, serviço do sistema
  `caddy-escritorio`) em `192.168.1.220:443`, certificado Let's Encrypt pelo DNS da Cloudflare (token em
  `~/.config/caddy/cloudflare.token`, gravado pelo Vitor). Rotas: `/` → `127.0.0.1:4748` (porta remota, HTTP) e
  `/livekit/*` (prefixo removido) → `127.0.0.1:7880` (LiveKit da VM, `node_ip` 192.168.1.220).
- **`.env`**: `escritorio.kaviski.com.br` em `HABBLAUD_ALLOWED_HOSTS`; `HABBLAUD_LIVEKIT_URL=wss://escritorio.kaviski.com.br/livekit`;
  o `habblaud.service` carrega também `~/.config/habblaud/livekit.env` (chave/segredo; `kc-habblaud.py` ajustado).
- **URL com caminho no LiveKit: funciona.** O `livekit-client` 2.23 mantém o caminho e acrescenta `/rtc/v1` (com volta
  para `/rtc`) e `/rtc/v1/validate`: `wss://.../livekit` vira `wss://.../livekit/rtc/v1`, que o Caddy entrega como
  `/rtc/v1`. Conferido com um proxy de teste que tira o prefixo `/livekit` como o Caddy: dois navegadores na mesma
  chamada, áudio e vídeo dos dois lados.
- A mídia vai direto do navegador ao LiveKit da VM (`7881/TCP` e `50000-50100/UDP` em 192.168.1.220), alcançável na
  rede local e pela VPN.

**Alternativa (não usada): VPS 31.97.27.13**, para quem estiver fora da VPN. Arquivos em `deploy/kaviski/`
(`livekit-compose.yml`, `livekit.yaml.example`, `nginx-escritorio.conf.example`): nomes no DNS com certbot, túnel do
VPS até a `4748` da VM, LiveKit no VPS (IP público) com `7881/TCP` e `50000-50100/UDP` liberados no firewall do VPS, e no
`.env` o nome em `HABBLAUD_ALLOWED_HOSTS` e `HABBLAUD_LIVEKIT_*` iguais aos do `livekit.yaml` do VPS.

## Onda Gather (2026-11-06) ✅
Pacote "recursos do Gather" pedido pelo Vitor, feito em frentes paralelas (worktrees da sessão d553e49d) e juntado na
`main` por cherry-pick pela sessão integradora (03d3677e). Tudo só com `HABBLAUD_HUMANOS=1`. Base comum, feita antes
pelo líder: `interact.ts` (tecla **E** + dica "E · Sentar"; cada frente registra os seus provedores), `topbar.ts`
(`kvTopButton`, botões do topo em ordem) e `person-actions.ts` (ações sobre outra pessoa, desenhadas pelo cartão e pela
lista de online; ordens: Mensagem 10, Cumprimentar 20, Ir até 30, Seguir 40, Teleportar 45, Ir até a mesa 46,
Chamar 50).

**Botões do topo** (da esquerda para a direita pela ordem): Modo clássico (lua, 12), Agenda (25), Modo foco/pomodoro
(fones, 30), Convidar visitantes (envelope, 35), Salas (60), Avisos (sino, 60). **Teclas**: setas/WASD (Shift corre),
clique anda, duplo clique corre, **E** usa o que está perto (sentar, café, quadro, mural, link, bater na porta), Esc para
de seguir / fecha, Enter abre a conversa, G cumprimenta, 1–9 reações, N mini-mapa, ? ajuda (lista em
`shortcuts-list.ts`).

### Como as frentes se ligam
- **Status**: agenda ("📅 Em reunião até…") e pomodoro ("🎧 Focado até…") entram pelo `auto-status.ts` no `status.ts`
  (camadas por fonte; o manual vence). Não perturbe silencia avisos (W2) e tira da chamada de voz (W3), mas não do palco.
- **Modo clássico** (W1: `kvPeople.inside = false`, `resting = true`): sai da chamada de voz (W3) e o boneco descansa no
  lounge com o selo DESCANSANDO; o pomodoro (W5) é outra coisa e pode estar ligado junto.
- **Mesa fixa** (W1, `profile.desk`): vale em sala de projeto e na **sala pessoal** (W4) — o servidor confere pelo mesmo
  `kvAreaAllowed`; "Chamar até mim" leva o agente até ela; "alguém entrou na minha sala" (W2) usa a sala da mesa, senão a
  sala própria (`kvPeople.myRoom()`, W4), senão a sala em que estou.
- **Área `r:<id>`** é a mesma para projeto e sala própria: chat, voz, **tranca** (W2) e quadro/mural (W4) valem nas duas.
  O `kvAreaAllowed` (livekit.ts) consulta, nesta ordem, a guarda do W2 (tranca e roda privada), a sala própria (W4) e as
  salas do cliente.
- **Andar até**: mini-mapa e "Ir para a reunião" (W5, `walk.ts`) usam `kvPeople.walkTo`/`goArea` do W1 (que levantam o
  boneco antes); sala trancada (W2) desfaz o passo pelo `kvPeople.onFrame`/`stopMe` do W1.
- **Visitante** (W5, papel `visitante`): `kvRestricted` como o cliente; sem mesa fixa (403), sem convidar, sem agenda,
  sem palco, sem trancar.
- **Janelas e teclado**: o `modalOpen()` do mundo conta qualquer `dialog[open]`/`[aria-modal="true"]`/popover aberto e
  trava as setas. Janela nossa escondida não pode ficar com `aria-modal` (a grade de vídeo travava o boneco com o
  LiveKit ligado; corrigido em 8354545).

### Boneco, mesa fixa e móveis (frente W1)
- **Modo clássico** (botão da lua no topo, lembrado em `habblaud.kv.classico`; quem tinha `habblaud.kv.andar` = '0' começa nele):
  substitui o "Andar/Sair do escritório". Ligado: `kvPeople.inside = false` (teclado, câmera, cliques, barra, conversa e
  chamada de voz como fora do escritório) e `kvPeople.resting = true`: o boneco anda sozinho até o lounge, senta (sofá,
  poltrona ou puff livre) e a posição vai com `z: 1` (selo DESCANSANDO para os outros). Desligado: levanta e volta para
  a mesa fixa (ou para onde estava).
- **Mesa fixa** (`profile.desk`, uma KvPos de sala): `GET|POST /api/kaviski/humanos/desk` (`server/kaviski/humanos/desk.ts`)
  — só cadeira dentro de sala que a pessoa vê (cliente: as dele; visitante não tem), a sala precisa existir e duas
  pessoas não ficam com a mesma cadeira (`kvSameDesk`, com o espelhamento do lado do corredor). A presença leva
  `desk` junto da pessoa, filtrada por sala. Escolher: clique na cadeira → "Definir como minha mesa", o botão 📌 que
  aparece sentado numa cadeira de sala, ou "Minha mesa" na janela Meu boneco. O boneco nasce sentado nela (sem o
  elevador); a cadeira fica reservada no `SpotRegistry` (`kvdesk:<id>`: agente nenhum a escolhe) e, vazia, mostra
  "mesa de Fulano". "Chamar até mim" leva o agente até a mesa, quando há.
- **Móveis** (`seats.ts`, `me.ts`, `furniture.ts`): tecla E perto de cadeira, banqueta, poltrona, sofá, puff, banco e
  cadeira da copa = sentar (reserva o lugar com o id do visitante; um agente que não está nem indo para lá cede o lugar);
  E de novo, seta ou clique = levantar (o passo livre do teclado trata assento como parede, então sentar/levantar vão
  pela fila `go/enter/exit` do Sim e o teclado espera; o `canStand` original não mudou). Máquina de café/água (pose
  `use` e `drink`), fliperama (`game`), estante (`read`). A pose vai na posição (`KvPos.p`/`h`, `shared/kaviski-desk.ts`)
  e o boneco de corda senta no assento mais perto da posição (e o reserva na página de quem vê).
- **Ações sobre outra pessoa** (`goto.ts`, desenhadas pelo cartão): Seguir (40; chip "Seguindo Fulano · Esc para
  parar"), Teleportar (45), Ir até a mesa (46). API no `kvPeople`: `walkTo(tx, ty, run?)`, `goTo(id)`/`goNear(id)`,
  `goArea(area)`, `followPerson`, `teleportTo`, `goDesk(id | null)`, `stopMe`, `myDesk`, `following`, `resting`,
  `onFrame` (ganchos por quadro de outros módulos), `toScreen`, `encode`, `ctl`.
- **Toque** (`touch.ts`): joystick (8 direções; na borda corre) e botão E com o rótulo do que está perto, só em tela de
  toque com o boneco andando; tocar no chão anda e a pinça dá zoom (do original). Botões da barra maiores
  (`pointer: coarse`). **Duplo clique** no chão corre (gancho `kv.doubleClick` no `world/index.ts`).
- Código: `shared/kaviski-desk.ts`, `server/kaviski/humanos/desk.ts` (+ `desk.test.ts`),
  `client/src/kaviski/humanos/{w1,me,seats,furniture,goto,classic,touch,stick,desk-labels}.ts` + `w1.css` (+ `seats.test.ts`),
  traduções em `shared/locales/kaviski-w1.ts`.

### Chamar, avisos, status com nota, reações, sala trancada e roda privada (frente W2)
- **Status com nota** (`client/src/kaviski/humanos/status.ts`): disponível, ocupado, ausente e **não perturbe**
  (`KvStatus` ganhou `'naoperturbe'`), nota livre de até 60 caracteres (sugestões 🍽️ Almoçando, 📅 Em reunião, 🎧 Focado,
  🏠 Home office, ☕ Pausa, 🚗 A caminho) e "até" (30 min, 1 h, 2 h, 4 h, hoje). O servidor guarda `note`/`until` na
  presença e limpa sozinho quando vence (`KvPresence.expire`, a cada 5 s). Aparece no selo do boneco, na lista de online e
  no cartão. **API para outros módulos**: `kvSetStatus({status?, note?, until?, source?})`, `kvClearStatus(source)`,
  `kvStatusNow()`, `kvOnStatus(cb)`. Cada fonte é uma camada: vale a manual se não for a padrão (disponível sem nota);
  senão a automática mais recente ainda válida (agenda e foco entram por `auto-status.ts`); senão disponível. Por cima, o
  **ausente automático**: aba escondida 10 min ou sem mexer 15 min (menos em não perturbe), volta sozinho. A manual
  fica lembrada no navegador.
- **Avisos fora da aba** (`alerts.ts`): toque curto feito na hora (WebAudio, sem arquivo), notificação do navegador
  (permissão só pelo botão "Permitir notificações" do sino **Avisos** no topo, nunca ao abrir), título piscando com o
  contador e o contador também no ícone da aba; voltar à aba zera. Avisa: chamada, 1:1 (evento `dm`), **@menção** no chat
  da área (primeira palavra do nome ou o usuário, sem acento), batida na porta e **alguém entrando na minha sala** (a da
  mesa fixa `kvPeople.myDesk`, a sala própria `kvPeople.myRoom()` ou, sem elas, a sala em que estou). Preferências (sons,
  notificações) lembradas. Não perturbe: sem som e sem notificação (aviso na página e contador continuam, quietos).
- **Chamar** (`ring.ts`, ação "Chamar" 🔔 no cartão): `POST /api/kaviski/humanos/ring {to}` → evento `ring` só para
  quem foi chamado; toque, notificação e aviso com **Ir até** (`kvPeople.goTo`, senão leva a câmera) e **Responder**
  (abre a 1:1). Só chama quem eu vejo (a mesma regra da presença); em não perturbe responde 409 "Fulano está em não
  perturbe". Limite: 1 a cada 15 s para a mesma pessoa e 6 por minuto. Vai ao Registro ("chamar pessoa", sem texto).
- **Reações rápidas** (`reactions.ts`): botão 😀 na barra do topo e teclas **1–9** (foco no escritório, roda de
  cumprimentos fechada). `POST /react {emoji}` → evento `react` só para quem vê o meu boneco; o emoji sobe e some sobre
  a cabeça. **✋** levanta/baixa a mão: fica no `people` (`hand`) e aparece na pilha da cabeça (`kvHeads`, ordem 30) e na
  lista. Limite: 8 a cada 5 s.
- **Trancar a sala / bater na porta** (`locks.ts`; servidor `social.ts`): numa sala (de projeto ou própria), **equipe e
  admin** trancam pelo cadeado da barra; **cliente e visitante não trancam** (mas, se estavam dentro, ficam na lista e
  respondem a quem bate). A lista de quem entra = quem estava dentro na hora + quem for deixado entrar; qualquer um da
  lista destranca; **destranca sozinha** quando ninguém da lista está mais dentro. Trancada: cadeado na porta; o boneco de
  quem está fora volta para fora da porta e, perto dela, **E · Bater na porta**; quem está dentro recebe "Fulano quer
  entrar" com **Deixar entrar / Recusar**. No servidor: posição dentro da sala recusada (`guard` da presença), área do
  chat e **token do LiveKit recusados** (guarda no `kvAreaAllowed`, `kvSetAreaGuard`) para quem não está na lista; cliente
  não fica sabendo de tranca em sala que não é dele. Registro: trancar, destrancar, deixar entrar, recusar.
- **Conversa privada** (`bubble.ts`): nas áreas abertas (núcleo e corredor), "🤫 Conversa privada" junta quem está a até
  3 tiles num grupo `b:<id>` do servidor (que confere mesma área, visibilidade e distância). **Voz** (token próprio:
  `kvAreaAllowed('b:<id>')` só para membros) e **chat** (o `chat.ts` usa `callAreaOf`) só do grupo; quem chega perto
  depois não ouve nem lê (um membro chama pelo cartão: "Chamar para a conversa privada"). Contorno tracejado no chão em
  volta do grupo. Afastar-se 6 tiles dos outros por 2,5 s (ou sair da área) tira da roda; com menos de 2, ela acaba.
  `kvPeople.callArea` = a área de voz e chat que vale para mim (`media.ts` e `chat.ts` usam).
- Rotas novas: `POST /api/kaviski/humanos/{ring,react,lock,knock,knock/answer,bubble}`; eventos novos do fluxo de
  presença: `ring`, `react`, `bubble`, `knock`, `knock-answer`; campos novos: `note`, `until`, `hand`, `bubble` (pessoa) e
  `locks` (estado). Ganchos genéricos nas deps do `KvPresence`: `guard`, `extra`, `state`, `callArea`, `changed`.
- Código: `server/kaviski/humanos/social.ts` (+ `social.test.ts`), `shared/kaviski-social.ts`,
  `shared/locales/kaviski-social.ts`, `client/src/kaviski/humanos/{social,social-api,status,status-text,alerts,ring,
  reactions,locks,bubble,overlay}.ts` + `social.css`; mudanças pequenas em `presence.ts` (servidor e página),
  `livekit.ts`, `chat.ts` (servidor e página), `index.ts` (servidor e página), `world.ts` (rótulo e selo), `online.ts`,
  `person-card.ts`, `bar.ts` e `auto-status.ts` (agora repassa ao `status.ts`).

### Voz e vídeo (frente W3)
Tudo só com `HABBLAUD_HUMANOS=1` e o LiveKit configurado (sem ele, nada disto aparece, como antes).
- **Ajustes (setinha ▾ ao lado do microfone e da câmera, ou botão direito neles)**, lembrados neste navegador
  (`habblaud.kv.media.fx`): microfone, câmera e alto-falante (este só no Chrome/Edge: `setSinkId`); **redução de ruído e
  eco do navegador** (`noiseSuppression`/`echoCancellation`/`autoGainControl`, ligada por padrão; mudar recaptura o
  microfone); **filtro de ruído forte RNNoise** (opcional; `@sapphi-red/web-noise-suppressor` MIT + RNNoise BSD-3, em
  WebAssembly num AudioWorklet a 48 kHz). O Krisp do LiveKit é só do LiveKit Cloud (não usamos).
- **Fundo da câmera**: sem efeito, desfocar, três fundos em pixel art desenhados na hora (escritório, jardim, cidade à
  noite) ou uma imagem própria (reduzida a 640×480 e guardada no navegador). `@livekit/track-processors` (Apache 2.0)
  com a segmentação do MediaPipe (Apache 2.0). **Nada vem de CDN**: o wasm do MediaPipe (~9 MB, só baixa ao ligar o
  efeito) e o modelo `selfie_segmenter.tflite` (250 kB, em `client/src/kaviski/humanos/assets/`) saem do próprio
  Habblaud (`/bundle/`); o `FilesetResolver.forVisionTasks` é trocado em tempo de execução para apontar para eles.
- **Palco (megafone)**: admin e equipe têm o botão 📢 na barra; cliente e visitante não (`kvRestricted`). Quem sobe
  fala para o andar inteiro: todo mundo online (com ou sem boneco; cliente também) vê "📢 Fulano no palco" e ouve numa
  chamada à parte do LiveKit. Servidor (`server/kaviski/humanos/stage.ts`): `GET/POST /api/kaviski/humanos/stage`
  (`{on}`; um palco por vez; quem abriu ou um admin fecha) e `POST .../stage/token` — **só quem está no palco recebe
  `canPublish`**, os outros só `canSubscribe` (o LiveKit recusa se o ouvinte tentar publicar). Evento `stage` do fluxo
  de presença para todas as páginas (e uma consulta a cada 30 s de garantia). Cada palco aberto é uma chamada nova
  (token velho não serve; o nome leva a pasta de dados, como as chamadas de área: teste e produção nunca se misturam); fecha sozinho quando quem abriu sai (fechou a página) ou depois de 2 h; conta rebaixada a
  cliente sai do palco. Registro: "palco aberto"/"palco fechado". Cada um pode **silenciar o palco** no navegador;
  **não perturbe não corta o palco** (é aviso para todos). Enquanto alguém está no palco, a voz dele na chamada da área
  fica muda para quem ouve o palco (não chega em dobro).
- **Grade de vídeo** (botão na barra): todos da chamada em tela cheia — câmera ou a inicial, nome, 🔇, borda verde em
  quem fala, telas compartilhadas (a primeira vai grande sozinha). 📌 (ou duplo clique) fixa um quadro grande com os
  outros numa faixa. Esc fecha. Nas áreas abertas só aparece quem eu ouço (mesma proximidade das bolinhas).
- **Quem está falando**: anel verde aceso no chão, embaixo do boneco de quem fala (o meu também, e o de quem está no
  palco), desenhado num DOM nosso por cima do mundo (`kvPeople.locate`), sem gancho no renderer; 🔇 na pilha ao lado da
  cabeça (`kvHeads`, ordem 5) de quem está na minha chamada com o microfone desligado. A bolinha de vídeo ganha a borda
  verde. Com a grade aberta, bolinhas, anéis e pilhas somem (não ficam por cima dela).
- **Não perturbe** (status `naoperturbe`, do W2): não entro em chamada de área nem toco o áudio de ninguém (só o palco,
  se não estiver silenciado). **Modo clássico** (`kvPeople.resting`, do W1): também fora da chamada (microfone e câmera
  desligados; a preferência fica). **Roda privada** (`kvPeople.callArea`, do W2): `b:<id>` vale no lugar da área, com
  volume cheio como numa sala.
- **Robustez**: ao sair de uma área, **antes mesmo de a chamada trocar** (os 0,7 s de espera e a conexão), o meu
  microfone fica mudo e o volume de todos vai a zero — nada vaza para a sala que deixei. Reconecta sozinho (aviso na
  barra); se a chamada cai de vez, o tick entra de novo. Sem HTTPS os botões ficam apagados com a explicação. Bolinhas de
  vídeo diminuem com a distância nas áreas abertas.
- Código: `client/src/kaviski/humanos/media-{fx,menu,stage,grid,speak,rules,extras}.ts`, `media.css`, ganchos no
  `media.ts`; `server/kaviski/humanos/stage.ts` (+ `stage.test.ts`), `shared/kaviski-media.ts`,
  `shared/locales/kaviski-media.ts`; `media-rules.test.ts`. Depuração: `habblaud.kvMedia` no console.
- **Limite conhecido**: quem perde acesso a uma sala (tela de Pessoas) continua na chamada dela até sair da área (o
  token do LiveKit já emitido vale até 2 h; o servidor não expulsa pela API do LiveKit).

### Salas próprias, quadro branco, mural e links na parede (frente W4)
- **Salas que não são projetos** em `<dataDir>/kaviski/rooms.json` (600): `pessoal` (a sala/canto fixo de uma pessoa,
  "Sala de Ana" — uma por pessoa), `reuniao`, `descanso`, `outra`. Id `kvsala-<10 caracteres>` (nunca começa com `/`,
  não colide com pasta de projeto); a área de conversa/voz é `r:<id>`, como nas salas de projeto.
- **Quem cria**: admin, qualquer tipo e para qualquer dono; equipe, a própria sala pessoal e salas de reunião; cliente e
  visitante, nada. **Quem edita/apaga**: o dono (da equipe) ou um admin. **Quem vê**: `equipe` (a equipe toda + os
  clientes marcados) ou `escolhidos` (só as pessoas marcadas); admin e dono sempre. Tudo conferido no servidor
  (`shared/kaviski-rooms.ts` `kvCanSeeOwnRoom`/`kvCanEditOwnRoom`/`kvCanCreateOwnRoom`).
- **No prédio**: a página pede a lista já filtrada (`GET /api/kaviski/humanos/rooms`) e injeta as salas no Sim
  (`sim.injected.rooms`, o mesmo mecanismo da depuração): ficam sempre, com a luz acesa, depois das salas de projeto.
  Layout por tipo (`client/src/kaviski/humanos/rooms-layout.ts`, gancho `kvLayoutRoom` no `sim.ts`): reunião = mesa
  grande com banquetas e quadro branco; descanso = sofá e poltronas de frente para a TV, puffs; pessoal = mesa de
  trabalho, estante e cantinho com poltronas; outra = duas mesas + mesa de reunião. Placa com selo do tipo
  ("Reunião"...). Quadro, placa e mural ficam no mesmo lugar dos dois lados do corredor. Os assentos são só de
  tipos "da sala" (agentes não vêm descansar aqui). O evento `rooms` do fluxo de presença avisa as páginas.
- **Voz, conversa e presença**: `kvAreaAllowed` (livekit.ts) pergunta a `kvOwnRoomArea` (rooms.ts) quando o id é de sala
  própria; a presença usa `kvRoomIdsFor` (salas de projeto liberadas + salas próprias que vê): cliente não diz que está
  numa sala própria que não vê, e a posição de quem está numa sala "só escolhidos" não vai a quem não a vê.
- **Habblaud World**: as salas próprias **não** entram no snapshot do Office; o uplink monta o prédio só com os agentes
  reais (`server/world/uplink.ts`), então nunca as vê (teste em `salas.test.ts`).
- **Tela Salas** (botão no topo, só equipe/admin; `rooms-dialog.ts`): criar, editar, apagar; tipo, nome, dono (admin),
  quem vê, paleta (as 10 do tema), cor da placa e **decoração**: grade da sala (14×9) e faixa da parede; escolhe o item
  (planta, planta alta, luminária, estante, arquivo, puff, quadro, pôster, relógio, tapete) e clica num lugar livre
  (clique no item tira). Até 16 itens. Lugar ocupado/porta/frente do quadro, placa e mural ficam bloqueados.
- **Objetos de parede** (tecla **E** perto, via `interact.ts`, ou clique com o boneco na mesma área):
  - **Quadro branco** de cada sala (de projeto ou própria): caneta, 6 cores, 3 espessuras, borracha, texto, desfazer o
    meu último, limpar (só a equipe). Ao vivo: o traço sai em pedaços (~12/s, `POST /api/kaviski/humanos/board`) e
    chega pelo evento `board` só a quem pode ver a sala; gravado em `boards.json` (até 3000 traços). Nas salas próprias
    a miniatura do desenho aparece no quadro da parede; nas de projeto o quadro de tarefas continua (só um pontinho).
  - **Mural de avisos** na recepção (no lugar do quadro) e em cada sala (no lugar do pôster): notas curtas (280);
    sala = quem entra nela escreve; recepção = só a equipe escreve (cliente lê). Apaga o autor, um admin ou o dono da
    sala própria. Bolinha vermelha piscando e "(1 novo)" na dica quando há nota de outra pessoa que eu não vi.
  - **Links na parede**: título + endereço (só `http`/`https`, sem usuário/senha embutidos), presos no trecho livre da
    parede mais perto do boneco (fora de placa, quadro, mural, janela, porta e móveis encostados). Só a equipe prende;
    abre em aba nova com `noopener,noreferrer`. Ícone de folha com tachinha desenhado na parede.
  - Rotas: `GET /objects`, `POST /notes`, `DELETE /notes/:id`, `POST /links`, `DELETE /links/:id`, `GET|POST /board`
    (todas em `/api/kaviski/humanos/`); evento `objects` (a página relê). Gravados em `objects.json` (600). Registro
    (`audit.ts`): criar/apagar sala, nota, link, limpar quadro.
- Código: `server/kaviski/humanos/{rooms,objects}.ts` (+ `salas.test.ts`), `shared/kaviski-rooms.ts`,
  `shared/locales/kaviski-salas.ts`, `client/src/kaviski/humanos/{salas,rooms,rooms-layout,rooms-dialog,objects,
  wall-draw,board-draw,whiteboard}.ts` + `salas.css`. Para os irmãos: `kvOwnRooms()`, `kvMeetingRooms()`, `kvMyRoom()`
  e `kvOnOwnRooms(cb)` em `rooms.ts`; `kvPeople.myRoom()` em tempo de execução.

### Convites por link, agenda e extras do dia a dia (frente W5)
**Convite por link (visitante sem conta).** Quem é admin ou equipe abre **Convidar visitantes** (botão do envelope no
topo) e gera um link: vale **1 h, 1 dia ou 7 dias**, **uso único ou várias pessoas** (até 50) e as **salas que o
visitante vê** (como as do cliente; nenhuma = só recepção e áreas comuns). O link (`/convite/<id>.<assinatura>`) abre
uma página que pede só o nome; o visitante entra com o papel **`visitante`** (selo VISITANTE), escolhe o boneco no tour
de boas-vindas e fica até o convite vencer.
- Regras no servidor: `visitante` é `kvRestricted` como o cliente (snapshot, fluxo, presença, chat, voz: só as salas do
  convite; lista fechada de rotas) e mais: não pede tarefa, não chama agente, não convida, não tem agenda.
- Assinatura: HMAC com uma chave tirada do `remote-secret` (nenhum segredo novo). Cookie do visitante
  `g1.<visitante>.<fim do convite>.<assinatura>`, conferido a cada requisição contra o convite: **revogar** (lista de
  convites → Revogar) ou **vencer** derruba na hora (o fluxo de presença fecha; a API responde 401 e a página mostra
  "a sua visita terminou").
- Freio de tentativas por endereço no link e na entrada (`KvLoginLimiter`). Registro: "convite criado", "visitante
  entrou", "convite revogado" (`KvAudit`).
- Dados: `<dataDir>/kaviski/invites.json` (600): convites, visitantes e o perfil deles (boneco). Convite vencido ou
  revogado há mais de 7 dias é esquecido.
- `HABBLAUD_PUBLIC_URL` (opcional, ex.: `https://escritorio.kaviski.com.br`): o link sai com esse endereço mesmo quando a
  tela é aberta pela porta local.
- Rotas: `GET|POST /api/kaviski/humanos/invites`, `DELETE /api/kaviski/humanos/invites/:id`, `GET /convite/<token>`,
  `POST /api/kaviski/humanos/invite/join {token, name}`.

**Agenda (Google Agenda, Outlook, iCloud) por ICS.** Botão do calendário no topo → **Minha agenda**: a pessoa cola o
"endereço secreto no formato iCal" (OAuth do Google: não — não temos credenciais; fica como opção futura, com o mesmo
lugar de guardar).
- O servidor guarda o endereço em `<dataDir>/kaviski/agenda.json` (600, fora do `users.json`) e **nunca o devolve** ao
  navegador (só "calendar.google.com · …/basic.ics") nem o escreve em log.
- Busca a cada 5 min: só `https` (`webcal://` vira `https://`), até 3 redirecionamentos, 10 s, 2 MB, e nunca endereço
  interno (conferido no IP resolvido: barra DNS rebinding). `HABBLAUD_AGENDA_PRIVATE=1` libera a rede local (agenda num
  servidor próprio, ex.: Nextcloud).
- Leitor ICS próprio (`shared/kaviski-ics.ts`, testado): VEVENT, DTSTART/DTEND/DURATION com UTC, TZID (IANA e nomes do
  Windows), flutuante e dia inteiro; RRULE diária/semanal (BYDAY, INTERVAL, COUNT, UNTIL)/mensal/anual simples,
  EXDATE, RECURRENCE-ID, CANCELLED e TRANSPARENT (livre). Regra que não sabe ler vira um evento só (não inventa).
- Durante uma reunião "ocupada": status automático **"📅 Em reunião até 15h"** (fonte `agenda`; o manual vence).
  1 min antes de uma reunião, um aviso no topo.
- **Sala da reunião**: se o local (ou a descrição) cita o nome de uma sala do escritório que a pessoa vê, a reunião
  ganha "📍 sala" e **Ir para a reunião** (o boneco anda até a porta). Reservas de sala (de todas as agendas, **sem título
  nem dono**, só as salas que quem pede vê) aparecem na dica da sala ("Reunião às 15h nesta sala") e no mini-mapa
  (ponto vermelho). As **salas próprias** (frente W4) também valem, as de reunião primeiro: "Sala Azul" no local acha a
  sala de reunião "Sala Azul" (`agendaRooms` em `humanos/index.ts`).
- Rotas: `GET|POST /api/kaviski/humanos/agenda`, `GET /api/kaviski/humanos/agenda/rooms`.

**Extras.**
- **Mini-mapa** (canto de baixo à direita da área livre; **N** recolhe/abre, lembrado): prédio, salas acesas/apagadas,
  agentes, pessoas na cor do crachá, eu piscando e o retângulo da câmera. Clicar anda até lá (longe: correndo) ou leva
  a câmera.
- **Atalhos**: botão **?** do mini-mapa e, na Ajuda do Habblaud (tecla **?**), uma seção "Pessoas no escritório:
  teclas" posta em tempo de execução. Lista em `client/src/kaviski/humanos/shortcuts-list.ts` (fácil de editar).
- **Modo foco (pomodoro)** — não confundir com o **Modo clássico** da frente W1 (lua): botão dos fones no topo, 25 ou 50 min, status **"🎧 Focado até 15h"** (fonte `foco`),
  minutos restantes no botão, som suave no fim (Web Audio; só uma aba toca), "Mais 25 min". Lembrado no navegador.
- **Boas-vindas**: tour de 3–4 passos na primeira entrada (visitante: escolher o boneco; andar; conversar; E para usar
  as coisas; modo foco e agenda), lembrado por pessoa no navegador; "Ver o tour de novo" na janela de Atalhos.
- **Quem está na sala**: parar o mouse sobre uma sala ou área comum mostra as pessoas, quantos agentes e a reunião
  marcada.
- Status automático: `client/src/kaviski/humanos/auto-status.ts` repassa ao `status.ts` da frente W2
  (`kvSetStatus`/`kvClearStatus` com a fonte `agenda` ou `foco`; o manual vence).
- Código: `server/kaviski/humanos/{invites,invites-route,agenda,test-harness}.ts` (+ `invites.test.ts`,
  `agenda.test.ts`), `shared/{kaviski-invites,kaviski-ics,kaviski-agenda}.ts` (+ `kaviski-ics.test.ts`),
  `shared/locales/kaviski-extras.ts`, `client/src/kaviski/humanos/{extras,invites,agenda,focus,minimap,shortcuts,
  shortcuts-list,welcome,room-hover,walk,auto-status}.ts` + `extras.css`.

### Interface no tema do Habblaud e conversas estilo Teams (frente W6)
Pedido do Vitor: "a tela de criar user está horrível, os selects são os feios do HTML; o sistema de chats é feio;
salve chats por conversa como Teams; pode usar o tema do Habblaud".
- **Kit de interface** (`client/src/kaviski/humanos/ui/`): `kit.ts` (botões primário/secundário/perigo/fantasma em 3D,
  `kvField` com erro em linha, `kvInput`, `kvPassword` com mostrar/ocultar e gerador, `kvToggle`, `kvTabs`, `kvAvatar` —
  boneco ou iniciais na cor do crachá, com bolinha de status —, `kvRoleBadge`, `kvEmpty`, `kvChip`, `kvTitle` que só usa
  a Pixelify quando o texto não tem "C" maiúsculo nem dígitos), `select.ts` (`KvSelect` e `KvMultiSelect` com chips:
  teclado, busca a partir de 8 opções, digitar pula; abre dentro do `<dialog>` aberto), `modal.ts` (`KvModal`,
  `kvConfirm`), `toast.ts` (`kvToast`, um por chave), `icons.ts` (ícones em pixel), `kit.css`.
- **Ponte de tema** (`ui/bridge.css` + `ui/enhance.ts`): as janelas das outras frentes (convites, agenda, salas próprias,
  quadro, mural, atalhos, nota do status, mesa fixa, barra do boneco) ganham o visual do kit sem mexer no código delas, e
  todo `<select>` das telas das pessoas (classe `kv-*` nele ou num pai) vira o select do kit sozinho — o nativo fica
  escondido e continua a fonte da verdade (`value`, `change`, opções novas). Os do Habblaud original não mudam.
- **Topo que cabe** (`ui/topfit.ts`): quando os botões das pessoas não cabem numa linha, os de maior `order` vão para o
  menu **Mais** (com o nome de cada um; contadores aparecem lá). Conversas é o último a sair.
- **Pessoas** (`people.ts` + `people.css`): contas em cartões (boneco, papel, @usuário, salas em chips, "pede tarefas"),
  busca e filtro por papel; formulário com papel num select com explicação e a lista do que cada papel pode, salas com
  busca e chips (aceita colar uma pasta), senha com gerador (copia), validação em linha (`kvValidatePerson`, testada) e
  confirmação ao apagar. Abas **Contas**, **Convites** (o conteúdo da janela de convites, `kvMountInvites` em
  `invites.ts`) e **Registro** (agrupado por dia, com busca).
- **Conversas** (`chat.ts` + `chat-format.ts` + `chat.css`): lista à esquerda — "Aqui" (a área; roda privada `b:` da W2
  incluída), "Recentes" (cada 1:1 e cada sala de projeto em que estive, lembradas no navegador) e "Online agora"; busca
  em pessoas e, com 2+ letras, nas mensagens das minhas conversas (no servidor; clicar leva até a fala e a destaca); Nova
  conversa escolhendo a pessoa. À direita, **abas** das conversas abertas (até 6, lembradas), dias separados, falas
  agrupadas (5 min), bolhas minhas e dos outros com boneco e nome, links só http/https (`kvLinkify`, testado), emojis,
  urgente, "digitando…", Carregar anteriores. Sala em que não estou: só leitura, com "Ir até a sala".
- **Servidor** (`direct.ts`, `index.ts`): 1:1 guardada por conversa (1000 falas, 180 dias), `GET /dm?with=&before=&limit=`
  em páginas (`{messages, more}`), `POST /dm/typing {to}` (evento `typing` só para a outra pessoa, 1 a cada 1,5 s),
  `GET /dm/search?q=` (só nas conversas de quem busca e com quem ainda pode conversar, até 40). Salas: 300 falas por 30
  dias (`KV_CHAT_HISTORY*`). Testes em `server/kaviski/humanos/conversas.test.ts`. O fluxo de presença liga sozinho os
  eventos novos que alguém ouvir (`presence.ts` `bind`).
- **Cartão da pessoa** (`person-card.ts` + `.css`): faixa na cor do crachá com xadrez em pixel, boneco grande com o
  status, papel, status com nota (W2) e onde está; ações do registro em botões grandes de ícone (a primeira em azul);
  **mensagem rápida** (Enter manda a 1:1 e abre a conversa numa aba).
- **Quem está online** (`online.ts` + `online.css`): eu com o status num select próprio (a nota da W2 entra logo abaixo),
  Modo clássico (W1), Meu boneco, busca e as pessoas "Perto de você", "No escritório" e "Fora do escritório", com
  atalhos de Mensagem e Ir até. **Meu boneco** no `KvModal`, cores do crachá em amostras e a Minha mesa (W1).
- Celular: conversas em uma coluna (lista ou conversa, com voltar), Pessoas em uma coluna, o joystick e o E somem com a
  conversa/lista/cartão abertos, o Mais não sai da tela.
- Traduções em `shared/locales/kaviski-ui.ts`. Ganchos novos só em arquivos do fork: uma linha em `humanos/index.ts`
  (`kvAutoEnhance` e `kvTopFit`) e `kvMountInvites`/`refresh` no fim de `invites.ts`.

### Testes da integração (2026-11-06)
Instância própria da integradora (build de produção, `HABBLAUD_PORT=4771`/`4772`, `~/.habblaud-dev-int`, LiveKit local
`ws://127.0.0.1:7880`), Chromium headless (Playwright) com 2 a 4 pessoas ao mesmo tempo (admin, equipe, cliente,
visitante). Roteiros em `<scratch da 03d3677e>/e2e/` (os das frentes adaptados + os de integração). Passaram: boas-vindas,
mini-mapa, convite e visitante; pomodoro e modo clássico juntos; sentar com E (o outro vê a pose), mesa fixa pelo 📌,
nascer na mesa, DESCANSANDO; cartão com Seguir/Teleportar/Ir até a mesa; status com nota, chamar com a aba escondida,
não perturbe, reações, mão, @menção, 1:1; roda privada (voz e chat só do grupo); sala trancada (voz recusada, porta,
bater, deixar entrar); voz: RNNoise, fundos, grade, palco (cliente só ouve), não perturbe e modo clássico fora da
chamada, troca de área sem vazar áudio, reconexão, nada de CDN; Sala Azul trancada; mesa na sala pessoal.

## Como desenvolver sem derrubar o escritório
- Desenvolver numa **segunda instância** (`HABBLAUD_PORT=4757`, `HABBLAUD_REMOTE_PORT=4758`,
  `HABBLAUD_DATA_DIR=~/.habblaud-dev`), sem mexer no serviço `habblaud` em produção.
- Antes de cada commit: `npm run typecheck && npm test && npm run i18n:check && npm run build` (pt-BR primeiro; os
  outros idiomas pelo `i18n:check`).
  **Sempre numa worktree própria** (com `npm ci` dela): o serviço de produção serve o `dist/` da pasta principal e um build
  ali troca a página na hora. Parar instância de teste só pelo PID (a linha de comando é igual à da produção).
- Só depois de testado: `python3 ~/base/scripts/kc-habblaud.py subir --build`.
- Commit e push direto na `main` do fork, mudanças pequenas.
