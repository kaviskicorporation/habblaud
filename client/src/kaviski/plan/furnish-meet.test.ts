// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): a mobília das salas de reunião, nos 6 layouts —
// no prédio original (16x12, norte e sul) e na planta livre (8x8 a 40x28, porta em cada lado): nada sobreposto, todo
// assento/lugar alcançável da porta, a passagem da porta livre, capacidade coerente com o tipo e o painel de reservas
// (ação `reunioes`) com lugar de uso alcançável.
import { describe, expect, it } from 'vitest';
import { FURNITURE, type RoomTheme } from '../../art/api';
import { KV_MEET_LAYOUT_INFO, KV_MEET_LAYOUTS, kvDefaultMeet, type KvMeetLayout } from '../../../../shared/kaviski-meetings';
import type { KvDoorSide, KvPlanDoor } from '../../../../shared/kaviski-plan';
import type { AreaLayout } from '../../world/layout/types';
import { kvDecorFree, kvOwnRoomTags, layoutOwnRoom } from '../humanos/rooms-layout';
import { kvLayoutPlanRoom } from './engine-room';
import { KV_MEET_ACTION, kvMeetSeats } from './furnish-meet';
import './furnish-propria';
import { kvSpriteDims } from './themes-dims';
import { kvComputeActionSpots } from './themes-spots';

const THEME: RoomTheme = { carpet: '#7a8fb0', carpet2: '#9aaccc', wall: { base: '#e8e4dc', trim: '#a39a8a', pattern: 'plain' }, accent: '#4a6fa5', deskVariant: 'wood', chairVariant: 'black' };

/** Tiles (absolutos) de pé e de assento, e quem a porta alcança. */
function analyse(a: AreaLayout) {
  const key = (x: number, y: number) => `${x},${y}`;
  const walk = new Set<string>();
  for (const r of a.walkable) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) walk.add(key(x, y));
  const occ = new Map<string, string>();
  const problems: string[] = [];
  const seatTiles = new Set<string>();
  for (const f of a.furniture) {
    const d = FURNITURE[f.kind];
    if (d.mount !== 'floor') continue;
    for (let y = f.ty; y < f.ty + d.footprint.h; y++)
      for (let x = f.tx; x < f.tx + d.footprint.w; x++) {
        const k = key(x, y);
        if (occ.has(k)) problems.push(`${f.id} em cima de ${occ.get(k)} (${k})`);
        if (!walk.has(k)) problems.push(`${f.id} fora do piso (${k})`);
        occ.set(k, f.id);
        if (d.seat) seatTiles.add(k);
      }
  }
  for (const r of a.blocked ?? []) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) occ.set(key(x, y), occ.get(key(x, y)) ?? 'block');
  const free = (x: number, y: number) => walk.has(key(x, y)) && !occ.has(key(x, y));
  const seen = new Set<string>();
  const q: [number, number][] = [];
  const d = a.door!;
  for (let y = d.y; y < d.y + d.h; y++)
    for (let x = d.x; x < d.x + d.w; x++)
      if (free(x, y)) {
        seen.add(key(x, y));
        q.push([x, y]);
      }
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = key(x + dx, y + dy);
      if (seen.has(k) || !free(x + dx, y + dy)) continue;
      seen.add(k);
      q.push([x + dx, y + dy]);
    }
  }
  const reached = (x: number, y: number) => seen.has(key(x, y));
  for (const s of a.spots) {
    if (s.seated) {
      if (!seatTiles.has(key(s.tx, s.ty)) && !occ.has(key(s.tx, s.ty))) problems.push(`${s.id} sem assento`);
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reached(s.tx + dx!, s.ty + dy!))) problems.push(`${s.id} sem caminho (${s.tx},${s.ty})`);
    } else {
      if (occ.has(key(s.tx, s.ty))) problems.push(`${s.id} em cima de ${occ.get(key(s.tx, s.ty))}`);
      if (!reached(s.tx, s.ty)) problems.push(`${s.id} sem caminho (${s.tx},${s.ty})`);
    }
    if (!['desk', 'stool', 'nook', 'stand', 'switch', 'whiteboard'].includes(s.kind)) problems.push(`${s.id}: lugar que atrai agente (${s.kind})`);
  }
  // itens de parede sem sobreposição (na mesma parede)
  const spans: [number, number, string, string][] = [];
  for (const w of a.wallItems) {
    const half = ((kvSpriteDims(w.variant)?.w ?? FURNITURE[w.kind].footprint.w) * 16) / 2;
    const lo = w.cx - half + 1;
    const hi = w.cx + half - 1;
    const wall = `${w.on}:${w.baseY}`;
    for (const [l, h, id, on] of spans) if (on === wall && lo < h && hi > l) problems.push(`${w.id} em cima de ${id} na parede`);
    spans.push([lo, hi, w.id, wall]);
  }
  return { problems, occ, reached, free };
}

function panelOk(a: AreaLayout, tags: ReadonlyMap<string, readonly string[]> | undefined, free: (x: number, y: number) => boolean, reached: (x: number, y: number) => boolean): string | null {
  const ids = [...(tags ?? new Map()).entries()].filter(([, v]) => v.includes(KV_MEET_ACTION));
  if (!ids.length) return 'sem item reunioes';
  const spots = kvComputeActionSpots([a], tags!, free).filter((s) => s.action === KV_MEET_ACTION);
  if (!spots.length) return 'sem lugar de uso do painel';
  if (!spots.some((s) => reached(s.tx, s.ty))) return 'lugar de uso do painel sem caminho';
  return null;
}

// ------------------------------------------------------------------ prédio original (16x12)

describe('sala de reunião no prédio original (16x12)', () => {
  for (const layout of KV_MEET_LAYOUTS) {
    it(`${layout}: norte e sul sem sobreposição, tudo alcançável, porta livre e painel de reservas`, () => {
      for (const slot of [0, 1]) {
        const north = slot === 0;
        const a = layoutOwnRoom({ id: 'kvsala-teste', slot, seed: 3 }, THEME, { kind: 'reuniao', decor: [], meet: kvDefaultMeet(layout) });
        const r = analyse(a);
        expect(r.problems, `${layout} ${north ? 'norte' : 'sul'}`).toEqual([]);
        // a passagem da porta (colunas 6–9) e o interruptor ficam livres
        const rx = a.rect.x;
        const ry = a.rect.y;
        for (let x = 6; x <= 9; x++) for (const y of north ? [8, 9, 10] : [2, 3]) expect(r.occ.has(`${rx + x},${ry + y}`), `${layout} ${x},${y}`).toBe(false);
        expect(panelOk(a, kvOwnRoomTags(a), r.free, r.reached), layout).toBeNull();
        const seats = kvMeetSeats(a);
        const cap = KV_MEET_LAYOUT_INFO[layout].capacity;
        expect(seats, `${layout}: ${seats} lugares`).toBeGreaterThanOrEqual(Math.min(cap, 6));
        expect(seats, `${layout}: ${seats} lugares`).toBeLessThanOrEqual(Math.max(cap * 2, 8));
      }
    });
  }

  it('a capacidade acompanha o tipo (cabine pequena, treinamento e conselho grandes)', () => {
    const n = (l: KvMeetLayout) => kvMeetSeats(layoutOwnRoom({ id: 'kvsala-x', slot: 0, seed: 1 }, THEME, { kind: 'reuniao', decor: [], meet: kvDefaultMeet(l) }));
    expect(n('cabine')).toBeLessThan(n('reuniao'));
    expect(n('treinamento')).toBeGreaterThanOrEqual(18);
    expect(n('conselho')).toBeGreaterThanOrEqual(12);
  });

  it('sala sem `meet` (antiga) = layout reunião; a tela de decoração vê o layout', () => {
    const old = layoutOwnRoom({ id: 'kvsala-x', slot: 0, seed: 1 }, THEME, { kind: 'reuniao', decor: [] });
    const neu = layoutOwnRoom({ id: 'kvsala-x', slot: 0, seed: 1 }, THEME, { kind: 'reuniao', decor: [], meet: kvDefaultMeet('reuniao') });
    expect(old.furniture.map((f) => [f.kind, f.tx, f.ty])).toEqual(neu.furniture.map((f) => [f.kind, f.tx, f.ty]));
    const free = kvDecorFree('reuniao', THEME);
    expect(kvDecorFree('reuniao', THEME, 'reuniao').floor).toEqual(free.floor);
    expect(kvDecorFree('reuniao', THEME, 'treinamento').floor.size).toBeLessThan(free.floor.size);
    // o painel de reservas ocupa a parede (a decoração não entra nele)
    expect(free.wall.some(([a, b]) => a <= 5.5 && b >= 5.5)).toBe(true);
  });
});

// ------------------------------------------------------------------ planta livre

const SIZES: [number, number][] = [
  [8, 8],
  [10, 9],
  [14, 10],
  [20, 12],
  [20, 14],
  [30, 20],
  [40, 28],
  [9, 16],
];
const SIDES: KvDoorSide[] = ['s', 'n', 'e', 'w'];

function planRoom(layout: KvMeetLayout, w: number, h: number, side: KvDoorSide) {
  const at = side === 'n' || side === 's' ? Math.floor(w / 2) - 1 : Math.floor(h / 2);
  const doors: KvPlanDoor[] = [{ side, at }];
  const info = { id: 'kvsala-x', name: 'Sala', seed: 1, slot: 0, kvOwn: { kind: 'reuniao', decor: [], meet: kvDefaultMeet(layout) } } as never;
  const tags = new Map<string, string[]>();
  const a = kvLayoutPlanRoom({ id: 'kvsala-x', rect: { x: 4, y: 6, w, h }, doors, theme: THEME, seed: 5, item: { id: 'el-p', kind: 'propria', ref: 'kvsala-x', x: 4, y: 6, w, h, doors }, furnisher: 'propria:reuniao', info, tags });
  return { a, tags, doors };
}

/** Os tiles (absolutos) da passagem da porta (2 para dentro), como o motor reserva. */
function passage(w: number, h: number, d: KvPlanDoor): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 2; i++) {
    if (d.side === 'n') for (const y of [2, 3]) out.push([4 + d.at + i, 6 + y]);
    else if (d.side === 's') for (const y of [h - 2, h - 3]) out.push([4 + d.at + i, 6 + y]);
    else if (d.side === 'w') for (const x of [1, 2]) out.push([4 + x, 6 + d.at + i]);
    else for (const x of [w - 2, w - 3]) out.push([4 + x, 6 + d.at + i]);
  }
  return out;
}

describe('sala de reunião na planta livre (8x8 a 40x28, porta em qualquer lado)', () => {
  for (const layout of KV_MEET_LAYOUTS) {
    it(`${layout}: sem sobreposição, tudo alcançável da porta, porta livre e o painel de reservas marcado`, () => {
      for (const [w, h] of SIZES) {
        for (const side of SIDES) {
          const { a, tags, doors } = planRoom(layout, w, h, side);
          const what = `${layout} ${w}x${h} porta ${side}`;
          const r = analyse(a);
          expect(r.problems, what).toEqual([]);
          for (const [x, y] of passage(w, h, doors[0]!)) expect(r.occ.has(`${x},${y}`), `${what}: passagem ${x},${y}`).toBe(false);
          expect(panelOk(a, tags, r.free, r.reached), what).toBeNull();
          expect(kvMeetSeats(a), `${what}: lugares`).toBeGreaterThanOrEqual(1);
        }
      }
    });
  }

  it('capacidade coerente no tamanho sugerido e crescendo com a sala', () => {
    const seats = (l: KvMeetLayout, w: number, h: number) => kvMeetSeats(planRoom(l, w, h, 's').a);
    for (const l of KV_MEET_LAYOUTS) {
      const i = KV_MEET_LAYOUT_INFO[l];
      const n = seats(l, i.w, i.h);
      expect(n, `${l} ${i.w}x${i.h}: ${n} lugares`).toBeGreaterThanOrEqual(Math.ceil(i.capacity * 0.75));
      expect(n, `${l} ${i.w}x${i.h}: ${n} lugares`).toBeLessThanOrEqual(Math.max(i.capacity * 2, 6));
      expect(seats(l, 40, 28), `${l} 40x28`).toBeGreaterThan(n);
    }
    expect(seats('cabine', 8, 8)).toBeLessThanOrEqual(4);
    expect(seats('treinamento', 20, 14)).toBeGreaterThanOrEqual(20);
    expect(seats('treinamento', 40, 28)).toBeGreaterThan(seats('reuniao', 40, 28));
  });

  it('cada layout tem a sua chave de furnisher e a sala sem `meet` usa a reunião', () => {
    const doors: KvPlanDoor[] = [{ side: 's', at: 6 }];
    const info = { id: 'kvsala-x', name: 'Sala', seed: 1, slot: 0, kvOwn: { kind: 'reuniao', decor: [] } } as never;
    const base = { id: 'kvsala-x', rect: { x: 0, y: 0, w: 14, h: 10 }, doors, theme: THEME, seed: 5, item: { id: 'el-p', kind: 'propria' as const, ref: 'kvsala-x', x: 0, y: 0, w: 14, h: 10, doors }, info };
    const old = kvLayoutPlanRoom({ ...base, furnisher: 'propria:reuniao' });
    const neu = kvLayoutPlanRoom({ ...base, furnisher: 'propria:reuniao:reuniao' });
    expect(old.furniture.length).toBe(neu.furniture.length);
    const cab = kvLayoutPlanRoom({ ...base, furnisher: 'propria:reuniao:cabine' });
    expect(cab.furniture.some((f) => f.variant === 'kv-call-desk')).toBe(true);
  });
});
