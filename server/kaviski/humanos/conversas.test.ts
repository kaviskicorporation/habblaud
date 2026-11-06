// Fork Kaviski (KAVISKI-HUMANOS.md): conversas estilo Teams no servidor — cada conversa guardada separada, em páginas,
// com retenção, "digitando…" só para a outra pessoa e busca só nas conversas de quem busca.
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { KV_CHAT_HISTORY, KV_CHAT_HISTORY_MS } from '../../../shared/kaviski-presence';
import { KvDirect } from './direct';

const P = (id: string, role: 'admin' | 'equipe' | 'cliente', rooms: string[] = []): KvPerson => ({ id, user: id, name: id.toUpperCase(), role, rooms });
const rarm = P('rarm', 'cliente', ['/proj/Clientes/12-Rarm']);
const rarm2 = P('rarm2', 'cliente', ['/proj/Clientes/12-Rarm/01.App']);
const outro = P('outro', 'cliente', ['/proj/Clientes/99-Outro']);
const bia = P('bia', 'equipe');
const caio = P('caio', 'admin');
const DAY = 24 * 60 * 60 * 1000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(opts: { file?: string | null; people?: KvPerson[]; at?: number } = {}) {
  const all = opts.people ?? [rarm, rarm2, outro, bia, caio];
  const sent: { event: string; to: string[]; data: unknown }[] = [];
  const clock = { t: opts.at ?? 1_800_000_000_000 };
  const dm = new KvDirect({
    people: () => all,
    online: () => new Map(),
    look: () => undefined,
    emit: (event, data, to) => sent.push({ event, to: all.filter((p) => to(p)).map((p) => p.id).sort(), data }),
    file: opts.file ?? null,
    now: () => clock.t,
  });
  return { dm, sent, clock, all };
}

/** Manda `n` falas (uma por segundo, passando o limite de 30/min com o relógio). */
function talk(dm: KvDirect, clock: { t: number }, from: KvPerson, to: string, n: number, prefix = 'fala'): void {
  for (let i = 0; i < n; i++) {
    clock.t += 2_100;
    const r = dm.send(from, { to, text: `${prefix} ${i}` });
    if (!r.ok) throw new Error(r.error);
  }
}

describe('conversas 1:1: páginas e retenção', () => {
  it('entrega em páginas, das mais novas para trás, e diz se há mais', () => {
    const { dm, clock } = setup();
    talk(dm, clock, bia, 'rarm', 150);
    const first = dm.page(rarm, 'bia')!;
    expect(first.messages).toHaveLength(100);
    expect(first.more).toBe(true);
    expect(first.messages.at(-1)!.text).toBe('fala 149');
    expect(first.messages[0]!.text).toBe('fala 50');
    const older = dm.page(rarm, 'bia', { before: first.messages[0]!.at })!;
    expect(older.messages.map((m) => m.text)).toEqual(Array.from({ length: 50 }, (_, i) => `fala ${i}`));
    expect(older.more).toBe(false);
    expect(dm.page(rarm, 'bia', { limit: 10 })!.messages).toHaveLength(10);
    expect(dm.page(rarm, 'bia', { limit: 9999 })!.messages).toHaveLength(150);
  });

  it('quem não participa (ou não pode conversar) não recebe a página', () => {
    const { dm, clock } = setup();
    talk(dm, clock, bia, 'rarm', 3);
    expect(dm.page(outro, 'rarm')).toBeUndefined();
    expect(dm.page(outro, 'bia')!.messages).toEqual([]); // conversa dele com a bia: vazia, nunca a da rarm
    expect(dm.page(caio, 'rarm')!.messages).toEqual([]);
  });

  it('cada conversa fica separada no arquivo (600) e volta ao reiniciar; o que passou de 180 dias some', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kv-conv-'));
    dirs.push(dir);
    const file = join(dir, 'dm.json');
    const a = setup({ file });
    talk(a.dm, a.clock, bia, 'rarm', 2, 'velha');
    a.clock.t += 181 * DAY;
    talk(a.dm, a.clock, bia, 'rarm', 2, 'nova');
    talk(a.dm, a.clock, caio, 'bia', 1, 'outra');
    a.dm.save();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { convs: Record<string, unknown[]> };
    expect(Object.keys(raw.convs).sort()).toEqual(['bia|caio', 'bia|rarm']);

    const b = setup({ file, at: a.clock.t });
    expect(b.dm.page(rarm, 'bia')!.messages.map((m) => m.text)).toEqual(['nova 0', 'nova 1']);
    expect(b.dm.page(bia, 'caio')!.messages.map((m) => m.text)).toEqual(['outra 0']);
    expect(b.dm.contacts(rarm).find((c) => c.id === 'bia')).toMatchObject({ unread: 2, last: { text: 'nova 1', mine: false } });
  });

  it('guarda até 1000 falas por conversa', () => {
    const { dm, clock } = setup();
    talk(dm, clock, bia, 'rarm', 1005);
    expect(dm.history(rarm, 'bia')).toHaveLength(1000);
    expect(dm.history(rarm, 'bia')![0]!.text).toBe('fala 5');
  });
});

describe('conversas 1:1: digitando e busca', () => {
  it('"digitando" vai só para a outra pessoa, com freio, e nunca entre clientes de empresas diferentes', () => {
    const { dm, sent, clock } = setup();
    expect(dm.typing(bia, 'rarm')).toBe(true);
    expect(sent).toEqual([{ event: 'typing', to: ['rarm'], data: { from: 'bia', at: clock.t } }]);
    expect(dm.typing(bia, 'rarm')).toBe(true); // freio: não emite de novo
    expect(sent).toHaveLength(1);
    clock.t += 1_600;
    dm.typing(bia, 'rarm');
    expect(sent).toHaveLength(2);
    expect(dm.typing(rarm, 'outro')).toBe(false);
    expect(dm.typing(rarm, 'ninguem')).toBe(false);
    expect(sent).toHaveLength(2);
  });

  it('busca só nas conversas de quem busca, sem acento nem caixa, as mais novas primeiro', () => {
    const { dm, clock } = setup();
    clock.t += 1000;
    dm.send(bia, { to: 'rarm', text: 'O deploy da Rarm saiu' });
    clock.t += 1000;
    dm.send(caio, { to: 'bia', text: 'Deploy amanhã às 9h' });
    clock.t += 1000;
    dm.send(rarm, { to: 'rarm2', text: 'viu o DEPLOY?' });
    expect(dm.search(bia, 'deploy').map((r) => [r.with.id, r.message.text])).toEqual([
      ['caio', 'Deploy amanhã às 9h'],
      ['rarm', 'O deploy da Rarm saiu'],
    ]);
    expect(dm.search(rarm, 'deploy').map((r) => r.with.id)).toEqual(['rarm2', 'bia']);
    expect(dm.search(outro, 'deploy')).toEqual([]);
    expect(dm.search(caio, 'amanha').map((r) => r.with.id)).toEqual(['bia']);
    expect(dm.search(bia, 'd')).toEqual([]); // curto demais
    expect(dm.search(bia, 42)).toEqual([]);
  });

  it('quem deixou de poder conversar (o cliente mudou de empresa) sai da busca e da conversa', () => {
    const people = [P('ana', 'cliente', ['/proj/Clientes/12-Rarm']), P('beto', 'cliente', ['/proj/Clientes/12-Rarm'])];
    const { dm, clock } = setup({ people });
    clock.t += 1000;
    dm.send(people[0]!, { to: 'beto', text: 'segredo da empresa' });
    expect(dm.search(people[0]!, 'segredo')).toHaveLength(1);
    people[1]!.rooms = ['/proj/Clientes/99-Outro'];
    expect(dm.search(people[0]!, 'segredo')).toEqual([]);
    expect(dm.page(people[0]!, 'beto')).toBeUndefined();
  });
});

describe('conversas das salas', () => {
  it('cada sala guarda uma conversa longa (300 falas, 30 dias)', () => {
    expect(KV_CHAT_HISTORY).toBe(300);
    expect(KV_CHAT_HISTORY_MS).toBe(30 * DAY);
  });
});
