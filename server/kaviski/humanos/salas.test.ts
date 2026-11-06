// Fork Kaviski (KAVISKI-HUMANOS.md): salas próprias (rooms.ts), objetos de parede (objects.ts) e as checagens de área
// com elas (livekit.ts kvAreaAllowed, presence.ts). Tudo no servidor: o cliente nunca recebe o que não pode ver.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../../log';
import { tempDir } from '../../test/fixtures';
import type { AgentInfo, OfficeSnapshot } from '../../../shared/types';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { kvCanSeeOwnRoom, kvParseDecor, kvSafeUrl } from '../../../shared/kaviski-rooms';
import { project } from '../../../shared/world/projection';
import { kvAreaAllowed } from './livekit';
import { KvPresence } from './presence';
import { KvObjects } from './objects';
import { KvRooms, kvOwnRoomArea, kvRoomIdsFor, kvRoomsRoute, kvUseRooms, ROOMS_PATH } from './rooms';
import { createHumanos } from '.';
import { closeAll, json, login, start } from './test-harness';

setQuiet(true);

const P = (id: string, role: KvPerson['role'], rooms: string[] = []): KvPerson => ({ id, user: id, name: id.toUpperCase(), role, rooms });
const admin = P('adm', 'admin');
const ana = P('ana', 'equipe');
const leo = P('leo', 'equipe');
const bia = P('bia', 'cliente', ['/proj/Clientes/14-FPF']);
const caio = P('caio', 'cliente', ['/proj/Clientes/12-Rarm']);
const everyone = [admin, ana, leo, bia, caio];
const known = (id: string) => everyone.find((p) => p.id === id)?.name;

const FPF = '/proj/Clientes/14-FPF/05.Hub';
const RARM = '/proj/Clientes/12-Rarm/01.App';
function agent(id: string, roomId: string): AgentInfo {
  return { id, kind: 'main', provider: 'claude', roomId, name: id, look: 'm', role: 'dev', sessionId: id, account: 'A', status: 'working', recent: [], tasks: [], startedAt: 0, lastEventAt: 0, statusSince: 0, stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: 1 } as AgentInfo;
}
const SNAP = {
  rooms: [
    { id: FPF, name: '05.Hub', path: FPF, slot: 0, seed: 1, createdAt: 0 },
    { id: RARM, name: '01.App', path: RARM, slot: 1, seed: 2, createdAt: 0 },
  ],
  agents: [agent('a1', FPF), agent('a2', RARM)],
  accounts: [],
  meta: {},
} as unknown as OfficeSnapshot;

let rooms: KvRooms;
let dir: string;
let cleanup: () => void = () => {};
beforeEach(() => {
  ({ dir, cleanup } = tempDir('kv-salas-'));
  rooms = new KvRooms(join(dir, 'rooms.json'), () => 1000);
  kvUseRooms(rooms);
});
afterEach(() => {
  kvUseRooms(null);
  cleanup();
});

function create(who: KvPerson, body: Record<string, unknown>) {
  const r = rooms.create(who, body, known);
  if (!r.ok) throw new Error(r.error);
  return r.room;
}

describe('salas próprias: quem cria, edita e vê', () => {
  it('equipe cria a própria sala pessoal (uma só) e salas de reunião; não cria descanso; cliente não cria nada', () => {
    const mine = create(ana, { kind: 'pessoal' });
    expect(mine.owner).toBe('ana');
    expect(mine.name).toBe('Sala de ANA');
    expect(mine.id).toMatch(/^kvsala-[A-Za-z0-9_-]{10}$/);
    expect(rooms.create(ana, { kind: 'pessoal' }, known)).toMatchObject({ ok: false, status: 409 });
    expect(create(ana, { kind: 'reuniao', name: 'Reunião 1' }).kind).toBe('reuniao');
    expect(rooms.create(ana, { kind: 'descanso' }, known)).toMatchObject({ ok: false, status: 403 });
    expect(rooms.create(ana, { kind: 'pessoal', owner: 'leo' }, known)).toMatchObject({ ok: false, status: 409 }); // dono ignorado: é a dela
    expect(rooms.create(bia, { kind: 'reuniao' }, known)).toMatchObject({ ok: false, status: 403 });
    expect(rooms.create(bia, { kind: 'pessoal' }, known)).toMatchObject({ ok: false, status: 403 });
    expect(rooms.create(ana, { kind: 'cozinha' }, known)).toMatchObject({ ok: false, status: 400 });
  });

  it('admin cria qualquer tipo, para qualquer dono; dono desconhecido é recusado', () => {
    expect(create(admin, { kind: 'descanso' }).kind).toBe('descanso');
    expect(create(admin, { kind: 'pessoal', owner: 'leo' }).owner).toBe('leo');
    expect(rooms.create(admin, { kind: 'pessoal', owner: 'ninguem' }, known)).toMatchObject({ ok: false, status: 400 });
  });

  it('só o dono (da equipe) ou um admin edita/apaga', () => {
    const r = create(ana, { kind: 'reuniao' });
    expect(rooms.update(leo, r.id, { name: 'x' }, known)).toMatchObject({ ok: false, status: 403 });
    expect(rooms.remove(leo, r.id)).toMatchObject({ ok: false, status: 403 });
    expect(rooms.update(bia, r.id, { name: 'x' }, known)).toMatchObject({ ok: false, status: 404 }); // nem vê
    expect(rooms.update(ana, r.id, { name: 'Sala Azul', style: 3, color: '#ff0000' }, known)).toMatchObject({ ok: true });
    expect(rooms.get(r.id)).toMatchObject({ name: 'Sala Azul', style: 3, color: '#ff0000' });
    expect(rooms.update(ana, r.id, { style: 99 }, known)).toMatchObject({ ok: false, status: 400 });
    expect(rooms.update(ana, r.id, { color: 'vermelho' }, known)).toMatchObject({ ok: false, status: 400 });
    expect(rooms.update(ana, r.id, { people: ['ninguem'] }, known)).toMatchObject({ ok: false, status: 400 });
    expect(rooms.remove(admin, r.id)).toMatchObject({ ok: true });
    expect(rooms.get(r.id)).toBeUndefined();
  });

  it('quem vê: equipe toda (+ clientes marcados) ou só os escolhidos; admin e dono sempre', () => {
    const geral = create(ana, { kind: 'reuniao', people: ['bia'] });
    const secreta = create(admin, { kind: 'outra', access: 'escolhidos', people: ['leo'] });
    expect(rooms.visibleTo(leo).map((r) => r.id).sort()).toEqual([geral.id, secreta.id].sort());
    expect(rooms.visibleTo(ana).map((r) => r.id)).toEqual([geral.id]);
    expect(rooms.visibleTo(bia).map((r) => r.id)).toEqual([geral.id]);
    expect(rooms.visibleTo(caio)).toEqual([]);
    expect(rooms.visibleTo(admin)).toHaveLength(2);
    // visitante (W5) é tratado como cliente: só se estiver na lista
    expect(kvCanSeeOwnRoom(geral, { id: 'vis', role: 'visitante' as KvPerson['role'] })).toBe(false);
  });

  it('grava em rooms.json (600) e relê', () => {
    const r = create(ana, { kind: 'pessoal', decor: [{ kind: 'planta', x: 3, y: 4, variant: 'flower' }] });
    const file = join(dir, 'rooms.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = new KvRooms(file);
    again.load();
    expect(again.get(r.id)).toMatchObject({ kind: 'pessoal', owner: 'ana', decor: [{ kind: 'planta', x: 3, y: 4, variant: 'flower' }] });
  });

  it('decoração: itens desconhecidos ou fora da sala caem fora; parede só com x; tapete precisa de cor', () => {
    expect(
      kvParseDecor([
        { kind: 'planta', x: 3, y: 4, variant: 'cacto' },
        { kind: 'foguete', x: 3, y: 4 },
        { kind: 'luminaria', x: 30, y: 4 },
        { kind: 'quadro', x: 5, y: 9 },
        { kind: 'tapete', x: 2, y: 3, w: 3, h: 2 },
        { kind: 'tapete', x: 2, y: 3, w: 3, h: 2, color: '#123456' },
      ]),
    ).toEqual([
      { kind: 'planta', x: 3, y: 4, variant: 'fern' },
      { kind: 'quadro', x: 5, y: 0 },
      { kind: 'tapete', x: 2, y: 3, w: 3, h: 2, color: '#123456' },
    ]);
    expect(kvParseDecor('x')).toBeUndefined();
    expect(kvParseDecor(Array.from({ length: 40 }, () => ({ kind: 'planta', x: 2, y: 2 })))).toHaveLength(16);
  });
});

describe('checagem de área com as salas próprias', () => {
  it('kvAreaAllowed: sala própria vale para quem a vê; as de projeto seguem as regras do cliente', () => {
    const r = create(ana, { kind: 'reuniao', name: 'Reunião 1', people: ['bia'] });
    const sec = create(admin, { kind: 'outra', name: 'Diretoria', access: 'escolhidos' });
    expect(kvAreaAllowed(`r:${r.id}`, leo, SNAP)).toBe('Reunião 1');
    expect(kvAreaAllowed(`r:${r.id}`, bia, SNAP)).toBe('Reunião 1');
    expect(kvAreaAllowed(`r:${r.id}`, caio, SNAP)).toBeUndefined();
    expect(kvAreaAllowed(`r:${sec.id}`, ana, SNAP)).toBeUndefined();
    expect(kvAreaAllowed(`r:${sec.id}`, admin, SNAP)).toBe('Diretoria');
    expect(kvAreaAllowed('r:kvsala-naoexiste1', admin, SNAP)).toBeUndefined();
    // salas de projeto continuam como antes
    expect(kvAreaAllowed(`r:${FPF}`, bia, SNAP)).toBe('05.Hub');
    expect(kvAreaAllowed(`r:${RARM}`, bia, SNAP)).toBeUndefined();
    expect(kvOwnRoomArea(FPF, bia)).toBeNull();
    expect([...kvRoomIdsFor(SNAP, bia)].sort()).toEqual([FPF, r.id].sort());
  });

  it('presença: cliente não diz que está numa sala própria que não vê; a posição dentro dela não vaza para quem não vê', () => {
    const r = create(ana, { kind: 'reuniao', people: ['bia'] });
    const sec = create(admin, { kind: 'outra', access: 'escolhidos', people: ['leo'] });
    const presence = new KvPresence({ snapshot: () => SNAP, look: () => undefined });
    const entries = (presence as unknown as { entries: Map<string, unknown> }).entries;
    for (const p of [bia, caio, leo, ana]) entries.set(p.id, { person: p, status: 'disponivel', since: 0, conns: 1, window: 0, posts: 0 });
    const pos = (room: string) => ({ k: 'r', r: room, x: 40, y: 60, s: 'n', d: 'down', m: 0 });
    expect(presence.update(caio, { pos: pos(r.id), area: `r:${r.id}` })).toBe('room');
    expect(presence.update(bia, { pos: pos(r.id), area: `r:${r.id}` })).toBeNull();
    expect(presence.areaOf('bia')).toBe(`r:${r.id}`);
    expect(presence.update(leo, { pos: pos(sec.id), area: `r:${sec.id}` })).toBeNull();
    // ana (equipe) não vê a sala secreta: o Leo aparece, mas sem posição
    const seenByAna = presence.visibleTo(ana, SNAP);
    expect(seenByAna.find((p) => p.id === 'leo')?.pos).toBeUndefined();
    expect(seenByAna.find((p) => p.id === 'bia')?.pos?.r).toBe(r.id);
    // caio (cliente da Rarm) não divide sala com a Bia: nem a vê
    expect(presence.visibleTo(caio, SNAP).some((p) => p.id === 'bia')).toBe(false);
    presence.stop();
  });

  it('Habblaud World: as salas próprias nunca entram no snapshot nem no pacote do prédio', () => {
    const dir2 = join(dir, 'world');
    const snap = structuredClone(SNAP);
    const before = JSON.stringify(snap);
    const h = createHumanos({ dataDir: dir2, snapshot: () => snap, env: { HABBLAUD_HUMANOS: '1' } });
    h.rooms.create(admin, { kind: 'reuniao', name: 'Reunião' }, known);
    h.rooms.create(admin, { kind: 'descanso' }, known);
    expect(h.rooms.size).toBe(2);
    expect(JSON.stringify(snap)).toBe(before);
    // o uplink (server/world/uplink.ts) monta as salas a partir dos agentes reais do snapshot
    const roomsUp = [...new Set(snap.agents.map((a) => a.roomId))].map((id) => ({ id }));
    const uplink = project({ rooms: roomsUp, agents: snap.agents, theme: 'none', version: 't', options: { compactions: false, tokensVisible: false } }, { floorId: (id: string) => `f_${id.length.toString(16).padStart(10, '0')}`, agentId: (id: string) => `a_${id.length.toString(16).padStart(8, '0')}` }, 0);
    expect(JSON.stringify(uplink)).not.toContain('kvsala-');
    expect(JSON.stringify(uplink)).not.toContain('Reunião');
    h.presence.stop();
    h.objects.flush();
  });
});

describe('objetos de parede', () => {
  let objects: KvObjects;
  let r: ReturnType<typeof create>;
  beforeEach(() => {
    r = create(ana, { kind: 'reuniao', people: ['bia'] });
    objects = new KvObjects(
      {
        canAccess: (area, person) => !!kvAreaAllowed(area, person, SNAP),
        canModerate: (area, person) => rooms.get(area.slice(2))?.owner === person.id,
        now: (() => {
          let t = 10_000;
          return () => (t += 5_000);
        })(),
      },
      dir,
    );
  });

  it('mural: sala = quem entra nela; recepção = só a equipe escreve; apaga autor, admin ou dono da sala', () => {
    const area = `r:${r.id}`;
    const n = objects.addNote(bia, { area, text: '  oi\u0007 pessoal  ' });
    expect(n).toMatchObject({ ok: true, value: { text: 'oi  pessoal', by: { id: 'bia' } } });
    expect(objects.addNote(caio, { area, text: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(objects.addNote(bia, { area: 'a:core:recepcao', text: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(objects.addNote(leo, { area: 'a:core:recepcao', text: 'Reunião sexta' })).toMatchObject({ ok: true });
    expect(objects.addNote(leo, { area: 'c', text: 'corredor' })).toMatchObject({ ok: false, status: 403 });
    expect(objects.addNote(leo, { area, text: '' })).toMatchObject({ ok: false, status: 400 });
    // quem vê o quê
    expect(objects.listFor(caio).notes.map((x) => x.area)).toEqual(['a:core:recepcao']);
    expect(objects.listFor(bia).notes).toHaveLength(2);
    const id = (n as { value: { id: string } }).value.id;
    expect(objects.removeNote(leo, id)).toMatchObject({ ok: false, status: 403 });
    expect(objects.removeNote(ana, id)).toMatchObject({ ok: true }); // dona da sala
    expect(existsSync(join(dir, 'objects.json'))).toBe(true);
    expect(statSync(join(dir, 'objects.json')).mode & 0o777).toBe(0o600);
  });

  it('links: só http/https sem usuário/senha; cliente não prende; quem não vê a área nem recebe', () => {
    const area = `r:${r.id}`;
    expect(kvSafeUrl('javascript:alert(1)')).toBeUndefined();
    expect(kvSafeUrl('https://user:pw@x.com')).toBeUndefined();
    expect(kvSafeUrl('data:text/html,oi')).toBeUndefined();
    expect(kvSafeUrl('https://exemplo.com/a b')).toBeUndefined();
    expect(kvSafeUrl(' https://exemplo.com/planilha ')).toBe('https://exemplo.com/planilha');
    expect(objects.addLink(leo, { area, x: 3, title: 'X', url: 'javascript:alert(1)' })).toMatchObject({ ok: false, status: 400 });
    expect(objects.addLink(leo, { area, x: 99, title: 'X', url: 'https://a.b' })).toMatchObject({ ok: false, status: 400 });
    expect(objects.addLink(leo, { area, x: 3, title: '', url: 'https://a.b' })).toMatchObject({ ok: false, status: 400 });
    expect(objects.addLink(bia, { area, x: 3, title: 'X', url: 'https://a.b' })).toMatchObject({ ok: false, status: 403 });
    const l = objects.addLink(leo, { area, x: 3.3, title: 'Planilha', url: 'https://a.b/p' });
    expect(l).toMatchObject({ ok: true, value: { x: 3.25, url: 'https://a.b/p' } });
    expect(objects.listFor(bia).links).toHaveLength(1);
    expect(objects.listFor(caio).links).toHaveLength(0);
    expect(objects.removeLink(bia, (l as { value: { id: string } }).value.id)).toMatchObject({ ok: false, status: 403 });
    expect(objects.removeLink(admin, (l as { value: { id: string } }).value.id)).toMatchObject({ ok: true });
  });

  it('quadro: traço em pedaços, texto, desfazer o meu, limpar só a equipe; sem acesso = 403', () => {
    const area = `r:${r.id}`;
    const op = (who: KvPerson, extra: Record<string, unknown>) => objects.boardPost(who, { area, kind: 'op', ...extra });
    expect(op(bia, { op: { id: 'traco001', tool: 'pen', color: '#e2604f', size: 4, pts: [10, 10, 20, 20] } })).toMatchObject({ ok: true, value: { kind: 'op', op: { id: 'bia:traco001', by: 'bia' } } });
    expect(op(bia, { append: true, op: { id: 'traco001', pts: [30, 30, 99999, -5] } })).toMatchObject({ ok: true, value: { append: true, op: { pts: [30, 30, 1600, 0] } } });
    expect(op(leo, { append: true, op: { id: 'traco001', pts: [1, 1] } })).toMatchObject({ ok: false, status: 409 }); // traço de outra pessoa
    expect(op(bia, { op: { id: 'traco001', tool: 'pen', color: '#e2604f', size: 4, pts: [1, 1] } })).toMatchObject({ ok: false, status: 409 });
    expect(op(bia, { op: { id: 'traco002', tool: 'pen', color: '#bada55', size: 4, pts: [1, 1] } })).toMatchObject({ ok: false, status: 400 });
    expect(op(bia, { op: { id: 'traco003', tool: 'pen', color: '#1d2433', size: 4, pts: [1, 1, 2] } })).toMatchObject({ ok: false, status: 400 });
    expect(op(leo, { op: { id: 'texto001', tool: 'text', color: '#3f7fd8', size: 40, pts: [100, 100], text: 'Pauta' } })).toMatchObject({ ok: true });
    expect(op(leo, { op: { id: 'apaga001', tool: 'eraser', color: '#1d2433', size: 30, pts: [5, 5, 6, 6] } })).toMatchObject({ ok: true, value: { op: { color: '#ffffff' } } });
    expect(op(caio, { op: { id: 'traco009', tool: 'pen', color: '#1d2433', size: 4, pts: [1, 1] } })).toMatchObject({ ok: false, status: 403 });
    expect(objects.board(caio, area)).toMatchObject({ ok: false, status: 403 });
    expect(objects.board(bia, 'a:core:recepcao')).toMatchObject({ ok: false, status: 403 }); // quadro só em sala
    const b = objects.board(bia, area);
    expect(b.ok && b.value.ops.map((o) => o.id)).toEqual(['bia:traco001', 'leo:texto001', 'leo:apaga001']);
    expect(b.ok && b.value.ops[0]!.pts).toEqual([10, 10, 20, 20, 30, 30, 1600, 0]);
    expect(objects.boardPost(bia, { area, kind: 'undo' })).toMatchObject({ ok: true, value: { kind: 'remove', id: 'bia:traco001' } });
    expect(objects.boardPost(bia, { area, kind: 'undo' })).toMatchObject({ ok: false, status: 404 });
    expect(objects.boardPost(bia, { area, kind: 'clear' })).toMatchObject({ ok: false, status: 403 });
    expect(objects.boardPost(leo, { area, kind: 'clear' })).toMatchObject({ ok: true, value: { kind: 'clear' } });
    expect(objects.listFor(bia).boards).toEqual({});
    objects.boardPost(leo, { area, kind: 'op', op: { id: 'traco010', tool: 'pen', color: '#1d2433', size: 4, pts: [1, 1] } });
    objects.flush();
    expect(JSON.parse(readFileSync(join(dir, 'boards.json'), 'utf8'))[area].ops).toHaveLength(1);
    // sala apagada: some tudo dela
    objects.addNote(leo, { area, text: 'x' });
    objects.dropArea(area);
    objects.flush();
    expect(objects.listFor(admin).notes.filter((n) => n.area === area)).toEqual([]);
    expect(objects.board(admin, area)).toMatchObject({ ok: true, value: { ops: [] } });
  });
});

describe('rota /api/kaviski/humanos/rooms', () => {
  let server: http.Server | null = null;
  afterEach(() => server?.close());

  it('lista filtrada por quem pede; cliente sem a lista de pessoas; avisa as páginas quando muda', async () => {
    let who: KvPerson | undefined = admin;
    let changed = 0;
    server = http.createServer((req, res) => kvRoomsRoute(req, res, new URL(req.url!, 'http://x').pathname, { rooms, whoIs: () => who, people: () => everyone, changed: () => changed++ }));
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${ROOMS_PATH}`;
    const call = (method: string, url: string, body?: unknown) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
    const created = await call('POST', base, { kind: 'outra', name: 'Diretoria', access: 'escolhidos', people: ['leo'] });
    expect(created.status).toBe(201);
    expect(changed).toBe(1);
    const id = (created.body.room as { id: string }).id;
    who = ana;
    let r = await call('GET', base);
    expect(r.body.rooms).toEqual([]);
    expect(r.body.canCreate).toEqual(['pessoal', 'reuniao']);
    expect(r.body.people).toHaveLength(5);
    expect((await call('POST', `${base}/${id}`, { name: 'x' })).status).toBe(404);
    who = leo;
    r = await call('GET', base);
    expect((r.body.rooms as { id: string; people: string[]; canEdit?: boolean }[]).map((x) => [x.id, x.people, x.canEdit])).toEqual([[id, [], undefined]]); // não edita: não vê a lista
    expect((await call('DELETE', `${base}/${id}`)).status).toBe(403);
    who = bia;
    r = await call('GET', base);
    expect(r.body).toEqual({ rooms: [], canCreate: [], mine: null });
    who = undefined;
    expect((await call('GET', base)).status).toBe(403);
    who = admin;
    expect((await call('DELETE', `${base}/${id}`)).status).toBe(200);
    expect(changed).toBe(2);
  });
});

describe('agenda (W5) aponta para as salas próprias', () => {
  afterEach(closeAll);

  it('o local do evento acha a sala de reunião; quem não vê a sala não vê a reserva', async () => {
    const now = Date.now();
    const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const cal = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x', `DTSTART:${stamp(now - 600_000)}`, `DTEND:${stamp(now + 3_600_000)}`, 'SUMMARY:Daily', 'LOCATION:Sala Azul', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const h = await start({ agendaFetcher: async () => cal });
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    const post = (cookie: string, path: string, body: unknown) => fetch(`${h.base}/api/kaviski/humanos/${path}`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }));
    const room = (await post(admin, 'rooms', { kind: 'reuniao', name: 'Sala Azul' })).body.room as { id: string };
    const st = await post(admin, 'agenda', { url: 'https://calendar.google.com/calendar/ical/x/private-0123456789abcdef0123456789abcdef/basic.ics' });
    expect(st.status).toBe(200);
    expect(st.body.events[0].room).toEqual({ id: room.id, name: 'Sala Azul', area: `r:${room.id}` });
    await post(admin, 'users', { user: 'rarm', role: 'cliente', rooms: ['/proj/Clientes/12-Rarm'], password: 'senha-rarm-1' });
    const cliente = await login(h, 'rarm', 'senha-rarm-1');
    const books = async () => ((await (await fetch(`${h.base}/api/kaviski/humanos/agenda/rooms`, { headers: { cookie: cliente } })).json()) as { bookings: { roomId: string }[] }).bookings;
    expect(await books()).toEqual([]);
    const rarmId = ((await (await fetch(`${h.base}/api/kaviski/humanos/users`, { headers: { cookie: admin } })).json()) as { people: { id: string; user: string }[] }).people.find((p) => p.user === 'rarm')!.id;
    expect((await post(admin, `rooms/${room.id}`, { people: [rarmId] })).status).toBe(200);
    expect((await books()).map((b) => b.roomId)).toEqual([room.id]);
  });
});
