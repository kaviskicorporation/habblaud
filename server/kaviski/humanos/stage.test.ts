// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): o palco (megafone) — quem fala, quem só ouve.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { setQuiet } from '../../log';
import { kvLiveKitToken } from './livekit';
import { KvStage, kvStageRoute, STAGE_MAX_MS } from './stage';

setQuiet(true);

const CFG = { url: 'ws://127.0.0.1:7880', key: 'chave', secret: 'x'.repeat(40) };
const person = (id: string, role: KvPerson['role']): KvPerson => ({ id, user: id, name: id.toUpperCase(), role, rooms: [] });
const ADMIN = person('ana', 'admin');
const BIA = person('bia', 'equipe');
const CAIO = person('caio', 'equipe');
const RARM = person('rarm', 'cliente');

const grantOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).video;

function setup(online = new Set(['ana', 'bia', 'caio', 'rarm'])) {
  let t = 1_000_000;
  const events: { event: string; data: unknown; to: KvPerson[] }[] = [];
  const everyone = [ADMIN, BIA, CAIO, RARM];
  const stage = new KvStage({
    emit: (event, data, to) => events.push({ event, data, to: everyone.filter((p) => to(p, undefined)) }),
    online: (id) => online.has(id),
    now: () => t,
  });
  return { stage, events, online, tick: (ms: number) => (t += ms) };
}

const stages: KvStage[] = [];
afterEach(() => {
  for (const s of stages.splice(0)) s.stop();
});

describe('palco (megafone)', () => {
  it('só a equipe abre; cliente recebe 403; um palco por vez', () => {
    const { stage, events, tick } = setup();
    stages.push(stage);
    expect(stage.set(RARM, true)).toMatchObject({ ok: false, status: 403 });
    expect(stage.set(BIA, 'sim')).toMatchObject({ ok: false, status: 400 });
    expect(stage.set(BIA, true)).toMatchObject({ ok: true, state: { active: true, by: { id: 'bia', name: 'BIA' } } });
    // todo mundo recebe o aviso, inclusive o cliente
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('stage');
    expect(events[0]!.to.map((p) => p.id)).toEqual(['ana', 'bia', 'caio', 'rarm']);
    tick(2000);
    expect(stage.set(CAIO, true)).toMatchObject({ ok: false, status: 409 });
    // outro da equipe não fecha o palco de quem abriu; o admin fecha
    expect(stage.set(CAIO, false)).toMatchObject({ ok: false, status: 403 });
    expect(stage.set(ADMIN, false)).toMatchObject({ ok: true, state: { active: false } });
    expect(events.at(-1)!.data).toEqual({ active: false });
  });

  it('token: só quem está no palco publica; os outros (cliente também) só ouvem', () => {
    const { stage } = setup();
    stages.push(stage);
    expect(stage.token(CFG, BIA)).toBeUndefined();
    stage.set(BIA, true);
    const mine = stage.token(CFG, BIA)!;
    expect(mine.canPublish).toBe(true);
    expect(grantOf(mine.token)).toMatchObject({ room: mine.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
    for (const p of [ADMIN, CAIO, RARM]) {
      const t = stage.token(CFG, p)!;
      expect(t.canPublish).toBe(false);
      expect(t.room).toBe(mine.room);
      expect(grantOf(t.token)).toMatchObject({ canPublish: false, canSubscribe: true, canPublishData: false });
    }
  });

  it('cada palco é uma chamada nova; quem abriu e saiu do escritório perde o palco', () => {
    const { stage, events, online, tick } = setup();
    stages.push(stage);
    stage.set(BIA, true);
    const first = stage.token(CFG, CAIO)!.room;
    tick(2000);
    stage.set(BIA, false);
    tick(2000);
    stage.set(BIA, true);
    expect(stage.token(CFG, CAIO)!.room).not.toBe(first);
    online.delete('bia');
    stage.sweep();
    expect(stage.state()).toEqual({ active: false });
    expect(events.at(-1)!.data).toEqual({ active: false });
  });

  it('palco esquecido fecha sozinho; conta rebaixada a cliente sai do palco', () => {
    const { stage, tick } = setup();
    stages.push(stage);
    stage.set(CAIO, true);
    tick(STAGE_MAX_MS + 1);
    stage.sweep();
    expect(stage.state().active).toBe(false);
    tick(2000);
    stage.set(CAIO, true);
    stage.refresh({ ...CAIO, role: 'cliente' }, 'caio');
    expect(stage.state().active).toBe(false);
  });

  it('instâncias diferentes no mesmo LiveKit: palcos em chamadas diferentes', () => {
    const t = 1_000_000;
    const a = new KvStage({ emit: () => {}, online: () => true, now: () => t, scope: '/dados/prod' });
    const b = new KvStage({ emit: () => {}, online: () => true, now: () => t, scope: '/dados/teste' });
    stages.push(a, b);
    a.set(BIA, true);
    b.set(BIA, true);
    expect(a.token(CFG, CAIO)!.room).not.toBe(b.token(CFG, CAIO)!.room);
  });

  it('o token padrão (chamadas de área) continua com tudo liberado', () => {
    expect(grantOf(kvLiveKitToken(CFG, BIA, 'kv-x', 1000))).toMatchObject({ canPublish: true, canSubscribe: true, canPublishData: true });
  });
});

describe('rotas do palco', () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function start(withLiveKit = true) {
    const config = withLiveKit ? CFG : undefined;
    const { stage } = setup();
    stages.push(stage);
    const who = new Map([['ana', ADMIN], ['bia', BIA], ['rarm', RARM]]);
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!kvStageRoute({ stage, whoIs: (r) => who.get(String(r.headers['x-who'])), config }, req, res, url.pathname)) {
        res.statusCode = 418;
        res.end();
      }
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const call = async (path: string, who: string, body?: unknown) => {
      const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-who': who, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> };
    };
    return call;
  }

  it('abre, dá o token certo a cada um e recusa quem não entrou', async () => {
    const call = await start();
    expect((await call('/api/kaviski/humanos/stage', 'ninguem')).status).toBe(403);
    expect((await call('/api/kaviski/humanos/stage', 'rarm')).body).toEqual({ active: false });
    expect((await call('/api/kaviski/humanos/stage/token', 'rarm', {})).status).toBe(404);
    expect((await call('/api/kaviski/humanos/stage', 'rarm', { on: true })).status).toBe(403);
    expect((await call('/api/kaviski/humanos/stage', 'bia', { on: true })).body).toMatchObject({ active: true, by: { id: 'bia' } });
    const bia = await call('/api/kaviski/humanos/stage/token', 'bia', {});
    expect(bia.body.canPublish).toBe(true);
    const rarm = await call('/api/kaviski/humanos/stage/token', 'rarm', {});
    expect(rarm.status).toBe(200);
    expect(rarm.body.canPublish).toBe(false);
    expect(grantOf(String(rarm.body.token)).canPublish).toBe(false);
    expect((await call('/api/kaviski/humanos/livekit', 'bia')).status).toBe(418);
  });

  it('sem LiveKit configurado: 404', async () => {
    const call = await start(false);
    expect((await call('/api/kaviski/humanos/stage', 'bia')).status).toBe(404);
  });
});
