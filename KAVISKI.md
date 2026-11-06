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
| Marca | `HABBLAUD_BRAND=Kaviski Corporation` | Linha pequena acima do logotipo no topo (a versão continua), título da aba `<marca> · Habblaud`, tela de login remota com o nome da empresa e "escritório virtual · Habblaud". |
| Mensagens às sessões do TwiCC | `HABBLAUD_TWICC_MESSAGES=1` + `npm run codex:bridge` | Sessões que o TwiCC está rodando (Claude Code e Codex) recebem a caixa "Mandar mensagem"; o auxiliar do host entrega com `twicc send-message --no-expand -- <id> <texto>`. Ver abaixo. |
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

## Pontos de toque nos arquivos originais

| Arquivo | Linhas | O quê | No conflito do merge |
|---|---|---|---|
| `server/http/app.ts` | +7/−2 | imports; `sendFile` com `kvFrameHeaders({...})`; campo `kaviski?` no `ApiDeps`; 1 linha antes de `/api/rooms/rename` chamando `deps.kaviski?.route(...)` (com `host:` = trava do auxiliar do host) | aceitar o original e reaplicar os ganchos |
| `server/http/static.ts` | +3/−2 | import; objeto `headers` de `send` embrulhado em `kvFrameHeaders({...})` | idem |
| `server/http/remote.ts` | +8/−6 | imports; `sendHtml` com `kvFrameHeaders`; `kvSameSite(secure)` no `cookieHeader`; `kvKeepRoomQuery` nos dois redirecionamentos (`/` e `/login`); `location.replace('/' + location.search)` no JS da tela de login; `kvBrandLogin(loginPage(...))` | idem |
| `server/index.ts` | +6 | import; `createKaviski({..., roomAlias})` + `kaviski.attach(office)` logo depois do `new Office(...)`; `kaviski.attachMessages(messages, office)` depois de `late.messages = messages`; `kaviski,` no `createApiHandler` | idem |
| `scripts/codex-bridge.ts` | +2 | import; `if (!parsed.once) void twiccLoop(post, log)` antes do laço principal | idem |
| `client/src/app.ts` | +4 | imports; `kvStartRoomLink(...)` e `kvStartBrand(store)` depois do `createUI` | idem |
| `client/src/ui/notify.ts` | +2/−1 | import; título da aba com `kvTitle(BASE_TITLE)` | idem |
| `client/src/ui/model.ts` | +3/−1 | import; `c.rooms = kvRoomCount(snap)`; `if (!agents.length) continue;` em `groupRooms` (sala vazia fora da lista lateral) | idem |
| `client/src/world/sim/sim.ts` | +2/−1 | import; `kvDarkIfEmpty(this.createRoom(...), snap, !!this.visit)` (sala fixa vazia nasce apagada) | idem |
| `client/src/ui/drawer.ts` | +4 | import; campo `kvTwicc`; `this.kvTwicc.el` depois do `this.termBtn`; `this.kvTwicc.update(...)` no `render` | idem |
| `client/src/ui/history.ts` | +2/−1 | import; `group.append(kvHistoryItem(this.item(s, now), s, ...))` | idem |
| `client/src/world/render/overlay.ts` | +4/−1 | import; `kvDrawSignStyle(...)` depois do `drawSignText`; `kvAccent(room.info, room.theme.accent)` e `kvDrawPillBadge(...)` na pílula | idem |
| `shared/locales/{en,es,fr}.ts` | +15 cada | bloco "fork Kaviski" logo no começo do objeto | manter os dois lados; rodar `npm run i18n:check` |
| `server/http/app.ts` (humanos) | ±7 | `allows(feature, req)` no tipo `remote` e no `trusted()`; `kvRemotePty()` → `kvRemotePtyFor(req)` (5 linhas já marcadas) | idem |
| `server/http/pty.ts` | ±2 | `kvRemotePtyFor(req)` | idem |
| `server/http/remote.ts` (humanos) | +1 | `export const kvMarkRemote` (marca a requisição como remota, para o login por pessoa) | idem |
| `server/index.ts` (humanos) | +10/−3 | imports; `createHumanos(...)` depois do `Hub`; `kvRemoteAllows(...)` no `canAnswer` e no `allows`; `kvSessions` + `kvHumanos.gate(createRemoteGate(...))`; `kvHumanos.before(...)` antes do `api(...)` nas duas portas; `kvHumanos.attachMessages(messages)` depois do `kaviski.attachMessages` | idem |
| `client/src/app.ts` (humanos) | +2 | import; `kvStartHumanos(store)` | idem |
| `client/src/world/index.ts` (humanos) | +4/−2 | import; `const kv = kvAttachWorld({..., select, selected})` antes do `attachInput`; `kv.click(...)` no `click:` e `!kv.walking()` no `keys:`; `kv.frame(...)` logo depois do `sim.update` | idem |
| `client/src/world/render/overlay.ts` (humanos) | +4/−3 | import; `visitor = ... \|\| !!kvPersonBadge(ch)` (2 lugares: etiqueta sempre à mostra) e o selo `kvPersonBadge(ch) ?? visitorBadge()` (medida e desenho) | idem |
| `shared/locales/{en,es,fr}.ts` (humanos) | +4 cada | imports e `...KV_HUMANOS_XX`, `...KV_EXTRAS_XX` (convites, agenda, mini-mapa, foco) no começo do objeto | idem |
| `package.json` / `package-lock.json` (humanos) | +1 | `livekit-client` (Apache 2.0) em `devDependencies` (voz e vídeo, carregado sob demanda) | manter os dois lados; `npm install` |
| `docker-compose.yml` | +5 | `HABBLAUD_FRAME_ANCESTORS`, `HABBLAUD_TWICC_URL`, `HABBLAUD_TWICC_MESSAGES` e `HABBLAUD_BRAND` no `environment:` | manter os dois lados |

`server/model/office.ts` **não** foi tocado: `kaviski.attach(office)` embrulha `office.commit()` em tempo de execução e
decora cada snapshot novo. Se o original renomear `commit`, o teste `server/kaviski/kaviski.test.ts` acusa.

Arquivos só do fork: `shared/kaviski.ts` (+ teste), `server/kaviski/{index,frame,remote,room-styles,pinned,twicc-messages,twicc-bridge}.ts`
(+ `kaviski.test.ts`, `kaviski-extra.test.ts`), `client/src/kaviski/{twicc,room-link,room-style,brand,empty-rooms}.ts`
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
