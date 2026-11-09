# Fork Kaviski do Habblaud

Este repositório (`kaviskicorporation/habblaud`) é um fork de `marmottajr/habblaud` com personalizações para integrar o
Habblaud ao **TwiCC** (interface web do Claude Code) no ambiente Kaviski. A cada versão nova do original:

```bash
cd ~/habblaud
git fetch upstream
git merge upstream/main          # resolver conflitos com a tabela abaixo
export NVM_DIR=~/.nvm; . ~/.nvm/nvm.sh
npm ci && npm run typecheck && npm test && npm run i18n:check && npm run build
python3 /home/hostadmin/base/scripts/kc-habblaud.py subir --build
git push origin main             # nunca --force
```

Regra: a lógica nova mora em arquivos **só nossos** (`server/kaviski/`, `client/src/kaviski/`, `shared/kaviski*.ts`);
nos arquivos originais só há **ganchos de 1 linha**, marcados com `fork Kaviski`. Sem as variáveis abaixo (e sem
`room-styles.json`), o comportamento é o original.

> Plano em andamento: **pessoas no escritório** (estilo Gather, equipe + clientes, voz e vídeo) — ver `KAVISKI-HUMANOS.md`.
> Ligado com `HABBLAUD_HUMANOS=1` (contas por pessoa, papéis, filtro de salas): detalhes e ganchos em `KAVISKI-HUMANOS.md`.

## Recursos

| Recurso | Como liga | O que faz |
|---|---|---|
| Embutir no TwiCC (iframe) | `HABBLAUD_FRAME_ANCESTORS="http://192.168.1.220:3500 http://localhost:3500 http://127.0.0.1:3500"` | Troca `X-Frame-Options` por `Content-Security-Policy: frame-ancestors 'self' <origens>` na página, na tela de login e nos anexos das entregas. Na porta remota em **HTTPS**, o cookie de login vira `SameSite=None; Partitioned` (com Strict ele nunca iria num iframe de `http://…:3500`, que é outro site). |
| Abrir no TwiCC | `HABBLAUD_TWICC_URL=http://192.168.1.220:3500` | Vai no snapshot em `meta.kaviski.twiccUrl`. Botão **Abrir no TwiCC** no painel do agente e link **TwiCC** em cada sessão do histórico. Dentro de iframe abre em `_top`, fora em `_blank`. |
| Companion do painel Browser | o mesmo `HABBLAUD_TWICC_URL` | Dentro do iframe do TwiCC, carrega `<HABBLAUD_TWICC_URL>/_twicc/browser-companion.js` (some o aviso "This page doesn't include the TwiCC companion script"): voltar/avançar de verdade, seleção de elemento para descrever ao agente e captura de erros da página. Fora do iframe não carrega. `client/src/kaviski/companion.ts`. |
| Link direto para a sala | sempre (só age com o parâmetro) | `/?sala=<caminho da pasta, urlencoded>` (ou `?room=`) seleciona e centraliza a sala; espera até 15 s se ela ainda não existe. Na porta remota o parâmetro sobrevive à tela de login. |
| Cor e grupo por cliente | `POST /api/rooms/style` (só local) | Moldura colorida na placa da sala + selo com o nome do grupo; na pílula (zoom longe) a faixa usa a cor do cliente e o selo vai acima. Vai no snapshot em `RoomInfo.kaviski`. |
| Empresa completa (salas fixas) | `"pinned": true` no mapa de `/api/rooms/style` | Toda sala fixa existe sempre, vazia (apagada) até alguém chegar, com o mesmo id/semente que o Office daria. Salas na ordem dos clientes: as do mapa primeiro, agrupadas por `group` (grupos na ordem em que aparecem no mapa), depois as outras. `server/kaviski/pinned.ts`. |
| Nome da sala pelo mapa | `"name"` no mapa | Usado quando não há apelido manual (Renomear vence). |
| Nome do produto: **Voxtrin** | sempre (`shared/kaviski-marca.ts`) | Na tela o escritório se chama Voxtrin (logo do site voxtrin.com): logotipo no topo e na abertura (o "V" separado só nas telas estreitas), favicon e ícones com o "V", título da aba, Sobre, login e convites (logotipo e cores do site), avisos e os quatro idiomas (`tr()` troca "Habblaud" por "Voxtrin"). Ficam como estão: "Habblaud World" (serviço de terceiros) e os nomes técnicos (`HABBLAUD_*`, `~/.habblaud`, serviço `habblaud`, `/habblaud`, repositório). Imagens: arquivos oficiais do Voxtrin em `client/public/assets/brand/voxtrin-{icon,icon-space,full,full-space}.png` e `client/public/favicon.ico` (como vieram); o resto sai deles com `python3 scripts/kaviski/marca.py`. |
| Nome da empresa | Configurações › Empresa (admin ou pelo próprio computador; `<dataDir>/kaviski/empresa.json`, `server/kaviski/empresa.ts`); `HABBLAUD_BRAND=Kaviski Corporation` é o valor inicial | Título da aba `<empresa> · Voxtrin`, notificações do navegador, tela de login e convites com o nome da empresa e "escritório virtual · Voxtrin". No topo não aparece (a linha acima do logotipo saiu). `GET/POST /api/kaviski/empresa`. |
| Visual da tela de login e do convite | sempre (`server/kaviski/login-visual.ts`, chamado pelo `kvBrandLogin`) | Wallpaper gerado por IA (Codex `image_gen`, `client/public/assets/brand/login-wallpaper.png`, liberado sem login pelo `PUBLIC_STATIC`) com zoom lento, estrelas, brilhos e partículas; card de vidro com borda animada, sombra em camadas e inclinação 3D; ícones nos campos, mostrar senha, saudação e "Escritório no ar". Só CSS e um script que enfeita a página original (formulário e envio intactos). `prefers-reduced-motion` desliga as animações. Título do card = **Voxtrin** (o nome do produto, em letras grandes com o "V" vermelho) e embaixo "<empresa> · escritório virtual"; aba "Voxtrin · entrar". O card mora num palco fixo (`.kv-stage`) que centraliza sempre: antes o `<body>` em grade virava duas linhas quando uma extensão do navegador injetava um elemento nele e o card subia para o topo. |
| Mensagens às sessões do TwiCC | `HABBLAUD_TWICC_MESSAGES=1` + `npm run codex:bridge` | Sessões que o TwiCC está rodando (Claude Code e Codex) recebem a caixa "Mandar mensagem"; o auxiliar do host entrega com `twicc send-message --no-expand -- <id> <texto>`. Ver abaixo. |
| Responder pelo escritório às sessões do TwiCC | senha do TwiCC em `~/.habblaud/twicc-senha` + `npm run codex:bridge` (`HABBLAUD_TWICC_APPROVALS=0` desliga) | Perguntas (AskUserQuestion), aprovação de ferramenta e de plano das sessões do TwiCC aparecem no cartão "pede permissão" do agente e são respondidas no Habblaud, sem abrir o TwiCC. Ver abaixo. |
| Cartões de uso compactos com logos | sempre | Os cartões de uso por conta no topo ficam numa linha só (34 px de altura): logo do Claude (estrela laranja) ou do Codex (flor da OpenAI) no lugar do quadradinho com letra, nome e dois mini anéis (5 h e semana) com % e reinício curto. O que aparece depende do espaço livre na barra (consulta de contêiner, por número de contas): tudo; sem nome/reinício/idade (letra da conta num selinho na logo); só logo + % semanal. E-mail, plano, horários exatos e origem continuam na dica. `client/src/kaviski/provider-logos.ts` e `usage-compact.css`. |
| Detalhes de UX | `HABBLAUD_HUMANOS=1` (a saudação e o resumo só para quem entrou com conta) | **Barra de ações da tecla E** (`humanos/interact.ts` + `interact-model.ts`): cada provedor devolve uma ou várias ações com `icon` (emoji), `tone` (cor da família) e `sub`; a principal grande com a tecla E, até 3 alternativas embaixo (Tab troca, clique usa), pulinho ao aparecer, "afundar" e vibração ao usar. Móveis novos em `seats.ts` (`KV_USE`: lanche, geladeira, pia, pingue-pongue, torcida; `ms` = uso com tempo) e poses sentado (`KvMeCtl.setSeatPose`: cochilar, celular, digitar). **Busca rápida** `client/src/kaviski/ux/spotlight.ts` (Ctrl/⌘+K, lupa no grupo Sistema do topo): pessoas, agentes, salas, ações "ir e fazer", status e comandos das teclas (dispara a tecla no documento); recentes em `localStorage` (`habblaud.kv.busca.recentes`). **Saudação do dia** e **Enquanto você estava fora** em `ux/brief.ts` (regras puras em `brief-model.ts`). Botões que afundam ao apertar em `ux/ux.css`. Traduções em `shared/locales/kaviski-ux.ts`. |
| Topo em grupos | com `HABBLAUD_HUMANOS=1` (liga junto com os botões das pessoas) | Os botões de painéis do topo, que vêm de vários módulos (original, `humanos/*`, `plan/*`), ficam numa ordem só, em grupos com uma divisória sutil: **Escritório** (Conversas, Pessoas, Salas, Agenda, Foco) · **Agentes e o dia** (Novo agente, Entregas, Feed, Meu dia, Timelapse, Histórico, Mundo) · **Sistema** (Avisos, Configurações, Ajuda, ⋯). O menu **Mais** (⋯) traz, por seção, ícone, nome e atalho: sempre Convidar visitantes, Modo clássico, Habblaud World, Organograma e Planta da empresa (pouco usados, sem atalho nem contador) e, quando a barra aperta, os de menor prioridade (Histórico, Salas, Timelapse, Agenda, Pessoas, Meu dia, Foco, Feed...). A barra se encaixa por passos (`KV_TOP_STEPS`): primeiro tenta dar aos cartões de uso o nível completo (≥ 1800 px) ou médio (≥ 1100 px) com passos leves — Histórico no Mais, chip da conta só com a inicial, sem os contadores de salas e subagentes, Salas no Mais, "precisam de você" só com a mão, Timelapse no Mais —; se não der, só o necessário para nada quebrar a linha. Os botões são os mesmos (o "ir e fazer" e os contadores continuam): os do Mais ficam num depósito invisível em cima do ⋯ (janela ancorada no botão abre embaixo dele). Dica de cada botão com o atalho (`{0} · atalho: {1}`). O chip da pessoa vai para o fim da barra (inicial + nome + papel, selo do status) e abre o menu da conta (status, nota, meu avatar, modo clássico e **Sair** quando entrou pela porta remota). Conexão e versão viram uma cápsula só. `client/src/kaviski/topbar-groups.ts` (+ `.css`), `topbar-model.ts` (ordem, grupos e passos; `topbar-model.test.ts`), traduções em `shared/locales/kaviski-topo.ts`. Substitui o antigo `humanos/ui/topfit.ts`. |
| Sala de Arquivos | com `HABBLAUD_HUMANOS=1` | Arquivos internos da empresa: botão no topo (grupo Escritório) e a sala temática **Sala de Arquivos** (`tema:arquivo`, balcão e arquivos de gaveta: o "ir e fazer" leva o avatar até lá). Pastas com acesso (só a equipe, todos com clientes, pessoas escolhidas), envio por arrastar e soltar (até 25 MB por arquivo, 10 GB no total, `HABBLAUD_FILES_MAX_GB`), documentos em Markdown escritos no próprio Voxtrin, versões, favoritos, etiquetas, lixeira de 30 dias, prévia (imagem, PDF, vídeo, áudio, texto) e a ligação com as reuniões (ata pronta, pauta, "Arquivos da reunião" no cartão da reunião). Detalhes em `KAVISKI-HUMANOS.md` → "Sala de Arquivos". |
| Só na rede da empresa | sempre (`HABBLAUD_SO_REDE_LOCAL=0` desliga; `HABBLAUD_REDES_PERMITIDAS="cidr,..."` troca a lista) | A porta remota (login, 4748, e o `escritorio.kaviski.com.br` pelo Caddy) só atende IP da rede local (192.168/16, 10/8, 172.16/12), da VPN Tailscale (100.64/10), IPv6 local e o próprio servidor; IP público recebe 403 antes do login e uma linha no log. Atrás do Caddy local vale o `X-Forwarded-For` (`kvClientIp`). O Caddy também recusa IP de fora (`/etc/caddy/Caddyfile`, `remote_ip private_ranges 100.64.0.0/10`). Hoje nada é publicado na internet (DNS com IP interno, sem porta no roteador); isto garante se um dia alguém abrir uma porta ou túnel por engano. `server/kaviski/rede.ts` (+ teste). |
| Terminal interativo pela porta remota | `HABBLAUD_REMOTE_PTY=1` (modo Node, fora do Docker, com `HABBLAUD_PTY=1`) | Com login, a porta remota também abre/assume/encerra sessões do Claude Code (terminal interativo), edita personagem e renomeia sala. Só para instalação atrás de VPN: quem passa no login tem um shell na máquina. Confere Origin/Sec-Fetch-Site. `server/kaviski/remote-pty.ts`. Na VM kc-dev-01 o Habblaud roda fora do Docker (serviço `habblaud` do systemd do usuário, `kc-habblaud.py subir`) justamente para isso. |

### URL da sessão no TwiCC

`<HABBLAUD_TWICC_URL>/project/<project_id>/session/<session_id>`, com `project_id` = cwd com tudo que não é letra/número
trocado por `-` (o nome da pasta em `~/.claude/projects`) e `session_id` = id da sessão (UUID). Regras
(`shared/kaviski.ts` `kvTwiccSessionUrl`):

- Claude Code: principal e subagente (o subagente leva à sessão principal, que é o `sessionId` dele).
- Codex: só o agente principal — no TwiCC a sessão do Codex tem o id do thread (o mesmo `sessionId` do Habblaud) e o
  projeto pelo cwd; o thread de um subagente do Codex não é uma sessão do TwiCC, então ali o botão não aparece.
- Sem botão: id que não é UUID (demo), cwd desconhecido ou longo demais (> 200 caracteres, o Claude Code encurta com hash).

### Rota de estilo

```bash
curl -s -X POST http://localhost:4747/api/rooms/style \
  -H 'Content-Type: application/json' \
  -d '{"rooms": {"/home/hostadmin/projetos/Clientes/14-FPF/05.FPFHub": {"color": "#3cb44b", "group": "FPF"}}}'
curl -s http://localhost:4747/api/rooms/style      # lê o mapa atual
```

- Corpo: `{"rooms": {"<caminho>": {"color": "#rgb|#rrggbb", "group": "texto"}}}`. **Substitui o mapa inteiro**
  (`{"rooms": {}}` apaga tudo). Vale também para salas que ainda não existem (chave = caminho; comparação sem diferença de
  maiúsculas e sem barra final, como os nomes de sala; as chaves voltam em minúsculas).
- Validação: cor inválida → 400; caminho vazio ou > 1024 → 400; > 500 salas → 400; grupo limpo e cortado em 40 caracteres;
  entrada sem cor nem grupo é ignorada.
- Trava: a mesma de `/api/rooms/rename` — bind local + Host `localhost`/`127.0.0.1`; pela porta remota, nunca (403).
- Persistido em `<dataDir>/room-styles.json` (no Docker, `/data/room-styles.json` no volume `habblaud-data`).

### Salas fixas (empresa completa)

```json
{"rooms": {"/home/hostadmin/projetos/Clientes/14-FPF/05.FPFHub": {"color": "#800000", "group": "FPF", "pinned": true, "name": "FPF · FPFHub"}}}
```

- `pinned`: booleano (outro tipo → 400); exige caminho absoluto. `name`: texto, limpo e cortado em 40 (como o Renomear).
  Entrada só com `pinned: false` é ignorada. As maiúsculas do caminho são guardadas (`path` no `room-styles.json`).
- Teto: 500 entradas no mapa (`KV_ROOMS_MAX`); o prédio não tem teto (uma coluna a cada 2 salas: 82 salas = 41
  colunas; a Visão geral (O) fica bem afastada, use o zoom/`?sala=`).
- Sala fixa vazia: entra no snapshot (e no timelapse, que grava o snapshot), **não** vai ao Habblaud World (o prédio
  enviado conta só salas com agentes, `server/world/uplink.ts`). Na tela: nasce apagada, não aparece na lista lateral
  nem no contador "salas" (que conta só salas com alguém), aparece no prédio e na lista de pastas do Novo agente.
- Quem manda o mapa é `python3 /home/hostadmin/base/scripts/kc-habblaud.py estilos` (só projetos não arquivados).

### Mensagens às sessões do TwiCC

As sessões do TwiCC rodam pelo SDK (sem terminal): o plugin `habblaud-mensagens` nunca fica presente nelas.
`server/kaviski/twicc-messages.ts` embrulha, em tempo de execução, `send/get/canMessage/reachable` do
`MessageRegistry` (o arquivo original não é tocado); `server/kaviski/twicc-bridge.ts` é a parte do auxiliar do host.

- `POST /api/host/twicc/poll` `{live?: [ids]}` → `{messages: [{id, session, text}], want: [ids]}` e
  `POST /api/host/twicc/ack` `{results: [{id, ok, error?}]}`. Só pela porta local (trava de `/api/host/*`).
- O auxiliar, a cada 2 s, pergunta; quando há agentes candidatos (`want`), relê no máximo a cada 20 s
  `twicc sessions --active --include-hidden` (o CLI gasta ~3 s de CPU) e manda os ids vivos.
- Só sessões que o TwiCC está **rodando** (`process.state` ≠ `dead`) recebem: uma sessão morta no TwiCC pode estar
  aberta num terminal, e o send-message a retomaria num segundo processo. Sessão viva no TwiCC tem prioridade também no
  Codex (vai pelo TwiCC, não pelo `codex queue`).
- Mesmos estados/prazos da original (queued → sent → delivered/failed; 60 s para buscar, 60 s para confirmar); a
  atividade "Mensagem pelo Habblaud" entra no agente quando confirma. Texto nunca vai a log.
- Binário: `HABBLAUD_TWICC_BIN` ou `twicc` do PATH (ou `~/.local/bin/twicc`). Depois de mudar o auxiliar:
  `systemctl --user restart habblaud-codex-bridge`.

### Responder pelo escritório às sessões do TwiCC

As sessões do TwiCC rodam pelo SDK: o hook `PermissionRequest` do plugin `habblaud-permissoes` não roda nelas, e o
pedido fica só na página do TwiCC. O CLI do TwiCC responde perguntas (`answer-questions`), mas **aprovar ferramenta ou
plano só quem entrou com a senha** (de propósito, no TwiCC). Então o auxiliar do host entra como a página do TwiCC faz.

- `server/kaviski/twicc-approvals-bridge.ts` (auxiliar): lê a senha de `HABBLAUD_TWICC_PASSWORD_FILE` ou
  `~/.habblaud/twicc-senha` (fora do git, `chmod 600`; nunca vai a log nem ao Habblaud), faz `POST /api/auth/login/` no
  TwiCC local (porta de `~/.twicc/twicc.info.json` ou `HABBLAUD_TWICC_LOCAL_URL`) e abre o WebSocket `/ws/` com o
  cookie. Os `pending_requests` vêm de `active_processes`/`process_state`; a resposta vai como
  `claude_code:pending_request_response` (o mesmo que a página do TwiCC manda). Senha recusada: espera 10 min ou o
  arquivo mudar (o TwiCC bloqueia depois de 5 tentativas em 5 min).
- `server/kaviski/twicc-approvals.ts` (servidor): `POST /api/host/twicc/requests` `{connected, requests}` →
  `{decisions: [{id, session, request_id, payload}]}` (trava de `/api/host/*`), a cada 1,5 s. Cada pedido vira um
  `PermissionRequestInfo` (id `tw-...`) do agente principal da sessão. O `PermissionRegistry` original não é tocado: o
  fork embrulha `snapshot/detail/decide` em tempo de execução; a rota `/api/permissions/:id/decision` e a trava de quem
  pode responder (`canAnswer`, papéis das pessoas) são as mesmas.
- Aprovar, recusar com motivo, "sempre permitir" (as sugestões do próprio Claude Code, mandadas como
  `updated_permissions`), responder as perguntas (por texto; múltipla escolha junta por ", ") ou "Responder no TwiCC"
  (some do escritório e continua esperando lá). Vale a primeira resposta, aqui ou no TwiCC: o pedido some quando o
  TwiCC deixa de listá-lo.
- Fica no TwiCC: formulários de MCP (elicitation), sessões **ocultas** no TwiCC (o WebSocket não fala delas) e o Codex
  rodando pelo TwiCC. A recusa não interrompe o agente (o TwiCC não tem isso).
- Página: `client/src/kaviski/twicc-perm.ts` troca os textos "terminal" por "TwiCC" no cartão.
- Depois de mudar o auxiliar: `systemctl --user restart habblaud-codex-bridge`.

## Pontos de toque nos arquivos originais

| Arquivo | Linhas | O quê | No conflito do merge |
|---|---|---|---|
| `server/http/app.ts` | +7/−2 | imports; `sendFile` com `kvFrameHeaders({...})`; campo `kaviski?` no `ApiDeps`; 1 linha antes de `/api/rooms/rename` chamando `deps.kaviski?.route(...)` (com `host:` = trava do auxiliar do host) | aceitar o original e reaplicar os ganchos |
| `server/http/static.ts` | +3/−2 | import; objeto `headers` de `send` embrulhado em `kvFrameHeaders({...})` | idem |
| `server/http/remote.ts` | +8/−6 | imports; `sendHtml` com `kvFrameHeaders`; `kvSameSite(secure)` no `cookieHeader`; `kvKeepRoomQuery` nos dois redirecionamentos (`/` e `/login`); `location.replace('/' + location.search)` no JS da tela de login; `kvBrandLogin(loginPage(...))` | idem |
| `server/index.ts` | +6 | import; `createKaviski({..., roomAlias})` + `kaviski.attach(office)` logo depois do `new Office(...)`; `kaviski.attachMessages(messages, office)` depois de `late.messages = messages`; `kaviski,` no `createApiHandler` | idem |
| `scripts/codex-bridge.ts` | +4 | imports; `if (!parsed.once) void twiccLoop(post, log)` e `void twiccApprovalsLoop(post, log)` antes do laço principal | idem |
| `server/index.ts` (aprovações do TwiCC) | +1 | `kaviski.attachApprovals(permissions, office)` depois de `late.permissions = permissions` | idem |
| `client/src/ui/permission.ts` | +2 | import; `kvTwiccCard(p, {...}, ask)` no fim do `render` (textos do TwiCC no cartão) | idem |
| `shared/locales/{en,es,fr}.ts` (aprovações do TwiCC) | +2 cada | import e `...KV_APROV_XX` (`shared/locales/kaviski-aprovacoes.ts`) | idem; juntar as linhas dos dois lados |
| `client/src/app.ts` | +4 | imports; `kvStartRoomLink(...)` e `kvStartBrand(store)` depois do `createUI` | idem |
| `client/src/ui/notify.ts` | +2/−1 | import; título da aba com `kvTitle(BASE_TITLE)` | idem |
| `client/src/ui/model.ts` | +3/−1 | import; `c.rooms = kvRoomCount(snap)`; `if (!agents.length) continue;` em `groupRooms` (sala vazia fora da lista lateral) | idem |
| `client/src/world/sim/sim.ts` | +2/−1 | import; `kvDarkIfEmpty(this.createRoom(...), snap, !!this.visit)` (sala fixa vazia nasce apagada) | idem |
| `client/src/ui/drawer.ts` | +4 | import; campo `kvTwicc`; `this.kvTwicc.el` depois do `this.termBtn`; `this.kvTwicc.update(...)` no `render` | idem |
| `client/src/ui/history.ts` | +2/−1 | import; `group.append(kvHistoryItem(this.item(s, now), s, ...))` | idem |
| `client/src/world/render/overlay.ts` | +4/−1 | import; `kvDrawSignStyle(...)` depois do `drawSignText`; `kvAccent(room.info, room.theme.accent)` e `kvDrawPillBadge(...)` na pílula | idem |
| `shared/locales/{en,es,fr}.ts` | +16 cada | bloco "fork Kaviski" logo no começo do objeto | manter os dois lados; rodar `npm run i18n:check` |
| `server/http/app.ts` (humanos) | ±7 | `allows(feature, req)` no tipo `remote` e no `trusted()`; `kvRemotePty()` → `kvRemotePtyFor(req)` (5 linhas já marcadas) | idem |
| `server/http/pty.ts` | ±2 | `kvRemotePtyFor(req)` | idem |
| `server/http/remote.ts` (humanos) | +1 | `export const kvMarkRemote` (marca a requisição como remota, para o login por pessoa) | idem |
| `server/index.ts` (humanos) | +10/−3 | imports; `createHumanos(...)` depois do `Hub`; `kvRemoteAllows(...)` no `canAnswer` e no `allows`; `kvSessions` + `kvHumanos.gate(createRemoteGate(...))`; `kvHumanos.before(...)` antes do `api(...)` nas duas portas; `kvHumanos.attachMessages(messages)` depois do `kaviski.attachMessages` | idem |
| `server/index.ts` (só na rede) | +3 | import; `const kvRede = kvRedeLocalGuard()` antes do `startRemoteListener`; `if (kvRede(req, res)) return;` antes do `guard` da porta remota | manter as três linhas |
| `client/src/app.ts` (humanos) | +2 | import; `kvStartHumanos(store)` | idem |
| `client/src/world/index.ts` (humanos) | +5/−2 | import; `const kv = kvAttachWorld({..., select, selected})` antes do `attachInput`; `kv.click(...)` no `click:` e `!kv.walking()` no `keys:`; `kv.frame(...)` logo depois do `sim.update`; `kv.doubleClick(hit)` no começo do `doubleClick:` (duplo clique no chão = o avatar corre) | idem |
| `client/src/world/render/overlay.ts` (humanos) | +4/−3 | import; `visitor = ... \|\| !!kvPersonBadge(ch)` (2 lugares: etiqueta sempre à mostra) e o selo `kvPersonBadge(ch) ?? visitorBadge()` (medida e desenho) | idem |
| `shared/locales/{en,es,fr}.ts` (humanos) | +8 cada | imports e `...KV_HUMANOS_XX`, `...KV_EXTRAS_XX` (convites, agenda, mini-mapa, foco: `kaviski-extras.ts`), `...KV_W1_XX` (avatar, mesa, móveis: `kaviski-w1.ts`), `...KV_SOCIAL_XX` (chamar, reações, status com nota, sala trancada, roda privada: `kaviski-social.ts`) no começo do objeto | idem; juntar as linhas dos dois lados |
| `package.json` / `package-lock.json` (humanos) | +1 | `livekit-client` (Apache 2.0) em `devDependencies` (voz e vídeo, carregado sob demanda) | manter os dois lados; `npm install` |
| `package.json` / `package-lock.json` (voz e vídeo, onda Gather) | +2 | `@livekit/track-processors` (Apache 2.0, fundo da câmera) e `@sapphi-red/web-noise-suppressor` (MIT, RNNoise BSD-3) em `devDependencies`, carregados sob demanda | manter os dois lados; `npm install` |
| `server/http/static.ts` (voz e vídeo) | +1 | `'.wasm': 'application/wasm'` no `MIME` (filtro de ruído e fundo da câmera) | idem |
| `shared/locales/{en,es,fr}.ts` (voz e vídeo) | +2 cada | import e `...KV_MEDIA_XX` (`shared/locales/kaviski-media.ts`) logo depois do `KV_HUMANOS_XX` | idem |
| `client/src/world/sim/sim.ts` (salas próprias) | ±4 | import de `layoutProjectRoom` trocado por `kvLayoutRoom` (rooms-layout.ts); as 3 chamadas (`createRoom`, sala fantasma e nova vaga no `moveRoom`) passam o `RoomInfo` | aceitar o original e trocar de novo `layoutProjectRoom(...)` por `kvLayoutRoom(..., info)` |
| `client/src/world/render/renderer.ts` (salas próprias) | +2 | import; `kvDrawWallExtras(this.ctx, this.art, vis, rise, now)` logo depois do laço dos itens de parede em `drawWalls` | idem |
| `shared/locales/{en,es,fr}.ts` (salas próprias) | +2 cada | import e `...KV_SALAS_XX` (`shared/locales/kaviski-salas.ts`) no fim da lista do fork | idem |
| `shared/locales/{en,es,fr}.ts` (interface, W6) | +2 cada | import e `...KV_UI_XX` (`shared/locales/kaviski-ui.ts`: kit, Pessoas, conversas, cartão, online) no fim da lista do fork | idem |
| `shared/locales/{en,es,fr}.ts` (planta livre: editor) | +2 cada | import e `...KV_EDITOR_XX` (`shared/locales/kaviski-editor.ts`: editor da empresa, planta no servidor, modelos) logo depois do `KV_UI_XX` | idem |
| `client/src/world/sim/sim.ts` (planta livre) | +4/−6 | import de `plan/hooks`; `kvPlanSlot(this, r) ?? this.freeSlot()` no `createRoom`; `kvAssembleBuilding(...)` no começo do `relayout` (`cols`, o encolher e `kvB ?? assembleBuilding(...)`); `kvCanCompact(this, r.slot)` no `compact`; `this` como 4º argumento das 3 chamadas de `kvLayoutRoom`; `overflowTile` com `r.w`/`r.h` (igual ao original em 16x12) | aceitar o original e refazer as trocas |
| `client/src/world/render/renderer.ts` (planta livre) | +8/−3 | import; `kvBaseKey(sim)` no lugar de `sim.building.cols` (troca da camada base); `kvPlanExteriorOf(...) ?? layoutExterior(cols)`; laço das cascas `kvPlanShells(...)` antes do laço dos slots (que não roda com a planta); `if (!kvFinishBase(...)) this.finishBase(...)` | idem |
| `client/src/world/index.ts` (planta livre) | +3/−3 | import; `buildingRect = () => kvBuildingRectPx(sim) ?? {...}`; `kvBaseKey(sim)` no lugar de `sim.building.cols` no `lastCols` (reenquadrar quando o prédio muda) | idem |
| `client/src/world/render/lighting.ts` (planta livre) | +2 | import; `if (kvWindowSpill(...)) return;` no começo do `paintWindowSpill` (luz das janelas no gramado em volta da planta) | idem |
| `shared/i18n.ts` (marca Voxtrin) | +2/−1 | import; `kvProduto(...)` em volta do texto escolhido no `tr()` (troca "Habblaud" por "Voxtrin", menos "Habblaud World"; desligado nos testes) | aceitar o original e reaplicar |
| `client/src/ui/notify.ts` (marca Voxtrin) | +2/−2 | import; `BASE_TITLE = KV_PRODUTO`; `kvTitle(...)` no título da notificação do navegador (empresa na frente) | idem |
| `client/src/ui/settings.ts` (grupos do fork) | +3 | import; `...kvSettingsGroups()` logo depois do grupo Aparência; `kvRenderSettingsGroups()` quando o painel abre (`client/src/kaviski/settings-groups.ts`: Empresa, Ir e fazer) | idem |
| `client/src/app.ts` (empresa) | +1 | `import './kaviski/empresa'` (registra o grupo Empresa antes de o painel ser montado) | idem |
| `client/src/ui/widgets.ts` (marca Voxtrin) | ±2 | import do `KV_WORDMARK as WORDMARK` (`client/src/kaviski/marca.ts`) no lugar do `WORDMARK` do `icons.ts`; texto de leitor de tela `KV_PRODUTO` | idem |
| `client/src/ui/version.ts` (marca Voxtrin) | +2/−1 | import; `` `${KV_PRODUTO} ` `` no nome do Sobre | idem |
| `server/spawn/spawn.ts` (marca Voxtrin) | +2/−1 | import; `kvProduto(...)` no nome da sessão aberta pelo escritório | idem |
| `client/index.html`, `client/public/manifest.webmanifest`, `client/public/assets/brand/*`, `client/public/assets/og-image.png`, `client/public/assets/manifest.json` (marca Voxtrin) | — | nome Voxtrin e imagens novas (`python3 scripts/kaviski/marca.py`, arquivos oficiais `voxtrin-*.png` em `client/public/assets/brand/` e `client/public/favicon.ico`) | manter o nosso lado; se o original mudar as imagens, rodar o `marca.py` de novo |
| `mod/*/.claude-plugin/plugin.json`, `mod/habblaud/hooks/register.ts`, `mod/habblaud-permissoes/hooks/{hooks.json,permission-hook.mjs}`, `mod/habblaud-codex/hook.mjs` (marca Voxtrin) | ±1 cada | "Voxtrin" nos textos que aparecem no Claude Code/Codex (nome do plugin, `/habblaud`, aviso "Aguardando resposta", motivo da recusa); o comando continua `/habblaud` | manter o nosso texto |
| `client/src/world/render/overlay.ts` (planta livre) | +4/−3 | import; `kvPlanAreaOfTile(...) ?? ...` no agrupamento dos balões; `colW` = largura da própria área (16 no original) dentro do laço de `drawRoomTexts`; `kvPlanSignText(vis.id)` no texto da placa e na pílula das áreas | idem |
| `client/src/ui/usage.ts` (cartões de uso compactos) | +2 | import; `kvUsageLogo(card, a)` logo depois do `updateAccountChip` no `updateCard` (logo do Claude/Codex; o CSS do fork esconde o chip e compacta o cartão) | aceitar o original e reaplicar; se o original mudar o DOM do cartão, conferir `client/src/kaviski/usage-compact.css` |
| `client/src/world/index.ts` (planta livre: salas temáticas) | +2/−1 | import; `const art: ArtModule = kvArt(artModule)` (itens `kv-*` em pixel art das salas temáticas, `plan/themes-art.ts`) | aceitar o original e reaplicar o `kvArt(...)` |
| `shared/locales/{en,es,fr}.ts` (planta livre: salas temáticas) | +2 cada | import e `...KV_TEMAS_XX` (`shared/locales/kaviski-temas.ts`: salas temáticas e "ir e fazer") | idem; juntar as linhas dos dois lados |
| `shared/locales/{en,es,fr}.ts` (planta livre, motor) | +2 cada | import e `...KV_PLANTA_XX` (`shared/locales/kaviski-planta.ts`) | idem; juntar as linhas dos dois lados |
| `shared/locales/{en,es,fr}.ts` (planta livre: organograma) | +2 cada | import e `...KV_ORG_XX` (`shared/locales/kaviski-organograma.ts`: organograma, agentes fixos, áreas, atalhos) no fim da lista do fork | idem; juntar as linhas dos dois lados |
| `shared/locales/{en,es,fr}.ts` (topo em grupos) | +2 cada | import e `...KV_TOPO_XX` (`shared/locales/kaviski-topo.ts`) logo depois do `KV_EDITOR_XX` | idem; juntar as linhas dos dois lados |
| `shared/locales/{en,es,fr}.ts` (reuniões e reservas de sala) | +6 cada | imports e `...KV_REUNIOES_SALAS_XX`, `...KV_REUNIOES_UI_XX`, `...KV_REUNIOES_XX` depois do `KV_TEMAS_XX` | idem; juntar as linhas dos dois lados |
| `docker-compose.yml` | +5 | `HABBLAUD_FRAME_ANCESTORS`, `HABBLAUD_TWICC_URL`, `HABBLAUD_TWICC_MESSAGES` e `HABBLAUD_BRAND` no `environment:` | manter os dois lados |

`server/model/office.ts` **não** foi tocado: `kaviski.attach(office)` embrulha `office.commit()` em tempo de execução e
decora cada snapshot novo. Se o original renomear `commit`, o teste `server/kaviski/kaviski.test.ts` acusa.

Arquivos só do fork: `shared/kaviski.ts` (+ teste), `server/kaviski/{index,frame,remote,room-styles,pinned,twicc-messages,twicc-bridge,twicc-approvals,twicc-approvals-bridge}.ts`
(+ `kaviski.test.ts`, `kaviski-extra.test.ts`), `client/src/kaviski/{twicc,twicc-perm,room-link,room-style,brand,empty-rooms}.ts`
(+ `kaviski.test.ts`) e `kaviski.css`, este `KAVISKI.md`.

O `CHANGELOG.md` do original **não** recebe as mudanças do fork (evita conflito a cada versão): o histórico fica aqui.

## Variáveis no `.env` (gitignored)

```
HABBLAUD_FRAME_ANCESTORS=http://192.168.1.220:3500 http://localhost:3500 http://127.0.0.1:3500
HABBLAUD_TWICC_URL=http://192.168.1.220:3500
HABBLAUD_BRAND=Kaviski Corporation
HABBLAUD_TWICC_MESSAGES=1
```

Subir sempre com `python3 /home/hostadmin/base/scripts/kc-habblaud.py subir --build` (mantém o fuso).

## Observações

- A porta remota `4748` está em **HTTPS** (há certificado em `~/.habblaud/remote-tls/server`); `http://…:4748` redireciona
  (308) para `https://…:4748`. Use a URL `https://192.168.1.220:4748/?sala=…` no painel Browser do TwiCC; o navegador
  precisa confiar na CA (`/remote/ca.crt`).
- O cookie particionado vale só dentro do TwiCC: entra-se uma vez no iframe e outra ao abrir o Habblaud direto. Safari
  bloqueia cookies em iframe de outro site mesmo assim; Chrome/Edge/Firefox funcionam.
- Se a porta remota voltar a ser HTTP puro, TwiCC `http://192.168.1.220:3500` e Habblaud `http://192.168.1.220:4748` são do
  mesmo site e o cookie Strict original já passa no iframe.

## Histórico do fork

- 2026-11-04 — frame-ancestors, "Abrir no TwiCC", `?sala=`, cores/grupos por cliente (`/api/rooms/style`).
- 2026-11-04 — salas fixas (`pinned`) e `name` no mapa de estilos, marca (`HABBLAUD_BRAND`), mensagens às sessões do
  TwiCC (`HABBLAUD_TWICC_MESSAGES`). Timelapse ("Não foi possível buscar a linha do tempo"): não reproduzido no
  Chromium e no Firefox (porta local, remota com login e dentro de iframe com a origem do TwiCC); as rotas dão 200.

## HTTP puro na porta remota (sem certificado)
- `server/http/remote.ts` (1 linha, `fork Kaviski`): com `HABBLAUD_REMOTE_INSECURE_HTTP=1` a porta remota é HTTP mesmo que exista certificado em `~/.habblaud/remote-tls` (no original, o certificado vence). Decisão do Vitor: rede local, sem instalar CA. Com TwiCC (`http://…:3500`) e Habblaud (`http://…:4748`) os dois em HTTP no mesmo IP, são same-site e o cookie `SameSite=Strict` original funciona dentro do iframe do TwiCC.
- Conflito no merge: manter `tls: hasTls && !insecure ? tls : undefined`.

## Salas escondidas e volta ao visual original (2026-11-05)
- Os andares (`HABBLAUD_FLOOR_COLS`, `floor`/`dim`) foram **revertidos** (`git revert` de 504113e e 0966a56): o Vitor preferiu o visual original. As salas fixas (`pinned`) e as cores/selos (`color`/`group`) continuam no código, mas o `kc-habblaud.py` não as manda mais — sem elas o prédio é o original.
- Campo novo `"hidden": true` no mapa de `/api/rooms/style`: a sala e **todos os agentes dela** somem do snapshot (lista, prédio, contadores). Vence os outros campos da entrada. Implementado em `server/kaviski/index.ts` (`decorate`) e `room-styles.ts`; testes em `server/kaviski/hidden.test.ts`. O `kc-habblaud.py estilos` esconde os projetos sem GitHub, os com ` *` no nome e a pasta pessoal (`~`).
- Conflito no merge: nenhum arquivo original novo foi tocado por esta mudança.
