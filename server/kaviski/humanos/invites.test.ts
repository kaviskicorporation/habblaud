// Fork Kaviski (KAVISKI-HUMANOS.md): convites por link e visitantes (fase 4).
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../../log';
import { tempDir } from '../../test/fixtures';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import type { OfficeSnapshot } from '../../../shared/types';
import type { KvPlan } from '../../../shared/kaviski-plan';
import { KvInvites } from './invites';
import { kvPublicUrl } from './invites-route';
import { closeAll, json, login, RARM, start, visit } from './test-harness';

setQuiet(true);
afterEach(closeAll);
const ADMIN: KvPerson = { id: 'admin', user: 'kavisvi', name: 'Vitor', role: 'admin', rooms: [] };
const H = 60 * 60 * 1000;

describe('KvInvites', () => {
  const secret = () => Buffer.alloc(32, 7);

  it('valida o pedido e guarda com permissão 600, sem guardar o link', () => {
    const tmp = tempDir();
    const file = join(tmp.dir, 'kaviski', 'invites.json');
    const inv = new KvInvites(file, secret);
    expect(inv.create(ADMIN, { ttl: '2h' }).ok).toBe(false);
    expect(inv.create(ADMIN, { ttl: '1h', maxUses: 0 }).ok).toBe(false);
    expect(inv.create(ADMIN, { ttl: '1h', maxUses: 51 }).ok).toBe(false);
    expect(inv.create(ADMIN, { ttl: '1h', rooms: ['relativo'] }).ok).toBe(false);
    const r = inv.create(ADMIN, { ttl: '1d', maxUses: 3, rooms: ['/proj/Clientes/12-Rarm/'], label: 'Reunião com a Rarm' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invite).toMatchObject({ state: 'ativo', maxUses: 3, uses: 0, rooms: ['/proj/Clientes/12-Rarm'], label: 'Reunião com a Rarm', by: { id: 'admin', name: 'Vitor' } });
    expect(r.invite.link).toMatch(/^\/convite\/[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toContain(r.invite.link!.split('.')[1]);
    const again = new KvInvites(file, secret);
    again.load();
    expect(again.list()[0]?.link).toBe(r.invite.link);
    tmp.cleanup();
  });

  it('link com assinatura errada ou de outra chave não abre', () => {
    const inv = new KvInvites(null, secret);
    const r = inv.create(ADMIN, { ttl: '1h' });
    if (!r.ok) throw new Error('create');
    const token = r.invite.link!.slice('/convite/'.length);
    expect(inv.open(token).problem).toBeUndefined();
    const [id, sig] = token.split('.');
    expect(inv.open(`${id}.${sig!.slice(0, -1)}${sig!.endsWith('A') ? 'B' : 'A'}`).problem).toBe('invalido');
    expect(inv.open(`${id}`).problem).toBe('invalido');
    expect(inv.open(undefined).problem).toBe('invalido');
    const other = new KvInvites(null, () => Buffer.alloc(32, 8));
    expect(other.open(token).problem).toBe('invalido');
  });

  it('uso único: a segunda pessoa não entra; várias pessoas: até o limite', () => {
    const inv = new KvInvites(null, secret);
    const one = inv.create(ADMIN, { ttl: '1h' });
    if (!one.ok) throw new Error('create');
    const t1 = one.invite.link!.slice(9);
    expect(inv.join(t1, '  ').ok).toBe(false);
    const a = inv.join(t1, 'Ana');
    expect(a.ok).toBe(true);
    const b = inv.join(t1, 'Bia');
    expect(b).toMatchObject({ ok: false, status: 410 });
    const many = inv.create(ADMIN, { ttl: '1h', maxUses: 2 });
    if (!many.ok) throw new Error('create');
    const t2 = many.invite.link!.slice(9);
    expect(inv.join(t2, 'C').ok).toBe(true);
    expect(inv.join(t2, 'D').ok).toBe(true);
    expect(inv.join(t2, 'E').ok).toBe(false);
    // esgotado, mas quem entrou continua dentro
    if (a.ok) expect(inv.verify(a.token)?.name).toBe('Ana');
    expect(inv.list().find((i) => i.id === many.invite.id)).toMatchObject({ state: 'esgotado', uses: 2 });
  });

  it('a sessão do visitante acaba quando o convite vence ou é revogado; cookie adulterado não vale', () => {
    let now = 1_000_000_000_000;
    const inv = new KvInvites(null, secret, () => now);
    const r = inv.create(ADMIN, { ttl: '1h', rooms: ['/proj/Clientes/12-Rarm'] });
    if (!r.ok) throw new Error('create');
    const j = inv.join(r.invite.link!.slice(9), 'Visita');
    if (!j.ok) throw new Error('join');
    expect(j.token).toMatch(/^g1\.v_/);
    expect(j.maxAgeS).toBe(3600);
    const p = inv.verify(j.token)!;
    expect(p).toMatchObject({ role: 'visitante', name: 'Visita', rooms: ['/proj/Clientes/12-Rarm'], until: now + H });
    expect(kvRestricted(p)).toBe(true);
    // outro prazo no cookie (mesmo assinado errado) não vale
    const parts = j.token.split('.');
    expect(inv.verify([parts[0], parts[1], String(Number(parts[2]) + H), parts[3]].join('.'))).toBeUndefined();
    expect(inv.verify(`${j.token.slice(0, -2)}xx`)).toBeUndefined();
    now += H - 1;
    expect(inv.verify(j.token)).toBeDefined();
    now += 2;
    expect(inv.verify(j.token)).toBeUndefined();
    expect(inv.list()[0]!.state).toBe('vencido');
    expect(inv.open(r.invite.link!.slice(9)).problem).toBe('vencido');

    now = 1_000_000_000_000;
    const r2 = inv.create(ADMIN, { ttl: '7d', maxUses: 5 });
    if (!r2.ok) throw new Error('create');
    const j2 = inv.join(r2.invite.link!.slice(9), 'Outra');
    if (!j2.ok) throw new Error('join');
    expect(inv.verify(j2.token)).toBeDefined();
    const rev = inv.revoke(r2.invite.id)!;
    expect(rev.visitors).toEqual([j2.person.id]);
    expect(rev.invite.state).toBe('revogado');
    expect(rev.invite.link).toBeUndefined();
    expect(inv.verify(j2.token)).toBeUndefined();
    expect(inv.join(r2.invite.link!.slice(9), 'Mais uma')).toMatchObject({ ok: false, status: 410 });
    // 7 dias depois de vencer, some
    now += 15 * 24 * H;
    expect(inv.list()).toHaveLength(0);
  });

  it('editar a validade não derruba quem entrou: o cookie antigo vale e o gate ganha um cookie novo', () => {
    let now = 1_000_000_000_000;
    const inv = new KvInvites(null, secret, () => now);
    const r = inv.create(ADMIN, { ttl: '1h', maxUses: 3 });
    if (!r.ok) throw new Error('create');
    const j = inv.join(r.invite.link!.slice(9), 'Visita');
    if (!j.ok) throw new Error('join');
    expect(inv.renew(j.token)).toBeUndefined(); // validade igual: nada a reemitir
    const e = inv.update(r.invite.id, { extend: '1d' });
    expect(e).toMatchObject({ ok: true, visitors: [j.person.id], ended: false, roomsChanged: false });
    if (!e.ok) return;
    expect(e.invite.expiresAt).toBe(now + H + 24 * H);
    expect(inv.verify(j.token)?.until).toBe(now + 25 * H);
    const fresh = inv.renew(j.token)!;
    expect(fresh.maxAgeS).toBe(25 * 3600);
    expect(fresh.token).not.toBe(j.token);
    expect(inv.verify(fresh.token)?.name).toBe('Visita');
    expect(inv.renew(fresh.token)).toBeUndefined();
    // passou da validade antiga: os dois cookies continuam valendo (vale o fim atual do convite)
    now += 2 * H;
    expect(inv.verify(j.token)).toBeDefined();
    expect(inv.verify(fresh.token)).toBeDefined();
    // data exata: no passado não; mais que 30 dias, não; encurtar vale e corta quando chega
    expect(inv.update(r.invite.id, { expiresAt: now - 1 })).toMatchObject({ ok: false, status: 400 });
    expect(inv.update(r.invite.id, { expiresAt: now + 31 * 24 * H })).toMatchObject({ ok: false, status: 400 });
    expect(inv.update(r.invite.id, { expiresAt: now + 10 * 60_000 }).ok).toBe(true);
    expect(inv.renew(fresh.token)?.maxAgeS).toBe(600);
    now += 10 * 60_000 + 1;
    expect(inv.verify(j.token)).toBeUndefined();
    expect(inv.verify(fresh.token)).toBeUndefined();
    // venceu: estender reabre (a partir de agora), com teto de 30 dias
    const back = inv.update(r.invite.id, { extend: '7d' });
    expect(back.ok && back.invite.expiresAt).toBe(now + 7 * 24 * H);
    for (let k = 0; k < 6; k++) inv.update(r.invite.id, { extend: '7d' });
    expect(inv.list()[0]!.expiresAt).toBe(now + 30 * 24 * H);
    // revogado não se edita
    inv.revoke(r.invite.id);
    expect(inv.update(r.invite.id, { extend: '1h' })).toMatchObject({ ok: false, status: 409 });
    expect(inv.update('nao-existe', {})).toMatchObject({ ok: false, status: 404 });
  });

  it('edita pessoas, descrição, salas e acesso; convite antigo (sem acesso) continua igual', () => {
    const tmp = tempDir();
    const file = join(tmp.dir, 'invites.json');
    const inv = new KvInvites(file, secret);
    const r = inv.create(ADMIN, { ttl: '1d', label: 'Antes', own: ['kvsala-reuniao1'], meetings: false, blocked: ['arquivo'], voice: false });
    if (!r.ok) throw new Error('create');
    expect(r.invite.access).toEqual({ own: ['kvsala-reuniao1'], meetings: false, blocked: ['arquivo'], voice: false, chat: true });
    expect(inv.create(ADMIN, { ttl: '1h', own: ['/nao/e/sala'] }).ok).toBe(false);
    expect(inv.create(ADMIN, { ttl: '1h', blocked: ['cozinha'] }).ok).toBe(false);
    expect(inv.create(ADMIN, { ttl: '1h', voice: 'sim' }).ok).toBe(false);
    const j = inv.join(r.invite.link!.slice(9), 'Visita');
    if (!j.ok) throw new Error('join');
    expect(inv.verify(j.token)?.guest).toEqual({ own: ['kvsala-reuniao1'], meetings: false, blocked: ['arquivo'], voice: false, chat: true });
    expect(inv.ownAllowed(j.person.id, 'kvsala-reuniao1', 'reuniao')).toBe(true);
    expect(inv.ownAllowed(j.person.id, 'kvsala-reuniao2', 'reuniao')).toBe(false);
    const e = inv.update(r.invite.id, { label: 'Depois', maxUses: 4, rooms: ['/proj/Clientes/12-Rarm'], meetings: true, blocked: [], chat: false });
    expect(e).toMatchObject({ ok: true, roomsChanged: true, invite: { label: 'Depois', maxUses: 4, rooms: ['/proj/Clientes/12-Rarm'], access: { own: ['kvsala-reuniao1'], meetings: true, blocked: [], voice: false, chat: false } } });
    expect(inv.ownAllowed(j.person.id, 'kvsala-reuniao2', 'reuniao')).toBe(true);
    expect(inv.ownAllowed(j.person.id, 'kvsala-pessoal', 'pessoal')).toBe(false);
    expect(inv.ownAllowed('ana', 'kvsala-reuniao2', 'reuniao')).toBe(false);
    expect(inv.verify(j.token)).toMatchObject({ rooms: ['/proj/Clientes/12-Rarm'], guest: { meetings: true, chat: false } });
    expect(inv.update(r.invite.id, { maxUses: 0 }).ok).toBe(false);
    expect(inv.update(r.invite.id, { label: '' })).toMatchObject({ ok: true });
    expect(inv.list()[0]!.label).toBeUndefined();
    // nada mudou: nada para registrar
    expect(inv.update(r.invite.id, { maxUses: 4 })).toMatchObject({ ok: true, changes: [] });
    expect(inv.activePeople().map((p) => p.id)).toEqual([j.person.id]);

    // arquivo de antes da edição: sem `access` = o de sempre (temáticas abertas, voz e chat)
    const old = JSON.parse(readFileSync(file, 'utf8')) as { invites: Record<string, unknown>[] };
    delete old.invites[0]!.access;
    writeFileSync(file, JSON.stringify(old));
    const again = new KvInvites(file, secret);
    again.load();
    expect(again.list()[0]!.access).toEqual({ own: [], meetings: false, blocked: [], voice: true, chat: true });
    expect(again.verify(j.token)?.guest).toEqual({ own: [], meetings: false, blocked: [], voice: true, chat: true });
    again.revoke(r.invite.id);
    expect(again.activePeople()).toEqual([]);
    tmp.cleanup();
  });

  it('perfil (boneco) do visitante mora no convite', () => {
    const inv = new KvInvites(null, secret);
    const r = inv.create(ADMIN, { ttl: '1h' });
    if (!r.ok) throw new Error('create');
    const j = inv.join(r.invite.link!.slice(9), 'Visita');
    if (!j.ok) throw new Error('join');
    expect(inv.has(j.person.id)).toBe(true);
    expect(inv.setProfile(j.person.id, { look: { seed: 1, look: 'f' } })).toBe(true);
    expect(inv.profile(j.person.id)).toEqual({ look: { seed: 1, look: 'f' } });
    expect(inv.has('admin')).toBe(false);
  });

  it('HABBLAUD_PUBLIC_URL só vale com http(s) e sem caminho', () => {
    expect(kvPublicUrl({ HABBLAUD_PUBLIC_URL: 'https://escritorio.kaviski.com.br/' })).toBe('https://escritorio.kaviski.com.br');
    expect(kvPublicUrl({ HABBLAUD_PUBLIC_URL: 'javascript:alert(1)' })).toBeUndefined();
    expect(kvPublicUrl({ HABBLAUD_PUBLIC_URL: 'https://x.com/a?b' })).toBeUndefined();
    expect(kvPublicUrl({})).toBeUndefined();
  });
});

describe('convites pela porta remota', () => {
  it('admin e equipe convidam; cliente não; o visitante vê só as salas do convite e nenhuma ação', async () => {
    const h = await start();
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    for (const [user, role] of [['bia', 'equipe'], ['rarm', 'cliente']]) {
      const r = await fetch(`${h.base}/api/kaviski/humanos/users`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ user, role, rooms: role === 'cliente' ? ['/proj/Clientes/12-Rarm'] : [], password: `senha-${user}-1` }) });
      expect(r.status).toBe(201);
    }
    const equipe = await login(h, 'bia', 'senha-bia-1');
    const cliente = await login(h, 'rarm', 'senha-rarm-1');
    const create = (cookie: string, body: unknown) => fetch(`${h.base}/api/kaviski/humanos/invites`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify(body) });
    expect((await create(cliente, { ttl: '1h' })).status).toBe(403);
    expect((await fetch(`${h.base}/api/kaviski/humanos/invites`, { headers: { cookie: cliente } })).status).toBe(403);
    const made = await create(equipe, { ttl: '1d', rooms: ['/proj/Clientes/12-Rarm'], label: 'Visita da Rarm' });
    expect(made.status).toBe(201);
    const { invite } = (await made.json()) as { invite: { id: string; link: string } };
    // pela porta local (o próprio computador) também
    expect((await fetch(`${h.localBase}/api/kaviski/humanos/invites`)).status).toBe(200);

    // a página do link abre sem login; link adulterado, não
    const pageRes = await fetch(`${h.base}${invite.link}`, { redirect: 'manual' });
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain('bia');
    expect(html).toContain('Visita da Rarm');
    expect((await fetch(`${h.base}${invite.link.slice(0, -3)}abc`, { redirect: 'manual' })).status).toBe(404);

    const v = await visit(h, invite.link, 'Carla <b>');
    expect(v.status).toBe(200);
    expect(v.cookie).toMatch(/^habblaud_remote=g1\./);
    expect(v.go).toBe(`/?sala=${encodeURIComponent('/proj/Clientes/12-Rarm')}`);
    const cookie = v.cookie!;
    const me = (await (await fetch(`${h.base}/api/kaviski/humanos/me`, { headers: { cookie } })).json()) as { person: KvPerson };
    expect(me.person).toMatchObject({ role: 'visitante', name: 'Carla <b>', rooms: ['/proj/Clientes/12-Rarm'] });
    expect(me.person.until).toBeGreaterThan(Date.now());

    const snap = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie } })).json()) as OfficeSnapshot;
    expect(snap.rooms.map((r) => r.path)).toEqual([RARM]);
    expect(snap.ptys).toBeUndefined();
    expect((await fetch(`${h.base}/api/agents/${encodeURIComponent('c:2')}`, { headers: { cookie } })).status).toBe(404);
    for (const path of ['/api/stats', '/api/sessions/recent', '/api/kaviski/humanos/users', '/api/kaviski/humanos/audit', '/api/kaviski/humanos/invites']) {
      expect((await fetch(`${h.base}${path}`, { headers: { cookie } })).status, path).toBe(403);
    }
    for (const [path, body] of [['/api/messages', { agentId: 'c:1', text: 'oi' }], ['/api/spawn', {}], ['/api/kaviski/humanos/summon', { agentId: 'c:1' }], ['/api/kaviski/humanos/invites', { ttl: '1h' }]] as const) {
      expect((await fetch(`${h.base}${path}`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify(body) })).status, path).toBe(403);
    }
    const access = await (await fetch(`${h.base}/api/access`, { headers: { cookie } })).json();
    expect(access).toMatchObject({ remote: true, permissions: false, messages: false, terminal: false, spawn: false });
    // o boneco do visitante é salvo (no convite, não no users.json)
    const look = { seed: 42, look: 'm', color: '#ff8800' };
    expect((await fetch(`${h.base}/api/kaviski/humanos/profile`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ look }) })).status).toBe(200);
    expect(((await (await fetch(`${h.base}/api/kaviski/humanos/profile`, { headers: { cookie } })).json()) as { look: unknown }).look).toEqual(look);

    // o registro guarda quem convidou e quem entrou
    const log = (await (await fetch(`${h.base}/api/kaviski/humanos/audit`, { headers: { cookie: admin } })).json()) as { entries: { who: { name: string; role: string }; action: string }[] };
    expect(log.entries.map((e) => `${e.who.role}:${e.action}`).slice(0, 2)).toEqual(['visitante:visitante entrou', 'equipe:convite criado']);

    // revogar derruba: a API responde 401 (ended) e a página explica
    const del = await fetch(`${h.base}/api/kaviski/humanos/invites/${invite.id}`, { method: 'DELETE', headers: { ...json, cookie: admin } });
    expect(del.status).toBe(200);
    const after = await fetch(`${h.base}/api/snapshot`, { headers: { cookie } });
    expect(after.status).toBe(401);
    expect(((await after.json()) as { ended?: boolean }).ended).toBe(true);
    const ended = await fetch(`${h.base}/`, { headers: { cookie }, redirect: 'manual' });
    expect(ended.status).toBe(401);
    expect(await ended.text()).toContain('VISITANTE');
    expect(ended.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    // a API não apaga o cookie (a página ainda vai explicar); /login também explica
    expect(after.headers.get('set-cookie')).toBeNull();
    const viaLogin = await fetch(`${h.base}/login`, { headers: { cookie }, redirect: 'manual' });
    expect(viaLogin.status).toBe(401);
    expect(await viaLogin.text()).toContain('VISITANTE');
    expect((await visit(h, invite.link, 'De novo')).status).toBe(410);
  });

  it('a presença do visitante cai quando o convite é revogado', async () => {
    const h = await start();
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    const { invite } = (await (await fetch(`${h.base}/api/kaviski/humanos/invites`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ ttl: '1h', maxUses: 5 }) })).json()) as { invite: { id: string; link: string } };
    const v = await visit(h, invite.link, 'Visita');
    const ac = new AbortController();
    const stream = await fetch(`${h.base}/api/kaviski/humanos/presence`, { headers: { cookie: v.cookie! }, signal: ac.signal });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    let text = '';
    while (!text.includes('event: people')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"role":"visitante"');
    await fetch(`${h.base}/api/kaviski/humanos/invites/${invite.id}`, { method: 'DELETE', headers: { ...json, cookie: admin } });
    // o fluxo termina (o servidor fecha)
    let done = false;
    while (!done) done = (await reader.read()).done;
    expect(done).toBe(true);
    ac.abort();
  });

  it('editar pela tela: só a equipe; estender reemite o cookie; salas novas chegam ao visitante; encurtar para o passado não', async () => {
    const h = await start();
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    const api = `${h.base}/api/kaviski/humanos`;
    const made = await fetch(`${api}/invites`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ ttl: '1h', maxUses: 2 }) });
    const { invite } = (await made.json()) as { invite: { id: string; link: string; expiresAt: number } };
    const v = await visit(h, invite.link, 'Visita');
    const cookie = v.cookie!;
    const patch = (body: unknown, c = admin) => fetch(`${api}/invites/${invite.id}`, { method: 'PATCH', headers: { ...json, cookie: c }, body: JSON.stringify(body) });
    expect((await patch({ extend: '1d' }, cookie)).status).toBe(403);
    // sala de reunião criada pelo admin: o visitante ainda não vê
    const sala = (await (await fetch(`${api}/rooms`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ kind: 'reuniao', name: 'Sala Azul' }) })).json()) as { room: { id: string } };
    const ownOf = async () => ((await (await fetch(`${api}/rooms`, { headers: { cookie } })).json()) as { rooms: { id: string }[] }).rooms.map((r) => r.id);
    expect(await ownOf()).toEqual([]);
    const snap0 = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie } })).json()) as OfficeSnapshot;
    expect(snap0.rooms).toEqual([]);

    const e = await patch({ extend: '1d', rooms: ['/proj/Clientes/12-Rarm'], meetings: true, voice: false });
    expect(e.status).toBe(200);
    const edited = ((await e.json()) as { invite: { expiresAt: number; access: { meetings: boolean } } }).invite;
    expect(edited.expiresAt).toBe(invite.expiresAt + 24 * H);
    // o mesmo cookie continua valendo e volta renovado (Max-Age até o fim novo)
    const me = await fetch(`${api}/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { person: KvPerson }).person).toMatchObject({ rooms: ['/proj/Clientes/12-Rarm'], until: edited.expiresAt, guest: { meetings: true, voice: false } });
    const set = me.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^habblaud_remote=g1\./);
    const maxAge = Number(/Max-Age=(\d+)/.exec(set)?.[1]);
    expect(maxAge).toBeGreaterThan(24 * 3600);
    const renewed = `habblaud_remote=${/habblaud_remote=([^;]+)/.exec(set)![1]}`;
    const again = await fetch(`${api}/me`, { headers: { cookie: renewed } });
    expect(again.status).toBe(200);
    expect(again.headers.get('set-cookie')).toBeNull();
    // salas novas: projeto e a sala de reunião (todas as de reunião)
    const snap = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie } })).json()) as OfficeSnapshot;
    expect(snap.rooms.map((r) => r.path)).toEqual([RARM]);
    expect(await ownOf()).toEqual([sala.room.id]);
    // tirar "todas as de reunião" e liberar só ela, uma a uma; depois nenhuma: some de novo (lista e planta)
    expect((await patch({ meetings: false, own: [sala.room.id] })).status).toBe(200);
    expect(await ownOf()).toEqual([sala.room.id]);
    expect((await patch({ own: [] })).status).toBe(200);
    expect(await ownOf()).toEqual([]);
    expect((await fetch(`${api}/livekit-token`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ area: `r:${sala.room.id}` }) })).status).not.toBe(200);
    // voz desligada no convite
    expect(((await (await fetch(`${api}/livekit`, { headers: { cookie } })).json()) as { enabled: boolean }).enabled).toBe(false);
    // a tela vê o visitante (online ou não) e o que dá para liberar
    const list = (await (await fetch(`${api}/invites`, { headers: { cookie: admin } })).json()) as { invites: { id: string; visitors: { name: string }[] }[]; own: { id: string; kind: string }[]; themes: unknown[] };
    expect(list.invites[0]!.visitors.map((x) => x.name)).toEqual(['Visita']);
    expect(list.own).toEqual([{ id: sala.room.id, name: 'Sala Azul', kind: 'reuniao' }]);
    expect((await patch({ expiresAt: Date.now() - 1000 })).status).toBe(400);
    // o registro guarda a edição
    const log = (await (await fetch(`${api}/audit`, { headers: { cookie: admin } })).json()) as { entries: { action: string }[] };
    expect(log.entries.map((x) => x.action)).toContain('convite editado');
  });

  it('sala temática bloqueada e chat desligado valem no servidor; a planta do visitante leva o lugar fechado; editar avisa a página', async () => {
    const h = await start();
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    const api = `${h.base}/api/kaviski/humanos`;
    const planBody = {
      v: 1, on: true, w: 80, h: 40, auto: { x: 60, y: 0, dir: 'e' },
      items: [
        { id: 'el-rec', kind: 'nucleo', ref: 'recepcao', x: 0, y: 0, w: 16, h: 12 },
        { id: 'el-cor', kind: 'corredor', x: 0, y: 12, w: 60, h: 4 },
        { id: 'el-rh', kind: 'tema', ref: 'rh', x: 16, y: 0, w: 12, h: 12, name: 'Pessoas' },
        { id: 'el-arq', kind: 'tema', ref: 'arquivo', x: 28, y: 0, w: 12, h: 12 },
      ],
    };
    expect((await fetch(`${api}/plan`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ plan: planBody, base: 0 }) })).status).toBe(200);
    const { invite } = (await (await fetch(`${api}/invites`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ ttl: '1h', blocked: ['rh'], chat: false }) })).json()) as { invite: { id: string; link: string } };
    const themes = ((await (await fetch(`${api}/invites`, { headers: { cookie: admin } })).json()) as { themes: { key: string }[] }).themes;
    expect(themes.map((t) => t.key)).toEqual(['rh', 'arquivo']);
    const cookie = (await visit(h, invite.link, 'Visita')).cookie!;
    const plan = ((await (await fetch(`${api}/plan`, { headers: { cookie } })).json()) as { plan: KvPlan }).plan;
    expect(plan.items.filter((i) => i.blocked).map((i) => [i.x, i.y])).toEqual([[16, 0]]);
    expect(JSON.stringify(plan)).not.toContain('Pessoas');
    expect(JSON.stringify(plan)).not.toContain('el-rh');

    const ac = new AbortController();
    const stream = await fetch(`${api}/presence`, { headers: { cookie }, signal: ac.signal });
    const reader = stream.body!.getReader();
    let text = '';
    while (!text.includes('event: people')) text += new TextDecoder().decode((await reader.read()).value);
    const at = (area: string) => fetch(`${api}/presence`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ pos: { k: 'a', x: 300, y: 100, d: 'down', m: 0 }, area }) });
    expect((await at('a:kv:el-rh')).status).toBe(400);
    expect((await at('a:kv:el-arq')).status).toBe(200);
    expect((await fetch(`${api}/chat`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ area: 'a:kv:el-arq', text: 'oi' }) })).status).toBe(403);

    // liberou o RH e bloqueou o arquivo: a página do visitante recebe `plan` (refilter) e a guarda troca na hora
    expect((await fetch(`${api}/invites/${invite.id}`, { method: 'PATCH', headers: { ...json, cookie: admin }, body: JSON.stringify({ blocked: ['arquivo'], chat: true }) })).status).toBe(200);
    while (!text.includes('"refilter":true')) text += new TextDecoder().decode((await reader.read()).value);
    expect((await at('a:kv:el-rh')).status).toBe(200);
    expect((await at('a:kv:el-arq')).status).toBe(400);
    const plan2 = ((await (await fetch(`${api}/plan`, { headers: { cookie } })).json()) as { plan: KvPlan }).plan;
    expect(plan2.items.filter((i) => i.blocked).map((i) => [i.x, i.y])).toEqual([[28, 0]]);
    ac.abort();
  });

  it('freio: link errado demais trava o endereço', async () => {
    const h = await start();
    const bad = `${h.base}/convite/AAAAAAAAAAAAAAAA.${'B'.repeat(43)}`;
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await fetch(bad, { redirect: 'manual' })).status);
    expect(codes.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(codes.at(-1)).toBe(429);
    const j = await fetch(`${h.base}/api/kaviski/humanos/invite/join`, { method: 'POST', headers: json, body: JSON.stringify({ token: 'x', name: 'y' }) });
    expect(j.status).toBe(429);
  });
});
