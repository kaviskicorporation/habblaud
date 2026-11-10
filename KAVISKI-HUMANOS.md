# Fork Kaviski: pessoas no escritório (plano)

Projeto: `Interno/Sistemas/04.Habblaud` (TwiCC: 04.Habblaud). Objetivo: o Habblaud vira o escritório onde **pessoas e agentes de IA trabalham juntos**, no estilo Gather, com o
design e a identidade do Habblaud. Decisões do Vitor (2026-11-05):

- **No próprio fork** `kaviskicorporation/habblaud` (`~/habblaud`), puxando as versões novas do original por merge
  (`kc-habblaud.py atualizar`), como o resto do `KAVISKI.md`.
- **Usuários: equipe Kaviski + clientes.** Cliente entra e vê só as salas dos projetos dele.
- **Voz e vídeo desde a fase 1** (LiveKit no servidor).

## Licenças (regra)

- Habblaud: **MIT** — manter o aviso de autoria (LICENSE).
- **Atualização 2026-11-10 (ADR 0015, Voxtrin Cloud):** o Voxtrin passou a ser **vendido** como SaaS
  (`05.Voxtrin_Cloud`). Com isso, **nenhum código ou elemento do WorkAdventure pode entrar neste fork** (a Commons
  Clause proíbe cobrar pelo produto). A regra abaixo vale só como histórico; até hoje nada dele foi copiado.
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
- **Avatar próprio** salvo na conta (aparência do `shared/appearance.ts`), nome e cor.
- **Andar no escritório**: setas/WASD e clique (A* do World), dentro e entre as salas permitidas.
- **Presença ao vivo**: posição, sala e status (disponível, ocupado, ausente) por WebSocket
  (`/api/kaviski/humanos/ws`); lista "quem está online".
- **Voz e vídeo**: LiveKit (container `livekit` em `127.0.0.1`, porta UDP para mídia); token emitido pelo servidor
  do Habblaud por sala (`/api/kaviski/humanos/livekit-token`); áudio por **sala** (entrou na sala, entra na chamada) e por
  **proximidade** (volume pela distância); câmera em bolinha sobre/ao lado do avatar; compartilhar tela.
  Microfone e câmera exigem HTTPS ou localhost no navegador: com acesso por VPN, usar HTTPS na porta remota
  (certificado do `remote:setup`) ou um nome com certificado.
- Tela de administração (admin): criar/editar contas, papéis e salas.

### 2. Conversa
Chat de texto por sala e por proximidade, balões sobre o avatar, cumprimentos/curtidas (reaproveitar `social` do World),
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
- **Tela de Pessoas** (botão com dois avatares no topo, só admin; pela porta local `http://localhost:4747` também): criar,
  editar (nome, papel, salas, senha) e apagar. Rotas `GET|POST /api/kaviski/humanos/users`,
  `POST|DELETE /api/kaviski/humanos/users/:id`, `GET /api/kaviski/humanos/me`. Chip "Nome · papel" no topo.
- Código: `server/kaviski/humanos/{index,gate,users,request,stream-filter}.ts` (+ `humanos.test.ts`),
  `shared/kaviski-humanos.ts`, `shared/locales/kaviski-humanos.ts` (traduções), `client/src/kaviski/humanos/{index,people}.ts`
  + `humanos.css`. Ganchos listados no `KAVISKI.md`.

### 1b — avatar, andar e presença ao vivo (2026-11-06) ✅
- **Meu avatar**: o "visitante" que o `Sim` já tem (`client/src/world/sim/visitor.ts`, o da cena Visita do Habblaud World)
  — chega pelo elevador da recepção, anda com setas/WASD (Shift corre, com colisão) ou clique (A*), a câmera segue. Com o
  avatar no escritório as teclas são dele (a câmera continua no arrastar/roda). Botão **Andar/Sair do escritório** na
  lista de online (lembrado no navegador; padrão: entra).
- **Aparência na conta**: "Meu avatar" abre as mesmas peças do editor de personagem (`AppearanceFields`) + cor do crachá;
  `GET|POST /api/kaviski/humanos/profile` guarda `{seed, look, parts, color}` no perfil (`users.json`; a conta do `.env`
  em `builtinProfile`). Quem nunca escolheu ganha um avatar sorteado pelo id.
- **Os outros**: "avatares de corda" (`Character` do Sim) desenhados pelo mesmo renderer (o `people()` do `Sim` é
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
  volume cheio; nas áreas comuns e no corredor, **volume pela distância** entre os avatares (cheio até 3 tiles, some em 11).
- **Barra de voz** no topo (só com o avatar no escritório): "Na chamada: <área>", microfone, câmera e compartilhar tela.
  Microfone e câmera começam desligados (escolha lembrada no navegador). Câmera = bolinha com o vídeo em cima do avatar
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
- **Balões** em cima do avatar de quem falou (o balão do próprio Sim, `showBubble`).
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
  anda até o avatar de quem chamou, fica até 45 s (ou até o status mudar) e volta sozinho. Vai até a mesa fixa de quem
  chamou (`profile.desk`, onda Gather) ou, sem mesa, até onde o avatar está. 1 chamada a cada 15 s por pessoa.
- **Registro** (`audit.ts`, `<dataDir>/kaviski/audit.jsonl`, 600, gira em 5 MB): mensagem, permissão (aprovar/recusar,
  com o título do pedido), novo agente, terminal aberto/fechado, encerrar/assumir, personagem, renomear sala, chamar
  agente — quem, quando, qual agente/sala, o quê e se deu certo. O corpo é copiado enquanto a rota original o lê
  (`kvTapBody`), sem mexer nas rotas. Tela de Pessoas → botão **Registro** (só admin; `GET /api/kaviski/humanos/audit`).
- **Cliente pode pedir tarefas** (opção na conta, o admin liga): ele passa a ter a caixa de mensagem, só para agentes
  das salas dele (`POST /api/messages` e `GET /api/messages/:id` tratados por `humanos/index.ts` com o registro de
  mensagens, `kvHumanos.attachMessages`). Todo o resto continua fechado. `kvRemoteAllows(allowed, req, feature)`.
- Código: `server/kaviski/humanos/{audit,index}.ts`, `client/src/kaviski/humanos/{agent,world,people}.ts`.

### Conversas estilo Teams e cartão de pessoa (2026-11-06) ✅ (pedido do Vitor)
- **Cartão da pessoa** (`person-card.ts`): clicar no avatar de alguém (andando ou não) ou na pessoa na lista de online
  abre um cartão com avatar, nome, papel, status, onde está e os botões de **todas as ações registradas** em
  `person-actions.ts` (registro comum com a sessão d553e49d). Daqui: **Mensagem**, **Cumprimentar** e **Ir até** (o meu
  avatar anda até perto da pessoa).
- **Conversas** (`chat.ts`): janela de duas colunas embaixo da barra do topo, com botão fixo no topo (com as não lidas),
  na barra do avatar e no Enter. À esquerda: "Aqui" (a conversa da área, fase 2) e cada pessoa com quem posso falar
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

### Coisas saindo da cabeça do avatar (2026-11-06) ✅ (pedido do Vitor, como no Gather)
- `client/src/kaviski/humanos/heads.ts`: pilha de miniaturas **ao lado da cabeça** de cada pessoa, acompanhando o avatar
  e a câmera (a bolinha da câmera continua em cima da cabeça). Hoje: a **tela compartilhada** ao vivo em miniatura
  (clique amplia o quadro grande; o quadro do canto continua) e o **começo de uma mensagem 1:1** que acabou de chegar
  (só quem recebe vê, some em 12 s — urgente, 60 s; clique abre a conversa). A conversa da área já aparecia como balão
  do Sim em cima da cabeça. API para outros módulos: `kvHeads.set(pessoa, chave, elemento, {order, ttlMs})` /
  `kvHeads.drop(pessoa, chave)` (`''` = eu).
- **Chamadas separadas por instância**: o nome da chamada no LiveKit passa a incluir a pasta de dados
  (`HABBLAUD_DATA_DIR`). Antes, a instância de teste (4757/4758) e a produção, no mesmo LiveKit, caíam na mesma chamada
  da mesma área.

### Janelas no tema do Habblaud: Salas, Agenda, Convites e campos 3D (2026-11-06) ✅ (pedido do Vitor)
- **Salas** (`rooms-dialog.ts` + `rooms-dialog.css`), **Agenda** (`agenda.ts`) e **Convites** (`invites.ts`, também na aba
  Convites da tela Pessoas) no mesmo padrão da tela Pessoas: `KvModal` com ícone, lista em cartões (ou estado vazio
  explicado, centralizado) e formulário em seções com ícone. Escolhas que eram listas viraram blocos com ícone (tipo da
  sala, quem entra, validade, uma/várias pessoas, itens da decoração com ícones em pixel coloridos); salas marcáveis
  com o visto em pixel; paleta como mini-salas; a sala da decoração nas cores da paleta; confirmações no tema.
- Kit (`ui/kit.css`, `ui/bridge.css`): **campo de texto afundado** × **lista de seleção elevada** (antes iguais), rótulo
  com o quadradinho de pixel, caixas de marcar e seletor de cor nativos no tema. Peças comuns em `ui/section.ts`
  (`kvSection`, `kvSplit`, `kvSeg`, `kvPick`, `kvTip`) + `ui/section.css`.

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
- **Modo clássico** (W1: `kvPeople.inside = false`, `resting = true`): sai da chamada de voz (W3) e o avatar descansa no
  lounge com o selo DESCANSANDO; o pomodoro (W5) é outra coisa e pode estar ligado junto.
- **Mesa fixa** (W1, `profile.desk`): vale em sala de projeto e na **sala pessoal** (W4) — o servidor confere pelo mesmo
  `kvAreaAllowed`; "Chamar até mim" leva o agente até ela; "alguém entrou na minha sala" (W2) usa a sala da mesa, senão a
  sala própria (`kvPeople.myRoom()`, W4), senão a sala em que estou.
- **Área `r:<id>`** é a mesma para projeto e sala própria: chat, voz, **tranca** (W2) e quadro/mural (W4) valem nas duas.
  O `kvAreaAllowed` (livekit.ts) consulta, nesta ordem, a guarda do W2 (tranca e roda privada), a sala própria (W4) e as
  salas do cliente.
- **Andar até**: mini-mapa e "Ir para a reunião" (W5, `walk.ts`) usam `kvPeople.walkTo`/`goArea` do W1 (que levantam o
  avatar antes); sala trancada (W2) desfaz o passo pelo `kvPeople.onFrame`/`stopMe` do W1.
- **Visitante** (W5, papel `visitante`): `kvRestricted` como o cliente; sem mesa fixa (403), sem convidar, sem agenda,
  sem palco, sem trancar.
- **Janelas e teclado**: o `modalOpen()` do mundo conta qualquer `dialog[open]`/`[aria-modal="true"]`/popover aberto e
  trava as setas. Janela nossa escondida não pode ficar com `aria-modal` (a grade de vídeo travava o avatar com o
  LiveKit ligado; corrigido em 8354545).

### Avatar, mesa fixa e móveis (frente W1)
- **Modo clássico** (botão da lua no topo, lembrado em `habblaud.kv.classico`; quem tinha `habblaud.kv.andar` = '0' começa nele):
  substitui o "Andar/Sair do escritório". Ligado: `kvPeople.inside = false` (teclado, câmera, cliques, barra, conversa e
  chamada de voz como fora do escritório) e `kvPeople.resting = true`: o avatar anda sozinho até o lounge, senta (sofá,
  poltrona ou puff livre) e a posição vai com `z: 1` (selo DESCANSANDO para os outros). Desligado: levanta e volta para
  a mesa fixa (ou para onde estava).
- **Mesa fixa** (`profile.desk`, uma KvPos de sala): `GET|POST /api/kaviski/humanos/desk` (`server/kaviski/humanos/desk.ts`)
  — só cadeira dentro de sala que a pessoa vê (cliente: as dele; visitante não tem), a sala precisa existir e duas
  pessoas não ficam com a mesma cadeira (`kvSameDesk`, com o espelhamento do lado do corredor). A presença leva
  `desk` junto da pessoa, filtrada por sala. Escolher: clique na cadeira → "Definir como minha mesa", o botão 📌 que
  aparece sentado numa cadeira de sala, ou "Minha mesa" na janela Meu avatar. O avatar nasce sentado nela (sem o
  elevador); a cadeira fica reservada no `SpotRegistry` (`kvdesk:<id>`: agente nenhum a escolhe) e, vazia, mostra
  "mesa de Fulano". "Chamar até mim" leva o agente até a mesa, quando há.
- **Móveis** (`seats.ts`, `me.ts`, `furniture.ts`): tecla E perto de cadeira, banqueta, poltrona, sofá, puff, banco e
  cadeira da copa = sentar (reserva o lugar com o id do visitante; um agente que não está nem indo para lá cede o lugar);
  E de novo, seta ou clique = levantar (o passo livre do teclado trata assento como parede, então sentar/levantar vão
  pela fila `go/enter/exit` do Sim e o teclado espera; o `canStand` original não mudou). Máquina de café/água (pose
  `use` e `drink`), fliperama (`game`), estante (`read`). A pose vai na posição (`KvPos.p`/`h`, `shared/kaviski-desk.ts`)
  e o avatar de corda senta no assento mais perto da posição (e o reserva na página de quem vê).
- **Ações sobre outra pessoa** (`goto.ts`, desenhadas pelo cartão): Seguir (40; chip "Seguindo Fulano · Esc para
  parar"), Teleportar (45), Ir até a mesa (46). API no `kvPeople`: `walkTo(tx, ty, run?)`, `goTo(id)`/`goNear(id)`,
  `goArea(area)`, `followPerson`, `teleportTo`, `goDesk(id | null)`, `stopMe`, `myDesk`, `following`, `resting`,
  `onFrame` (ganchos por quadro de outros módulos), `toScreen`, `encode`, `ctl`.
- **Toque** (`touch.ts`): joystick (8 direções; na borda corre) e botão E com o rótulo do que está perto, só em tela de
  toque com o avatar andando; tocar no chão anda e a pinça dá zoom (do original). Botões da barra maiores
  (`pointer: coarse`). **Duplo clique** no chão corre (gancho `kv.doubleClick` no `world/index.ts`).
- Código: `shared/kaviski-desk.ts`, `server/kaviski/humanos/desk.ts` (+ `desk.test.ts`),
  `client/src/kaviski/humanos/{w1,me,seats,furniture,goto,classic,touch,stick,desk-labels}.ts` + `w1.css` (+ `seats.test.ts`),
  traduções em `shared/locales/kaviski-w1.ts`.

### Chamar, avisos, status com nota, reações, sala trancada e roda privada (frente W2)
- **Status com nota** (`client/src/kaviski/humanos/status.ts`): disponível, ocupado, ausente e **não perturbe**
  (`KvStatus` ganhou `'naoperturbe'`), nota livre de até 60 caracteres (sugestões 🍽️ Almoçando, 📅 Em reunião, 🎧 Focado,
  🏠 Home office, ☕ Pausa, 🚗 A caminho) e "até" (30 min, 1 h, 2 h, 4 h, hoje). O servidor guarda `note`/`until` na
  presença e limpa sozinho quando vence (`KvPresence.expire`, a cada 5 s). Aparece no selo do avatar, na lista de online e
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
  cumprimentos fechada). `POST /react {emoji}` → evento `react` só para quem vê o meu avatar; o emoji sobe e some sobre
  a cabeça. **✋** levanta/baixa a mão: fica no `people` (`hand`) e aparece na pilha da cabeça (`kvHeads`, ordem 30) e na
  lista. Limite: 8 a cada 5 s.
- **Trancar a sala / bater na porta** (`locks.ts`; servidor `social.ts`): numa sala (de projeto ou própria), **equipe e
  admin** trancam pelo cadeado da barra; **cliente e visitante não trancam** (mas, se estavam dentro, ficam na lista e
  respondem a quem bate). A lista de quem entra = quem estava dentro na hora + quem for deixado entrar; qualquer um da
  lista destranca; **destranca sozinha** quando ninguém da lista está mais dentro. Trancada: cadeado na porta; o avatar de
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
  fala para o andar inteiro: todo mundo online (com ou sem avatar; cliente também) vê "📢 Fulano no palco" e ouve numa
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
- **Quem está falando**: anel verde aceso no chão, embaixo do avatar de quem fala (o meu também, e o de quem está no
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
- **Objetos de parede** (tecla **E** perto, via `interact.ts`, ou clique com o avatar na mesma área):
  - **Quadro branco** de cada sala (de projeto ou própria): caneta, 6 cores, 3 espessuras, borracha, texto, desfazer o
    meu último, limpar (só a equipe). Ao vivo: o traço sai em pedaços (~12/s, `POST /api/kaviski/humanos/board`) e
    chega pelo evento `board` só a quem pode ver a sala; gravado em `boards.json` (até 3000 traços). Nas salas próprias
    a miniatura do desenho aparece no quadro da parede; nas de projeto o quadro de tarefas continua (só um pontinho).
  - **Mural de avisos** na recepção (no lugar do quadro) e em cada sala (no lugar do pôster): notas curtas (280);
    sala = quem entra nela escreve; recepção = só a equipe escreve (cliente lê). Apaga o autor, um admin ou o dono da
    sala própria. Bolinha vermelha piscando e "(1 novo)" na dica quando há nota de outra pessoa que eu não vi.
  - **Links na parede**: título + endereço (só `http`/`https`, sem usuário/senha embutidos), presos no trecho livre da
    parede mais perto do avatar (fora de placa, quadro, mural, janela, porta e móveis encostados). Só a equipe prende;
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
uma página que pede só o nome; o visitante entra com o papel **`visitante`** (selo VISITANTE), escolhe o avatar no tour
de boas-vindas e fica até o convite vencer.
- Regras no servidor: `visitante` é `kvRestricted` como o cliente (snapshot, fluxo, presença, chat, voz: só as salas do
  convite; lista fechada de rotas) e mais: não pede tarefa, não chama agente, não convida, não tem agenda.
- Assinatura: HMAC com uma chave tirada do `remote-secret` (nenhum segredo novo). Cookie do visitante
  `g1.<visitante>.<fim do convite>.<assinatura>`, conferido a cada requisição contra o convite: **revogar** (lista de
  convites → Revogar) ou **vencer** derruba na hora (o fluxo de presença fecha; a API responde 401 e a página mostra
  "a sua visita terminou").
- Freio de tentativas por endereço no link e na entrada (`KvLoginLimiter`). Registro: "convite criado", "visitante
  entrou", "convite revogado" (`KvAudit`).
- Dados: `<dataDir>/kaviski/invites.json` (600): convites, visitantes e o perfil deles (avatar). Convite vencido ou
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
  ganha "📍 sala" e **Ir para a reunião** (o avatar anda até a porta). Reservas de sala (de todas as agendas, **sem título
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
- **Boas-vindas**: tour de 3–4 passos na primeira entrada (visitante: escolher o avatar; andar; conversar; E para usar
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
  avatar ou iniciais na cor do crachá, com bolinha de status —, `kvRoleBadge`, `kvEmpty`, `kvChip`, `kvTitle` que só usa
  a Pixelify quando o texto não tem "C" maiúsculo nem dígitos), `select.ts` (`KvSelect` e `KvMultiSelect` com chips:
  teclado, busca a partir de 8 opções, digitar pula; abre dentro do `<dialog>` aberto), `modal.ts` (`KvModal`,
  `kvConfirm`), `toast.ts` (`kvToast`, um por chave), `icons.ts` (ícones em pixel), `kit.css`.
- **Ponte de tema** (`ui/bridge.css` + `ui/enhance.ts`): as janelas das outras frentes (convites, agenda, salas próprias,
  quadro, mural, atalhos, nota do status, mesa fixa, barra do avatar) ganham o visual do kit sem mexer no código delas, e
  todo `<select>` das telas das pessoas (classe `kv-*` nele ou num pai) vira o select do kit sozinho — o nativo fica
  escondido e continua a fonte da verdade (`value`, `change`, opções novas). Os do Habblaud original não mudam.
- **Topo que cabe**: substituído pelo **topo em grupos** (`client/src/kaviski/topbar-groups.ts`, ver `KAVISKI.md`): grupos
  com divisória, menu **Mais** fixo para os pouco usados e o que não cabe; Conversas continua o último a sair.
- **Pessoas** (`people.ts` + `people.css`): contas em cartões (avatar, papel, @usuário, salas em chips, "pede tarefas"),
  busca e filtro por papel; formulário com papel num select com explicação e a lista do que cada papel pode, salas com
  busca e chips (aceita colar uma pasta), senha com gerador (copia), validação em linha (`kvValidatePerson`, testada) e
  confirmação ao apagar. Abas **Contas**, **Convites** (o conteúdo da janela de convites, `kvMountInvites` em
  `invites.ts`) e **Registro** (agrupado por dia, com busca).
- **Conversas** (`chat.ts` + `chat-format.ts` + `chat.css`): lista à esquerda — "Aqui" (a área; roda privada `b:` da W2
  incluída), "Recentes" (cada 1:1 e cada sala de projeto em que estive, lembradas no navegador) e "Online agora"; busca
  em pessoas e, com 2+ letras, nas mensagens das minhas conversas (no servidor; clicar leva até a fala e a destaca); Nova
  conversa escolhendo a pessoa. À direita, **abas** das conversas abertas (até 6, lembradas), dias separados, falas
  agrupadas (5 min), bolhas minhas e dos outros com avatar e nome, links só http/https (`kvLinkify`, testado), emojis,
  urgente, "digitando…", Carregar anteriores. Sala em que não estou: só leitura, com "Ir até a sala".
- **Servidor** (`direct.ts`, `index.ts`): 1:1 guardada por conversa (1000 falas, 180 dias), `GET /dm?with=&before=&limit=`
  em páginas (`{messages, more}`), `POST /dm/typing {to}` (evento `typing` só para a outra pessoa, 1 a cada 1,5 s),
  `GET /dm/search?q=` (só nas conversas de quem busca e com quem ainda pode conversar, até 40). Salas: 300 falas por 30
  dias (`KV_CHAT_HISTORY*`). Testes em `server/kaviski/humanos/conversas.test.ts`. O fluxo de presença liga sozinho os
  eventos novos que alguém ouvir (`presence.ts` `bind`).
- **Cartão da pessoa** (`person-card.ts` + `.css`): faixa na cor do crachá com xadrez em pixel, avatar grande com o
  status, papel, status com nota (W2) e onde está; ações do registro em botões grandes de ícone (a primeira em azul);
  **mensagem rápida** (Enter manda a 1:1 e abre a conversa numa aba).
- **Quem está online** (`online.ts` + `online.css`): eu com o status num select próprio (a nota da W2 entra logo abaixo),
  Modo clássico (W1), Meu avatar, busca e as pessoas "Perto de você", "No escritório" e "Fora do escritório", com
  atalhos de Mensagem e Ir até. **Meu avatar** no `KvModal`, cores do crachá em amostras e a Minha mesa (W1).
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

## Planta livre (2026-11-06)

### Motor do prédio (frente A)
Com uma planta ligada (`KvPlan.on`, gravada pelo editor ou o rascunho dele), o prédio do mundo É a planta. Sem planta,
com ela desligada ou numa visita a outro prédio (Habblaud World), tudo é o original. Código em `client/src/kaviski/plan/`:
- `hooks.ts`: o único arquivo que os originais importam (sim, render, luz, overlay, câmera); sem o motor ligado cada
  gancho devolve null e o original segue. `engine.ts` liga os ganchos (`kvStartPlanEngine`, chamado pelo
  `plan/index.ts`), lê a planta gravada (`store.ts` da frente B) e preenche o `kvPlanWorld` do contrato (`plan`,
  `preview(rascunho)`, `actionSpots()`, `itemAt`, `areaRect`, `onChange`, `origin` = {0,0}: o tile 0,0 da planta é o do
  mundo).
- `engine-geom.ts` (puro): o número de vaga da sala (`RoomState.slot`) com a planta: `slot < 0` = lugar marcado (item
  `-1 - slot`, projeto/sala própria pelo `ref`), `0..V-1` = as vagas (`vaga`, por `order`), `>= V` = faixa automática
  (pares norte/sul de 16x12 dos lados de um corredor, para leste; ou fileiras oeste/leste de um corredor vertical, para
  o sul). A compactação do Sim só mexe nas salas da faixa.
- `engine-build.ts` (puro): áreas fixas (núcleo transladado com os mesmos ids — elevadores incluídos —, corredores,
  jardins, salas temáticas, corredor da faixa), as cascas da camada base (pátio com deck nas vagas vazias e nas salas que
  quem vê não tem, fachada/mureta/parede onde o corredor encosta na grama, enfeites dos jardins), a grade e o **caminho de
  pedra**: o que ficou sem caminho até a recepção ganha um caminho pela grama (abrindo um vão no fechamento/vidro do
  corredor). Sem recepção na planta, ela entra num lugar livre (sempre há elevador). Áreas fixas em cache por planta.
- `engine-room.ts`: a casca paramétrica de qualquer tamanho (face norte, parede sul externa quando dá para a grama,
  laterais cortadas nas portas `e`/`w`, batente nas portas `n`, placa que deixa lugar para o quadro, interruptor junto
  da porta principal, sombra da luz apagada) e o `KvFurnishCtx` (furn/seat/spot/wall que respeitam a passagem das
  portas; `ctx.wall` mede os itens largos das salas temáticas por `kvSpriteDims`). `tag` guarda várias ações por item; o
  `actionSpots()` usa `kvComputeActionSpots` (frente C) com cache até o próximo relayout.
- Furnishers padrão: `furnish-projeto.ts` (ilhas face a face que se repetem com a sala, mesas com `deskId`/`seat`/`rank`,
  quadro kanban, canto de reunião, estante, coluna de apoio, sofá nas salas altas; estilos `ilhas`, `aberto`, `baias`),
  `furnish-propria.ts` (reunião, descanso, pessoal, outra + a decoração do dono onde couber), `furnish-tema.ts` (a
  chave `tema`, para sala temática sem mobília registrada). Sala 16x12 com a porta no lugar do original (faixa para
  leste, vaga igual) usa o layout do original transladado: o **Clássico** (`examples.ts`, `kvPlanClassic({vagas})`) é
  igual ao prédio de sempre. `kvPlanExample()` é uma empresa maior para testes.
- Posição das pessoas (`humanos/pos.ts`): com a planta, fora das salas a posição vai absoluta (a planta é igual para
  todos); dentro de sala, relativa a ela (espelho só na faixa automática, como antes); no corredor da faixa, relativa à
  sala da coluna (`KvPos.v = 1` na faixa vertical). Mesa fixa aceita salas de até 32 tiles de altura.
- Áreas de voz/conversa: sala `r:<id>`, núcleo `a:core:<...>`, sala temática/corredor/jardim da planta `a:kv:<item>`
  (o `livekit.ts` aceita), o corredor principal (o da faixa, ou o maior) continua `c`. Nomes pelo `kvPlanAreaLabel`.
- Ao trocar a planta (ou a cada rascunho), as salas ganham vaga e layout novos, quem estava sentado num lugar que mudou
  de posição vai junto, e quem ficaria fora do chão vai para o chão livre mais perto (nunca para a grama). Rápido: 10
  rascunhos com relayout em ~70 ms na planta de exemplo.
- Console (testes): `habblaud.kvPlan.classic(vagas?)`, `.example()`, `.preview(planta)`, `.off()`; planta de teste
  guardada no navegador: `.keep(planta | 'classic' | 'example')` / `.forget()` (localStorage `kv-plan-dev`).
- Testes: `plan/engine.test.ts` (translado, faixa, vagas, caminho para tudo no Clássico e no exemplo, caminho de pedra,
  recepção que falta, salas de 10x9 a 40x20 com portas nos 4 lados).

### Editor da empresa, planta no servidor e modelos (frente B)
Botão **Planta da empresa** (régua/esquadro) no topo, só para quem pode editar; também pela maquete da sala temática
Arquitetura (ação `planta` do "ir e fazer", `kvOpenPlanEditor({focus?, templates?})` em `plan/editor.ts`).
- **Servidor** (`server/kaviski/humanos/plan.ts` + `plan.test.ts`): `<dataDir>/kaviski/plan.json` (600) com a planta, a
  versão, quem e quando, e as últimas `KV_PLAN_HISTORY` (40) versões. Rotas em `/api/kaviski/humanos/`: `GET plan`
  (`KvPlanDoc` + `canEdit`, já filtrada), `POST plan {plan, base, note?, paths?}` (grava só se `base` = versão atual;
  senão **409** com `{doc}` atual — duas pessoas editando não se apagam), `GET plan/versions`, `POST plan/restore
  {version, base?}` (a antiga vira uma versão nova; nada se perde). Valida com `kvNormPlan` (devolve `problems`).
  Quem grava: admin; equipe só com `editors: 'equipe'` (e não troca isso); cliente e visitante nunca. Evento `plan`
  `{version}` no fluxo de presença; registro "planta gravada"/"planta restaurada".
- **Filtro por quem vê** (no servidor, `kvPlanFor`): cliente/visitante não recebem item `projeto` de sala que não vê
  (nem o caminho), `propria` que não vê, nem agentes fixos dessas salas; sala própria "só escolhidos" sai para quem não
  a vê (equipe inclusive).
- **Salas fixas**: item `projeto` com `fixed` (planta ligada) entra no snapshot vazio e apagado pelo mesmo caminho das
  `pinned` do mapa de estilos: `server/kaviski/index.ts` junta `kvPlanPinned()` às entradas do `room-styles.json` (o
  mapa vence; sala `hidden` não volta). O caminho com as maiúsculas vem do snapshot e da lista de pastas na gravação
  (`paths`, guardado no `plan.json`). O Habblaud World não as vê vazias: o uplink conta só salas com agentes (teste).
- **Página**: `plan/store.ts` (`kvPlanDoc`, `kvSavedPlan`, `kvOnPlanDoc`, `kvLoadPlan`, `kvSavePlan`, `kvRestorePlan`,
  `kvPlanVersions`; recarrega no evento `plan`). O motor (frente A) monta o prédio com `kvSavedPlan()`.
- **Editor** (`plan/editor.ts`, desenho em `editor-draw.ts`, lógica pura testada em `editor-model.ts`, nomes/cores/ícones
  em `editor-kinds.ts`, `editor.css`): a planta em blueprint por cima do mundo, alinhada à câmera (`kvPeople.camera`,
  `kvPlanWorld.origin`), em três vistas (**Planta**, **Misto**, **Mundo**). Arrastar move (grade + ímã que encosta nas
  paredes vizinhas; Shift sem ímã; vermelho e não solta quando sobrepõe), alças redimensionam nos limites de
  `KV_PLAN_SIZE`, clique na borda da parede da sala escolhida põe/tira porta e arrastar a porta a move (pelas paredes),
  Delete apaga (com "Desfazer" no aviso), setas movem 1 tile (Shift: 4), Ctrl+Z/Ctrl+Shift+Z, Ctrl+D duplica, Ctrl+S
  grava, L trava, F sala fixa, Enter/duplo clique editam o nome, Esc solta/sai; roda = zoom, arrastar o vazio, espaço ou
  o botão do meio = câmera; arrastando perto da borda a câmera acompanha. Enquanto se edita, a interface do escritório
  (topo, listas, atividade, barra) some e fica só o mundo + o editor. Console: `habblaud.kvPlanEditor.open({templates})`. **Paleta** à esquerda (arrastar ou clicar):
  Corredor, Jardim, Vaga, as 12 salas temáticas (catálogo da frente C), salas de projeto (as do prédio + as pastas do
  Novo agente, com busca), salas próprias e o núcleo. **Painel** à direita: nome na placa, projeto/sala/tema, Sala fixa,
  Travar, paleta e cor da placa, mobília (estilos do furnisher), portas, largura/altura/X/Y, Duplicar/Apagar; sem nada
  escolhido: nome da empresa, contagem, Planta ligada ("desligada volta ao prédio original, o desenho fica"), "A equipe
  também edita" (admin), direção da faixa automática, Ajustar o tamanho, Voltar ao prédio original.
- **Avisos ao vivo** (`kvPlanWarnings`): sala sem porta para corredor/área aberta, sem caminho até a recepção, fora da
  planta, planta sem recepção — selo amarelo piscando no item e a lista no painel com **Corrigir** (vai até o item e,
  quando dá, põe a porta na parede encostada no corredor; recepção que falta volta).
- **Ao vivo**: cada mudança chama `kvPlanWorld.preview(rascunho)` (120 ms depois); Gravar manda ao servidor (409 abre a
  escolha "ficar com a de Fulano" / "gravar a minha por cima", com as duas miniaturas); Descartar volta à gravada; sair
  com mudanças pede confirmação. Se outra pessoa grava e eu não tenho mudanças, o editor adota a versão nova sozinho.
  **Versões**: lista com quem/quando/quantas peças e "Voltar para esta".
- **Faixa automática**: a bandeirinha verde "salas novas" arrasta o `KvPlan.auto`; a direção (direita/baixo) no painel.
- **Modelos — "Monte a sua empresa"** (`plan/templates.ts` + `templates.test.ts`, assistente em `plan/wizard.ts`):
  abre sozinho na primeira vez (sem planta gravada) e pelo botão Modelos. Nome, quantas pessoas (sugere reuniões e
  vagas), salas temáticas (as principais marcadas), reuniões a mais, vagas, projetos de hoje e salas próprias, e o
  estilo com miniatura ao vivo: **Clássico** (o prédio de hoje), **Campus** (pátio com jardim e corredor em anel,
  salas de 12×16 nas laterais), **Torre** (corredor vertical, alas lado a lado), **Galeria** (corredor em L, ou U com
  muitas salas, jardim no canto). Todos saem sem sobreposição, aceitos inteiros pelo `kvNormPlan` e sem nenhum aviso
  (toda sala com porta e caminho até a recepção), testado para 0 a 80 projetos. O rascunho do prédio de hoje é
  `kvPlanFromClassic` (salas nos slots de agora).
- **Celular**: o editor abre em modo simples (sem paleta e sem portas; tocar escolhe, arrastar move, painel embaixo) com
  o aviso de que o editor completo é para tela grande.
- Traduções em `shared/locales/kaviski-editor.ts`. Testes no navegador (Playwright, instância 4801/4802): assistente,
  gravar, mover, redimensionar, porta, paleta, desfazer, Misto com o motor, 409 entre admin e equipe, cliente sem o
  botão e com a planta filtrada, versões.

### Organograma, agentes de IA fixos, Pessoas e atalhos (frente D)
- **Dados** (vale com a planta ligada ou não):
  - `<dataDir>/kaviski/org.json` (600): as **áreas** (`KvDept`: nome, cor, ícone em pixel, área-mãe, responsável) e os
    **agentes fixos** (`KvOrgAgent` = o `KvFixedAgent` do contrato + `seatSide` e a aparência opcional). Decisão: os
    agentes fixos ficam aqui e **não** em `KvPlan.agents` (a frente B só deixa passar o que vier ali), porque precisam
    valer com a planta desligada.
  - Cargo, área e gestor de cada pessoa ficam na **conta** (`profile.org` no `users.json`; somem com ela). Gestor =
    `u:<pessoa>` ou `a:<agente fixo>`. **Sem ciclos**: o servidor recusa (400) quem acabaria gestor de si mesmo; na
    página, quem fecharia ciclo nem aparece na lista de gestores (`kvWouldCycle`, testado).
  - Áreas padrão até alguém gravar as suas: Diretoria, Desenvolvimento, Design, Comercial, Atendimento, Agentes de IA.
- **Rotas** (`server/kaviski/humanos/org.ts`): `GET /api/kaviski/humanos/org` → `{depts, agents, people, can}`;
  `POST /org/depts` (admin, troca a lista); `POST /org/people/:id` `{title, dept, reportsTo}` (admin);
  `POST /org/agents` `{agent}` e `DELETE /org/agents/:id` (admin e equipe). Cadeira de agente fixo é única: nem outro
  agente fixo nem a mesa fixa de uma pessoa (`kvSameDesk`, com o espelhamento do corredor) → 409. Evento `org` (sem
  dados) no fluxo de presença; as páginas relêem. Tudo vai ao Registro ("organograma: pessoa", "agente fixo criado"...).
- **Quem vê o quê (decisão)**: admin e equipe veem tudo. **Cliente e visitante** veem só a equipe (admin + equipe, sem
  usuário e sem papel), a si mesmos, as áreas e os agentes fixos **das salas que eles veem** (sem a regra de quem senta);
  gestor escondido não aparece (a pessoa vira topo). Nunca veem outros clientes. Os agentes ao vivo que aparecem são os
  do snapshot que já chega filtrado.
- **Organograma** (`client/src/kaviski/humanos/org-chart.ts` + `.css`; `kvOpenOrgChart({focus?})`, também na aba
  Organograma da tela Pessoas e no botão do topo "Organograma"): árvore com cartões 3D em pixel (avatar de verdade, nome,
  cargo, área na cor dela, status ao vivo), linhas em degrau (`kvOrgLayout`, puro e testado: pai no meio dos filhos,
  muitas folhas viram coluna), agrupado por **Hierarquia** ou **Por área** (áreas como grupos coloridos, a hierarquia
  dentro delas), filtros Todos / Pessoas / Agentes, busca (acende quem bate e leva até ele), zoom (roda, pinça, botões,
  Encaixar), arrastar, recolher equipes, exportar **PNG**. Clique num cartão: detalhe ao lado (Abrir o cartão,
  Mensagem, Editar; agente: Ver no escritório, Editar). **Agentes ao vivo que não são fixos** viram a "Equipe de IA" do
  projeto (pendurada no agente fixo principal da sala, se houver); subagentes debaixo de quem os chamou. Celular (ou o
  botão de lista): lista recolhível. Agente fixo sem agente agora: cartão apagado.
- **Agentes fixos na mesa** (`fixed-agents.ts`): a cada quadro (gancho `kvPeople.onTick`, sem reescrever o `sim.ts`),
  o agente ao vivo que bate com a regra (`main` / `provider:claude|codex` / `sub` / `name:<texto>`; a mais específica
  escolhe primeiro, `kvMatchFixedAgents`, testado) ganha a cadeira como `homeSpot` (o Sim leva o agente até ela). Sem
  agente: a cadeira fica reservada (`kvfixed:<id>`, nenhum outro agente senta) com a plaquinha roxa "mesa de <nome>".
  Pessoa (mesa fixa, avatar sentado) vence o agente. Aparência opcional pelo `sim.agentPatches`. A posição é a mesma da
  mesa fixa das pessoas (KvPos relativa à sala): vale no prédio original e na planta (a frente A mantém a KvPos).
  Cadastrar: clique numa cadeira com o avatar → **"🤖 Fixar um agente aqui"** (ou "Mesa de X: editar o agente"), ou
  Pessoas → **Agentes fixos** → Novo (com **Escolher no escritório**: o próximo clique numa cadeira, com ou sem
  avatar). Formulário (`fixed-agents-form.ts`): nome (sugerido "Claude · Sala"), sala, qual agente, cadeira, cargo, área,
  gestor e aparência (as peças do editor de personagem).
- **Tela Pessoas**: seção **Organograma** no formulário da conta (cargo, área no select do kit com a cor e o ícone,
  gestor no select com o avatar), cargo e área nos cartões; abas novas **Organograma**, **Áreas** (nome, 10 cores ou
  qualquer uma, 14 ícones em pixel, área-mãe, responsável, ordem; grava de uma vez) e **Agentes fixos**.
  `kvOpenPeople(tab?, personId?)` exportada (a frente C usa no RH).
- **Cargo à mostra**: no cartão da pessoa (cargo, chip da área, "Responde a"), na lista de online ("Meu cargo: ..." e o
  cargo de cada um).
- **Ação "ir e fazer"** `organograma` (`kvRegisterAction`, ícone `org`): o quadro do organograma do RH e da diretoria
  (frente C marca os itens) abre `kvOpenOrgChart()`.
- **Atalhos com cores e vida** (`shortcuts.ts`, `shortcuts-list.ts`, `shortcuts.css`): grupos com cor e ícone em pixel
  (Andar, Conversar, Usar coisas, Câmera, Janelas, Editor da empresa — este só para a equipe), teclas desenhadas como
  teclas 3D em pixel (setas em cruz, mouse como pílula), cartões entrando em cascata, busca, filtro por grupo e
  **"Experimente"**: com a janela aberta, apertar uma tecla (ou Ctrl+Z...) acende os atalhos dela. Para acrescentar:
  `kvAddShortcuts('grupo', [{ keys: ['E'], text: tr('...') }], {title, color, icon})` (tecla = `'Ctrl+Z'`, `'←'` ou
  `{ m: tr('clique') }`; `range: true` = faixa). A mesma lista, compacta e colorida, na Ajuda (tecla ?).
- Código: `shared/kaviski-org.ts` (+ teste), `server/kaviski/humanos/org.ts` (+ `org.test.ts`), `client/src/kaviski/humanos/
  {org-api,org-chart,org-people,org-icons,org-start,fixed-agents,fixed-agents-form}.ts` + `org-chart.css`, `org.css`,
  `shortcuts{,-list}.ts` (+ `shortcuts-list.test.ts`), `shortcuts.css`; traduções em `shared/locales/kaviski-organograma.ts`.
  Mudanças pequenas em arquivos do fork: `humanos/index.ts` (servidor: rotas; página: `kvStartOrg`, `kvOpenPeople`),
  `world.ts` (`kvPeople.decode` e `kvPeople.onTick`), `furniture.ts` (`kvSeatMenuExtras`), `people.ts`,
  `person-card.ts`, `online.ts`. Depuração: `habblaud.kvOrg.doc()` / `habblaud.kvOrg.open()` no console.
- **Habblaud World**: nada disto entra no snapshot do `Office` (áreas, cargos e agentes fixos moram em `org.json` e
  nos perfis; o agente fixo só muda a cadeira de um agente real na página).

### Salas temáticas fixas e "ir e fazer" (frente C)
Pedido do Vitor: "salas temáticas fixas relacionadas ao que tem de funções e interações; quero poder pedir para o avatar
ir nelas e interagir; se eu clicar num menu, o avatar vai até o local/item e sai daquela ação; tudo deve ter um
item/sala interativo fixo". Tudo só com `HABBLAUD_HUMANOS=1` **e** uma planta ligada; sem planta, os botões abrem
direto como sempre.
- **12 salas temáticas** (`KvThemeKey`), cada uma com piso, tapete, cores, plantas e os itens interativos marcados com a
  ação (`ctx.tag`). Catálogo para a paleta do editor em `themes-info.ts` (`kvThemeInfo(key)`/`kvThemeInfos()`: nome,
  ícone em pixel colorido, cor da placa, cor do piso, descrição, tamanho sugerido, ações). Mapa das funções → item:

  | Sala | Item → ação |
  |---|---|
  | RH | balcão com a ficha → **Pessoas**; quadro na parede → **Organograma** (frente D); arquivo → **Registro** (`kvOpenPeople('registro')`); mesa dos envelopes → **Convidar visitantes**; poltronas de espera |
  | Diretoria | organograma grande → **Organograma**; luneta → **Visão geral (O)**; mesa da diretoria, estante, poltronas |
  | Reunião | calendário → **Minha agenda**; telão; mesa(s) com banquetas |
  | Recepção de visitantes | balcão → **Convidar visitantes**; quadro de presença → **Quem está online / meu status**; mapa → **mini-mapa**; totem "i" → **Ajuda (?)**; espera |
  | Provador | espelhos de camarim (com reflexo) e espelho de corpo inteiro → **Meu avatar** (o avatar penteia o cabelo); arara de roupas |
  | Cabines de foco | relógio de tomate → **Modo foco (pomodoro)**; cabines de mesa com vidro |
  | Auditório | púlpito → **Palco (megafone)**; telão; fileiras de banquetas com corredor |
  | Central dos agentes | terminal → **Novo agente**; TV grande → **Timelapse (L)**; painel → **Meu dia (M)**; estante → **Histórico**; impressora → **Feed** |
  | TI e ajustes | sino → **Avisos**; pôster das teclas → **Atalhos**; bancada → **Ajustes de voz e vídeo**; rack → **Configurações**; engrenagem → liga/desliga **Abrir só ao chegar ao local** |
  | Arquitetura | maquete e planta emoldurada → **Planta da empresa** (frente B); prancheta → **Salas** |
  | Correio | caixa de correio e telefone → **Conversas**; escaninho → **Entregas** |
  | Sala de descanso | rede → **Modo clássico**; fliperama (E = jogar, da W1); TV com sofá, poltronas, puffs |
- **De qualquer tamanho** (8x8 até 48x32, porta em qualquer lado): `themes-place.ts` (`KvPlacer`) põe cada móvel só se a
  porta ainda alcança todos os tiles de uso e os assentos (busca em largura; parte de um tile da porta e exige o
  interruptor ligado a ela); reserva o tile de onde se usa cada item. Item de parede sem lugar (sala estreita, porta no
  norte) vira um **cavalete** no chão com a mesma ação. Sala grande ganha grupos no miolo (ilhas de mesas, cantinhos de
  poltronas, mesas de reunião) e móveis do tema espalhados pelas paredes até uma densidade boa. Testado em
  `themes.test.ts` com um "motor de mentira" (`themes-harness.ts`): 12 salas × 8 tamanhos × 4 lados de porta — a ação
  principal sempre tem item, todo item é alcançável, nada sobreposto.
- **Itens novos em pixel art** (`themes-sprites.ts`, puro, mesmo kit dos móveis: topo claro, frente na cor, lado escuro,
  contorno, sombra): balcão do RH, mesa de convites, caixa de correio, púlpito, maquete, prancheta, terminal, rack,
  bancada de voz e vídeo, escaninho, telefone, rede, totem de informações, luneta, relógio de tomate, arara, espelho de
  corpo inteiro, arquivo, cavaletes; na parede: organograma (2, 3 e 4 tiles), quadro de presença, mapa, calendário,
  gráfico, TV grande (a programação passa nela), sino, engrenagem, teclas, espelho de camarim (reflexo de verdade),
  planta emoldurada, painel de voz. Cada um usa um móvel do catálogo como **suporte** (footprint e se bloqueia) com a
  variante `kv-*` (`themes-dims.ts`, `kvSpriteDims`); o motor confere a largura real na parede. Gancho de 1 linha:
  `const art = kvArt(artModule)` em `client/src/world/index.ts` (`themes-art.ts`; `kvRegisterSprite` para outros).
- **"Ir e fazer"** (`go-and-do.ts`, `kvGoAndDo(key, {direct?, spot?})`): o avatar anda (corre se longe) até o item da
  ação mais perto (`kvPlanWorld.actionSpots()`, calculado por `kvComputeActionSpots` em `themes-spots.ts`), vira para
  ele, faz a pose (mexer, ler papéis, pentear no espelho, falar no púlpito) e um brilho com o ícone sobe do item. Dois
  jeitos, pela configuração **"Abrir só ao chegar ao local"** (por pessoa, ver abaixo):
  - **desligada (padrão)**: a janela abre **na hora do clique**, como antes do "ir e fazer", e o avatar vai andando até
    o item mesmo assim (pose e brilho ao chegar; não reabre nada). **Fechar a janela antes de ele chegar para o avatar**
    (cancela o trajeto): `KvOpenWatch` (`go-and-do-model.ts`) olha as janelas novas (`dialog`, `[popover]`,
    `[role=dialog]`...) que apareceram até 1,5 s depois do clique e o `aria-expanded`/`aria-pressed` do botão; clicar
    de novo no botão (ou a tecla) fecha a janela e para o avatar. Ação sem janela visível (mini-mapa, Visão geral...):
    o avatar só vai até lá.
  - **ligada**: o avatar anda e a janela **só abre quando ele chega**. Chip "Indo até o RH… · Esc cancela"; clicar de
    novo, Esc ou andar cancela.
  Nos dois: Esc ou andar cancela a ida; Shift+clique abre direto, sem andar. Sem avatar, modo clássico, avatar no
  elevador, sem planta ou sem item: abre direto.
  - **Botões ligados** sem reescrever os módulos das outras frentes (`themes-actions.ts`, `KV_ACTION_DEFS`): um
    listener de captura em cada botão (os do topo, os que foram para o menu **Mais** — continuam os mesmos — e o "?"
    do mini-mapa) desvia o clique para o "ir e fazer"; `run` clica o próprio botão sem desvio. **Shift+clique** abre
    direto; botão já ligado/aberto (conversa aberta, foco ligado, modo clássico) fecha direto. Teclas **L**, **M** e
    **?** também passam por ele. Ações registradas pelas irmãs (`organograma`, `planta`) valem igual.
  - **Tecla E** perto de um item ("E · Registro (RH)", também no botão de toque do celular), **clique no item** (perto ou
    longe: o avatar vai e usa) e **contorno aceso** com o nome ao passar o mouse.
  - **Quem pode**: cada ação pergunta ao botão dela (escondido = não pode) e Timelapse, Meu dia, Histórico e Novo agente
    são só da equipe (cliente e visitante: o servidor já recusava). Item de ação que eu não posso não acende, não tem E
    nem clique.
  - **Configuração "Abrir só ao chegar ao local"** (padrão desligada), **salva por pessoa**: `profile.prefs`
    (`{abrirAoChegar}`) no `users.json` da conta (`<dataDir>/kaviski/`; visitante: no perfil do convite), lida e gravada
    só pela própria pessoa em `GET/POST /api/kaviski/humanos/prefs` (`server/kaviski/humanos/prefs.ts`; formato e
    validação em `shared/kaviski-prefs.ts`: chave desconhecida some, valor de tipo errado = 400; acesso local sem login
    = o admin embutido). Na página, `kvPrefs` (`client/src/kaviski/humanos/prefs.ts`) busca ao ligar o "ir e fazer";
    sem conta ou sem resposta, fica no `localStorage` (`habblaud.kv.prefs`). A opção antiga `habblaud.kv.irAndando`
    (que desligava a caminhada) é ignorada: o padrão novo já abre na hora. Onde mudar: **Configurações › Ir e fazer**
    (grupo registrado em `client/src/kaviski/settings-groups.ts`), o botão "🚶 Abrir ao chegar" na lista de quem está
    online (ao lado de Meu avatar) e a engrenagem da sala de TI.
- Testes no navegador (Playwright, instância 4811/4812, planta `habblaud.kvPlan.example()` com as 12 salas, 38 itens):
  cada ação do topo leva o avatar ao item certo e abre a janela; Esc cancela; Shift abre direto; E e clique; contorno;
  pose no espelho; cliente sem Pessoas/Registro/Convites/Novo agente/Timelapse/Meu dia/Histórico e sem "E · Pessoas" no
  balcão; celular (menu Mais → anda até o RH; botão de toque "E · Registro (RH)"). Depuração: `habblaud.kvGoAndDo(key)`,
  `habblaud.kvActions()`, `habblaud.kvPlanWorld.actionSpots()`.
- Código: `client/src/kaviski/plan/{themes,themes-place,themes-info,themes-sprites,themes-dims,themes-art,themes-spots,
  themes-actions,themes-harness,go-and-do,go-and-do-model}.ts` + `themes.css` (+ `themes.test.ts`, `themes-spots.test.ts`,
  `themes-sprites.test.ts`, `go-and-do-model.test.ts`); preferência por pessoa em `client/src/kaviski/humanos/prefs.ts`,
  `server/kaviski/humanos/prefs.ts` (+ `prefs.test.ts`) e `shared/kaviski-prefs.ts`; traduções em `shared/locales/kaviski-temas.ts`. Mudanças pequenas em arquivos do fork:
  `humanos/index.ts` (`kvStartGoAndDo()`), `humanos/world.ts` (`kvPeople.onItemClick` no clique). Contrato: campo
  opcional `box` em `KvActionSpot` (`plan/api.ts`).
- **Habblaud World**: nada disto entra no snapshot do `Office` — as salas e os itens existem só na página (mobília da
  planta) e as ações só abrem janelas que já existiam.

## Reuniões e reservas de sala (2026-11-06) ✅
Pedido do Vitor: "salas de reunião diferentes que possam ser usadas de verdade, agendadas e marcadas (como as do MS
Teams); privada = ninguém de fora vê nem escuta; melhorar o layout com essas salas". Tudo só com `HABBLAUD_HUMANOS=1`.
- **Salas de reunião = salas próprias do tipo `reuniao` com `meet`** (`shared/kaviski-meetings.ts`, `KvMeetConfig`): 6
  tipos (`cabine` 2 lugares, `bate-papo` 4, `reuniao` 8, `conselho` 14, `treinamento` 20, `criativa` 8), capacidade,
  equipamentos (tela, vídeo, quadro, som, projetor, café, acessível), "aceita reservas", "liberar se ninguém aparecer
  em 10 min" e "privada por padrão". Configura-se na tela **Salas** (cartões dos tipos). Sala antiga sem `meet` = `reuniao`.
- **Mobília por tipo**, no prédio original (16x12, `humanos/rooms-meet.ts`) e na planta livre de 8x8 a 40x28
  (`plan/furnish-meet.ts`, pelo `KvPlacer`: tudo alcançável), 14 itens novos em pixel art (`plan/meet-sprites.ts`: mesa
  redonda, mesa de conselho, mesa de chamada, painéis acústicos, mesas de treinamento, mesa alta, flip chart, bar de
  café, tela de projeção, mural de post-its, painel de reservas da porta). O painel de cada sala é marcado com a ação
  `reunioes` do "ir e fazer" (abre o painel da sala).
- **Reservas** (`server/kaviski/humanos/meetings.ts` + `meetings.test.ts`, `<dataDir>/kaviski/meetings.json`, 600):
  `GET|POST /api/kaviski/humanos/meetings`, `POST meetings/now` (usar agora pela porta), `GET meetings/freebusy`
  (reservas + agenda ICS, sem títulos, só a equipe), `POST|DELETE meetings/<id>` (mudar/cancelar; `?series=1`), `POST
  meetings/<id>/checkin|end|extend`. Evento `meetings` no fluxo de presença. Regras: marca a equipe/admin numa sala que
  vê e que aceita reservas; nunca duas reservas no mesmo horário (409 com os conflitos; repetição diária/dias
  úteis/semanal até 52 vezes, com "marcar só os livres"); muda/cancela o organizador ou um admin; check-in sozinho quando
  alguém da reunião entra na sala (de 5 min antes); sem check-in em 10 min a reserva é liberada (`released: 'auto'`).
- **Privacidade**: numa privada, quem não é da reunião vê só "Reunião privada" (sem título, organizador nem convidados).
  Enquanto acontece, a sala fica **trancada e coberta** (`social.ts` `syncMeetingLocks`, tranca com `veil` e `meeting`):
  só organizador e convidados (e quem eles deixarem entrar pela batida na porta) entram; para os outros o servidor não
  manda a posição de quem está dentro (presença: `veil` → sem `pos`, com `meet: true`, "🔒 em reunião privada" na lista),
  recusa token do LiveKit, conversa, quadro, mural e reações. Destrancar a sala de uma reunião privada a torna pública.
  O cadeado da barra numa sala própria agora tranca **e cobre** (`lock {veil: true}`).
- **Convidado de fora da sala** (ex.: cliente): vê a sala da reunião de 15 min antes a 5 min depois (`KvRooms.setGuest`;
  eventos `rooms` e `plan` com `refilter` avisam as páginas).
- **Página**: botão **Reuniões** no topo (`meetings-dialog.ts`: Minhas reuniões, Marcar reunião com assistente de
  agendamento e "achar sala", Salas), **painel da porta** (`meetings-panel.ts`: LIVRE/OCUPADA, usar agora 15/30/60 min,
  check-in, mais 15 min, encerrar), plaquinha com LED na porta de cada sala e a sala privada coberta com persianas
  (`meetings.ts`, `meetings-world.css`), status automático "📅 Em reunião até…" (fonte `reuniao`) e aviso 1 min antes,
  "Baixar .ics", e as reservas na janela Minha agenda. Lógica pura em `meetings-model.ts` (+ teste).
- **Planta da Kaviski**: a sala temática genérica de reunião virou a **Sala do Conselho** (reservável, mesmo lugar) e
  entrou a **Ala das reuniões** (Rua e Passeio das reuniões, jardim): Cabines 1–3, Sala Café e Sala Pôr do Sol
  (bate-papo), Salas Azul e Verde (reunião), Sala Ideias (criativa) e Sala de Treinamento. Script de montagem fora do
  repositório (as salas são dados: `rooms.json` + `plan.json`, versão nova da planta; a anterior fica no histórico).
- Traduções: `shared/locales/kaviski-reunioes{,-ui,-salas}.ts`.

## Sala de Arquivos (2026-11-08) ✅
Pedido do Vitor: "um sistema de arquivos internos da empresa, uma sala de arquivos interativa no menu de cima, focado em
tudo relacionado a arquivos e documentos, inclusive ligados às reuniões". Tudo só com `HABBLAUD_HUMANOS=1`.
- **Contrato** (`shared/kaviski-files.ts`): pastas (`KvFolder`, acesso `equipe` | `todos` | `pessoas`, cor), arquivos
  (`KvFile`: enviado ou `doc` = Markdown escrito aqui; versões, etiquetas, descrição, favoritos por pessoa, reuniões
  ligadas com cópia do título/horário e de quem é da reunião, lixeira), regras de acesso puras (`kvSeesFolder`,
  `kvSeesFile`, `kvCanEditFile`) e o Markdown seguro (`kvMarkdown`: escapa tudo; links só http/https/mailto).
- **Servidor** (`server/kaviski/humanos/files.ts` + `files.test.ts`): índice em `<dataDir>/kaviski/files/index.json` e o
  conteúdo em `files/blobs/<id>` (600). `GET /api/kaviski/humanos/files` (o que eu vejo), `POST files/upload` (base64 no
  JSON: a borda só aceita JSON, barreira contra CSRF; até 25 MB), `POST files/doc`, `POST files/<id>` (nome, pasta,
  descrição, etiquetas, favorito, texto do documento), `POST files/<id>/link|trash|restore|revert`, `DELETE files/<id>`
  (só da lixeira), `GET files/<id>/raw[?v=n&dl=1]` (HTML/SVG/desconhecido baixa como `application/octet-stream`, tudo numa
  sandbox CSP; PDF e imagens abrem na janela), `POST|DELETE files/folders[/<id>]`. Evento `files` no fluxo de presença.
  Regras: vê pela pasta e todas as mães, por ser da reunião ligada ou por ter enviado; raiz só a equipe; muda quem
  enviou, a equipe ou um admin; o cliente envia nas pastas que vê (a pasta que ele cria herda o acesso); visitante não
  entra; apagar de vez só quem enviou ou admin; lixeira some sozinha em 30 dias; espaço total 10 GB
  (`HABBLAUD_FILES_MAX_GB`). Reunião privada: quem não é dela vê só "Reunião privada" na ligação.
- **Página** (`client/src/kaviski/humanos/files/`): botão **Sala de Arquivos** no topo (`index.ts`; `kv-btn-files` no
  grupo Escritório, `topbar-model.ts`), janela `files-dialog.ts` (vistas Todos/Recentes/Favoritos/Meus/Documentos/Das
  reuniões/Lixeira, árvore de pastas, espaço usado, caminho, busca sem acento, tipo, ordem, grade/lista, arrastar do
  computador envia e arrastar um arquivo para uma pasta move, detalhes com prévia, descrição, etiquetas, reuniões,
  versões e ações, "Copiar link" `/?arquivo=<id>`, atividade recente), `files-editor.ts` (editor de documento com barra
  de formatação, Escrever/Lado a lado/Prévia, Ctrl+S, aviso ao sair sem salvar; pasta com nome, cor e quem vê; mover),
  lógica pura em `files-model.ts` (+ teste). **Das reuniões**: as minhas reuniões de ontem em diante com **Ata** (cria
  "Ata - <reunião> - <data>" na pasta Reuniões, já ligada, com data, sala, organizador, participantes, a pauta da nota,
  anotações, decisões e próximos passos) e **Enviar**; e os arquivos agrupados por reunião. No cartão de cada reunião
  (`meetings-dialog.ts`) entrou o botão **Arquivos da reunião** com o número de arquivos (`files/meet-hook.ts`).
- **Sala temática `arquivo`** (`shared/kaviski-plan.ts`, `plan/themes*.ts`): balcão do arquivo, arquivos de gaveta,
  estantes de pastas, impressora e mesa de consulta; a ação `arquivos` do "ir e fazer" leva o avatar até o balcão. Na
  planta da Kaviski ela entrou embaixo da Ala das reuniões (x 46, y 62, 12x11, porta para o Passeio), versão nova da
  planta (a anterior fica no histórico).
- Traduções: `shared/locales/kaviski-arquivos.ts`.

## Como desenvolver sem derrubar o escritório
- Desenvolver numa **segunda instância** (`HABBLAUD_PORT=4757`, `HABBLAUD_REMOTE_PORT=4758`,
  `HABBLAUD_DATA_DIR=~/.habblaud-dev`), sem mexer no serviço `habblaud` em produção.
- Antes de cada commit: `npm run typecheck && npm test && npm run i18n:check && npm run build` (pt-BR primeiro; os
  outros idiomas pelo `i18n:check`).
  **Sempre numa worktree própria** (com `npm ci` dela): o serviço de produção serve o `dist/` da pasta principal e um build
  ali troca a página na hora. Parar instância de teste só pelo PID (a linha de comando é igual à da produção).
- Só depois de testado: `python3 ~/base/scripts/kc-habblaud.py subir --build`.
- Commit e push direto na `main` do fork, mudanças pequenas.
