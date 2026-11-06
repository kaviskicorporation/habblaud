// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): onde o boneco fica para usar cada item interativo.
// Puro (sem DOM): o motor do prédio (frente A) guarda os `ctx.tag(id, ação)` e chama esta função depois de cada
// relayout. Vale para móvel (`#f`), item de parede (`#w`) e spot (`#s`), ids do AreaBuilder.
import { FURNITURE, type Dir } from '../../art/api';
import { FOOT_DX, FOOT_DY, TILE } from '../../world/constants';
import type { AreaLayout } from '../../world/layout/types';
import type { KvActionSpot } from './api';
import { kvSpriteDims } from './themes-dims';

type Walkable = (tx: number, ty: number) => boolean;

/** Quanto o desenho de um item sobe acima do footprint (px), para a caixa do contorno. */
const RISE: Record<string, number> = { plant_tall: 24, bookshelf: 20, binder_shelf: 20, filing_cabinet: 8, vending_machine: 20, fridge: 18, arcade: 16, water_cooler: 12 };

/** Os tiles de onde dá para usar um móvel (w x h em tx,ty): embaixo (do meio para as pontas), dos lados, em cima. */
export function kvApproachTiles(tx: number, ty: number, w: number, h: number): { tx: number; ty: number; dir: Dir }[] {
  const out: { tx: number; ty: number; dir: Dir }[] = [];
  const mid = (w - 1) / 2;
  const cols = [...Array(w).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  for (const c of cols) out.push({ tx: tx + c, ty: ty + h, dir: 'up' });
  for (let r = h - 1; r >= 0; r--) {
    out.push({ tx: tx - 1, ty: ty + r, dir: 'right' });
    out.push({ tx: tx + w, ty: ty + r, dir: 'left' });
  }
  for (const c of cols) out.push({ tx: tx + c, ty: ty - 1, dir: 'down' });
  return out;
}

function standAt(area: AreaLayout, id: string, action: string, t: { tx: number; ty: number; dir: Dir }, x: number, y: number, box: KvActionSpot['box'], furnitureId?: string): KvActionSpot {
  return { action, areaId: area.id, tx: t.tx, ty: t.ty, dir: t.dir, x, y, furnitureId: furnitureId ?? id, box };
}

/** Os lugares de uso de todos os itens marcados (um por item; o mesmo item pode ter mais de uma ação). */
export function kvComputeActionSpots(areas: Iterable<AreaLayout>, tags: ReadonlyMap<string, string | readonly string[]>, walkable: Walkable): KvActionSpot[] {
  const out: KvActionSpot[] = [];
  if (!tags.size) return out;
  for (const area of areas) {
    const take = (id: string): string[] => {
      const v = tags.get(id);
      return v === undefined ? [] : typeof v === 'string' ? [v] : [...v];
    };
    for (const s of area.spots) {
      for (const action of take(s.id)) {
        out.push({ action, areaId: area.id, tx: s.tx, ty: s.ty, dir: s.dir, x: s.x, y: s.y - 10, furnitureId: s.furnitureId ?? s.id, box: { x: s.tx * TILE, y: s.ty * TILE - TILE, w: TILE, h: 2 * TILE } });
      }
    }
    for (const f of area.furniture) {
      const acts = take(f.id);
      if (!acts.length) continue;
      const fp = FURNITURE[f.kind].footprint;
      const rise = kvSpriteDims(f.variant)?.rise ?? RISE[f.kind] ?? 12;
      const box = { x: f.tx * TILE + (f.dx ?? 0), y: f.ty * TILE - rise + (f.dy ?? 0), w: fp.w * TILE, h: fp.h * TILE + rise };
      const t = kvApproachTiles(f.tx, f.ty, fp.w, fp.h).find((c) => walkable(c.tx, c.ty));
      if (!t) continue;
      for (const action of acts) out.push(standAt(area, f.id, action, t, box.x + box.w / 2, box.y + box.h / 2, box));
    }
    for (const w of area.wallItems) {
      const acts = take(w.id);
      if (!acts.length) continue;
      const fw = (kvSpriteDims(w.variant)?.w ?? Math.max(1, FURNITURE[w.kind].footprint.w)) * TILE;
      const south = w.on === 'south';
      const box = south ? { x: w.cx - fw / 2, y: w.baseY - TILE, w: fw, h: TILE } : { x: w.cx - fw / 2, y: w.baseY - 2 * TILE + 4, w: fw, h: 2 * TILE - 6 };
      // face: o boneco fica na primeira linha de piso, embaixo do item, virado para cima; sul: em cima da mureta
      const col = Math.floor(w.cx / TILE);
      const row = south ? Math.round(w.baseY / TILE) - 2 : Math.round(w.baseY / TILE);
      const step = south ? -1 : 1;
      const dir: Dir = south ? 'down' : 'up';
      const cands: { tx: number; ty: number; dir: Dir }[] = [];
      for (const dy of [0, step]) for (const dx of [0, -1, 1, -2, 2]) cands.push({ tx: col + dx, ty: row + dy, dir });
      const t = cands.find((c) => walkable(c.tx, c.ty));
      if (!t) continue;
      for (const action of acts) out.push(standAt(area, w.id, action, t, w.cx, box.y + box.h / 2, box));
    }
  }
  return out;
}

/** Os pés do boneco no lugar de uso (px de mundo). */
export function kvSpotFeet(s: KvActionSpot): { x: number; y: number } {
  return { x: s.tx * TILE + FOOT_DX, y: s.ty * TILE + FOOT_DY };
}
