// Fork Kaviski (KAVISKI.md): salas fixas e nome no mapa de estilos, marca (HABBLAUD_BRAND) e mensagens às sessões do
// TwiCC (servidor e auxiliar do host).
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../shared/types';
import type { KvRoomEntry, KvRoomInfo, KvSnapshotMeta } from '../../shared/kaviski';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { MessageRegistry } from '../messages/registry';
import { createKaviski } from './index';
import { kvDecorateRooms } from './pinned';
import { kvBrandLogin } from './remote';
import { kvSetEmpresaAtual } from './empresa';
import { parseRoomStyles } from './room-styles';
import { attachTwiccMessages, ERR_TWICC_NOT_FETCHED, TWICC_QUEUED_TIMEOUT_MS } from './twicc-messages';
import { cliError, liveIds, sendArgs, twiccRound, type TwiccBridgeState, type TwiccCli } from './twicc-bridge';
import { loginPage } from '../http/remote';

setQuiet(true);

const SID = '79c4a4d2-306e-40f9-b437-62c5c6ab3bc1';
const SID2 = 'b1ef7065-33e4-49cd-b996-b565f186b12d';

function room(path: string, slot: number): RoomInfo {
  return { id: path, name: path.split('/').pop()!, path, slot, seed: 1, createdAt: 1 };
}

function entries(body: Record<string, unknown>): [string, KvRoomEntry][] {
  const r = parseRoomStyles({ rooms: body });
  if ('error' in r) throw new Error(r.error);
  return [...r.rooms];
}

describe('mapa de estilos: pinned e name', () => {
  it('aceita pinned/name, guarda as maiúsculas só das fixas e recusa formatos errados', () => {
    const r = parseRoomStyles({ rooms: { '/P/Clientes/01-Acme/01.Loja/': { pinned: true, name: '  Loja\n Acme ', group: 'Acme' }, '/p/nome': { name: 'Só nome' } } });
    expect('rooms' in r && Object.fromEntries(r.rooms)).toEqual({
      '/p/clientes/01-acme/01.loja': { group: 'Acme', pinned: true, name: 'Loja Acme', path: '/P/Clientes/01-Acme/01.Loja' },
      '/p/nome': { name: 'Só nome' },
    });
    expect(parseRoomStyles({ rooms: { '/p': { pinned: 'sim' } } })).toHaveProperty('error');
    expect(parseRoomStyles({ rooms: { '/p': { name: 3 } } })).toHaveProperty('error');
    expect(parseRoomStyles({ rooms: { relativo: { pinned: true } } })).toHaveProperty('error');
    // pinned false sozinho = entrada vazia (ignorada)
    const off = parseRoomStyles({ rooms: { '/p': { pinned: false } } });
    expect('rooms' in off && off.rooms.size).toBe(0);
    const long = parseRoomStyles({ rooms: { '/p': { name: 'n'.repeat(80) } } });
    expect('rooms' in long && long.rooms.get('/p')?.name).toHaveLength(40);
    // o arquivo gravado (chave em minúsculas + path) volta com as maiúsculas
    const again = parseRoomStyles({ rooms: { '/p/loja': { pinned: true, path: '/P/Loja' } } });
    expect('rooms' in again && again.rooms.get('/p/loja')?.path).toBe('/P/Loja');
  });

  it('salas fixas vazias entram no snapshot, agrupadas pelo cliente, com nomes', () => {
    const map = entries({
      '/w/Clientes/01-Acme/01.Loja': { pinned: true, group: 'Acme', color: '#f00' },
      '/w/Clientes/02-Beta/01.App': { pinned: true, group: 'Beta', name: 'App da Beta' },
      '/w/Clientes/01-Acme/02.Site': { pinned: true, group: 'Acme' },
      '/w/Interno/Sites/01.Geral': { pinned: true },
      '/w/Clientes/02-Beta/02.Geral': { pinned: true, group: 'Beta' },
    });
    const live = [room('/tmp/solta', 0), room('/w/Clientes/02-Beta/01.App', 1)];
    const out = kvDecorateRooms(live, map, { createdAt: 5, alias: (p) => (p === '/w/Clientes/01-Acme/02.Site' ? 'Site (apelido)' : undefined) });
    expect(out.map((r) => [r.slot, r.path, r.name])).toEqual([
      [0, '/w/Clientes/01-Acme/01.Loja', '01.Loja'],
      [1, '/w/Clientes/01-Acme/02.Site', 'Site (apelido)'],
      [2, '/w/Clientes/02-Beta/01.App', 'App da Beta'],
      // dois "01.Geral"/"02.Geral" são distintos; "Geral" repetido ganharia a pasta pai
      [3, '/w/Clientes/02-Beta/02.Geral', '02.Geral'],
      [4, '/w/Interno/Sites/01.Geral', '01.Geral'],
      [5, '/tmp/solta', 'solta'],
    ]);
    const loja = out.find((r) => r.path.endsWith('01.Loja'))!;
    expect(loja).toMatchObject({ id: '/w/Clientes/01-Acme/01.Loja', createdAt: 5, kaviski: { color: '#ff0000', group: 'Acme', pinned: true } });
    // a sala real mantém o id e só ganha o estilo
    expect(out.find((r) => r.path.endsWith('01.App'))!.kaviski).toEqual({ group: 'Beta', pinned: true });
    // sem nenhuma fixa: ordem original, só o estilo
    const plain = kvDecorateRooms([room('/b', 0), room('/a', 1)], entries({ '/a': { color: '#000' } }), { createdAt: 0 });
    expect(plain.map((r) => r.path)).toEqual(['/b', '/a']);
    // nomes repetidos de pasta: desambiguados contra todas as salas
    const dup = kvDecorateRooms([], entries({ '/x/a/Geral': { pinned: true }, '/x/b/Geral': { pinned: true } }), { createdAt: 0 });
    expect(dup.map((r) => r.name)).toEqual(['a/Geral', 'b/Geral']);
  });

  it('no Office: a sala fixa existe vazia e vira a mesma sala quando alguém chega; o nome do mapa vale sem apelido', () => {
    const office = new Office({ names: new NameStore(null), version: '9', startedAt: 1, accounts: () => [], sources: () => [], accountName: () => undefined });
    const kv = createKaviski({ dataDir: null, env: { HABBLAUD_BRAND: '  Kaviski\nCorporation ' }, now: () => 42 });
    kv.attach(office);
    kv.styles.replace(new Map(entries({ '/w/Clientes/01-Acme/01.Loja': { pinned: true, group: 'Acme', name: 'Loja' } })));
    office.markDirty();
    let s = office.commit().snapshot;
    expect(s.rooms).toEqual([{ id: '/w/Clientes/01-Acme/01.Loja', name: 'Loja', path: '/w/Clientes/01-Acme/01.Loja', slot: 0, seed: expect.any(Number), createdAt: 42, kaviski: { group: 'Acme', pinned: true } }]);
    expect((s.meta as KvSnapshotMeta).kaviski).toEqual({ brand: 'Kaviski Corporation' });
    const seed = s.rooms[0].seed;
    office.addMain({ id: '.claude:1', account: '.claude', sessionId: SID, cwd: '/w/Clientes/01-Acme/01.Loja', role: 'Agente principal', startedAt: 1, status: 'working' });
    s = office.commit().snapshot;
    expect(s.rooms).toHaveLength(1);
    expect(s.rooms[0]).toMatchObject({ id: '/w/Clientes/01-Acme/01.Loja', name: 'Loja', seed, slot: 0 });
  });
});

describe('marca (HABBLAUD_BRAND)', () => {
  it('tela de login com o logotipo e o nome da empresa; sem nome, só o logotipo', () => {
    kvSetEmpresaAtual(undefined); // o createKaviski dos testes de cima liga a empresa dele
    const html = loginPage({ caDownload: false });
    const plain = kvBrandLogin(html, {});
    expect(plain).toContain('src="/assets/brand/wordmark.png"');
    expect(plain).not.toContain('<h1>Habblaud</h1>');
    expect(plain).toContain('<title>');
    const branded = kvBrandLogin(html, { HABBLAUD_BRAND: 'Kaviski <Corp>' });
    expect(branded).toContain('<h1>Kaviski &lt;Corp&gt;</h1>');
    expect(branded).toContain('<title>Kaviski &lt;Corp&gt; · entrar</title>');
    expect(branded).toContain('escritório virtual · Habblaud');
    expect(branded).not.toContain('<h1>Habblaud</h1>');
    expect(branded).toContain('/assets/brand/login-wallpaper.png');
    expect(branded).toContain('class="kv-bg"');
    expect(branded.indexOf('kv-field')).toBeLessThan(branded.indexOf('</body>'));
    expect(branded).toContain('id="f"'); // o formulário original continua
  });
});

// ---------------------------------------------------------------- mensagens às sessões do TwiCC

function agent(id: string, over: Partial<AgentInfo> = {}): AgentInfo {
  return { id, kind: 'main', account: '.claude', sessionId: SID, status: 'idle', provider: 'claude', ...over } as AgentInfo;
}

function fakeOffice(list: AgentInfo[]) {
  const acts: string[] = [];
  let dirty = 0;
  return {
    acts,
    dirty: () => dirty,
    get: (id: string) => list.find((a) => a.id === id),
    list: () => list,
    markDirty: () => void dirty++,
    addActivity: (id: string) => void acts.push(id),
  };
}

describe('mensagens às sessões do TwiCC (servidor)', () => {
  it('só a sessão viva no TwiCC recebe; entrega pelo auxiliar com confirmação', () => {
    let now = 1_000_000;
    const office = fakeOffice([agent('a1'), agent('a2', { sessionId: SID2 }), agent('sub', { kind: 'sub' })]);
    const registry = new MessageRegistry({ office, now: () => now });
    const tw = attachTwiccMessages(registry, office, { now: () => now, tickMs: 1e9 });
    try {
      expect(registry.canMessage('a1')).toBe(false);
      expect(registry.send({ agentId: 'a1', text: 'oi' })).toMatchObject({ error: 'unavailable' });
      // o auxiliar conta quais sessões o TwiCC roda (maiúsculas não importam)
      const first = tw.poll({ live: [SID.toUpperCase(), 'lixo'] });
      expect(first.messages).toEqual([]);
      expect(first.want.sort()).toEqual([SID, SID2].sort());
      expect(registry.canMessage('a1')).toBe(true);
      expect(registry.canMessage('a2')).toBe(false);
      expect(registry.canMessage('sub')).toBe(false);
      expect([...registry.reachable()]).toEqual(['a1']);
      expect(office.dirty()).toBeGreaterThan(0);

      const sent = registry.send({ agentId: 'a1', text: 'Responda só OK' });
      expect('message' in sent && sent.message.status).toBe('queued');
      const id = 'message' in sent ? sent.message.id : '';
      expect(registry.get(id)?.status).toBe('queued');
      const p = tw.poll({});
      expect(p.messages).toEqual([{ id, session: SID, text: 'Responda só OK' }]);
      expect(registry.get(id)?.status).toBe('sent');
      // outra mensagem ao mesmo agente espera a primeira
      const second = registry.send({ agentId: 'a1', text: 'dois' });
      expect(tw.poll({}).messages).toEqual([]);
      tw.ack({ results: [{ id, ok: true }] });
      expect(registry.get(id)?.status).toBe('delivered');
      expect(office.acts).toEqual(['a1']);
      const id2 = 'message' in second ? second.message.id : '';
      expect(tw.poll({}).messages.map((m) => m.id)).toEqual([id2]);
      tw.ack({ results: [{ id: id2, ok: false, error: 'sessão ocupada' }] });
      expect(registry.get(id2)).toMatchObject({ status: 'failed', error: 'sessão ocupada' });

      // ninguém busca: falha no prazo
      const lost = registry.send({ agentId: 'a1', text: 'perdida' });
      now += TWICC_QUEUED_TIMEOUT_MS + 1;
      tw.tick();
      const lostId = 'message' in lost ? lost.message.id : '';
      expect(registry.get(lostId)).toMatchObject({ status: 'failed', error: ERR_TWICC_NOT_FETCHED });
      // o auxiliar sumiu: ninguém mais recebe pelo TwiCC
      now += 60_000;
      tw.tick();
      expect(registry.canMessage('a1')).toBe(false);
    } finally {
      tw.stop();
    }
  });

  it('sem HABBLAUD_TWICC_MESSAGES nada é embrulhado; a rota fica 404, e só o auxiliar do host passa', async () => {
    const office = fakeOffice([agent('a1')]);
    const registry = new MessageRegistry({ office });
    const send = registry.send;
    const off = createKaviski({ dataDir: null, env: {} });
    off.attachMessages(registry, office);
    expect(off.twicc).toBeUndefined();
    expect(registry.send).toBe(send);
    const on = createKaviski({ dataDir: null, env: { HABBLAUD_TWICC_MESSAGES: '1' } });
    on.attachMessages(registry, office);
    expect(on.twicc).toBeDefined();
    on.twicc!.stop();
    const http = await import('node:http');
    const res = (kv: ReturnType<typeof createKaviski>, host: boolean) =>
      new Promise<number>((ok) => {
        const server = http.createServer((req, r) => {
          kv.route(req, r, '/api/host/twicc/poll', { enabled: true, trusted: host, host });
        });
        server.listen(0, '127.0.0.1', () => {
          const port = (server.address() as { port: number }).port;
          const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
            r.resume();
            r.on('end', () => server.close(() => ok(r.statusCode ?? 0)));
          });
          req.end('{}');
        });
      });
    expect(await res(off, true)).toBe(404);
    expect(await res(on, false)).toBe(403);
    expect(await res(on, true)).toBe(200);
  });
});

describe('mensagens às sessões do TwiCC (auxiliar do host)', () => {
  it('lê as sessões vivas, manda a lista, entrega só às vivas e confirma', async () => {
    const calls: { path: string; body: any }[] = [];
    let messages: unknown[] = [];
    const post = async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path.endsWith('/poll')) return { status: 200, json: { messages, want: [SID] } };
      return { status: 200, json: { ok: true } };
    };
    const sent: [string, string][] = [];
    const cli: TwiccCli = {
      live: async () => [SID],
      send: async (s, t) => {
        sent.push([s, t]);
        return { ok: true };
      },
    };
    const st: TwiccBridgeState = { liveAt: 0, fresh: false, want: 0 };
    let now = 100_000;
    expect(await twiccRound(post, cli, st, () => {}, () => now)).toEqual({ state: 'ok', sent: 0, want: 1 });
    expect(calls[0]).toEqual({ path: '/api/host/twicc/poll', body: { live: [SID] } });
    messages = [
      { id: 'm1', session: SID, text: '-n não é opção' },
      { id: 'm2', session: SID2, text: 'para sessão morta' },
    ];
    now += 1_000;
    expect(await twiccRound(post, cli, st, () => {}, () => now)).toMatchObject({ state: 'ok', sent: 2 });
    // lista ainda nova (menos de 20 s): a rodada não manda `live` de novo
    expect(calls[1].body).toEqual({});
    expect(sent).toEqual([[SID, '-n não é opção']]);
    expect(calls.filter((c) => c.path.endsWith('/ack')).map((c) => c.body.results[0])).toEqual([
      { id: 'm1', ok: true },
      { id: 'm2', ok: false, error: 'a sessão não está rodando no TwiCC' },
    ]);
    expect(await twiccRound(async () => ({ status: 404, json: { error: 'x' } }), cli, st)).toEqual({ state: 'refused', status: 404 });
    expect(await twiccRound(async () => null, cli, st)).toEqual({ state: 'down' });
  });

  it('argumentos, lista de vivas e erros do CLI', () => {
    expect(sendArgs(SID, '--x')).toEqual(['send-message', '--no-expand', '--', SID, '--x']);
    expect(liveIds({ items: [{ id: SID, process: { state: 'user_turn' } }, { id: SID2, process: { state: 'dead' } }, { id: 'x', process: { state: 'user_turn' } }] })).toEqual([SID]);
    expect(liveIds(null)).toEqual([]);
    expect(cliError('{"error": "session not found"}', '')).toBe('session not found');
    expect(cliError('', 'Erro\nmais')).toBe('Erro');
  });
});

describe('snapshot sem nada do fork', () => {
  it('sem mapa e sem variáveis o snapshot sai igual', () => {
    const office = new Office({ names: new NameStore(null), version: '9', startedAt: 1, accounts: () => [], sources: () => [], accountName: () => undefined });
    createKaviski({ dataDir: null, env: {} }).attach(office);
    office.addMain({ id: '.claude:1', account: '.claude', sessionId: SID, cwd: '/p/a', role: 'Agente principal', startedAt: 1, status: 'working' });
    const s: OfficeSnapshot = office.commit().snapshot;
    expect((s.rooms as KvRoomInfo[])[0].kaviski).toBeUndefined();
    expect((s.meta as KvSnapshotMeta).kaviski).toBeUndefined();
  });
});
