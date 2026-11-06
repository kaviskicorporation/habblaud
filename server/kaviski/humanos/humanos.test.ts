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
    expect((await fetch(`${h.base}/api/messages`, { method: 'POST', headers: { ...json, cookie: e }, body: JSON.stringify({ agentId: 'c:2', text: 'roda os testes' }) })).status).toBe(200);
    // fase 3: o registro guarda quem pediu o quê
    const log = (await (await fetch(`${h.base}/api/kaviski/humanos/audit`, { headers: { cookie: admin } })).json()) as { entries: { who: { name: string }; action: string; detail?: string; ok: boolean }[] };
    expect(log.entries[0]).toMatchObject({ who: { name: 'bia' }, action: 'mensagem', detail: 'roda os testes', ok: true });
    expect((await fetch(`${h.base}/api/kaviski/humanos/audit`, { headers: { cookie: e } })).status).toBe(403);
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
    expect(me).toMatchObject({ enabled: true, local: true, person: { user: 'kavisvi', role: 'admin' } });
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

import { KvPresence } from './presence';

describe('presença (quem vê quem)', () => {
  const person = (id: string, role: 'admin' | 'equipe' | 'cliente', rooms: string[] = []) => ({ id, user: id, name: id, role, rooms });
  const snap = () => snapshot();
  it('cliente vê a equipe e só os clientes das salas dele; posição em sala alheia não vai', () => {
    const pres = new KvPresence({ snapshot: snap, look: () => undefined });
    const fake = () => {
      const res = { writeHead() {}, write: () => true, on() {}, end() {}, destroyed: false, writableEnded: false };
      const req = { socket: { setTimeout() {}, setNoDelay() {} }, on() {} };
      return { req: req as unknown as http.IncomingMessage, res: res as unknown as http.ServerResponse };
    };
    const rarm = person('rarm', 'cliente', ['/proj/Clientes/12-Rarm']);
    const outro = person('outro', 'cliente', ['/proj/Clientes/99-Outro']);
    const bia = person('bia', 'equipe');
    for (const p of [rarm, outro, bia]) {
      const f = fake();
      pres.attach(f.req, f.res, p);
    }
    expect(pres.update(rarm, { pos: { k: 'r', r: 'r2', x: 1, y: 1, d: 'down', m: 0 } })).toBe('room');
    expect(pres.update(bia, { pos: { k: 'r', r: 'r2', x: 1, y: 1, d: 'down', m: 0 }, status: 'ocupado' })).toBeNull();
    const seenByRarm = pres.visibleTo(rarm, snapshot());
    expect(seenByRarm.map((p) => p.id).sort()).toEqual(['bia', 'rarm']);
    expect(seenByRarm.find((p) => p.id === 'bia')).toMatchObject({ status: 'ocupado' });
    expect(seenByRarm.find((p) => p.id === 'bia')!.pos).toBeUndefined();
    const seenByBia = pres.visibleTo(bia, snapshot());
    expect(seenByBia.map((p) => p.id).sort()).toEqual(['bia', 'outro', 'rarm']);
    expect(seenByBia.find((p) => p.id === 'bia')!.pos).toMatchObject({ r: 'r2' });
    expect(pres.update(rarm, { pos: { k: 'r', r: 'r1', x: 1, y: 1, d: 'down', m: 0 } })).toBeNull();
    pres.stop();
  });
});

import { createHmac } from 'node:crypto';
import { kvAreaAllowed, kvCallName, kvLiveKitConfig, kvLiveKitToken } from './livekit';

describe('voz e vídeo (LiveKit)', () => {
  const secret = 'x'.repeat(40);
  it('liga só com URL, chave e segredo válidos', () => {
    expect(kvLiveKitConfig({})).toEqual({});
    expect(kvLiveKitConfig({ HABBLAUD_LIVEKIT_URL: 'http://x', HABBLAUD_LIVEKIT_KEY: 'abc', HABBLAUD_LIVEKIT_SECRET: secret }).warning).toBe('HABBLAUD_LIVEKIT_URL');
    expect(kvLiveKitConfig({ HABBLAUD_LIVEKIT_URL: 'wss://lk.exemplo.com', HABBLAUD_LIVEKIT_KEY: 'abc', HABBLAUD_LIVEKIT_SECRET: 'curto' }).warning).toBe('HABBLAUD_LIVEKIT_SECRET');
    expect(kvLiveKitConfig({ HABBLAUD_LIVEKIT_URL: 'wss://lk.exemplo.com/', HABBLAUD_LIVEKIT_KEY: 'abc', HABBLAUD_LIVEKIT_SECRET: secret }).config?.url).toBe('wss://lk.exemplo.com');
  });
  it('cliente só entra nas chamadas das salas dele, das áreas comuns e do corredor', () => {
    const rarm = { id: 'r', user: 'r', name: 'R', role: 'cliente' as const, rooms: ['/proj/Clientes/12-Rarm'] };
    const bia = { id: 'b', user: 'b', name: 'B', role: 'equipe' as const, rooms: [] };
    expect(kvAreaAllowed('r:r1', rarm, snapshot())).toBe('Rarm');
    expect(kvAreaAllowed('r:r2', rarm, snapshot())).toBeUndefined();
    expect(kvAreaAllowed('r:r2', bia, snapshot())).toBe('Site');
    expect(kvAreaAllowed('a:core:copa', rarm, snapshot())).toBe('core:copa');
    expect(kvAreaAllowed('a:outra', rarm, snapshot())).toBeUndefined();
    expect(kvAreaAllowed('c', rarm, snapshot())).toBe('corredor');
    expect(kvCallName('r:r1')).toMatch(/^kv-[0-9a-f]{20}$/);
    expect(kvCallName('r:r1')).not.toContain('r1');
  });
  it('token JWT HS256 com a sala e a pessoa', () => {
    const t = kvLiveKitToken({ url: 'ws://x', key: 'chave', secret }, { id: 'p1', name: 'Ana' }, 'kv-sala', 1000);
    const [h, p, s] = t.split('.');
    expect(createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')).toBe(s);
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toMatchObject({ iss: 'chave', sub: 'p1', name: 'Ana', video: { room: 'kv-sala', roomJoin: true, canPublish: true, canSubscribe: true } });
    expect(payload.exp - payload.nbf).toBeGreaterThan(3600);
  });
});

import { KvLoginLimiter } from './gate';

describe('freio de login por endereço e por usuário', () => {
  it('quem erra muito trava a si mesmo, não os outros', () => {
    let t = 1_000_000;
    const lim = new KvLoginLimiter(() => t);
    for (let i = 0; i < 5; i++) lim.begin('1.1.1.1', 'ana')!(false);
    expect(lim.begin('1.1.1.1', 'ana')).toBeNull();
    // outro usuário em outro endereço: entra normal
    const other = lim.begin('2.2.2.2', 'bia');
    expect(other).not.toBeNull();
    other!(true);
    // o mesmo endereço tentando outro usuário também espera (chave do endereço)
    expect(lim.begin('1.1.1.1', 'bia')).toBeNull();
    // e outro endereço tentando a ana também (chave do usuário)
    expect(lim.begin('3.3.3.3', 'ana')).toBeNull();
    t += 2_000;
    const again = lim.begin('1.1.1.1', 'ana');
    expect(again).not.toBeNull();
    again!(true);
    expect(lim.retryAfter('1.1.1.1', 'ana')).toBe(0);
  });
});

import { KvChat } from './chat';

describe('conversa (fase 2)', () => {
  const person = (id: string, role: 'admin' | 'equipe' | 'cliente', rooms: string[] = []) => ({ id, user: id, name: id, role, rooms });
  function setup() {
    const pres = new KvPresence({ snapshot, look: () => undefined });
    const got = new Map<string, string[]>();
    const join = (p: ReturnType<typeof person>) => {
      got.set(p.id, []);
      const res = { writeHead() {}, write: (c: string) => (got.get(p.id)!.push(c), true), on() {}, end() {}, destroyed: false, writableEnded: false };
      const req = { socket: { setTimeout() {}, setNoDelay() {} }, on() {} };
      pres.attach(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse, p);
    };
    const chats = (id: string) => got.get(id)!.filter((c) => c.startsWith('event: chat')).map((c) => JSON.parse(c.split('data: ')[1]));
    return { pres, join, chats };
  }
  it('fala só chega a quem está na mesma área; sala guarda histórico; cliente não lê sala alheia', () => {
    const { pres, join, chats } = setup();
    let t = 1_000_000;
    const chat = new KvChat(pres, snapshot, null, () => t);
    const rarm = person('rarm', 'cliente', ['/proj/Clientes/12-Rarm']);
    const bia = person('bia', 'equipe');
    const caio = person('caio', 'equipe');
    for (const p of [rarm, bia, caio]) join(p);
    const at = (p: ReturnType<typeof person>, area: string) => pres.update(p, { pos: { k: 'a', x: 1, y: 1, d: 'down', m: 0 }, area });
    expect(chat.post(bia, { text: 'oi' })).toMatchObject({ ok: false, status: 409 });
    expect(at(rarm, 'r:r2')).toBe('area');
    at(rarm, 'r:r1');
    at(bia, 'r:r1');
    at(caio, 'r:r2');
    expect(chat.post(bia, { text: '  olá\u0007 Rarm  ' })).toMatchObject({ ok: true, message: { text: 'olá Rarm', area: 'r:r1' } });
    expect(chats('rarm').map((m) => m.text)).toEqual(['olá Rarm']);
    expect(chats('caio')).toEqual([]);
    t += 1000;
    expect(chat.post(bia, { greet: 'hello', to: 'rarm' })).toMatchObject({ ok: true, message: { greet: 'hello', to: { id: 'rarm' } } });
    t += 1000;
    expect(chat.post(bia, { greet: 'nao-existe' })).toMatchObject({ ok: false, status: 400 });
    expect(chat.list(rarm, 'r:r1')!.map((m) => m.text)).toEqual(['olá Rarm']);
    expect(chat.list(rarm, 'r:r2')).toBeUndefined();
    expect(chat.list(caio, 'r:r1')).toHaveLength(1);
    // limite: falar rápido demais
    expect(chat.post(bia, { text: 'primeira' })).toMatchObject({ ok: true });
    t += 100;
    expect(chat.post(bia, { text: 'de novo' })).toMatchObject({ ok: false, status: 429 });
    pres.stop();
  });
});

import { kvSetPerson } from './request';

describe('cliente que pode pedir tarefas (fase 3)', () => {
  it('só mensagens, e só se o admin liberou', () => {
    const req = {} as http.IncomingMessage;
    kvSetPerson(req, { id: 'r', user: 'r', name: 'R', role: 'cliente', rooms: [], request: true });
    expect(kvRemoteAllows(true, req, 'messages')).toBe(true);
    expect(kvRemoteAllows(true, req, 'terminal')).toBe(false);
    expect(kvRemoteAllows(true, req, 'permissions')).toBe(false);
    expect(kvRemoteAllows(false, req, 'messages')).toBe(false);
    const req2 = {} as http.IncomingMessage;
    kvSetPerson(req2, { id: 'r2', user: 'r2', name: 'R2', role: 'cliente', rooms: [] });
    expect(kvRemoteAllows(true, req2, 'messages')).toBe(false);
  });
  it('a flag só vale para cliente e é salva na conta', async () => {
    const tmp = tempDir();
    const users = new KvUsers(join(tmp.dir, 'u.json'), 'admin', Date.now, (p) => hashPassword(p, 10));
    const r = await users.create({ user: 'cli', role: 'cliente', rooms: ['/a'], password: '12345678', request: true });
    expect(r.ok && r.person.request).toBe(true);
    const e = await users.create({ user: 'eq', role: 'equipe', password: '12345678', request: true });
    expect(e.ok && e.person.request).toBeUndefined();
    const off = await users.update((r as { person: { id: string } }).person.id, { request: false });
    expect(off.ok && off.person.request).toBeUndefined();
    tmp.cleanup();
  });
});

import { KvDirect, kvCanTalk } from './direct';

describe('conversa 1:1 (estilo Teams)', () => {
  const P = (id: string, role: 'admin' | 'equipe' | 'cliente', rooms: string[] = []) => ({ id, user: id, name: id.toUpperCase(), role, rooms });
  const rarm = P('rarm', 'cliente', ['/proj/Clientes/12-Rarm']);
  const rarm2 = P('rarm2', 'cliente', ['/proj/Clientes/12-Rarm/01.App']);
  const outro = P('outro', 'cliente', ['/proj/Clientes/99-Outro']);
  const bia = P('bia', 'equipe');
  it('cliente fala com a equipe e com a mesma empresa; nunca com outro cliente', () => {
    expect(kvCanTalk(rarm, bia)).toBe(true);
    expect(kvCanTalk(rarm, rarm2)).toBe(true);
    expect(kvCanTalk(rarm, outro)).toBe(false);
    expect(kvCanTalk(bia, outro)).toBe(true);
    expect(kvCanTalk(bia, bia)).toBe(false);
  });
  it('manda, entrega às duas pessoas, guarda, conta não lidas e marca lido', () => {
    const sent: { to: string[]; data: { text: string } }[] = [];
    const all = [rarm, rarm2, outro, bia];
    let t = 1_000_000;
    const dm = new KvDirect({
      people: () => all,
      online: () => new Map([['bia', 'ocupado' as const]]),
      look: () => undefined,
      emit: (_e, data, to) => sent.push({ to: all.filter((p) => to(p)).map((p) => p.id), data: data as { text: string } }),
      file: null,
      now: () => t,
    });
    expect(dm.send(rarm, { to: 'outro', text: 'oi' })).toMatchObject({ ok: false, status: 404 });
    expect(dm.send(rarm, { to: 'bia', text: '  ' })).toMatchObject({ ok: false, status: 400 });
    expect(dm.send(rarm, { to: 'bia', text: 'Pode olhar o deploy?', urgent: true })).toMatchObject({ ok: true, message: { urgent: true, to: { id: 'bia' } } });
    expect(sent[0]!.to.sort()).toEqual(['bia', 'rarm']);
    t += 1000;
    const c = dm.contacts(bia).find((x) => x.id === 'rarm')!;
    expect(c).toMatchObject({ unread: 1, last: { text: 'Pode olhar o deploy?', mine: false } });
    expect(dm.contacts(rarm).map((x) => x.id)).not.toContain('outro');
    expect(dm.contacts(rarm).find((x) => x.id === 'bia')).toMatchObject({ online: true, status: 'ocupado', unread: 0 });
    expect(dm.history(bia, 'rarm')!.map((m) => m.text)).toEqual(['Pode olhar o deploy?']);
    expect(dm.history(outro, 'rarm')).toBeUndefined();
    dm.read(bia, 'rarm');
    expect(dm.contacts(bia).find((x) => x.id === 'rarm')!.unread).toBe(0);
  });
});
