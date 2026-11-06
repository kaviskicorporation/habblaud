// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): um "motor de mentira" para testar os furnishers das
// salas temáticas sem o prédio — monta a casca mínima de uma sala (miolo, porta, colunas livres de parede) e um
// KvFurnishCtx que confere sobreposição como o motor. Puro; usado pelos testes e pela prévia em PNG.
import { FURNITURE, type FurnitureKind } from '../../art/api';
import { hash32, mulberry32 } from '../../../../shared/hash';
import type { KvDoorSide, KvPlanItem } from '../../../../shared/kaviski-plan';
import { AreaBuilder } from '../../world/layout/builder';
import type { AreaLayout } from '../../world/layout/types';
import type { KvFurnishCtx } from './api';
import { kvSpriteDims } from './themes-dims';

export interface KvHarnessRoom {
  ctx: KvFurnishCtx;
  area: AreaLayout;
  tags: Map<string, string[]>;
  /** Tile local caminhável depois da mobília (para a busca do teste). */
  walkable: (lx: number, ly: number) => boolean;
  door: { x: number; y: number }[];
}

const THEME = { carpet: '#d7e2f2', carpet2: '#c9d7ec', wall: { base: '#e9e4da', trim: '#c9bfae' }, accent: '#3f7fd8', deskVariant: 'white', chairVariant: 'gray' };

/** Uma sala w x h com a porta no lado `side` (no meio), em (ox, oy) do mundo. */
export function kvHarnessRoom(ref: string, w: number, h: number, side: KvDoorSide = 's', ox = 10, oy = 20): KvHarnessRoom {
  const item: KvPlanItem = { id: 'el-test', kind: 'tema', ref, x: ox, y: oy, w, h, doors: [{ side, at: side === 'n' || side === 's' ? Math.floor(w / 2) - 1 : Math.floor(h / 2) }] };
  const rect = { x: ox, y: oy, w, h };
  const b = new AreaBuilder(`kv:${item.id}`, 'room', rect);
  const inner = { x: 1, y: 2, w: w - 2, h: h - 3 };
  const at = item.doors![0]!.at;
  // a passagem na frente da porta (2 tiles) e o tile do interruptor
  const door: { x: number; y: number }[] =
    side === 's'
      ? [{ x: at, y: h - 2 }, { x: at + 1, y: h - 2 }]
      : side === 'n'
        ? [{ x: at, y: 2 }, { x: at + 1, y: 2 }]
        : side === 'w'
          ? [{ x: 1, y: at }, { x: 1, y: at + 1 }]
          : [{ x: w - 2, y: at }, { x: w - 2, y: at + 1 }];
  const keepFree = [...door, side === 's' ? { x: at - 1, y: h - 2 } : { x: Math.max(1, at - 1), y: 2 }];
  const sign = new Set([Math.floor(w / 2) - 1, Math.floor(w / 2), Math.floor(w / 2) + 1].map((c) => c + (w >= 12 ? 3 : 0)));
  const wallSlots: KvFurnishCtx['wallSlots'] = [];
  for (let c = 1; c <= w - 2; c++) if (!sign.has(c) && !(side === 'n' && c >= at - 1 && c <= at + 2)) wallSlots.push({ on: 'face', lcx: c + 0.5 });
  const occ = new Set<string>();
  const wallOcc = new Set<number>();
  const keep = new Set(keepFree.map((k) => `${k.x},${k.y}`));
  const tags = new Map<string, string[]>();
  const rng = mulberry32(hash32(ref + w + 'x' + h));
  const inside = (x: number, y: number) => x >= inner.x && y >= inner.y && x < inner.x + inner.w && y < inner.y + inner.h;
  const free = (x: number, y: number, fw = 1, fh = 1) => {
    for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) if (!inside(xx, yy) || occ.has(`${xx},${yy}`) || keep.has(`${xx},${yy}`)) return false;
    return true;
  };
  const take = (x: number, y: number, fw: number, fh: number) => {
    for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) occ.add(`${xx},${yy}`);
  };
  const fp = (k: FurnitureKind) => FURNITURE[k].footprint;
  const ctx: KvFurnishCtx = {
    item,
    rect,
    inner,
    keepFree,
    wallSlots,
    theme: THEME,
    seed: hash32(ref),
    rng,
    b,
    furn(kind, lx, ly, variant, o) {
      const f = fp(kind);
      if (!free(lx, ly, f.w, f.h)) return null;
      take(lx, ly, f.w, f.h);
      return b.furn(kind, lx, ly, variant, o);
    },
    seat(kind, fk, lx, ly, dir, variant, o) {
      const f = fp(fk);
      if (!free(lx, ly, f.w, f.h)) return null;
      take(lx, ly, f.w, f.h);
      return b.seat(kind, fk, lx, ly, dir, variant, o);
    },
    spot(kind, lx, ly, dir, o) {
      if (!inside(lx, ly) || keep.has(`${lx},${ly}`)) return null;
      return b.spot(kind, lx, ly, dir, o);
    },
    wall(kind, lcx, variant, o) {
      const n = kvSpriteDims(variant)?.w ?? Math.max(1, fp(kind).w);
      const c0 = Math.round(lcx - n / 2);
      const cols = [...Array(n).keys()].map((i) => c0 + i);
      if (cols.some((c) => wallOcc.has(c) || !wallSlots.some((s) => Math.floor(s.lcx) === c))) return null;
      cols.forEach((c) => wallOcc.add(c));
      return b.wall(kind, lcx, variant, o);
    },
    free,
    tag(id, action) {
      tags.set(id, [...(tags.get(id) ?? []), action]);
    },
  };
  const walkable = (lx: number, ly: number) => {
    if (!inside(lx, ly)) return false;
    const ax = lx + ox;
    const ay = ly + oy;
    for (const f of b.area.furniture) {
      const d = FURNITURE[f.kind];
      if (!d.blocks && !d.seat) continue;
      if (ax >= f.tx && ax < f.tx + d.footprint.w && ay >= f.ty && ay < f.ty + d.footprint.h) return false;
    }
    return true;
  };
  return { ctx, area: b.area, tags, walkable, door };
}
