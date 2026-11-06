// Fork Kaviski (KAVISKI-HUMANOS.md): convites por link e visitantes (fase 4).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../../log';
import { tempDir } from '../../test/fixtures';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import type { OfficeSnapshot } from '../../../shared/types';
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
