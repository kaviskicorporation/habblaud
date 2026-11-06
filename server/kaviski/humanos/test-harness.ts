// Fork Kaviski (KAVISKI-HUMANOS.md): porta local + remota como no server/index.ts, com HABBLAUD_HUMANOS=1 e dois agentes
// em duas salas (testes dos convites e da agenda).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AccountsService } from '../../accounts/service';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { tempDir } from '../../test/fixtures';
import { createApiHandler, sendJson } from '../../http/app';
import { createRequestGuard, isLoopbackHost } from '../../http/guard';
import { COOKIE, createRemoteGate, isRemoteRequest, RemoteSessions, type RemoteConfig, type RemoteFeature } from '../../http/remote';
import { Hub } from '../../http/sse';
import { hashPassword, parsePasswordHash } from '../../remote/password';
import { SpawnService } from '../../spawn/spawn';
import { createHumanos, type KvHumanosDeps } from '.';
import { kvRemoteAllows } from './request';

const SECRET_HASH = await hashPassword('senha-do-admin', 10);
const CFG: RemoteConfig = {
  port: 0,
  host: '127.0.0.1',
  user: 'kavisvi',
  passwordHash: parsePasswordHash(SECRET_HASH)!,
  passwordHashText: SECRET_HASH,
  allow: new Set<RemoteFeature>(['permissions', 'messages', 'terminal', 'spawn']),
};
export const RARM = '/proj/Clientes/12-Rarm/01.App';
export const INTERNO = '/proj/Interno/Sites/01.Site';


export interface Harness {
  base: string;
  localBase: string;
  dataDir: string;
  close(): Promise<void>;
}

const closers: (() => Promise<void>)[] = [];
export async function closeAll(): Promise<void> {
  while (closers.length) await closers.pop()!();
}

export async function start(extra: Partial<KvHumanosDeps> = {}): Promise<Harness> {
  const env = { HABBLAUD_HUMANOS: '1', HABBLAUD_REMOTE_USER: 'kavisvi' };
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
  const humanos = createHumanos({ dataDir, snapshot: () => hub.current(), env, ...extra });
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
    remote: { is: isRemoteRequest, allows: (f, req) => kvRemoteAllows(CFG.allow.has(f), req, f) },
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
    humanos.presence.stop();
    local.closeAllConnections();
    remote.closeAllConnections();
    await new Promise<void>((ok) => local.close(() => ok()));
    await new Promise<void>((ok) => remote.close(() => ok()));
    tmp.cleanup();
  };
  closers.push(close);
  return { base: `http://127.0.0.1:${(remote.address() as AddressInfo).port}`, localBase: `http://127.0.0.1:${(local.address() as AddressInfo).port}`, dataDir, close };
}

export const json = { 'Content-Type': 'application/json' };

export async function login(h: Harness, user: string, password: string): Promise<string> {
  const r = await fetch(`${h.base}/api/remote/login`, { method: 'POST', headers: json, body: JSON.stringify({ user, password }) });
  const m = new RegExp(`${COOKIE}=([^;]+)`).exec(r.headers.get('set-cookie') ?? '');
  if (!r.ok || !m) throw new Error(`login ${user}: ${r.status}`);
  return `${COOKIE}=${m[1]}`;
}

export async function visit(h: Harness, link: string, name: string): Promise<{ status: number; cookie?: string; go?: string }> {
  const token = link.slice('/convite/'.length);
  const r = await fetch(`${h.base}/api/kaviski/humanos/invite/join`, { method: 'POST', headers: json, body: JSON.stringify({ token, name }) });
  const m = new RegExp(`${COOKIE}=([^;]+)`).exec(r.headers.get('set-cookie') ?? '');
  const body = (await r.json().catch(() => ({}))) as { go?: string };
  return { status: r.status, ...(m ? { cookie: `${COOKIE}=${m[1]}` } : {}), go: body.go };
}

