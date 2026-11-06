// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): o motor do prédio monta qualquer planta com caminho para tudo.
import { describe, expect, it } from 'vitest';
import { FURNITURE, type RoomTheme } from '../../art/api';
import { kvNormPlan, type KvPlan } from '../../../../shared/kaviski-plan';
import { coreAreas } from '../../world/layout/building';
import { layoutProjectRoom } from '../../world/layout/room';
import type { AreaLayout } from '../../world/layout/types';
import { kvBuildFromStatics, kvPlanStatics, kvTranslateArea } from './engine-build';
import { kvFixedSlot, kvIndexPlan, kvSlotPlace, kvStripCount, kvStripPlace } from './engine-geom';
import { kvLayoutPlanRoom } from './engine-room';
import { kvPlanClassic, kvPlanExample } from './examples';
import './furnish-projeto';
import './furnish-propria';
import './furnish-tema';

const THEME: RoomTheme = { carpet: '#7a8fb0', carpet2: '#9aaccc', wall: { base: '#e8e4dc', trim: '#a39a8a', pattern: 'plain' }, accent: '#4a6fa5', deskVariant: 'wood', chairVariant: 'black' };
const themeFor = () => THEME;
const norm = (p: KvPlan) => {
  const r = kvNormPlan(p);
  expect(r.problems).toEqual([]);
  return r.plan!;
};

/** Toda porta/spot de todas as áreas é alcançável a partir do elevador. */
function allReachable(b: ReturnType<typeof kvBuildFromStatics>): { ok: boolean; bad: string[] } {
  const elev = b.spots.find((s) => s.kind === 'elevator')!;
  const n = b.grid.nearestWalkable(elev.tx, elev.ty, 3)!;
  const reach = b.grid.reachableFrom(n.x, n.y);
  const bad: string[] = [];
  for (const s of b.spots) {
    const t = b.grid.walkable(s.tx, s.ty) ? { x: s.tx, y: s.ty } : b.grid.nearestWalkable(s.tx, s.ty, 2);
    if (!t || !reach[t.y * b.grid.w + t.x]) bad.push(s.id);
  }
  return { ok: !bad.length, bad };
}

function room(id: string, slot: number, plan: KvPlan): AreaLayout {
  const ix = kvIndexPlan(plan);
  const p = kvSlotPlace(ix, slot);
  return kvLayoutPlanRoom({ id, rect: p.rect, doors: p.doors, theme: THEME, seed: 7, item: p.item ?? { id: 'el-auto', kind: 'projeto', ...p.rect, doors: p.doors }, furnisher: 'projeto' });
}

describe('motor da planta', () => {
  it('translada uma área inteira (ids estáveis)', () => {
    const rec = coreAreas()[0];
    const t = kvTranslateArea(rec, 10, 5);
    expect(t.id).toBe(rec.id);
    expect(t.rect).toEqual({ ...rec.rect, x: rec.rect.x + 10, y: rec.rect.y + 5 });
    expect(t.spots.map((s) => s.id)).toEqual(rec.spots.map((s) => s.id));
    expect(t.spots[0].x).toBe(rec.spots[0].x + 160);
    expect(t.furniture[0].tx).toBe(rec.furniture[0].tx + 10);
  });

  it('faixa automática: pares norte/sul como o prédio original', () => {
    const auto = { x: 32, y: 0, dir: 'e' as const };
    expect(kvStripPlace(auto, 0).rect).toEqual({ x: 32, y: 0, w: 16, h: 12 });
    expect(kvStripPlace(auto, 1).rect).toEqual({ x: 32, y: 17, w: 16, h: 12 });
    expect(kvStripPlace(auto, 2).rect.x).toBe(48);
    expect(kvStripPlace(auto, 1).doors).toEqual([{ side: 'n', at: 7 }]);
    const v = kvStripPlace({ x: 0, y: 40, dir: 's' }, 3);
    expect(v.rect).toEqual({ x: 21, y: 52, w: 16, h: 12 });
    expect(v.doors[0].side).toBe('w');
  });

  it('slots: lugar marcado, vagas por ordem, depois a faixa', () => {
    const plan = norm({
      ...kvPlanClassic({ vagas: 2 }),
      items: [...kvPlanClassic({ vagas: 2 }).items, { id: 'el-sala', kind: 'projeto', ref: '/home/a/proj', x: 0, y: 40, w: 12, h: 10, doors: [{ side: 'n', at: 4 }] }],
      h: 60,
    });
    const ix = kvIndexPlan(plan);
    const fixed = kvFixedSlot(ix, '/home/a/proj');
    expect(fixed).toBeLessThan(0);
    expect(kvSlotPlace(ix, fixed!).rect).toEqual({ x: 0, y: 40, w: 12, h: 10 });
    expect(kvSlotPlace(ix, 0).item?.id).toBe('el-vaga0');
    expect(kvSlotPlace(ix, 2).strip).toBe(true);
    expect(kvSlotPlace(ix, 2).rect.x).toBe(48);
    expect(kvStripCount(ix, [0, 1, 2])).toBe(2);
  });

  it('o Clássico tem caminho da recepção até todas as salas da faixa', () => {
    const plan = norm(kvPlanClassic());
    const rooms = [0, 1, 2, 3, 4].map((k) => room(`/p/${k}`, k, plan));
    const st = kvPlanStatics(plan, kvStripCount(kvIndexPlan(plan), [0, 1, 2, 3, 4]), themeFor);
    const b = kvBuildFromStatics(st, rooms);
    expect(b.kv.bridges).toEqual([]);
    expect(allReachable(b)).toEqual({ ok: true, bad: [] });
    expect(b.corridor.id).toBe('kv:auto');
    // os elevadores continuam com os mesmos ids (o Sim guarda o id)
    expect(b.spots.filter((s) => s.kind === 'elevator').map((s) => s.id)).toEqual(coreAreas()[0].spots.filter((s) => s.kind === 'elevator').map((s) => s.id));
  });

  it('a empresa de exemplo monta sem buraco e com caminho para tudo', () => {
    const plan = norm(kvPlanExample());
    const ix = kvIndexPlan(plan);
    const slots = [0, 1, 2, 3, 4, 5, ix.vagas.length, ix.vagas.length + 1];
    const rooms = slots.map((s) => room(`/p/${s}`, s, plan));
    const st = kvPlanStatics(plan, kvStripCount(ix, slots), themeFor, ix);
    const b = kvBuildFromStatics(st, rooms);
    expect(allReachable(b).bad).toEqual([]);
    expect(st.areas.some((a) => a.id === 'kv:el-rh')).toBe(true);
  });

  it('parte solta ganha caminho de pedra pela grama', () => {
    const plan = norm({
      v: 1,
      on: true,
      w: 80,
      h: 40,
      auto: { x: 200, y: 0, dir: 'e' },
      items: [
        { id: 'el-r', kind: 'nucleo', ref: 'recepcao', x: 0, y: 0, w: 16, h: 12 },
        { id: 'el-c', kind: 'corredor', x: 0, y: 12, w: 30, h: 5 },
        // sala solta, com a porta para a grama
        { id: 'el-t', kind: 'tema', ref: 'rh', x: 50, y: 20, w: 12, h: 10, doors: [{ side: 'n', at: 4 }] },
      ],
    });
    const st = kvPlanStatics(plan, 0, themeFor);
    const b = kvBuildFromStatics(st, []);
    expect(b.kv.bridges.length).toBeGreaterThan(0);
    expect(allReachable(b).bad).toEqual([]);
  });

  it('sem recepção na planta, ela entra num lugar livre (sempre há elevador)', () => {
    const plan = norm({ v: 1, on: true, w: 60, h: 30, auto: { x: 0, y: 40, dir: 'e' }, items: [{ id: 'el-c', kind: 'corredor', x: 0, y: 12, w: 40, h: 5 }] });
    const st = kvPlanStatics(plan, 0, themeFor);
    expect(st.items.some((it) => it.ref === 'recepcao')).toBe(true);
    const b = kvBuildFromStatics(st, []);
    expect(b.spots.some((s) => s.kind === 'elevator')).toBe(true);
  });

  for (const [w, h] of [
    [10, 9],
    [16, 12],
    [24, 14],
    [40, 20],
  ] as const) {
    it(`sala de projeto ${w}x${h}: mesas com deskId, porta livre, nada sobreposto`, () => {
      for (const side of ['s', 'n', 'e', 'w'] as const) {
        const at = side === 'e' || side === 'w' ? 3 : 3;
        const a = kvLayoutPlanRoom({ id: 'r', rect: { x: 5, y: 5, w, h }, doors: [{ side, at }], theme: THEME, seed: 3, item: { id: 'el-x', kind: 'projeto', x: 5, y: 5, w, h }, furnisher: 'projeto' });
        const desks = a.spots.filter((s) => s.kind === 'desk');
        expect(desks.length).toBeGreaterThan(0);
        for (const d of desks) expect(a.furniture.some((f) => f.id === d.deskId)).toBe(true);
        // o quadro kanban cabe na face (numa sala estreita com a porta no norte, a placa ganha)
        if (w >= 14 || side !== 'n') expect(a.wallItems.some((wi) => wi.kind === 'whiteboard'), `${w}x${h} ${side}`).toBe(true);
        // móveis de chão não se sobrepõem e ficam no miolo
        const used = new Set<string>();
        for (const f of a.furniture) {
          const fp = FURNITURE[f.kind].footprint;
          if (FURNITURE[f.kind].mount !== 'floor') continue;
          for (let y = f.ty; y < f.ty + fp.h; y++) {
            for (let x = f.tx; x < f.tx + fp.w; x++) {
              expect(used.has(`${x},${y}`), `${f.id} em ${x},${y}`).toBe(false);
              used.add(`${x},${y}`);
              expect(x >= 6 && x <= 5 + w - 2 && y >= 7 && y <= 5 + h - 2).toBe(true);
            }
          }
        }
      }
    });
  }

  it('sala de projeto 16x12 na faixa: o mesmo layout do original (transladado)', () => {
    const orig = layoutProjectRoom({ id: 'p', slot: 0, seed: 42 }, THEME);
    const t = kvTranslateArea(orig, 64 - 32, 0);
    expect(t.rect).toEqual({ x: 64, y: 0, w: 16, h: 12 });
    expect(t.spots.length).toBe(orig.spots.length);
  });
});
