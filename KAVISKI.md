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

## Pontos de toque nos arquivos originais

| Arquivo | Linhas | O quê | No conflito do merge |
|---|---|---|---|
| `server/http/app.ts` | +7/−2 | imports; `sendFile` com `kvFrameHeaders({...})`; campo `kaviski?` no `ApiDeps`; 1 linha antes de `/api/rooms/rename` chamando `deps.kaviski?.route(...)` | aceitar o original e reaplicar os ganchos |
| `server/http/static.ts` | +3/−2 | import; objeto `headers` de `send` embrulhado em `kvFrameHeaders({...})` | idem |
| `server/http/remote.ts` | +8/−6 | imports; `sendHtml` com `kvFrameHeaders`; `kvSameSite(secure)` no `cookieHeader`; `kvKeepRoomQuery` nos dois redirecionamentos (`/` e `/login`); `location.replace('/' + location.search)` no JS da tela de login | idem |
| `server/index.ts` | +5 | import; `createKaviski` + `kaviski.attach(office)` logo depois do `new Office(...)`; `kaviski,` no `createApiHandler` | idem |
| `client/src/app.ts` | +2 | import; `kvStartRoomLink(location.search, store, world)` depois do `createUI` | idem |
| `client/src/ui/drawer.ts` | +4 | import; campo `kvTwicc`; `this.kvTwicc.el` depois do `this.termBtn`; `this.kvTwicc.update(...)` no `render` | idem |
| `client/src/ui/history.ts` | +2/−1 | import; `group.append(kvHistoryItem(this.item(s, now), s, ...))` | idem |
| `client/src/world/render/overlay.ts` | +4/−1 | import; `kvDrawSignStyle(...)` depois do `drawSignText`; `kvAccent(room.info, room.theme.accent)` e `kvDrawPillBadge(...)` na pílula | idem |
| `shared/locales/{en,es,fr}.ts` | +15 cada | bloco "fork Kaviski" logo no começo do objeto | manter os dois lados; rodar `npm run i18n:check` |
| `docker-compose.yml` | +3 | `HABBLAUD_FRAME_ANCESTORS` e `HABBLAUD_TWICC_URL` no `environment:` | manter os dois lados |

`server/model/office.ts` **não** foi tocado: `kaviski.attach(office)` embrulha `office.commit()` em tempo de execução e
decora cada snapshot novo. Se o original renomear `commit`, o teste `server/kaviski/kaviski.test.ts` acusa.

Arquivos só do fork: `shared/kaviski.ts` (+ teste), `server/kaviski/{index,frame,remote,room-styles}.ts` (+ teste),
`client/src/kaviski/{twicc,room-link,room-style}.ts` e `kaviski.css`, este `KAVISKI.md`.

O `CHANGELOG.md` do original **não** recebe as mudanças do fork (evita conflito a cada versão): o histórico fica aqui.

## Variáveis no `.env` (gitignored)

```
HABBLAUD_FRAME_ANCESTORS=http://192.168.1.220:3500 http://localhost:3500 http://127.0.0.1:3500
HABBLAUD_TWICC_URL=http://192.168.1.220:3500
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
