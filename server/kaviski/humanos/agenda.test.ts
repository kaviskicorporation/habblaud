// Fork Kaviski (KAVISKI-HUMANOS.md): agenda por ICS (endereço secreto, busca segura, salas e status).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../../log';
import { tempDir } from '../../test/fixtures';
import { KvAgenda, kvAgendaAllowPrivate, kvAgendaHint, kvAgendaUrl, kvFetchIcs, kvMatchRoom, kvPrivateHost, kvPrivateIp, kvReadLimited, type KvAgendaRoom } from './agenda';
import { closeAll, json, login, RARM, start, visit } from './test-harness';

setQuiet(true);
afterEach(closeAll);

const SECRET = 'https://calendar.google.com/calendar/ical/ana%40kaviski.com/private-0123456789abcdef0123456789abcdef/basic.ics';
const ics = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const event = (uid: string, start: number, end: number, extra: string[] = []) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, ...extra, 'END:VEVENT'].join('\r\n');

describe('endereço da agenda', () => {
  it('só https (webcal vira https), sem usuário/senha nem endereço interno', () => {
    expect(kvAgendaUrl(SECRET)).toEqual({ url: SECRET });
    expect(kvAgendaUrl('webcal://p01-caldav.icloud.com/published/2/abc')).toEqual({ url: 'https://p01-caldav.icloud.com/published/2/abc' });
    for (const bad of ['http://calendar.google.com/x.ics', 'ftp://x.com/a', 'https://user:senha@x.com/a', 'https://localhost/a.ics', 'https://127.0.0.1/a', 'https://192.168.1.220:4748/x', 'https://[::1]/x', 'https://intranet/x', 'https://nas.local/a', 'nada', 42, `https://x.com/${'a'.repeat(3000)}`]) {
      expect('error' in kvAgendaUrl(bad), String(bad)).toBe(true);
    }
  });
  it('HABBLAUD_AGENDA_PRIVATE=1 libera a rede local (servidor próprio), e só ela', () => {
    kvAgendaAllowPrivate(true);
    try {
      expect(kvAgendaUrl('https://nextcloud.local/remote.php/dav/x.ics')).toEqual({ url: 'https://nextcloud.local/remote.php/dav/x.ics' });
      expect('error' in kvAgendaUrl('http://nextcloud.local/x.ics')).toBe(true);
    } finally {
      kvAgendaAllowPrivate(false);
    }
    expect('error' in kvAgendaUrl('https://nextcloud.local/x.ics')).toBe(true);
  });
  it('o resumo para a página não carrega o caminho secreto', () => {
    const hint = kvAgendaHint(SECRET);
    expect(hint).toBe('calendar.google.com · …/basic.ics');
    expect(hint).not.toContain('0123456789');
    expect(kvAgendaHint('https://outlook.office365.com/owa/calendar/abcdef0123456789/reachcalendar.ics')).not.toContain('abcdef');
  });
  it('IPs internos (v4 e v6)', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(kvPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '142.250.0.1', '2607:f8b0::1']) expect(kvPrivateIp(ip), ip).toBe(false);
    expect(kvPrivateHost('calendar.google.com')).toBe(false);
    expect(kvPrivateHost('app.localhost')).toBe(true);
  });
  it('a busca recusa nome que resolve para endereço interno e IP interno escrito direto', async () => {
    await expect(kvFetchIcs('https://127.0.0.1:9/a.ics')).rejects.toThrow(/interno/);
    // localtest.me resolve para 127.0.0.1 (nome "público" apontando para dentro: DNS rebinding)
    await expect(kvFetchIcs('https://localtest.me:9/a.ics')).rejects.toThrow(/interno|buscar/);
    await expect(kvFetchIcs('http://calendar.google.com/a.ics')).rejects.toThrow(/https/);
  });
  it('limite de tamanho', async () => {
    await expect(kvReadLimited(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 1000)).rejects.toThrow(/grande/);
    await expect(kvReadLimited(Readable.from([Buffer.from('BEGIN:VCALENDAR')]), 1000)).resolves.toBe('BEGIN:VCALENDAR');
  });
});

describe('sala no texto do evento', () => {
  const rooms: KvAgendaRoom[] = [
    { id: 'r1', name: 'Rarm', path: '/p/Clientes/12-Rarm/01.App', area: 'r:r1' },
    { id: 'r2', name: 'Rarm Loja', area: 'r:r2' },
    { id: 'r3', name: 'Reunião Grande', area: 'r:kvsala-x' },
    { id: 'r4', name: 'FPF · FPFHub', path: '/p/Clientes/14-FPF/05.FPFHub', area: 'r:r4' },
  ];
  it('acha pelo nome (sem acento e maiúsculas), a mais longa vence; pedaço de palavra não vale', () => {
    expect(kvMatchRoom({ location: 'Sala Rarm' }, rooms)?.id).toBe('r1');
    expect(kvMatchRoom({ location: 'rarm loja (2º andar)' }, rooms)?.id).toBe('r2');
    expect(kvMatchRoom({ location: 'Habblaud: reuniao grande' }, rooms)?.id).toBe('r3');
    expect(kvMatchRoom({ location: 'Rarmazém' }, rooms)).toBeUndefined();
    expect(kvMatchRoom({ location: 'https://meet.google.com/abc', description: 'Vamos na sala FPF · FPFHub do Habblaud' }, rooms)?.id).toBe('r4');
    expect(kvMatchRoom({ location: 'pasta 05.FPFHub' }, rooms)?.id).toBe('r4');
    expect(kvMatchRoom({}, rooms)).toBeUndefined();
  });
});

describe('KvAgenda', () => {
  it('guarda o endereço em 600, lê os eventos, acha a sala, guarda o erro e as reservas', async () => {
    const tmp = tempDir();
    const file = join(tmp.dir, 'kaviski', 'agenda.json');
    const now = Date.parse('2026-11-06T17:00:00Z');
    let body = ics(
      event('a', now - 30 * 60_000, now + 30 * 60_000, ['SUMMARY:Planejamento', 'LOCATION:Sala Rarm']),
      event('b', now + 2 * 3600_000, now + 3 * 3600_000, ['SUMMARY:Outra']),
      event('velho', now - 10 * 86_400_000, now - 10 * 86_400_000 + 3600_000, ['SUMMARY:Antigo']),
    );
    let fails = false;
    const agenda = new KvAgenda({ file, now: () => now, fetcher: async (u) => {
      expect(u).toBe(SECRET);
      if (fails) throw new Error('a agenda respondeu 500');
      return body;
    } });
    const rooms: KvAgendaRoom[] = [{ id: 'r1', name: 'Rarm', area: 'r:r1' }];
    expect(agenda.state('ana', rooms)).toEqual({ configured: false, events: [] });
    expect(await agenda.set('ana', 'http://x.com/a.ics')).toMatchObject({ ok: false });
    expect(await agenda.set('ana', SECRET)).toEqual({ ok: true });
    const st = agenda.state('ana', rooms);
    expect(JSON.stringify(st)).not.toContain('0123456789');
    expect(st.events.map((e) => e.title)).toEqual(['Planejamento', 'Outra']);
    expect(st.events[0]!.room).toEqual({ id: 'r1', name: 'Rarm', area: 'r:r1' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toContain(SECRET);
    expect(agenda.bookings(() => rooms)).toEqual([{ roomId: 'r1', area: 'r:r1', start: now - 30 * 60_000, end: now + 30 * 60_000 }]);
    // erro na releitura: fica o erro, os eventos de antes continuam
    fails = true;
    await agenda.refresh('ana');
    expect(agenda.state('ana', rooms)).toMatchObject({ error: 'a agenda respondeu 500' });
    expect(agenda.state('ana', rooms).events).toHaveLength(2);
    fails = false;
    body = ics();
    await agenda.refresh('ana');
    expect(agenda.state('ana', rooms).error).toBeUndefined();
    // relê do disco
    const again = new KvAgenda({ file, now: () => now, fetcher: async () => ics() });
    again.load();
    expect(again.configured('ana')).toBe(true);
    // desligar apaga
    expect(await again.set('ana', '')).toEqual({ ok: true });
    expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    tmp.cleanup();
  });
});

describe('rotas da agenda', () => {
  it('cada um só vê a própria agenda; reservas só das salas que a pessoa vê; visitante não tem agenda', async () => {
    const now = Date.now();
    let cal = '';
    const h = await start({ agendaFetcher: async () => cal });
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    const snap = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie: admin } })).json()) as { rooms: { name: string; path: string }[] };
    const rarm = snap.rooms.find((r) => r.path === RARM)!.name;
    const site = snap.rooms.find((r) => r.path !== RARM)!.name;
    cal = ics(event('r', now - 600_000, now + 3600_000, ['SUMMARY:Daily', `LOCATION:Sala ${rarm}`]), event('s', now + 600_000, now + 1200_000, ['SUMMARY:Site', `LOCATION:${site}`]));
    const post = (cookie: string, url: string) => fetch(`${h.base}/api/kaviski/humanos/agenda`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ url }) });
    expect((await post(admin, 'http://x.com/a.ics')).status).toBe(400);
    const r = await post(admin, SECRET);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain('private-0123');
    const st = JSON.parse(text) as { configured: boolean; hint: string; events: { title: string; room?: { name: string } }[] };
    expect(st.configured).toBe(true);
    expect(st.hint).toContain('calendar.google.com');
    expect(st.events.map((e) => [e.title, e.room?.name])).toEqual([['Daily', rarm], ['Site', site]]);

    // um cliente da Rarm vê a reserva da sala Rarm, não a da sala Site, e não vê a agenda do admin
    await fetch(`${h.base}/api/kaviski/humanos/users`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ user: 'rarm', role: 'cliente', rooms: ['/proj/Clientes/12-Rarm'], password: 'senha-rarm-1' }) });
    const cliente = await login(h, 'rarm', 'senha-rarm-1');
    const mine = (await (await fetch(`${h.base}/api/kaviski/humanos/agenda`, { headers: { cookie: cliente } })).json()) as { configured: boolean };
    expect(mine.configured).toBe(false);
    const books = (await (await fetch(`${h.base}/api/kaviski/humanos/agenda/rooms`, { headers: { cookie: cliente } })).json()) as { bookings: { area: string }[] };
    expect(books.bookings).toHaveLength(1);
    const adminBooks = (await (await fetch(`${h.base}/api/kaviski/humanos/agenda/rooms`, { headers: { cookie: admin } })).json()) as { bookings: unknown[] };
    expect(adminBooks.bookings).toHaveLength(2);
    expect(JSON.stringify(adminBooks)).not.toContain('Daily');

    // visitante
    const { invite } = (await (await fetch(`${h.base}/api/kaviski/humanos/invites`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ ttl: '1h', rooms: [RARM] }) })).json()) as { invite: { link: string } };
    const v = await visit(h, invite.link, 'Visita');
    expect((await fetch(`${h.base}/api/kaviski/humanos/agenda`, { headers: { cookie: v.cookie! } })).status).toBe(403);
    expect((await post(v.cookie!, SECRET)).status).toBe(403);
    expect((await fetch(`${h.base}/api/kaviski/humanos/agenda/rooms`, { headers: { cookie: v.cookie! } })).status).toBe(200);
  });
});
