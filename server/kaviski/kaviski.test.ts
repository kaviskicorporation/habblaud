// Fork Kaviski (KAVISKI.md): frame-ancestors, rota de estilo das salas e login com ?sala=.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../shared/types';
import type { KvRoomInfo, KvSnapshotMeta } from '../../shared/kaviski';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { createApiHandler } from '../http/app';
import { createRemoteGate, RemoteSessions } from '../http/remote';
import { Hub } from '../http/sse';
import { createStaticHandler } from '../http/static';
import { hashPassword, parsePasswordHash } from '../remote/password';
import { frameAncestorsDirective, kvFrameHeaders, parseFrameAncestors } from './frame';
import { createKaviski } from './index';
import { kvKeepRoomQuery, kvSameSite } from './remote';
import { parseRoomStyles, RoomStyles } from './room-styles';

setQuiet(true);

const ORIGINS = 'http://192.168.1.220:3500 http://localhost:3500';

describe('frame-ancestors (HABBLAUD_FRAME_ANCESTORS)', () => {
  it('aceita só origens http(s) e ignora o resto', () => {
    const bad: string[] = [];
    expect(parseFrameAncestors(`${ORIGINS} javascript:alert(1) http://x.com/caminho https://[::1]:3500/ *`, (b) => bad.push(b))).toEqual([
      'http://192.168.1.220:3500',
      'http://localhost:3500',
      'https://[::1]:3500',
    ]);
    expect(bad).toEqual(['javascript:alert(1)', 'http://x.com/caminho', '*']);
    expect(parseFrameAncestors(undefined)).toEqual([]);
  });

  it('sem a variável os cabeçalhos ficam intactos', () => {
    const h = { 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' };
    expect(kvFrameHeaders(h, {})).toBe(h);
    expect(kvFrameHeaders(h, { HABBLAUD_FRAME_ANCESTORS: '  ' })).toBe(h);
    expect(frameAncestorsDirective({ HABBLAUD_FRAME_ANCESTORS: 'lixo' })).toBeUndefined();
  });

  it('com a variável troca X-Frame-Options por frame-ancestors (e soma a uma CSP existente)', () => {
    const env = { HABBLAUD_FRAME_ANCESTORS: ORIGINS };
    const out = kvFrameHeaders({ 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' }, env);
    expect(out).toEqual({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "frame-ancestors 'self' http://192.168.1.220:3500 http://localhost:3500" });
    const sandboxed = kvFrameHeaders({ 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "sandbox; default-src 'none'" }, env);
    expect(sandboxed['Content-Security-Policy']).toBe("sandbox; default-src 'none'; frame-ancestors 'self' http://192.168.1.220:3500 http://localhost:3500");
    expect('X-Frame-Options' in sandboxed).toBe(false);
  });

  it('a página (static.ts) e a tela de login (remote.ts) seguem a variável', async () => {
    const tmp = tempDir();
    const dist = join(tmp.dir, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Habblaud</title>');
    const serveStatic = createStaticHandler(dist);
    const hash = await hashPassword('senha boa demais', 10);
    const cfg = { user: 'ana', passwordHash: parsePasswordHash(hash)!, passwordHashText: hash };
    const gate = createRemoteGate({ config: cfg, sessions: new RemoteSessions(Buffer.alloc(32, 7), cfg), secure: false });
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/login' || url.pathname === '/r') {
        if (!gate(req, res, url)) res.end();
      } else serveStatic(req, res, url.pathname);
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const prev = process.env.HABBLAUD_FRAME_ANCESTORS;
    try {
      delete process.env.HABBLAUD_FRAME_ANCESTORS;
      let r = await fetch(`${base}/`);
      expect(r.headers.get('x-frame-options')).toBe('DENY');
      expect(r.headers.get('content-security-policy')).toBeNull();
      r = await fetch(`${base}/login`);
      expect(r.headers.get('x-frame-options')).toBe('DENY');

      process.env.HABBLAUD_FRAME_ANCESTORS = ORIGINS;
      for (const path of ['/', '/login']) {
        r = await fetch(`${base}${path}`);
        expect(r.headers.get('x-frame-options'), path).toBeNull();
        expect(r.headers.get('content-security-policy'), path).toBe("frame-ancestors 'self' http://192.168.1.220:3500 http://localhost:3500");
      }
      // a tela de login volta para / com o ?sala= de onde veio
      expect(await r.text()).toContain("location.replace('/' + location.search)");
      r = await fetch(`${base}/r?sala=%2Fhome%2Fx%2F01.Site&outro=1`, { redirect: 'manual' });
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe('/login?sala=%2Fhome%2Fx%2F01.Site');
    } finally {
      if (prev === undefined) delete process.env.HABBLAUD_FRAME_ANCESTORS;
      else process.env.HABBLAUD_FRAME_ANCESTORS = prev;
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
      tmp.cleanup();
    }
  });
});

describe('kvSameSite', () => {
  it('Strict no original; None + Partitioned só com HTTPS e HABBLAUD_FRAME_ANCESTORS', () => {
    expect(kvSameSite(true, {})).toBe('SameSite=Strict');
    expect(kvSameSite(false, { HABBLAUD_FRAME_ANCESTORS: ORIGINS })).toBe('SameSite=Strict');
    expect(kvSameSite(true, { HABBLAUD_FRAME_ANCESTORS: ORIGINS })).toBe('SameSite=None; Partitioned');
  });
});

describe('kvKeepRoomQuery', () => {
  it('leva só ?sala= ou ?room= adiante', () => {
    expect(kvKeepRoomQuery('/login', '/')).toBe('/login');
    expect(kvKeepRoomQuery('/login', '/?x=1')).toBe('/login');
    expect(kvKeepRoomQuery('/login', '/?room=/a b')).toBe('/login?room=%2Fa%20b');
    expect(kvKeepRoomQuery('/', '/login?sala=%2Fp%2Floja')).toBe('/?sala=%2Fp%2Floja');
    expect(kvKeepRoomQuery('/login', undefined)).toBe('/login');
  });
});

describe('parseRoomStyles', () => {
  it('valida cores, limpa grupos e recusa formatos errados', () => {
    const r = parseRoomStyles({ rooms: { '/P/Loja/': { color: '#ABC', group: '  Cliente\n  Acme  ' }, '/p/x': { color: '#112233' }, '/p/vazio': {} } });
    expect('rooms' in r && Object.fromEntries(r.rooms)).toEqual({ '/p/loja': { color: '#aabbcc', group: 'Cliente Acme' }, '/p/x': { color: '#112233' } });
    expect(parseRoomStyles({ rooms: { '/p': { color: 'red' } } })).toHaveProperty('error');
    expect(parseRoomStyles({ rooms: { '/p': { color: '#12345' } } })).toHaveProperty('error');
    expect(parseRoomStyles({ rooms: { '/p': { group: 3 } } })).toHaveProperty('error');
    expect(parseRoomStyles({ rooms: { '': { color: '#fff' } } })).toHaveProperty('error');
    expect(parseRoomStyles({ rooms: [] })).toHaveProperty('error');
    expect(parseRoomStyles({})).toHaveProperty('error');
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`/p/${i}`, { color: '#fff' }]));
    expect(parseRoomStyles({ rooms: many })).toHaveProperty('error');
    const long = parseRoomStyles({ rooms: { '/p': { group: 'x'.repeat(100) } } });
    expect('rooms' in long && long.rooms.get('/p')?.group).toHaveLength(40);
  });
});

describe('POST /api/rooms/style', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function start(opts: { terminal?: boolean; env?: NodeJS.ProcessEnv } = {}) {
    const tmp = tempDir();
    const dataDir = join(tmp.dir, 'data');
    const dir = join(tmp.dir, '.claude');
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => undefined });
    const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
    const kaviski = createKaviski({ dataDir, env: opts.env ?? {} });
    kaviski.attach(office);
    const hub = new Hub(office, { throttleMs: 10 });
    hub.start();
    const api = createApiHandler({ office, hub, accounts, sources: () => [], version: '9.9.9', inDocker: false, terminal: opts.terminal ?? true, kaviski });
    const server = http.createServer((req, res) => {
      if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    office.addMain({ id: '.claude:1', account: '.claude', sessionId: 's1', cwd: '/p/loja', role: 'Agente principal', startedAt: Date.now(), status: 'working' });
    const port = (server.address() as AddressInfo).port;
    cleanups.push(async () => {
      hub.stop();
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
      tmp.cleanup();
    });
    return { port, dataDir, office, hub };
  }

  function post(port: number, body: unknown, host = `localhost:${port}`): Promise<{ status: number; body: any }> {
    return new Promise((ok, fail) => {
      const data = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port, path: '/api/rooms/style', method: 'POST', headers: { Host: host, 'Content-Type': 'application/json' } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, body: JSON.parse(text || '{}') }));
      });
      req.on('error', fail);
      req.end(data);
    });
  }

  const snap = async (port: number) => (await (await fetch(`http://127.0.0.1:${port}/api/snapshot`)).json()) as OfficeSnapshot;

  it('aplica no snapshot, persiste no data dir e vale para sala que ainda não existe', async () => {
    const e = await start();
    expect(((await snap(e.port)).rooms as KvRoomInfo[])[0].kaviski).toBeUndefined();
    const r = await post(e.port, { rooms: { '/p/loja': { color: '#0a7', group: 'Acme' }, '/p/futura': { color: '#ff0000', group: 'Beta' } } });
    expect(r.status).toBe(200);
    expect(r.body.rooms['/p/loja']).toEqual({ color: '#00aa77', group: 'Acme' });
    await new Promise((ok) => setTimeout(ok, 30));
    expect(((await snap(e.port)).rooms as KvRoomInfo[]).find((x) => x.path === '/p/loja')?.kaviski).toEqual({ color: '#00aa77', group: 'Acme' });
    const file = JSON.parse(readFileSync(join(e.dataDir, 'room-styles.json'), 'utf8'));
    expect(file.rooms['/p/futura']).toEqual({ color: '#ff0000', group: 'Beta' });
    // reinício: outro processo lê o arquivo
    const again = new RoomStyles(join(e.dataDir, 'room-styles.json'));
    again.load();
    expect(again.get('/P/Futura/')).toEqual({ color: '#ff0000', group: 'Beta' });
    // a sala futura aparece já colorida
    e.office.addMain({ id: '.claude:2', account: '.claude', sessionId: 's2', cwd: '/p/futura', role: 'Agente principal', startedAt: Date.now(), status: 'working' });
    await new Promise((ok) => setTimeout(ok, 30));
    expect(((await snap(e.port)).rooms as KvRoomInfo[]).find((x) => x.path === '/p/futura')?.kaviski?.group).toBe('Beta');
    // substitui o mapa inteiro
    expect((await post(e.port, { rooms: {} })).status).toBe(200);
    await new Promise((ok) => setTimeout(ok, 30));
    expect(((await snap(e.port)).rooms as KvRoomInfo[]).every((x) => !x.kaviski)).toBe(true);
  });

  it('cor inválida -> 400; Host de fora ou sem bind local -> 403', async () => {
    const e = await start();
    expect((await post(e.port, { rooms: { '/p/loja': { color: 'azul' } } })).status).toBe(400);
    expect((await post(e.port, { rooms: {} }, 'habblaud.lan')).status).toBe(403);
    const off = await start({ terminal: false });
    expect((await post(off.port, { rooms: {} })).status).toBe(403);
  });

  it('HABBLAUD_TWICC_URL vai no meta do snapshot (e não vai sem ela)', async () => {
    const off = await start();
    expect((((await snap(off.port)).meta) as KvSnapshotMeta).kaviski).toBeUndefined();
    const on = await start({ env: { HABBLAUD_TWICC_URL: 'http://192.168.1.220:3500/' } });
    expect((((await snap(on.port)).meta) as KvSnapshotMeta).kaviski).toEqual({ twiccUrl: 'http://192.168.1.220:3500' });
  });
});
