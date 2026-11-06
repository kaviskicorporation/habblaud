// Fork Kaviski (KAVISKI-HUMANOS.md): mesa fixa (desk.ts), pose na posição e a mesa na presença.
import type http from 'node:http';
import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../../shared/types';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { kvParsePos, type KvPos } from '../../../shared/kaviski-presence';
import { kvParseDesk, kvSameDesk } from '../../../shared/kaviski-desk';
import { kvCheckDesk, kvDeskOf } from './desk';
import { KvPresence } from './presence';

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
    accounts: [],
    meta: { demo: false, sources: [], startedAt: 0, version: '1' },
  } as unknown as OfficeSnapshot;
}

const person = (id: string, role: string, rooms: string[] = []): KvPerson => ({ id, user: id, name: id, role: role as KvPerson['role'], rooms });
const desk = (r: string, x: number, y: number, s: 'n' | 's' = 'n'): KvPos => ({ k: 'r', r, x, y, s, d: 'up', m: 0 });

describe('pose na posição', () => {
  it('leva pose, item e descanso conhecidos; ignora o resto', () => {
    expect(kvParsePos({ k: 'a', x: 10, y: 20, d: 'up', m: 0, p: 'sit', h: 'coffee', z: 1 })).toMatchObject({ p: 'sit', h: 'coffee', z: 1 });
    const odd = kvParsePos({ k: 'a', x: 10, y: 20, d: 'up', m: 0, p: 'voar', h: 'espada', z: 2 })!;
    expect(odd.p).toBeUndefined();
    expect(odd.h).toBeUndefined();
    expect(odd.z).toBeUndefined();
  });
});

describe('mesa fixa: formato', () => {
  it('só posição de sala, parada', () => {
    expect(kvParseDesk({ k: 'r', r: 'r1', x: 40, y: 77, s: 'n', d: 'up', m: 1, p: 'sit' }, kvParsePos)).toEqual(desk('r1', 40, 77));
    expect(kvParseDesk({ k: 'a', x: 40, y: 77, d: 'up', m: 0 }, kvParsePos)).toBeUndefined();
    expect(kvParseDesk({ k: 'r', r: 'r1', x: -4, y: 77, d: 'up', m: 0 }, kvParsePos)).toBeUndefined();
    expect(kvParseDesk({ k: 'r', r: 'r1', x: 40, y: 900, d: 'up', m: 0 }, kvParsePos)).toBeUndefined();
    expect(kvParseDesk('x', kvParsePos)).toBeUndefined();
  });
  it('a mesma cadeira vista do outro lado do corredor (y espelhado)', () => {
    expect(kvSameDesk(desk('r1', 40, 77), desk('r1', 42, 75))).toBe(true);
    expect(kvSameDesk(desk('r1', 40, 77), desk('r1', 40, 192 - 77, 's'))).toBe(true);
    expect(kvSameDesk(desk('r1', 40, 77), desk('r1', 72, 77))).toBe(false);
    expect(kvSameDesk(desk('r1', 40, 77), desk('r2', 40, 77))).toBe(false);
    expect(kvSameDesk(undefined, desk('r2', 40, 77))).toBe(false);
  });
});

describe('mesa fixa: quem pode', () => {
  const profiles = new Map<string, Record<string, unknown>>();
  const deps = { snapshot, profile: (id: string) => ({ ...(profiles.get(id) ?? {}) }), ids: () => [...profiles.keys()] };
  it('cliente só nas salas dele; sala que não existe, não', () => {
    const rarm = person('rarm', 'cliente', ['/proj/Clientes/12-Rarm']);
    expect(kvCheckDesk(desk('r1', 40, 77), rarm, deps)).toMatchObject({ ok: true });
    expect(kvCheckDesk(desk('r2', 40, 77), rarm, deps)).toMatchObject({ ok: false, status: 403 });
    expect(kvCheckDesk(desk('r9', 40, 77), person('bia', 'equipe'), deps)).toMatchObject({ ok: false, status: 403 });
    expect(kvCheckDesk(desk('r2', 40, 77), person('bia', 'equipe'), deps)).toMatchObject({ ok: true });
    expect(kvCheckDesk({ k: 'a', x: 1, y: 1, d: 'up', m: 0 }, person('bia', 'equipe'), deps)).toMatchObject({ ok: false, status: 400 });
  });
  it('tirar a mesa sempre pode; visitante não tem mesa', () => {
    expect(kvCheckDesk(null, person('v', 'visitante'), deps)).toEqual({ ok: true, desk: null });
    expect(kvCheckDesk(desk('r1', 40, 77), person('v', 'visitante', ['/proj']), deps)).toMatchObject({ ok: false, status: 403 });
  });
  it('a cadeira de outra pessoa não; a minha de novo, sim', () => {
    profiles.set('bia', { desk: desk('r2', 40, 77) });
    profiles.set('caio', {});
    expect(kvCheckDesk(desk('r2', 41, 78), person('caio', 'equipe'), deps)).toMatchObject({ ok: false, status: 409 });
    expect(kvCheckDesk(desk('r2', 41, 78), person('bia', 'equipe'), deps)).toMatchObject({ ok: true });
    expect(kvCheckDesk(desk('r2', 104, 77), person('caio', 'equipe'), deps)).toMatchObject({ ok: true });
  });
  it('perfil com mesa estragada = sem mesa', () => {
    expect(kvDeskOf({ desk: { k: 'r' } })).toBeUndefined();
    expect(kvDeskOf({})).toBeUndefined();
  });
});

describe('mesa na presença', () => {
  it('vai junto da pessoa, só para quem vê a sala', () => {
    const desks: Record<string, KvPos> = { bia: desk('r2', 40, 77), caio: desk('r1', 40, 77) };
    const pres = new KvPresence({ snapshot, look: () => undefined, desk: (id) => desks[id] });
    const fake = () => {
      const res = { writeHead() {}, write: () => true, on() {}, end() {}, destroyed: false, writableEnded: false };
      const req = { socket: { setTimeout() {}, setNoDelay() {} }, on() {} };
      return { req: req as unknown as http.IncomingMessage, res: res as unknown as http.ServerResponse };
    };
    const rarm = person('rarm', 'cliente', ['/proj/Clientes/12-Rarm']);
    const bia = person('bia', 'equipe');
    const caio = person('caio', 'equipe');
    for (const p of [rarm, bia, caio]) {
      const f = fake();
      pres.attach(f.req, f.res, p);
    }
    const byRarm = pres.visibleTo(rarm, snapshot());
    expect(byRarm.find((p) => p.id === 'bia')!.desk).toBeUndefined();
    expect(byRarm.find((p) => p.id === 'caio')!.desk).toMatchObject({ r: 'r1' });
    const byBia = pres.visibleTo(bia, snapshot());
    expect(byBia.find((p) => p.id === 'bia')!.desk).toMatchObject({ r: 'r2' });
    pres.stop();
  });
});
