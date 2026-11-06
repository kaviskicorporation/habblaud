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
Permissões finas por sala e por ação, auditoria, convites por link (✅ feito: ver "4 — convites por link" abaixo),
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
  anda até o boneco de quem chamou, fica até 45 s (ou até o status mudar) e volta sozinho. Por enquanto vai até onde o
  boneco está (a "mesa fixa" `profile.desk` é da sessão d553e49d, que vai ligar depois). 1 chamada a cada 15 s por pessoa.
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

### 4 — convites por link, agenda e extras do dia a dia (2026-11-06) ✅
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
  (ponto vermelho). Salas próprias (de reunião) entram ao ligar `agendaRooms` em `humanos/index.ts` às salas próprias.
- Rotas: `GET|POST /api/kaviski/humanos/agenda`, `GET /api/kaviski/humanos/agenda/rooms`.

**Extras.**
- **Mini-mapa** (canto de baixo à direita da área livre; **N** recolhe/abre, lembrado): prédio, salas acesas/apagadas,
  agentes, pessoas na cor do crachá, eu piscando e o retângulo da câmera. Clicar anda até lá (longe: correndo) ou leva
  a câmera.
- **Atalhos**: botão **?** do mini-mapa e, na Ajuda do Habblaud (tecla **?**), uma seção "Pessoas no escritório:
  teclas" posta em tempo de execução. Lista em `client/src/kaviski/humanos/shortcuts-list.ts` (fácil de editar).
- **Modo foco (pomodoro)**: botão dos fones no topo, 25 ou 50 min, status **"🎧 Focado até 15h"** (fonte `foco`),
  minutos restantes no botão, som suave no fim (Web Audio; só uma aba toca), "Mais 25 min". Lembrado no navegador.
- **Boas-vindas**: tour de 3–4 passos na primeira entrada (visitante: escolher o boneco; andar; conversar; E para usar
  as coisas; modo foco e agenda), lembrado por pessoa no navegador; "Ver o tour de novo" na janela de Atalhos.
- **Quem está na sala**: parar o mouse sobre uma sala ou área comum mostra as pessoas, quantos agentes e a reunião
  marcada.
- Status automático: `client/src/kaviski/humanos/auto-status.ts` é o ponto de troca para o `status.ts`
  (`kvSetStatus`/`kvClearStatus`, manual vence); enquanto ele não existe, só mexe se a pessoa está "disponível".
- Código: `server/kaviski/humanos/{invites,invites-route,agenda,test-harness}.ts` (+ `invites.test.ts`,
  `agenda.test.ts`), `shared/{kaviski-invites,kaviski-ics,kaviski-agenda}.ts` (+ `kaviski-ics.test.ts`),
  `shared/locales/kaviski-extras.ts`, `client/src/kaviski/humanos/{extras,invites,agenda,focus,minimap,shortcuts,
  shortcuts-list,welcome,room-hover,walk,auto-status}.ts` + `extras.css`.

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

## Como desenvolver sem derrubar o escritório
- Desenvolver numa **segunda instância** (`HABBLAUD_PORT=4757`, `HABBLAUD_REMOTE_PORT=4758`,
  `HABBLAUD_DATA_DIR=~/.habblaud-dev`), sem mexer no serviço `habblaud` em produção.
- Antes de cada commit: `npm run typecheck && npm test && npm run i18n:check && npm run build` (pt-BR primeiro; os
  outros idiomas pelo `i18n:check`).
- Só depois de testado: `python3 ~/base/scripts/kc-habblaud.py subir --build`.
- Commit e push direto na `main` do fork, mudanças pequenas.
