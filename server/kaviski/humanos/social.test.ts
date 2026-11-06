// Fork Kaviski (KAVISKI-HUMANOS.md, W2): chamar, reações, status com nota, salas trancadas e rodas privadas.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import type { KvPresenceState } from '../../../shared/kaviski-presence';
import { kvMentions, kvStatusNote, kvStatusUntil } from '../../../shared/kaviski-social';
import type { OfficeSnapshot } from '../../../shared/types';
import { setQuiet } from '../../log';
import { tempDir } from '../../test/fixtures';
import { createHumanos } from '.';
import { kvAreaAllowed, kvSetAreaGuard } from './livekit';
import { KvPresence } from './presence';
import { kvSetPerson } from './request';

setQuiet(true);

const RARM = '/proj/Clientes/12-Rarm/01.App';
const INTERNO = '/proj/Interno/Sites/01.Site';

function snapshot(): OfficeSnapshot {
  return {
    rev: 1,
    serverTime: 0,
    rooms: [
      { id: 'r1', name: 'Rarm', path: RARM, slot: 0, seed: 1, createdAt: 0 },
      { id: 'r2', name: 'Site', path: INTERNO, slot: 1, seed: 2, createdAt: 0 },
    ],
    agents: [],
    meta: { demo: false, sources: [], startedAt: 0, version: '1' },
  } as unknown as OfficeSnapshot;
}

const person = (id: string, role: KvPerson['role'], rooms: string[] = []): KvPerson => ({ id, user: id, name: id.toUpperCase(), role, rooms });
const PEOPLE: Record<string, KvPerson> = {
  bia: person('bia', 'equipe'),
  ana: person('ana', 'equipe'),
  caio: person('caio', 'equipe'),
  rarm: person('rarm', 'cliente', ['/proj/Clientes/12-Rarm']),
  outro: person('outro', 'cliente', ['/proj/Clientes/99-Outro']),
};

describe('textos do status e menções', () => {
  it('nota: limpa, corta em 60 e aceita emoji', () => {
    expect(kvStatusNote('  🍽️   Almoçando\u0007 ')).toBe('🍽️ Almoçando');
    expect(kvStatusNote(null)).toBe('');
    expect(kvStatusNote(5)).toBeUndefined();
    expect([...kvStatusNote('x'.repeat(100))!]).toHaveLength(60);
  });
  it('até: no futuro e no máximo 7 dias', () => {
    expect(kvStatusUntil(0, 1000)).toBe(0);
    expect(kvStatusUntil(500, 1000)).toBeUndefined();
    expect(kvStatusUntil(5000, 1000)).toBe(5000);
    expect(kvStatusUntil(1000 + 8 * 24 * 3600_000, 1000)).toBeUndefined();
  });
  it('menção @nome sem acento e sem pegar pedaço de palavra', () => {
    expect(kvMentions('oi @joao, tudo bem?', ['João Silva'.split(' ')[0]!])).toBe(true);
    expect(kvMentions('oi @João', ['joao'])).toBe(true);
    expect(kvMentions('oi @joaozinho', ['joao'])).toBe(false);
    expect(kvMentions('email joao@x.com', ['joao'])).toBe(false);
    expect(kvMentions('@ana.rarm vem cá', ['ana.rarm'])).toBe(true);
  });
});

describe('status com nota e "até"', () => {
  it('o servidor guarda, mostra e limpa sozinho quando vence', () => {
    let t = 1_000_000;
    const pres = new KvPresence({ snapshot, look: () => undefined, now: () => t });
    const res = { writeHead() {}, write: () => true, on() {}, end() {}, destroyed: false, writableEnded: false };
    const req = { socket: { setTimeout() {}, setNoDelay() {} }, on() {} };
    pres.attach(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse, PEOPLE.bia!);
    expect(pres.update(PEOPLE.bia!, { status: 'naoperturbe', note: '🎧 Focado', until: t + 60_000 })).toBeNull();
    expect(pres.visibleTo(PEOPLE.bia!, snapshot())[0]).toMatchObject({ status: 'naoperturbe', note: '🎧 Focado', until: t + 60_000 });
    expect(pres.update(PEOPLE.bia!, { until: t - 1 })).toBe('until');
    expect(pres.update(PEOPLE.bia!, { status: 'cochilando' })).toBe('status');
    t += 61_000;
    pres.expire();
    const me = pres.visibleTo(PEOPLE.bia!, snapshot())[0]!;
    expect(me.status).toBe('disponivel');
    expect(me.note).toBeUndefined();
    pres.stop();
  });
});

// ---------------------------------------------------------------- pela rede (rotas de verdade)

interface Stream {
  events(name: string): unknown[];
  state(): KvPresenceState | null;
  close(): void;
}

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  kvSetAreaGuard(null);
});

/** createHumanos numa porta local; a pessoa de cada requisição vem do cabeçalho x-p (no lugar do login). */
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
  const srv = http.createServer((req, res) => {
    const id = req.headers['x-p'];
    if (typeof id === 'string' && PEOPLE[id]) kvSetPerson(req, PEOPLE[id]!);
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
  const post = async (who: string, path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-p': who }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  /** Abre o fluxo de presença de `who` e guarda o que chega. */
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
    const s: Stream = {
      events: parse,
      state: () => (parse('people').at(-1) as KvPresenceState | undefined) ?? null,
      close: () => ac.abort(),
    };
    streams.push(s);
    return s;
  };
  const at = (who: string, area: string, pos: Record<string, unknown>) => post(who, 'presence', { pos: { d: 'down', m: 0, ...pos }, area });
  const token = (who: string, area: string) => post(who, 'livekit-token', { area });
  return { post, open, at, token };
}

const wait = (ms = 250) => new Promise((ok) => setTimeout(ok, ms));

describe('chamar (cutucar) uma pessoa', () => {
  it('chega só a quem foi chamado, com limite, e não passa do "não perturbe"', async () => {
    const h = await start();
    const bia = await h.open('bia');
    const ana = await h.open('ana');
    await h.open('rarm');
    await h.open('outro');
    expect((await h.post('bia', 'ring', { to: 'ana' })).status).toBe(200);
    expect((await h.post('bia', 'ring', { to: 'ana' })).status).toBe(429);
    expect((await h.post('bia', 'ring', { to: 'bia' })).status).toBe(400);
    expect((await h.post('bia', 'ring', { to: 'ninguem' })).status).toBe(404);
    // cliente não chama quem ele não vê (outro cliente sem sala em comum)
    expect((await h.post('rarm', 'ring', { to: 'outro' })).status).toBe(404);
    expect((await h.post('rarm', 'ring', { to: 'ana' })).status).toBe(200);
    await h.post('caio', 'presence', {}); // offline: 409 (não abriu o fluxo)
    expect((await h.post('caio', 'ring', { to: 'ana' })).status).toBe(409);
    await h.post('bia', 'presence', { status: 'naoperturbe' });
    const dnd = await h.post('ana', 'ring', { to: 'bia' });
    expect(dnd.status).toBe(409);
    expect(dnd.body).toMatchObject({ dnd: true });
    expect(String(dnd.body.error)).toContain('BIA');
    await wait();
    expect(ana.events('ring').map((e) => (e as { from: { id: string } }).from.id)).toEqual(['bia', 'rarm']);
    expect(bia.events('ring')).toEqual([]);
  });
});

describe('reações rápidas e mão levantada', () => {
  it('a reação vai a quem vê o meu boneco; a mão fica no estado até baixar', async () => {
    const h = await start();
    const bia = await h.open('bia');
    const ana = await h.open('ana');
    const rarm = await h.open('rarm');
    expect((await h.post('bia', 'react', { emoji: '👍' })).status).toBe(409); // fora do escritório
    await h.at('bia', 'r:r2', { k: 'r', r: 'r2', x: 10, y: 10 });
    expect((await h.post('bia', 'react', { emoji: '👍' })).status).toBe(200);
    expect((await h.post('bia', 'react', { emoji: '💩' })).status).toBe(400);
    expect((await h.post('bia', 'react', { emoji: '✋' })).body).toMatchObject({ hand: true });
    await wait();
    expect(ana.events('react')).toMatchObject([{ who: 'bia', emoji: '👍' }]);
    expect(bia.events('react')).toHaveLength(1);
    // a sala r2 não é da Rarm: ela não vê o boneco da Bia lá dentro, nem a reação
    expect(rarm.events('react')).toEqual([]);
    expect(ana.state()!.people.find((p) => p.id === 'bia')).toMatchObject({ hand: true });
    await h.post('bia', 'react', { hand: false });
    await wait();
    expect(ana.state()!.people.find((p) => p.id === 'bia')!.hand).toBeUndefined();
    for (let i = 0; i < 8; i++) await h.post('ana', 'presence', {});
    await h.at('ana', 'c', { k: 'c', r: 'r1', x: 1, y: 1 });
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await h.post('ana', 'react', { emoji: '🎉' })).status);
    expect(codes).toContain(429);
  });
});

describe('trancar sala e bater na porta', () => {
  it('quem está fora não entra, não pega a voz; bater → deixar entrar; destranca quando todos saem', async () => {
    const h = await start();
    const bia = await h.open('bia');
    const ana = await h.open('ana');
    const caio = await h.open('caio');
    const rarm = await h.open('rarm');
    const inR1 = { k: 'r', r: 'r1', x: 5, y: 5 };
    await h.at('bia', 'r:r1', inR1);
    await h.at('ana', 'r:r1', inR1);
    await h.at('rarm', 'r:r1', inR1);
    await h.at('caio', 'c', { k: 'c', r: 'r1', x: 5, y: 5 });
    expect((await h.post('caio', 'lock', { on: true })).status).toBe(409); // não está numa sala
    expect((await h.post('rarm', 'lock', { on: true })).status).toBe(403); // cliente não tranca
    expect((await h.post('bia', 'lock', { on: true })).status).toBe(200);
    await wait();
    expect(bia.state()!.locks).toEqual([{ area: 'r:r1', by: 'BIA', n: 3, in: true }]);
    expect(caio.state()!.locks).toEqual([{ area: 'r:r1', by: 'BIA', n: 3, in: false }]);
    // o cliente estava dentro: entra na lista
    expect(rarm.state()!.locks).toMatchObject([{ in: true }]);
    // de fora: posição, área e voz recusadas
    expect((await h.at('caio', 'r:r1', inR1)).status).toBe(400);
    expect((await h.token('caio', 'r:r1')).status).toBe(403);
    expect((await h.token('ana', 'r:r1')).status).toBe(200);
    // bater na porta: só quem está dentro recebe; sala não trancada não precisa
    expect((await h.post('caio', 'knock', { area: 'r:r2' })).status).toBe(409);
    expect((await h.post('caio', 'knock', { area: 'r:r1' })).body).toMatchObject({ inside: 3 });
    expect((await h.post('caio', 'knock', { area: 'r:r1' })).status).toBe(429);
    await wait();
    expect(bia.events('knock')).toMatchObject([{ area: 'r:r1', from: { id: 'caio' } }]);
    expect(caio.events('knock')).toEqual([]);
    // só quem está dentro responde
    expect((await h.post('caio', 'knock/answer', { area: 'r:r1', who: 'caio', allow: true })).status).toBe(403);
    expect((await h.post('ana', 'knock/answer', { area: 'r:r1', who: 'caio', allow: true })).status).toBe(200);
    expect((await h.post('bia', 'knock/answer', { area: 'r:r1', who: 'caio', allow: true })).status).toBe(404); // já respondido
    await wait();
    expect(caio.events('knock-answer')).toMatchObject([{ area: 'r:r1', who: 'caio', allow: true, by: 'ANA' }]);
    expect(bia.events('knock-answer')).toHaveLength(1);
    expect((await h.at('caio', 'r:r1', inR1)).status).toBe(200);
    expect((await h.token('caio', 'r:r1')).status).toBe(200);
    // todos saem: destranca sozinha
    for (const who of ['bia', 'ana', 'caio', 'rarm']) await h.at(who, 'c', { k: 'c', r: 'r1', x: 1, y: 1 });
    await wait();
    expect(bia.state()!.locks).toBeUndefined();
    expect((await h.token('caio', 'r:r1')).status).toBe(200);
  });

  it('cliente não fica sabendo de sala trancada que não é dele; quem saiu do fluxo também conta', async () => {
    const h = await start();
    await h.open('bia');
    const rarm = await h.open('rarm');
    await h.at('bia', 'r:r2', { k: 'r', r: 'r2', x: 5, y: 5 });
    expect((await h.post('bia', 'lock', { on: true })).status).toBe(200);
    await wait();
    expect(rarm.state()!.locks).toBeUndefined();
    expect((await h.post('rarm', 'knock', { area: 'r:r2' })).status).toBe(403);
    // destrancar: só quem está na lista
    expect((await h.post('rarm', 'lock', { on: false, area: 'r:r2' })).status).toBe(403);
    expect((await h.post('bia', 'lock', { on: false })).status).toBe(200);
  });
});

describe('roda de conversa privada', () => {
  it('junta quem está perto; chat e voz só para os membros; sair da área desfaz', async () => {
    const h = await start();
    const bia = await h.open('bia');
    const ana = await h.open('ana');
    const caio = await h.open('caio');
    const lounge = 'a:core:lounge';
    await h.at('bia', lounge, { k: 'a', x: 100, y: 100 });
    await h.at('ana', lounge, { k: 'a', x: 130, y: 100 });
    await h.at('caio', lounge, { k: 'a', x: 400, y: 100 });
    // a área da roda vem do servidor, nunca da página
    expect((await h.at('caio', 'b:xyz', { k: 'a', x: 400, y: 100 })).status).toBe(400);
    expect((await h.post('caio', 'bubble', { action: 'start', near: ['bia'] })).status).toBe(409); // longe
    const r = await h.post('bia', 'bubble', { action: 'start', near: ['ana', 'caio'] });
    expect(r.status).toBe(200);
    expect(r.body.members).toEqual(['bia', 'ana']);
    const area = `b:${String(r.body.id)}`;
    await wait();
    expect(ana.state()!.people.find((p) => p.id === 'bia')).toMatchObject({ bubble: r.body.id });
    expect(ana.events('bubble')).toHaveLength(1);
    expect(caio.events('bubble')).toEqual([]);
    // voz
    expect((await h.token('ana', area)).status).toBe(200);
    expect((await h.token('caio', area)).status).toBe(403);
    expect(kvAreaAllowed(area, PEOPLE.caio!, snapshot())).toBeUndefined();
    // chat: a fala da roda só chega aos membros, e a de quem está fora não entra na roda
    expect((await h.post('bia', 'chat', { text: 'só entre nós' })).body).toMatchObject({ message: { area } });
    await wait(900);
    expect((await h.post('caio', 'chat', { text: 'oi pessoal' })).status).toBe(200);
    await wait();
    expect(ana.events('chat').map((m) => (m as { text: string }).text)).toEqual(['só entre nós']);
    expect(caio.events('chat').map((m) => (m as { text: string }).text)).toEqual(['oi pessoal']);
    // a Bia chama o Caio para a roda (quando ele chega perto)
    expect((await h.post('caio', 'bubble', { action: 'add', who: 'caio' })).status).toBe(409);
    expect((await h.post('bia', 'bubble', { action: 'add', who: 'caio' })).status).toBe(200);
    expect((await h.token('caio', area)).status).toBe(200);
    // sair da área tira da roda; com um só, ela acaba
    await h.at('caio', 'c', { k: 'c', r: 'r1', x: 1, y: 1 });
    await h.post('ana', 'bubble', { action: 'leave' });
    await wait();
    expect(bia.state()!.people.every((p) => !p.bubble)).toBe(true);
    expect((await h.token('bia', area)).status).toBe(403);
  });
});
