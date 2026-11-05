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

## Recursos

| Recurso | Como liga | O que faz |
|---|---|---|
| Embutir no TwiCC (iframe) | `HABBLAUD_FRAME_ANCESTORS="http://192.168.1.220:3500 http://localhost:3500 http://127.0.0.1:3500"` | Troca `X-Frame-Options` por `Content-Security-Policy: frame-ancestors 'self' <origens>` na página, na tela de login e nos anexos das entregas. Na porta remota em **HTTPS**, o cookie de login vira `SameSite=None; Partitioned` (com Strict ele nunca iria num iframe de `http://…:3500`, que é outro site). |
| Abrir no TwiCC | `HABBLAUD_TWICC_URL=http://192.168.1.220:3500` | Vai no snapshot em `meta.kaviski.twiccUrl`. Botão **Abrir no TwiCC** no painel do agente e link **TwiCC** em cada sessão do histórico. Dentro de iframe abre em `_top`, fora em `_blank`. |
| Link direto para a sala | sempre (só age com o parâmetro) | `/?sala=<caminho da pasta, urlencoded>` (ou `?room=`) seleciona e centraliza a sala; espera até 15 s se ela ainda não existe. Na porta remota o parâmetro sobrevive à tela de login. |
| Cor e grupo por cliente | `POST /api/rooms/style` (só local) | Moldura colorida na placa da sala + selo com o nome do grupo; na pílula (zoom longe) a faixa usa a cor do cliente e o selo vai acima. Vai no snapshot em `RoomInfo.kaviski`. |
| Empresa completa (salas fixas) | `"pinned": true` no mapa de `/api/rooms/style` | Toda sala fixa existe sempre, vazia (apagada) até alguém chegar, com o mesmo id/semente que o Office daria. Salas na ordem dos clientes: as do mapa primeiro, agrupadas por `group` (grupos na ordem em que aparecem no mapa), depois as outras. `server/kaviski/pinned.ts`. |
| Nome da sala pelo mapa | `"name"` no mapa | Usado quando não há apelido manual (Renomear vence). |
| Marca | `HABBLAUD_BRAND=Kaviski Corporation` | Linha pequena acima do logotipo no topo (a versão continua), título da aba `<marca> · Habblaud`, tela de login remota com o nome da empresa e "escritório virtual · Habblaud". |
| Prédio em andares | `HABBLAUD_FLOOR_COLS=5` (+ `"floor"` no mapa de estilos) | O prédio cresce para baixo em andares em vez de uma faixa infinita. Ver "Andares" abaixo. |
| Sala de projeto parado | `"dim": true` no mapa de estilos | Enquanto vazia e apagada, véu cinza listrado com "arquivo"; continua clicável e acende normal quando alguém chega. |
| Mensagens às sessões do TwiCC | `HABBLAUD_TWICC_MESSAGES=1` + `npm run codex:bridge` | Sessões que o TwiCC está rodando (Claude Code e Codex) recebem a caixa "Mandar mensagem"; o auxiliar do host entrega com `twicc send-message --no-expand -- <id> <texto>`. Ver abaixo. |

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
- Teto: 500 entradas no mapa (`KV_ROOMS_MAX`). Sem andares o prédio é uma faixa (uma coluna a cada 2 salas); com
  `HABBLAUD_FLOOR_COLS` ele cresce em andares (abaixo).
- Sala fixa vazia: entra no snapshot (e no timelapse, que grava o snapshot), **não** vai ao Habblaud World (o prédio
  enviado conta só salas com agentes, `server/world/uplink.ts`). Na tela: nasce apagada, não aparece na lista lateral
  nem no contador "salas" (que conta só salas com alguém), aparece no prédio e na lista de pastas do Novo agente.
- Quem manda o mapa é `python3 /home/hostadmin/base/scripts/kc-habblaud.py estilos` (só projetos não arquivados).

### Andares (`HABBLAUD_FLOOR_COLS`, `floor`, `dim`)

```json
{"rooms": {"/home/hostadmin/projetos/Interno/Sites/01.Site": {"pinned": true, "group": "Interno-Sites", "floor": "Kaviski · Interno"},
           "/home/hostadmin/projetos/Clientes/14-FPF/02.Antigo": {"pinned": true, "group": "FPF", "floor": "Arquivo", "dim": true}}}
```

UM prédio de vários andares, visto em corte (`client/src/kaviski/floors*.ts`):

- `HABBLAUD_FLOOR_COLS` (inteiro 1..40; vazio/0 = original) vai no snapshot em `meta.kaviski.floorCols`. Valor: **5**.
  - **Térreo** (embaixo, junto da rua ao sul, com a entrada a oeste): o núcleo original (recepção, banheiros, copa,
    lounge) + 5 colunas de projeto = **10 salas**.
  - **Andares de cima**: só a coluna 0 é circulação, exatamente sobre a recepção — ao norte o hall dos elevadores (os
    elevadores no mesmo x dos da recepção, placa com "Nº andar", ponto de café e mesinha), ao sul a escada (pintada) e
    um cantinho de espera — + 6 colunas de projeto = **12 salas**.
  - Andares separados só por uma laje de concreto; fachadas laterais contínuas; telhado com platibanda, casa de
    máquinas, caixa d'água, condensadoras e antena (`kvPaintBase`, na camada base). Célula vaga num andar de cima =
    espaço livre (laje de concreto, iluminado como interior); no térreo continua o jardim do original.
  - Com o mapa atual (Interno 8 · Em andamento 10 · Em pausa 5 · Arquivo 6): 4 andares, 7 colunas (112 × ~120 tiles
    + telhado), quase quadrado.
- `floor` (texto, até 40): um andar por rótulo, na ordem do mapa; o 1º no térreo; o que não cabe continua no andar de
  cima com "(cont.)". Sala sem `floor` (fora do mapa) vai para **"Outros"**, no topo. Sem nenhum `floor`, andares só
  sequenciais. O servidor ordena as salas por andar e, dentro dele, por grupo. O mesmo plano (`kvFloorPlan`, puro) é
  usado pela simulação e pela lista lateral.
- `dim` (booleano): projeto parado — véu cinza listrado com "arquivo" enquanto vazia e apagada.
- **Diretório do prédio** (lado esquerdo, junto da coluna dos elevadores, em espaço de tela): por andar, número grande
  ("T", "1", "2"...), nome e resumo vivo ("4 trabalhando · 1 precisa de você"; borda e número em âmbar quando alguém
  precisa de você). Clicar na placa enquadra o andar.
- **Lista lateral "Escritório"**: salas na ordem do prédio, com o cabeçalho do andar (número, nome, resumo) antes da
  primeira sala de cada andar; andar sem ninguém aparece recolhido (uma linha). Clicar no cabeçalho enquadra o andar
  (evento `kv:andar` em `window`).
- Geometria (`floors.ts`): o andar f começa em y = (F − 1 − f) × 30 tiles (29 do andar + 1 de laje); F é **global** na
  página e só cresce. Quando cresce (rótulo novo, "Outros", ou o timelapse/visita precisando de mais), tudo desce 30
  tiles: cada simulação refaz as salas no lugar novo, remonta o prédio, desloca os personagens e conclui os planos
  (`kvSyncGeometry`, como ao voltar de uma aba oculta). Na carga, os andares já vêm todos do 1º snapshot.
- Movimento: o A* não atravessa andares. Um `go` para outro andar vira: ir ao elevador do andar → passo `kvLift`
  (entra, porta fecha, ~0,65 s + 0,26 s por andar, sai no elevador do outro andar, com as animações originais) → o `go`
  original. Quem chega aparece no elevador do andar da própria sala; quem vai embora usa o do andar onde está. Café e
  água: o mais perto (o hall de cada andar tem); banheiro, lounge, TV, espelho e a mesa da copa ficam no térreo (vão de
  elevador). A compactação do original fica desligada com andares (buracos de propósito).
- Não muda: o que vai ao Habblaud World (server/world conta as salas com agentes), `?mock=1` (sem meta, original),
  timelapse (mesma simulação), visita a outro prédio (salas sem rótulo: andares sequenciais; se precisar de mais
  andares, o prédio da página cresce junto).

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
| `client/src/world/layout/geometry.ts` | +11/−7 | import; 1 linha de andar em `slotColumn`, `slotSide`, `cellRect` (+`floor`), `slotRect`, `slotAt` (+`floor`), `columnsFor`, `buildingRect` (+`floors`) | aceitar o original e reaplicar (sem andares tudo dá o original) |
| `client/src/world/layout/building.ts` | +10/−6 | imports; `kvFloors?` no `BuildingLayout`; `floors` em `buildWalkGrid`/`assembleBuilding`; `kvBuildingCore(...) ?? coreAreas()` e `kvGroundCorridor(...) ?? layoutCorridor(...)` | idem |
| `client/src/world/layout/exterior.ts` | +3 | import; 2 primeiras linhas de `slotShell` (`kvSlotShell`: o desenho do original, deslocado; espaço livre nos andares de cima) | idem |
| `client/src/world/sim/sim.ts` | +13/−3 (mais o de cima) | import; `kvPlanFloors` no início do `applySnapshot`; `kvRoomSlot(...) ?? this.freeSlot()` no `createRoom`; pool de `pickElevator`; `kvFloorCount(this)` no `assembleBuilding` do `relayout`; `kvSyncElevators` depois do `setSpots`; `kvNoCompact` em `compact`; `kvSyncGeometry` no início de `update`; `case 'kvLift'` no `runStep`; `kvFloorHop` no início de `stepGo`; `kvKeepSameFloor` em `randomFree` | idem |
| `client/src/world/sim/steps.ts` | +3/−1 | `KvLiftStep` no tipo `Step` | idem |
| `client/src/world/render/renderer.ts` | +17/−6 | imports; `kvLayoutExterior(...) ?? layoutExterior(...)` (2×); `kvBaseStale` no `sync`; `kvElevatorVis(...) ??` nos elevadores; jardins dos outros andares depois do laço de `buildBase`; `kvPaintBase` depois do `desaturate`; altura com andares na vinheta; `kvGroundY()` no capacho da entrada | idem |
| `client/src/world/render/lighting.ts` | +15/−10 | import; `kvVacantCell`/`kvIsTopRow` nos fechamentos e no sol das janelas; `kvSpillsSouth` no brilho para a rua; um halo de fachada por corredor; `kvBuildingKey` na chave do mapa de luz | idem |
| `client/src/world/render/overlay.ts` | +4/−2 (mais o de cima) | imports; `kvDrawDimRooms` antes da seleção; `kvDrawDirectory` antes de `drawRoomTexts`; `kvBubbleArea` na chave dos balões; `kvHallText` na placa | idem |
| `client/src/world/index.ts` | +6/−3 | imports; `kvBuildingPx(...) ??` em `buildingRect`; `kvBuildingKey` no lugar de `cols` para refazer o enquadramento; `kvStartFloorDirectory` depois do `attachInput` | idem |
| `client/src/ui/sidebar.ts` | +3/−1 | import; `kvSortByFloor(...)` em volta do `orderRooms`; `kvFloorHeads(...)` depois do `this.rooms.sync` | idem |
| `docker-compose.yml` | +6 | `HABBLAUD_FRAME_ANCESTORS`, `HABBLAUD_TWICC_URL`, `HABBLAUD_TWICC_MESSAGES` e `HABBLAUD_BRAND` no `environment:` (e `HABBLAUD_FLOOR_COLS`) | manter os dois lados |

`server/model/office.ts` **não** foi tocado: `kaviski.attach(office)` embrulha `office.commit()` em tempo de execução e
decora cada snapshot novo. Se o original renomear `commit`, o teste `server/kaviski/kaviski.test.ts` acusa.

Arquivos só do fork: `shared/kaviski.ts` (+ teste), `server/kaviski/{index,frame,remote,room-styles,pinned,twicc-messages,twicc-bridge}.ts`
(+ `kaviski.test.ts`, `kaviski-extra.test.ts`, `floors.test.ts`), `client/src/kaviski/{twicc,room-link,room-style,brand,empty-rooms,floors,floors-world,floors-sim,floors-draw,floors-list}.ts`
(+ `kaviski.test.ts`, `floors.test.ts`) e `kaviski.css`, este `KAVISKI.md`.

Se o original mexer na geometria (`geometry.ts`, `constants.ts`, `core.ts`, `exterior.ts`) ou no elevador
(`stepElevIn`/`stepElevOut`, que o `kvLift` chama), rode `npx vitest run client/src/kaviski/floors.test.ts`: ele monta
um prédio de 3 andares (núcleo só no térreo, elevadores alinhados), confere que não há ligação a pé entre andares,
leva um agente de um andar a outro e de volta (sem atravessar parede) e embora pelo elevador do próprio andar, e faz o
prédio crescer com gente dentro.

O `CHANGELOG.md` do original **não** recebe as mudanças do fork (evita conflito a cada versão): o histórico fica aqui.

## Variáveis no `.env` (gitignored)

```
HABBLAUD_FRAME_ANCESTORS=http://192.168.1.220:3500 http://localhost:3500 http://127.0.0.1:3500
HABBLAUD_TWICC_URL=http://192.168.1.220:3500
HABBLAUD_BRAND=Kaviski Corporation
HABBLAUD_TWICC_MESSAGES=1
HABBLAUD_FLOOR_COLS=5
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

- 2026-11-05 — prédio em andares (`HABBLAUD_FLOOR_COLS`), `floor` e `dim` no mapa de estilos, viagem de elevador entre
  andares. Refeito no mesmo dia (feedback "parecem novas empresas"): um prédio só em corte, térreo embaixo com a rua,
  núcleo só no térreo e coluna de circulação alinhada nos andares, lajes e telhado, diretório clicável à esquerda e
  lista lateral agrupada por andar.

## HTTP puro na porta remota (sem certificado)
- `server/http/remote.ts` (1 linha, `fork Kaviski`): com `HABBLAUD_REMOTE_INSECURE_HTTP=1` a porta remota é HTTP mesmo que exista certificado em `~/.habblaud/remote-tls` (no original, o certificado vence). Decisão do Vitor: rede local, sem instalar CA. Com TwiCC (`http://…:3500`) e Habblaud (`http://…:4748`) os dois em HTTP no mesmo IP, são same-site e o cookie `SameSite=Strict` original funciona dentro do iframe do TwiCC.
- Conflito no merge: manter `tls: hasTls && !insecure ? tls : undefined`.
