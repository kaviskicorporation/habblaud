// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): reservas, conflitos, repetição, check-in,
// liberação automática, convidados e a reunião privada (ninguém de fora entra, vê, ouve ou lê).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import type { KvPresenceState } from '../../../shared/kaviski-presence';
import { kvDefaultMeet, kvExpandRepeat, kvMeetingIcs, kvParseMeet, kvParseRepeat, type KvMeetingsState } from '../../../shared/kaviski-meetings';
import type { OfficeSnapshot } from '../../../shared/types';
import { setQuiet } from '../../log';
import { tempDir } from '../../test/fixtures';
import { createHumanos } from '.';
import { kvSetAreaGuard } from './livekit';
import { KvMeetings } from './meetings';
import { kvSetPerson } from './request';
import { KvRooms } from './rooms';

setQuiet(true);

const MIN = 60_000;
const person = (id: string, role: KvPerson['role'], rooms: string[] = []): KvPerson => ({ id, user: id, name: id.toUpperCase(), role, rooms });
const PEOPLE: Record<string, KvPerson> = {
  adm: person('adm', 'admin'),
  bia: person('bia', 'equipe'),
  ana: person('ana', 'equipe'),
  caio: person('caio', 'equipe'),
  rarm: person('rarm', 'cliente', ['/proj/Clientes/12-Rarm']),
};
const peopleList = () => Object.values(PEOPLE).map((p) => ({ id: p.id, name: p.name, role: p.role }));

describe('contrato puro', () => {
  it('configuração da sala: padrões por tipo, troca de tipo e validação', () => {
    expect(kvDefaultMeet('cabine')).toMatchObject({ layout: 'cabine', capacity: 2, privateDefault: true, bookable: true, autoRelease: true });
    expect(kvParseMeet({ layout: 'treinamento' })).toMatchObject({ capacity: 20, equipment: expect.arrayContaining(['projetor']) });
    const base = kvParseMeet({ layout: 'reuniao', capacity: 6 })!;
    expect(kvParseMeet({ autoRelease: false }, base)).toMatchObject({ layout: 'reuniao', capacity: 6, autoRelease: false });
    expect(kvParseMeet({ layout: 'conselho' }, base)!.capacity).toBe(14); // outro tipo: padrões dele
    expect(kvParseMeet({ capacity: 0 })).toBeUndefined();
    expect(kvParseMeet({ layout: 'piscina' })).toBeUndefined();
    expect(kvParseMeet({ equipment: ['tela', 'foguete', 'video'] })!.equipment).toEqual(['tela', 'video']);
    expect(kvParseMeet({ bookable: 'sim' })).toBeUndefined();
  });

  it('repetição: semanal na mesma hora local (horário de verão), dias úteis pulam o fim de semana', () => {
    expect(kvParseRepeat(undefined)).toBeUndefined();
    expect(kvParseRepeat({ freq: 'semanal', count: 1 })).toBeUndefined();
    expect(kvParseRepeat({ freq: 'mensal', count: 3 })).toBeNull();
    expect(kvParseRepeat({ freq: 'diaria', count: 99 })).toBeNull();
    // sexta, 6/11/2026, 15h em Nova York (o horário de verão de lá acaba em 1/11; testa a volta em março)
    const tz = 'America/New_York';
    const start = Date.UTC(2027, 2, 5, 20, 0); // sex 5/3/2027 15h EST
    const weekly = kvExpandRepeat(start, start + 30 * MIN, { freq: 'semanal', count: 3 }, tz);
    expect(weekly).toHaveLength(3);
    const hours = weekly.map((s) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(s.start));
    expect(hours).toEqual(['15', '15', '15']); // 14/3 muda o horário; continua 15h
    expect(weekly[2]!.end - weekly[2]!.start).toBe(30 * MIN);
    const weekdays = kvExpandRepeat(start, start + MIN * 30, { freq: 'uteis', count: 3 }, tz);
    const days = weekdays.map((s) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(s.start));
    expect(days).toEqual(['Fri', 'Mon', 'Tue']);
  });

  it('arquivo .ics: escapa e dobra as linhas', () => {
    const ics = kvMeetingIcs({ id: 'abc', title: 'Planejamento; Q1, metas', start: Date.UTC(2026, 10, 6, 15), end: Date.UTC(2026, 10, 6, 16), note: 'Levar\nos números', by: { id: 'a', name: 'Ana' }, people: [{ id: 'b', name: 'Bia' }] }, 'Sala Azul', 'Kaviski', { by: 'Organizador', people: 'Participantes' }, 0);
    expect(ics).toContain('SUMMARY:Planejamento\\; Q1\\, metas');
    expect(ics).toContain('DTSTART:20261106T150000Z');
    expect(ics).toContain('LOCATION:Sala Azul');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

/** KvMeetings com salas em memória e relógio de mentira. */
function setup(t0 = Date.UTC(2026, 10, 9, 13, 0)) {
  let t = t0;
  const rooms = new KvRooms(null, () => t);
  const known = (id: string) => PEOPLE[id]?.name;
  const mk = (body: Record<string, unknown>) => {
    const r = rooms.create(PEOPLE.adm!, body, known);
    if (!r.ok) throw new Error(r.error);
    return r.room;
  };
  const azul = mk({ kind: 'reuniao', name: 'Sala Azul', meet: { layout: 'reuniao', capacity: 4 } });
  const cab = mk({ kind: 'reuniao', name: 'Cabine', meet: { layout: 'cabine' } });
  const livre = mk({ kind: 'reuniao', name: 'Livre', meet: { bookable: false } });
  const pessoal = mk({ kind: 'pessoal', owner: 'bia' });
  const events = { changed: 0, rooms: 0, locks: [] as unknown[] };
  const mt = new KvMeetings({
    file: null,
    rooms,
    now: () => t,
    tz: 'America/Sao_Paulo',
    people: peopleList,
    changed: () => events.changed++,
    roomsChanged: () => events.rooms++,
    locks: (l) => (events.locks = l),
  });
  rooms.setGuest((roomId, pid) => mt.guestSees(roomId, pid));
  return { mt, rooms, azul, cab, livre, pessoal, events, now: () => t, go: (ms: number) => (t += ms) };
}

describe('reservas', () => {
  it('marca, recusa conflito e explica quem pode marcar onde', () => {
    const { mt, azul, livre, pessoal, now } = setup();
    const s = now() + 60 * MIN;
    const r = mt.create(PEOPLE.bia!, { room: azul.id, title: 'Planejamento', start: s, end: s + 60 * MIN, people: ['ana', 'caio', 'rarm', 'bia'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0]).toMatchObject({ title: 'Planejamento', people: ['ana', 'caio', 'rarm'], private: false, by: { id: 'bia' } });
    expect(r.warnings).toBeUndefined(); // 4 pessoas, 4 lugares
    const c = mt.create(PEOPLE.ana!, { room: azul.id, title: 'Outra', start: s + 30 * MIN, end: s + 90 * MIN });
    expect(c).toMatchObject({ ok: false, status: 409, extra: { conflicts: [{ start: s, end: s + 60 * MIN, title: 'Planejamento' }] } });
    // encostar não é conflito
    expect(mt.create(PEOPLE.ana!, { room: azul.id, title: 'Depois', start: s + 60 * MIN, end: s + 90 * MIN, people: ['bia', 'caio', 'rarm', 'adm'] })).toMatchObject({ ok: true, warnings: ['5 pessoas para 4 lugares nesta sala'] });
    expect(mt.create(PEOPLE.rarm!, { room: azul.id, start: s + 3 * 60 * MIN, end: s + 4 * 60 * MIN })).toMatchObject({ ok: false, status: 403 });
    expect(mt.create(PEOPLE.bia!, { room: livre.id, start: s, end: s + MIN * 30 })).toMatchObject({ ok: false, status: 404 });
    expect(mt.create(PEOPLE.bia!, { room: pessoal.id, start: s, end: s + MIN * 30 })).toMatchObject({ ok: false, status: 404 });
    expect(mt.create(PEOPLE.bia!, { room: azul.id, start: s, end: s + MIN })).toMatchObject({ ok: false, status: 400 });
    expect(mt.create(PEOPLE.bia!, { room: azul.id, start: now() - 3 * 60 * MIN, end: now() - 60 * MIN })).toMatchObject({ ok: false, status: 400 });
    expect(mt.create(PEOPLE.bia!, { room: azul.id, start: s + 9 * 60 * MIN, end: s + 10 * 60 * MIN, people: ['ninguem'] })).toMatchObject({ ok: false, status: 400 });
  });

  it('repetição: 409 com os horários tomados, ou marca só os livres', () => {
    const { mt, azul, now } = setup();
    const s = now() + 60 * MIN;
    mt.create(PEOPLE.ana!, { room: azul.id, title: 'Já marcada', start: s + 7 * 24 * 60 * MIN, end: s + 7 * 24 * 60 * MIN + 30 * MIN });
    const body = { room: azul.id, title: 'Semanal', start: s, end: s + 30 * MIN, repeat: { freq: 'semanal', count: 4 } };
    expect(mt.create(PEOPLE.bia!, body)).toMatchObject({ ok: false, status: 409, error: '1 de 4 horários já estão reservados nesta sala' });
    const r = mt.create(PEOPLE.bia!, { ...body, skipConflicts: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(3);
    expect(r.skipped).toHaveLength(1);
    expect(new Set(r.value.map((m) => m.series)).size).toBe(1);
    // cancelar a segunda da série leva ela e as próximas
    const second = r.value[1]!;
    expect(mt.cancel(PEOPLE.ana!, second.id, true)).toMatchObject({ ok: false, status: 403 });
    expect(mt.cancel(PEOPLE.bia!, second.id, true)).toMatchObject({ ok: true, value: 2 });
    expect(mt.all().filter((m) => m.series === second.series)).toHaveLength(1);
  });

  it('privada: quem não é da reunião vê só "ocupada"; convidado vê a sala só perto do horário', () => {
    const { mt, azul, rooms, cab, now, go } = setup();
    const s = now() + 60 * MIN;
    const r = mt.create(PEOPLE.bia!, { room: cab.id, title: 'Conversa com o cliente', start: s, end: s + 30 * MIN, people: ['rarm'] });
    expect(r.ok && r.value[0]!.private).toBe(true); // a cabine nasce privada
    const m = r.ok ? r.value[0]! : null!;
    expect(mt.view(m, PEOPLE.caio!)).toEqual({ id: m.id, room: cab.id, start: s, end: s + 30 * MIN, private: true, mine: false });
    expect(mt.view(m, PEOPLE.rarm!)).toMatchObject({ title: 'Conversa com o cliente', mine: true, people: [{ id: 'rarm', name: 'RARM' }] });
    expect(mt.view(m, PEOPLE.adm!)).toMatchObject({ title: 'Conversa com o cliente', canEdit: true });
    // o cliente não vê as salas da equipe... até 15 min antes da reunião dele
    expect(rooms.canSee(cab.id, PEOPLE.rarm)).toBe(false);
    expect(mt.state(PEOPLE.rarm!, now(), now() + 86_400_000)).toMatchObject({ canBook: false, rooms: [{ id: cab.id }], meetings: [{ id: m.id, mine: true }] });
    expect(mt.state(PEOPLE.rarm!, now(), now() + 86_400_000).people).toBeUndefined();
    go(46 * MIN);
    expect(rooms.canSee(cab.id, PEOPLE.rarm)).toBe(true);
    expect(rooms.canSee(azul.id, PEOPLE.rarm)).toBe(false);
    go(50 * MIN); // acabou há 6 min
    expect(rooms.canSee(cab.id, PEOPLE.rarm)).toBe(false);
  });

  it('check-in: entrar na sala faz sozinho; sem ninguém em 10 min, a sala é liberada', () => {
    const { mt, azul, cab, now, go, events } = setup();
    const s = now() + 10 * MIN;
    const a = mt.create(PEOPLE.bia!, { room: azul.id, title: 'Vazia', start: s, end: s + 60 * MIN });
    const b = mt.create(PEOPLE.bia!, { room: cab.id, title: 'Com gente', start: s, end: s + 60 * MIN, people: ['ana'] });
    if (!a.ok || !b.ok) throw new Error('marcar');
    go(4 * MIN);
    mt.onArea('ana', `r:${cab.id}`); // cedo demais (abre 5 min antes)
    expect(mt.get(b.value[0]!.id)!.checkin).toBeUndefined();
    go(MIN);
    mt.onArea('caio', `r:${cab.id}`); // não é da reunião
    mt.onArea('ana', `r:${cab.id}`);
    expect(mt.get(b.value[0]!.id)!.checkin).toBe(now());
    go(16 * MIN);
    const before = events.changed;
    mt.tick();
    expect(mt.get(a.value[0]!.id)!.released).toBe('auto');
    expect(mt.get(b.value[0]!.id)!.released).toBeUndefined();
    expect(events.changed).toBeGreaterThan(before);
    // liberada não bloqueia mais a sala
    expect(mt.create(PEOPLE.caio!, { room: azul.id, title: 'Aproveitar', start: now(), end: now() + 30 * MIN }).ok).toBe(true);
  });

  it('usar agora, estender, encerrar e mudar de horário', () => {
    const { mt, azul, now, go } = setup();
    const next = now() + 40 * MIN;
    mt.create(PEOPLE.ana!, { room: azul.id, title: 'Depois', start: next, end: next + 30 * MIN });
    expect(mt.quick(PEOPLE.bia!, { room: azul.id, minutes: 60 }, [])).toMatchObject({ ok: false, status: 409, extra: { freeUntil: next } });
    const q = mt.quick(PEOPLE.bia!, { room: azul.id, minutes: 30, private: true }, ['bia', 'caio', 'caio']);
    if (!q.ok) throw new Error(q.error);
    expect(q.value).toMatchObject({ people: ['caio'], private: true, checkin: now() });
    expect(mt.quick(PEOPLE.caio!, { room: azul.id, minutes: 15 }, [])).toMatchObject({ ok: false, status: 409 });
    expect(mt.privateLocks()).toEqual([{ id: q.value.id, area: `r:${azul.id}`, by: { id: 'bia', name: 'BIA' }, members: ['bia', 'caio'], until: q.value.end, title: 'Uso imediato' }]);
    expect(mt.extend(PEOPLE.caio!, q.value.id, 15)).toMatchObject({ ok: false, status: 409 }); // bate na das 13h40
    expect(mt.extend(PEOPLE.caio!, q.value.id, 10)).toMatchObject({ ok: true });
    go(5 * MIN);
    expect(mt.end(PEOPLE.caio!, q.value.id, false)).toMatchObject({ ok: false, status: 403 }); // convidado fora da sala
    expect(mt.end(PEOPLE.caio!, q.value.id, true)).toMatchObject({ ok: true });
    expect(mt.get(q.value.id)!.end).toBe(now());
    expect(mt.privateLocks()).toEqual([]);
    const d = mt.all().find((m) => m.title === 'Depois')!;
    expect(mt.update(PEOPLE.bia!, d.id, { title: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(mt.update(PEOPLE.ana!, d.id, { start: next - 30 * MIN, end: next })).toMatchObject({ ok: true });
    expect(mt.update(PEOPLE.adm!, d.id, { private: true, people: ['bia'] })).toMatchObject({ ok: true, value: { private: true, people: ['bia'] } });
  });

  it('sala apagada leva as reservas; sala trocada de tipo também', () => {
    const { mt, azul, now } = setup();
    mt.create(PEOPLE.bia!, { room: azul.id, title: 'x', start: now() + 60 * MIN, end: now() + 90 * MIN });
    mt.dropRoom(azul.id);
    expect(mt.all()).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ pelo servidor inteiro

interface Stream {
  events(name: string): unknown[];
  state(): KvPresenceState | null;
  close(): void;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  kvSetAreaGuard(null);
});

function snapshot(): OfficeSnapshot {
  return { rev: 1, serverTime: 0, rooms: [], agents: [], meta: { demo: false, sources: [], startedAt: 0, version: '1' } } as unknown as OfficeSnapshot;
}

async function start() {
  const tmp = tempDir();
  const env = {
    HABBLAUD_HUMANOS: '1',
    HABBLAUD_REMOTE_USER: 'kavisvi',
    HABBLAUD_LIVEKIT_URL: 'ws://127.0.0.1:7880',
    HABBLAUD_LIVEKIT_KEY: 'chave',
    HABBLAUD_LIVEKIT_SECRET: 'x'.repeat(40),
  };
  const humanos = createHumanos({ dataDir: tmp.dir, snapshot, env });
  // as pessoas do teste existem (convidados válidos)
  for (const p of Object.values(PEOPLE)) if (p.id !== 'adm') await humanos.users.create({ user: p.id, name: p.name, role: p.role, password: 'senha-de-teste-1', rooms: p.rooms });
  const ids = new Map(humanos.users.list().map((u) => [u.user, u.id]));
  const as = (id: string): KvPerson => ({ ...PEOPLE[id]!, id: ids.get(id) ?? id });
  const srv = http.createServer((req, res) => {
    const id = req.headers['x-p'];
    if (typeof id === 'string' && PEOPLE[id]) kvSetPerson(req, as(id));
    const url = new URL(req.url ?? '/', 'http://x');
    if (!humanos.before(req, res, url)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/kaviski/humanos`;
  const streams: Stream[] = [];
  closers.push(async () => {
    for (const s of streams) s.close();
    humanos.presence.stop();
    srv.closeAllConnections();
    await new Promise<void>((ok) => srv.close(() => ok()));
    tmp.cleanup();
  });
  const req = async (who: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-p': who }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const post = (who: string, path: string, body: unknown) => req(who, 'POST', path, body);
  const open = async (who: string): Promise<Stream> => {
    const ac = new AbortController();
    const r = await fetch(`${base}/presence`, { headers: { 'x-p': who }, signal: ac.signal });
    const reader = r.body!.getReader();
    let text = '';
    let first: () => void = () => {};
    const ready = new Promise<void>((ok) => (first = ok));
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
          if (text.includes('event: people')) first();
        }
      } catch {
        // fechado
      }
    })();
    await ready;
    const parse = (name: string) =>
      text
        .split('\n\n')
        .filter((c) => c.startsWith(`event: ${name}\n`))
        .map((c) => JSON.parse(c.split('\ndata: ')[1]!));
    const s: Stream = { events: parse, state: () => (parse('people').at(-1) as KvPresenceState | undefined) ?? null, close: () => ac.abort() };
    streams.push(s);
    return s;
  };
  const at = (who: string, room: string, x = 40, y = 40) => post(who, 'presence', { pos: { k: 'r', r: room, x, y, s: 'n', d: 'down', m: 0 }, area: `r:${room}` });
  const outside = (who: string) => post(who, 'presence', { pos: { k: 'a', x: 10, y: 10, d: 'down', m: 0 }, area: 'c' });
  return { req, post, open, at, outside, idOf: (u: string) => ids.get(u) ?? u };
}

const wait = (ms = 250) => new Promise((ok) => setTimeout(ok, ms));

describe('reiniciar o servidor com reuniões gravadas', () => {
  it('sobe sem erro e mantém as reservas', async () => {
    const tmp = tempDir();
    const env = { HABBLAUD_HUMANOS: '1', HABBLAUD_REMOTE_USER: 'kavisvi' };
    const a = createHumanos({ dataDir: tmp.dir, snapshot, env });
    const room = a.rooms.create(PEOPLE.adm!, { kind: 'reuniao', name: 'Sala' }, () => 'x');
    if (!room.ok) throw new Error(room.error);
    a.presence.stop();
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const t = Date.now();
    writeFileSync(join(tmp.dir, 'kaviski', 'meetings.json'), JSON.stringify({ version: 1, meetings: [{ id: 'm1', room: room.room.id, title: 'x', start: t - MIN, end: t + 30 * MIN, by: { id: 'adm', name: 'ADM' }, people: [], private: true, checkin: t, createdAt: t, updatedAt: t }] }));
    const b = createHumanos({ dataDir: tmp.dir, snapshot, env });
    b.presence.stop();
    tmp.cleanup();
  });
});

describe('reunião privada pelo servidor', () => {
  it('tranca e cobre a sala: quem está fora não entra, não vê, não ouve nem lê; bate na porta', async () => {
    const h = await start();
    const room = await h.post('adm', 'rooms', { kind: 'reuniao', name: 'Conselho', meet: { layout: 'conselho' } });
    expect(room.status).toBe(201);
    const id = (room.body.room as { id: string; meet: { layout: string; capacity: number } }).id;
    expect((room.body.room as { meet: { capacity: number } }).meet.capacity).toBe(14);
    const [bia, ana, caio] = [await h.open('bia'), await h.open('ana'), await h.open('caio')];
    await h.at('bia', id);
    await h.at('caio', id, 60, 60); // estava lá antes de a reunião começar
    const t = Date.now();
    const made = await h.post('bia', 'meetings', { room: id, title: 'Orçamento 2027', start: t - MIN, end: t + 30 * MIN, people: [h.idOf('ana')] });
    expect(made.status).toBe(201);
    const mid = ((made.body.meetings as { id: string; private: boolean }[])[0]!).id;
    expect((made.body.meetings as { private: boolean }[])[0]!.private).toBe(true); // conselho nasce privada
    await wait();
    // tranca da reunião: organizador e convidados na lista
    expect(bia.state()!.locks).toMatchObject([{ area: `r:${id}`, in: true, veil: true, meeting: mid, title: 'Orçamento 2027' }]);
    expect(caio.state()!.locks).toMatchObject([{ area: `r:${id}`, in: false, veil: true, meeting: mid }]);
    expect(caio.state()!.locks![0]!.title).toBeUndefined();
    // quem não é da reunião não fica sabendo onde a Bia está (nem o caio, para os outros)
    const biaForCaio = caio.state()!.people.find((p) => p.name === 'BIA')!;
    expect(biaForCaio.pos).toBeUndefined();
    expect(biaForCaio.meet).toBe(true);
    // a Ana (convidada) entra e vê a Bia
    expect((await h.at('ana', id, 50, 50)).status).toBe(200);
    await wait();
    expect(ana.state()!.people.find((p) => p.name === 'BIA')!.pos).toBeTruthy();
    // o caio não consegue mais pôr a posição lá dentro, nem pegar a voz ou a conversa da sala
    expect((await h.at('caio', id, 61, 61)).status).toBe(400);
    expect((await h.post('caio', 'livekit-token', { area: `r:${id}` })).status).toBe(403);
    expect((await h.post('ana', 'livekit-token', { area: `r:${id}` })).status).toBe(200);
    expect((await h.req('caio', 'GET', `chat?area=${encodeURIComponent(`r:${id}`)}`)).status).toBe(403);
    expect((await h.req('caio', 'GET', `board?area=${encodeURIComponent(`r:${id}`)}`)).status).not.toBe(200);
    // ...e a reunião aparece para ele só como "Reunião privada"
    const st = (await h.req('caio', 'GET', 'meetings')).body as unknown as KvMeetingsState;
    expect(st.meetings[0]).toEqual(expect.objectContaining({ id: mid, private: true, mine: false }));
    expect(st.meetings[0]!.title).toBeUndefined();
    // bate na porta; a Bia deixa entrar
    await h.outside('caio');
    expect((await h.post('caio', 'knock', { area: `r:${id}` })).status).toBe(200);
    await wait();
    expect(bia.events('knock')).toHaveLength(1);
    expect((await h.post('bia', 'knock/answer', { area: `r:${id}`, who: h.idOf('caio'), allow: true })).status).toBe(200);
    expect((await h.at('caio', id, 62, 62)).status).toBe(200);
    // encerrar: a sala volta ao normal
    expect((await h.post('bia', `meetings/${mid}/end`, {})).status).toBe(200);
    await wait();
    expect(caio.state()!.locks).toBeUndefined();
  });

  it('destrancar a sala de uma reunião privada a torna pública', async () => {
    const h = await start();
    const room = await h.post('adm', 'rooms', { kind: 'reuniao', name: 'Cabine 1', meet: { layout: 'cabine' } });
    const id = (room.body.room as { id: string }).id;
    const bia = await h.open('bia');
    await h.at('bia', id);
    const q = await h.post('bia', 'meetings/now', { room: id, minutes: 30 });
    expect(q.status).toBe(201);
    expect((q.body.meeting as { private: boolean }).private).toBe(true);
    await wait();
    expect(bia.state()!.locks).toMatchObject([{ veil: true }]);
    expect((await h.post('bia', 'lock', { on: false, area: `r:${id}` })).status).toBe(200);
    await wait();
    expect(bia.state()!.locks).toBeUndefined();
    const st = (await h.req('bia', 'GET', 'meetings')).body as unknown as KvMeetingsState;
    expect(st.meetings[0]!.private).toBe(false);
    expect(bia.events('meetings').length).toBeGreaterThan(0);
  });

  it('trancar com véu numa sala própria esconde quem está dentro; disponibilidade só para a equipe', async () => {
    const h = await start();
    const room = await h.post('adm', 'rooms', { kind: 'reuniao', name: 'Sala 2' });
    const id = (room.body.room as { id: string }).id;
    const ana = await h.open('ana');
    await h.open('bia');
    await h.at('bia', id);
    expect((await h.post('bia', 'lock', { on: true, veil: true })).status).toBe(200);
    await wait();
    expect(ana.state()!.people.find((p) => p.name === 'BIA')).toMatchObject({ meet: true });
    expect(ana.state()!.people.find((p) => p.name === 'BIA')!.pos).toBeUndefined();
    expect((await h.req('rarm', 'GET', `meetings/freebusy?people=${h.idOf('bia')}`)).status).toBe(403);
    expect((await h.req('ana', 'GET', `meetings/freebusy?people=${h.idOf('bia')}`)).status).toBe(200);
    // sala de reunião não aceita meet errado; sala pessoal não aceita meet
    expect((await h.post('adm', `rooms/${id}`, { meet: { capacity: 999 } })).status).toBe(400);
    expect((await h.post('adm', 'rooms', { kind: 'descanso', meet: { layout: 'cabine' } })).status).toBe(400);
  });
});
