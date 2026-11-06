// Fork Kaviski (KAVISKI-HUMANOS.md): contas por pessoa, papéis e filtro de salas no servidor.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../../accounts/service';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { tempDir } from '../../test/fixtures';
import { createApiHandler, sendJson } from '../../http/app';
import { createRequestGuard, isLoopbackHost } from '../../http/guard';
import { COOKIE, createRemoteGate, isRemoteRequest, RemoteSessions, type RemoteConfig, type RemoteFeature } from '../../http/remote';
import { Hub } from '../../http/sse';
import { hashPassword, parsePasswordHash } from '../../remote/password';
import { SpawnService } from '../../spawn/spawn';
import { kvFilterSnapshot, kvRoomAllowed, kvRoomRules, kvUserName } from '../../../shared/kaviski-humanos';
import type { OfficeSnapshot } from '../../../shared/types';
import { createHumanos } from '.';
import { kvRemoteAllows } from './request';
import { kvFilterChunk } from './stream-filter';
import { KvUsers } from './users';

setQuiet(true);

const SECRET_HASH = await hashPassword('senha-do-admin', 10);
const CFG: RemoteConfig = {
  port: 0,
  host: '127.0.0.1',
  user: 'kavisvi',
  passwordHash: parsePasswordHash(SECRET_HASH)!,
  passwordHashText: SECRET_HASH,
  allow: new Set<RemoteFeature>(['permissions', 'messages', 'terminal', 'spawn']),
};
const RARM = '/proj/Clientes/12-Rarm/01.App';
const INTERNO = '/proj/Interno/Sites/01.Site';

describe('regras de sala', () => {
  it('vale para a pasta e o que está dentro, sem diferença de maiúsculas nem barra final', () => {
    expect(kvRoomAllowed(RARM, ['/proj/Clientes/12-Rarm'])).toBe(true);
    expect(kvRoomAllowed(RARM, ['/proj/clientes/12-rarm/'])).toBe(true);
    expect(kvRoomAllowed(RARM, [RARM])).toBe(true);
    expect(kvRoomAllowed('/proj/Clientes/12-Rarm2/x', ['/proj/Clientes/12-Rarm'])).toBe(false);
    expect(kvRoomAllowed(INTERNO, ['/proj/Clientes/12-Rarm'])).toBe(false);
    expect(kvRoomAllowed(RARM, [])).toBe(false);
  });
  it('limpa a lista e recusa caminho relativo', () => {
    expect(kvRoomRules([' /a/b/ ', '/a/b', '', '/c//d'])).toEqual(['/a/b', '/c/d']);
    expect(kvRoomRules(['a/b'])).toBeUndefined();
    expect(kvRoomRules('x')).toBeUndefined();
  });
  it('usuário: minúsculo e só caracteres seguros', () => {
    expect(kvUserName(' Ana.Rarm ')).toBe('ana.rarm');
    expect(kvUserName('a')).toBeUndefined();
    expect(kvUserName('ana rarm')).toBeUndefined();
  });
});

function snapshot(): OfficeSnapshot {
  return {
    rev: 1,
    serverTime: 0,
    rooms: [
      { id: 'r1', name: 'Rarm', path: RARM, slot: 0, seed: 1, createdAt: 0 },
      { id: 'r2', name: 'Site', path: INTERNO, slot: 1, seed: 2, createdAt: 0 },
    ],
    agents: [{ id: 'a1', roomId: 'r1' }, { id: 'a2', roomId: 'r2' }] as OfficeSnapshot['agents'],
    ptys: [{ id: 'p' }] as unknown as OfficeSnapshot['ptys'],
    accounts: [{ id: 'claude' }] as OfficeSnapshot['accounts'],
    meta: { demo: false, sources: [], startedAt: 0, version: '1', world: { enabled: true } as never },
  };
}

describe('filtro do snapshot e do fluxo', () => {
  it('cliente recebe só as salas dele, sem terminais, contas nem World', () => {
    const out = kvFilterSnapshot(snapshot(), ['/proj/Clientes/12-Rarm']);
    expect(out.rooms.map((r) => r.id)).toEqual(['r1']);
    expect(out.agents.map((a) => a.id)).toEqual(['a1']);
    expect(out.ptys).toBeUndefined();
    expect(out.accounts).toEqual([]);
    expect(out.meta.world).toBeUndefined();
  });
  it('reescreve os eventos do SSE', () => {
    const rules = ['/proj/Clientes/12-Rarm'];
    const snap = kvFilterChunk(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`, rules, new Set());
    expect(JSON.parse(snap.out.split('\ndata: ')[1]).rooms).toHaveLength(1);
    const feed = kvFilterChunk(`event: feed\ndata: ${JSON.stringify([{ roomId: 'r1' }, { roomId: 'r2' }])}\n\n`, rules, snap.ids);
    expect(JSON.parse(feed.out.split('\ndata: ')[1])).toEqual([{ roomId: 'r1' }]);
    expect(kvFilterChunk(`event: notice\ndata: ${JSON.stringify({ roomId: 'r2' })}\n\n`, rules, snap.ids).out).toBe('');
    expect(kvFilterChunk(`event: notice\ndata: ${JSON.stringify({ text: 'geral' })}\n\n`, rules, snap.ids).out).toBe('');
    expect(kvFilterChunk(': ping\n\n', rules, snap.ids).out).toBe(': ping\n\n');
    expect(kvFilterChunk(`event: outro\ndata: {}\n\n`, rules, snap.ids).out).toBe('');
  });
});

describe('KvUsers', () => {
  it('cria, valida, guarda com permissão 600 e relê', async () => {
    const tmp = tempDir();
    const file = join(tmp.dir, 'kaviski', 'users.json');
    const users = new KvUsers(file, 'kavisvi', Date.now, (p) => hashPassword(p, 10));
    expect((await users.create({ user: 'kavisvi', role: 'admin', password: '12345678' })).ok).toBe(false);
    expect((await users.create({ user: 'ana', role: 'chefe', password: '12345678' })).ok).toBe(false);
    expect((await users.create({ user: 'ana', role: 'cliente', password: '123' })).ok).toBe(false);
    const r = await users.create({ user: 'Ana', name: 'Ana Rarm', role: 'cliente', rooms: ['/proj/Clientes/12-Rarm'], password: '12345678' });
    expect(r.ok && r.person).toMatchObject({ user: 'ana', name: 'Ana Rarm', role: 'cliente', rooms: ['/proj/Clientes/12-Rarm'] });
    expect((await users.create({ user: 'ana', role: 'equipe', password: '12345678' })).ok).toBe(false);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toContain('12345678');
    const again = new KvUsers(file, 'kavisvi');
    again.load();
    expect(again.byUser('ANA')?.name).toBe('Ana Rarm');
    tmp.cleanup();
  });
});

interface Harness {
  base: string;
  localBase: string;
  dataDir: string;
  close(): Promise<void>;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** Porta local + remota como no server/index.ts, com HABBLAUD_HUMANOS=1 e dois agentes em duas salas. */
async function start(env: NodeJS.ProcessEnv = { HABBLAUD_HUMANOS: '1', HABBLAUD_REMOTE_USER: 'kavisvi' }): Promise<Harness> {
  const tmp = tempDir();
  const dir = join(tmp.dir, '.claude');
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => {} });
  const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
  for (const [id, cwd] of [['c:1', RARM], ['c:2', INTERNO]]) {
    office.addMain({ id, account: 'claude', sessionId: `s-${id}`, cwd, role: 'dev', startedAt: Date.now(), status: 'working' });
  }
  const hub = new Hub(office, { throttleMs: 10, canAnswer: (req) => (isRemoteRequest(req) ? kvRemoteAllows(true, req) : isLoopbackHost(req.headers.host)) });
  hub.start();
  const dataDir = join(tmp.dir, 'data');
  const humanos = createHumanos({ dataDir, snapshot: () => hub.current(), env });
  const api = createApiHandler({
    office,
    hub,
    accounts,
    sources: () => [],
    version: '9.9.9',
    inDocker: true,
    terminal: true,
    spawn: new SpawnService(),
    messages: (req, res) => {
      req.resume();
      sendJson(res, 200, { ok: true });
    },
    remote: { is: isRemoteRequest, allows: (f, req) => kvRemoteAllows(CFG.allow.has(f), req) },
  });
  const guard = createRequestGuard();
  const sessions = new RemoteSessions(Buffer.alloc(32, 3), CFG);
  const gate = humanos.gate(createRemoteGate({ config: CFG, sessions, secure: false }), sessions, CFG);
  const page = (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html>');
  };
  const local = http.createServer((req, res) => {
    if (guard(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://x');
    if (humanos.before(req, res, url)) return;
    if (!api(req, res, url)) page(req, res);
  });
  const remote = http.createServer((req, res) => {
    if (guard(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://x');
    if (gate(req, res, url)) return;
    if (humanos.before(req, res, url)) return;
    if (!api(req, res, url)) page(req, res);
  });
  await new Promise<void>((ok) => local.listen(0, '127.0.0.1', ok));
  await new Promise<void>((ok) => remote.listen(0, '127.0.0.1', ok));
  const close = async () => {
    hub.stop();
    local.closeAllConnections();
    remote.closeAllConnections();
    await new Promise<void>((ok) => local.close(() => ok()));
    await new Promise<void>((ok) => remote.close(() => ok()));
    tmp.cleanup();
  };
  closers.push(close);
  return { base: `http://127.0.0.1:${(remote.address() as AddressInfo).port}`, localBase: `http://127.0.0.1:${(local.address() as AddressInfo).port}`, dataDir, close };
}

async function login(h: Harness, user: string, password: string): Promise<string | undefined> {
  const r = await fetch(`${h.base}/api/remote/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, password }) });
  const set = r.headers.get('set-cookie') ?? '';
  const m = new RegExp(`${COOKIE}=([^;]+)`).exec(set);
  return r.ok && m ? `${COOKIE}=${m[1]}` : undefined;
}

const json = { 'Content-Type': 'application/json' };

describe('porta remota com HABBLAUD_HUMANOS=1', () => {
  it('a conta do .env entra como admin e cria um cliente pela tela de Pessoas', async () => {
    const h = await start();
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    expect(admin).toMatch(/^habblaud_remote=v1\./);
    const me = await (await fetch(`${h.base}/api/kaviski/humanos/me`, { headers: { cookie: admin! } })).json();
    expect(me.person).toMatchObject({ user: 'kavisvi', role: 'admin', builtin: true });
    const created = await fetch(`${h.base}/api/kaviski/humanos/users`, {
      method: 'POST',
      headers: { ...json, cookie: admin! },
      body: JSON.stringify({ user: 'rarm', name: 'Rarm', role: 'cliente', rooms: ['/proj/Clientes/12-Rarm'], password: 'senha-da-rarm' }),
    });
    expect(created.status).toBe(201);
    const list = await (await fetch(`${h.base}/api/kaviski/humanos/users`, { headers: { cookie: admin! } })).json();
    expect(list.people.map((p: { user: string }) => p.user)).toEqual(['kavisvi', 'rarm']);
    expect(list.rooms.map((r: { path: string }) => r.path).sort()).toEqual([RARM, INTERNO].sort());
    expect(existsSync(join(h.dataDir, 'kaviski', 'users.json'))).toBe(true);
  });

  it('cliente: só as salas dele no snapshot e no fluxo, e nenhuma ação', async () => {
    const h = await start();
    const admin = (await login(h, 'kavisvi', 'senha-do-admin'))!;
    await fetch(`${h.base}/api/kaviski/humanos/users`, {
      method: 'POST',
      headers: { ...json, cookie: admin },
      body: JSON.stringify({ user: 'rarm', role: 'cliente', rooms: ['/proj/Clientes/12-Rarm'], password: 'senha-da-rarm' }),
    });
    expect(await login(h, 'rarm', 'errada!!')).toBeUndefined();
    const c = (await login(h, 'rarm', 'senha-da-rarm'))!;
    expect(c).toMatch(/^habblaud_remote=h1\./);
    const snap = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie: c } })).json()) as OfficeSnapshot;
    expect(snap.rooms.map((r) => r.path)).toEqual([RARM]);
    expect(snap.agents.map((a) => a.id)).toEqual(['c:1']);
    const full = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie: admin } })).json()) as OfficeSnapshot;
    expect(full.rooms).toHaveLength(2);

    expect((await fetch(`${h.base}/api/agents/${encodeURIComponent('c:1')}`, { headers: { cookie: c } })).status).toBe(200);
    expect((await fetch(`${h.base}/api/agents/${encodeURIComponent('c:2')}`, { headers: { cookie: c } })).status).toBe(404);
    for (const path of ['/api/stats', '/api/timeline/days', '/api/sessions/recent', '/api/deliveries', '/api/health', '/api/mod/summary', '/api/kaviski/humanos/users']) {
      expect((await fetch(`${h.base}${path}`, { headers: { cookie: c } })).status, path).toBe(403);
    }
    const msg = await fetch(`${h.base}/api/messages`, { method: 'POST', headers: { ...json, cookie: c }, body: '{}' });
    expect(msg.status).toBe(403);
    const access = await (await fetch(`${h.base}/api/access`, { headers: { cookie: c } })).json();
    expect(access).toMatchObject({ remote: true, permissions: false, messages: false, terminal: false, spawn: false });
    expect(access.kvRemotePty).toBeUndefined();
    const adminAccess = await (await fetch(`${h.base}/api/access`, { headers: { cookie: admin } })).json();
    expect(adminAccess).toMatchObject({ messages: true, spawn: true });

    // Fluxo SSE: o primeiro snapshot já vem filtrado.
    const ac = new AbortController();
    const stream = await fetch(`${h.base}/api/stream`, { headers: { cookie: c }, signal: ac.signal });
    const reader = stream.body!.getReader();
    let text = '';
    while (!/event: snapshot\ndata: [^\n]*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    ac.abort();
    const data = JSON.parse(text.split('event: snapshot\ndata: ')[1].split('\n\n')[0]) as OfficeSnapshot;
    expect(data.rooms.map((r) => r.path)).toEqual([RARM]);
    expect(text).not.toContain(INTERNO);
  });

  it('equipe vê tudo e age, mas não cuida das pessoas; trocar a senha derruba a sessão', async () => {
    const h = await start();
    const admin = (await login(h, 'kavisvi', 'senha-do-admin'))!;
    const r = await (
      await fetch(`${h.base}/api/kaviski/humanos/users`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ user: 'bia', role: 'equipe', password: 'senha-da-bia' }) })
    ).json();
    const e = (await login(h, 'bia', 'senha-da-bia'))!;
    const snap = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie: e } })).json()) as OfficeSnapshot;
    expect(snap.rooms).toHaveLength(2);
    expect((await fetch(`${h.base}/api/messages`, { method: 'POST', headers: { ...json, cookie: e }, body: '{}' })).status).toBe(200);
    expect((await fetch(`${h.base}/api/kaviski/humanos/users`, { headers: { cookie: e } })).status).toBe(403);
    await fetch(`${h.base}/api/kaviski/humanos/users/${r.person.id}`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ password: 'outra-senha' }) });
    expect((await fetch(`${h.base}/api/snapshot`, { headers: { cookie: e } })).status).toBe(401);
    // Apagada, não entra mais.
    await fetch(`${h.base}/api/kaviski/humanos/users/${r.person.id}`, { method: 'DELETE', headers: { ...json, cookie: admin } });
    expect(await login(h, 'bia', 'outra-senha')).toBeUndefined();
  });

  it('pela porta local (o próprio computador) a tela de Pessoas funciona sem login', async () => {
    const h = await start();
    const me = await (await fetch(`${h.localBase}/api/kaviski/humanos/me`)).json();
    expect(me).toEqual({ enabled: true, local: true });
    expect((await fetch(`${h.localBase}/api/kaviski/humanos/users`)).status).toBe(200);
  });

  it('sem HABBLAUD_HUMANOS: rotas próprias não existem e o login segue o original', async () => {
    const h = await start({ HABBLAUD_REMOTE_USER: 'kavisvi' });
    const admin = (await login(h, 'kavisvi', 'senha-do-admin'))!;
    expect((await fetch(`${h.base}/api/kaviski/humanos/me`, { headers: { cookie: admin } })).status).toBe(404);
    const snap = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie: admin } })).json()) as OfficeSnapshot;
    expect(snap.rooms).toHaveLength(2);
  });
});
