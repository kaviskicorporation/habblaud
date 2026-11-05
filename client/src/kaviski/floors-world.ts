// Fork Kaviski (KAVISKI.md): layout dos andares (ver floors.ts para a aritmética).
//
// - Térreo: o núcleo e o corredor do original, deslocados para o y do térreo (os ids não mudam: recepção, copa,
//   lounge e banheiros continuam sendo os do original para a vida social).
// - Andares de cima: só a coluna de circulação (coluna 0, exatamente sobre a recepção): ao norte o hall dos
//   elevadores (os elevadores no mesmo x dos da recepção, placa com o andar) com um ponto de café; ao sul a escada e
//   um cantinho de espera. Mais o corredor do andar. Ids com o sufixo `~<andar>`.
// - Área externa com andares: rua e calçada ao sul do térreo (como no original), entrada a oeste do corredor do térreo;
//   telhado acima do último andar e lajes entre os andares pintados na camada base (kvPaintBase).
import { mulberry32 } from '../../../shared/hash';
import { COL_W, CORE_COLS, CORRIDOR_Y, EXT_EAST, EXT_WEST, ROOM_H, SOUTH_Y, TILE } from '../world/constants';
import { AreaBuilder } from '../world/layout/builder';
import { CORE_WALLS, ELEVATOR_CX, layoutCafe, layoutLounge, layoutReception, layoutRestroom } from '../world/layout/core';
import { layoutCorridor } from '../world/layout/corridor';
import type { ExteriorLayout, SlotShell } from '../world/layout/exterior';
import { slotShell } from '../world/layout/exterior';
import type { AreaLayout, ExteriorProp, FloorPatch, TileRect } from '../world/layout/types';
import { FLOOR_PITCH, FLOOR_SLAB, kvBuildingH, kvFloorsOf, kvFloorsOn, kvFloorY, kvGroundY, kvSlotAt, ROOF_H, UPPER_CORE_COLS } from './floors';

/** Sufixo dos ids das áreas de um andar acima do térreo. */
export function kvFloorSuffix(f: number): string {
  return `~${f}`;
}

/** Id da área sem o sufixo do andar, e o andar. */
export function kvSplitAreaId(id: string): { base: string; floor: number } {
  const m = /^(.*)~(\d+)$/.exec(id);
  return m ? { base: m[1], floor: Number(m[2]) } : { base: id, floor: 0 };
}

export const HALL_ID = 'kv:hall';
export const STAIRS_ID = 'kv:escada';

/** Cópia de uma área deslocada `dy` tiles para baixo, com ids (área, móveis, spots, grupos) sufixados. */
export function kvShiftArea(a: AreaLayout, dy: number, sfx: string): AreaLayout {
  if (!dy && !sfx) return a;
  const py = dy * TILE;
  const id = a.id + sfx;
  const rid = (s: string | undefined): string | undefined => (s && sfx && s.startsWith(`${a.id}#`) ? id + s.slice(a.id.length) : s);
  const tr = (r: TileRect): TileRect => ({ ...r, y: r.y + dy });
  return {
    ...a,
    id,
    rect: tr(a.rect),
    floors: a.floors.map((f) => ({ ...f, y: f.y + py })),
    rugs: a.rugs.map((r) => ({ ...r, y: r.y + py })),
    walls: a.walls.map((w) => ({ ...w, y: w.y + py })),
    wallItems: a.wallItems.map((w) => ({ ...w, id: rid(w.id)!, baseY: w.baseY + py })),
    furniture: a.furniture.map((f) => ({ ...f, id: rid(f.id)!, ty: f.ty + dy })),
    spots: a.spots.map((s) => ({
      ...s,
      id: rid(s.id)!,
      areaId: id,
      ty: s.ty + dy,
      y: s.y + py,
      ...(s.sortY !== undefined ? { sortY: s.sortY + py } : {}),
      ...(s.furnitureId ? { furnitureId: rid(s.furnitureId) } : {}),
      ...(s.deskId ? { deskId: rid(s.deskId) } : {}),
      ...(s.group && sfx ? { group: s.group + sfx } : {}),
    })),
    walkable: a.walkable.map(tr),
    ...(a.blocked ? { blocked: a.blocked.map(tr) } : {}),
    ...(a.door ? { door: tr(a.door) } : {}),
    ...(a.shade ? { shade: { ...a.shade, y: a.shade.y + py } } : {}),
  };
}

/** Hall dos elevadores de um andar (coluna 0, norte), em y = 0: elevadores no x dos da recepção + ponto de café. */
function layoutHall(): AreaLayout {
  const b = new AreaBuilder(HALL_ID, 'reception', { x: 0, y: 0, w: COL_W, h: ROOM_H });
  const wall = CORE_WALLS.reception;
  b.floor('marble', 0, 0, 16, 12, 111);
  b.rug(1.5, 3.4, 7, 1.4, '#3d5a80', 112);
  b.face(0.5, 15, wall);
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);
  ELEVATOR_CX.forEach((cx, i) => {
    b.wall('elevator', cx, undefined, { order: 0.2 + i * 0.1 });
    b.spot('elevator', Math.floor(cx - 0.5), 2, 'up', { x: b.px(cx), y: b.py(2) + 2, group: `elevator:${i}` });
  });
  // mostrador do andar (a placa leva o número do andar) entre os elevadores e o café
  b.wall('sign', 9.5, undefined, { order: 0.9 });
  // ponto de café encostado na parede norte
  b.furn('counter', 11, 2, 'drawers', { order: 0.3 });
  for (const lx of [12, 13]) {
    const m = b.furn('coffee_machine', lx, 2, undefined, { order: 0.32 });
    b.spot('coffee', lx, 3, 'up', { dy: -3, furnitureId: m });
  }
  b.furn('water_cooler', 14, 2, undefined, { order: 0.34 });
  b.spot('water', 14, 3, 'up', { dy: -3 });
  b.wall('poster', 12.5, 'coffee', { order: 0.4 });
  b.furn('plant_tall', 1, 2, 'ficus', { order: 0.2 });
  // mesinha bistrô e banco de espera
  b.furn('cafe_table', 12, 6, undefined, { order: 0.5 });
  b.seat('cafe_seat', 'cafe_chair', 11, 6, 'right', 'right', { order: 0.52 });
  b.seat('cafe_seat', 'cafe_chair', 13, 6, 'left', 'left', { order: 0.53 });
  const bench = b.furn('bench', 3, 7, undefined, { order: 0.55 });
  for (let i = 0; i < 2; i++) b.seat('bench', 'bench', 3 + i, 7, 'down', undefined, { noFurniture: true, furnitureId: bench });
  b.furn('plant_small', 5, 7, 'fern', { order: 0.56 });
  b.furn('plant_tall', 14, 9, 'monstera', { order: 0.22 });
  b.wall('clock', 8.15, undefined, { order: 0.7 });
  // aberto para o corredor, com vidro nas pontas (como a recepção)
  for (const lx of [1, 2, 3, 12, 13, 14]) b.furn('glass_partition', lx, 11, 'h', { order: 0.15 });
  b.walk(1, 2, 14, 10);
  b.spot('talk', 6, 9, 'right', { group: 'talk:hall', dx: -1 });
  b.spot('talk', 7, 9, 'left', { group: 'talk:hall', dx: 1 });
  return b.build();
}

/** Escada (coluna 0, sul), em y = 0 (relativo ao sul do corredor): a escada (pintada na base) e um cantinho de espera. */
function layoutStairs(): AreaLayout {
  const b = new AreaBuilder(STAIRS_ID, 'reception', { x: 0, y: 0, w: COL_W, h: ROOM_H });
  const wall = CORE_WALLS.reception;
  // piso só no cantinho: a escada (lx 1..8) é pintada na camada base (kvPaintBase)
  b.floor('marble', 8.5, 0, 7.5, 12, 121);
  b.floor('marble', 0, 0, 1, 12, 122);
  b.face(0.5, 15, wall, [{ lx: 10, w: 3 }]);
  b.wall('door_frame', 11.5, undefined, { order: 0.05 });
  b.south(0.5, 15, 11, wall);
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);
  // divisória de vidro entre a escada e o cantinho
  for (let ly = 2; ly <= 10; ly++) b.furn('glass_partition', 9, ly, ly === 2 || ly === 10 ? 'end' : 'v', { order: 0.1 });
  b.block(1, 2, 8, 9);
  b.walk(10, 2, 5, 9);
  b.walk(10, 0, 3, 2);
  b.area.door = { x: 10, y: 0, w: 3, h: 2 };
  b.seat('armchair', 'armchair', 11, 8, 'right', 'right', { order: 0.6 });
  b.furn('coffee_table', 12, 8, undefined, { order: 0.58 });
  b.seat('armchair', 'armchair', 13, 8, 'left', 'left', { order: 0.61 });
  b.furn('plant_tall', 14, 3, 'palm', { order: 0.22 });
  b.furn('bookshelf', 13, 2, undefined, { order: 0.3 });
  b.spot('shelf', 13, 3, 'up', { dx: 8, dy: -2 });
  b.wall('painting', 14.25, undefined, { order: 0.6 });
  return b.build();
}

let moldCache: { core: AreaLayout[]; hall: AreaLayout; stairs: AreaLayout } | null = null;

function molds(): { core: AreaLayout[]; hall: AreaLayout; stairs: AreaLayout } {
  return (moldCache ??= { core: [layoutReception(), layoutRestroom(), layoutCafe(), layoutLounge()], hall: layoutHall(), stairs: layoutStairs() });
}

const coreCache = new Map<string, AreaLayout[]>();

/**
 * Núcleo do prédio com andares: o do térreo (deslocado, ids originais) + circulação e corredor de cada andar de cima.
 * null sem andares. Cache por (colunas, andares): a mesma área a cada montagem (o renderer não a refaz).
 */
export function kvBuildingCore(cols: number, floors: number): AreaLayout[] | null {
  if (!kvFloorsOn()) return null;
  const key = `${cols}:${floors}:${kvGroundY()}`;
  let list = coreCache.get(key);
  if (list) return list;
  const m = molds();
  list = m.core.map((a) => kvShiftArea(a, kvGroundY(), ''));
  for (let f = 1; f < floors; f++) {
    const y = kvFloorY(f);
    const sfx = kvFloorSuffix(f);
    list.push(kvShiftArea(m.hall, y, sfx), kvShiftArea(m.stairs, y + SOUTH_Y, sfx), kvShiftArea(layoutCorridor(cols), y, sfx));
  }
  coreCache.set(key, list);
  return list;
}

/** Corredor do térreo (deslocado; o id é o original). null sem andares. */
export function kvGroundCorridor(cols: number): AreaLayout | null {
  if (!kvFloorsOn()) return null;
  return kvShiftArea(layoutCorridor(cols), kvGroundY(), '');
}

/** Fechamentos (jardins) dos slots vazios dos andares de cima (o térreo o renderer já faz). */
export function kvUpperShells(b: { cols: number; kvFloors?: number }): SlotShell[] {
  const out: SlotShell[] = [];
  const floors = kvFloorsOf(b);
  for (let f = 1; f < floors; f++) {
    for (let col = UPPER_CORE_COLS; col < b.cols; col++) {
      for (const side of ['north', 'south'] as const) out.push(slotShell(kvSlotAt(col, side, f), col === b.cols - 1));
    }
  }
  return out;
}

/** Margem ao norte (tiles): telhado + bosque. */
const KV_EXT_NORTH = ROOF_H + 14;
const KV_EXT_SOUTH = 24;

/** Área externa com andares (null sem andares: fica a original). Rua ao sul do térreo, como no original. */
export function kvLayoutExterior(cols: number, b: { kvFloors?: number }): ExteriorLayout | null {
  if (!kvFloorsOn()) return null;
  const w = cols * COL_W;
  const H = kvBuildingH(kvFloorsOf(b));
  const G = kvGroundY();
  const bounds: TileRect = { x: -EXT_WEST, y: -KV_EXT_NORTH, w: w + EXT_WEST + EXT_EAST, h: H + KV_EXT_NORTH + KV_EXT_SOUTH };
  const px = (t: number) => t * TILE;
  const floors: FloorPatch[] = [];
  const props: ExteriorProp[] = [];
  const rng = mulberry32(0xc0de + cols);
  const seed = () => Math.floor(rng() * 1e9);
  const south = H;
  const corr = G + CORRIDOR_Y;

  floors.push({ kind: 'grass', x: px(bounds.x), y: px(bounds.y), w: px(bounds.w), h: px(bounds.h), seed: 11 });
  floors.push({ kind: 'sidewalk', x: px(bounds.x), y: px(south + 2), w: px(bounds.w), h: px(2), seed: 12 });
  floors.push({ kind: 'street', x: px(bounds.x), y: px(south + 4), w: px(bounds.w), h: px(5), seed: 13 });
  floors.push({ kind: 'sidewalk', x: px(bounds.x), y: px(south + 9), w: px(bounds.w), h: px(2), seed: 14 });
  // entrada principal (oeste do corredor do térreo) e o caminho até a calçada
  floors.push({ kind: 'sidewalk', x: px(-3), y: px(corr), w: px(3), h: px(5), seed: 15 });
  floors.push({ kind: 'sidewalk', x: px(-3), y: px(corr + 5), w: px(2), h: px(south + 2 - corr - 5), seed: 16 });
  // bosque ao norte, além do telhado
  for (const [row, gap] of [
    [-ROOF_H - 3, 4],
    [-ROOF_H - 7, 6],
    [-ROOF_H - 11, 8],
  ] as const) {
    for (let x = bounds.x + 2; x < bounds.x + bounds.w - 1; x += gap + Math.floor(rng() * 4)) {
      props.push({ kind: rng() < 0.3 ? 'pine' : 'tree', x: px(x) + Math.floor(rng() * 8), y: px(row) - Math.floor(rng() * 12), seed: seed() });
    }
  }
  // árvores a oeste e a leste, ao longo do prédio inteiro (sem tapar a entrada)
  for (const side of [-1, 1]) {
    for (const band of [0, 7, 13]) {
      const baseX = side < 0 ? -6 - band : w + 4 + band;
      for (let y = -ROOF_H + 1; y < H; y += 3 + Math.floor(rng() * 3)) {
        if (side < 0 && band === 0 && y >= corr - 1 && y <= south + 1) continue;
        props.push({ kind: rng() < 0.3 ? 'pine' : 'tree', x: px(baseX + Math.floor(rng() * 5)), y: px(y + 1), seed: seed() });
        if (band === 0 && rng() < 0.5 && y > 0) props.push({ kind: 'bush', x: px(side < 0 ? -2 : w + 1), y: px(y + 2), seed: seed() });
      }
    }
  }
  // cerca viva + flores na fachada sul do térreo (com a passagem do jardim dos slots vazios) e postes
  for (let x = 0; x < w; x += 2) {
    const col = Math.floor(x / COL_W);
    const lx = x - col * COL_W;
    const gate = col >= CORE_COLS && (lx === 6 || lx === 8) ? kvSlotAt(col, 'south', 0) : undefined;
    props.push({ kind: (x / 2) % 3 === 1 ? 'flowers' : 'hedge', x: px(x) + TILE, y: px(south + 1) + 10, seed: x * 7 + 3, whenRoom: gate });
  }
  for (let x = bounds.x + 4; x < bounds.x + bounds.w; x += 10) props.push({ kind: 'lamp', x: px(x), y: px(south + 3) + 6, seed: x });
  for (const row of [13, 17, 21]) {
    for (let x = bounds.x + 3; x < bounds.x + bounds.w - 2; x += 6 + Math.floor(rng() * 5)) {
      props.push({ kind: rng() < 0.2 ? 'pine' : 'tree', x: px(x) + Math.floor(rng() * 10), y: px(south + row) + Math.floor(rng() * 10), seed: seed() });
      if (rng() < 0.3) props.push({ kind: 'bush', x: px(x + 3), y: px(south + row + 1), seed: seed() });
    }
  }
  props.push({ kind: 'bench', x: px(-4), y: px(corr + 3) + 6, seed: 1 });
  props.push({ kind: 'totem', x: px(-3) + 6, y: px(corr + 1), seed: 2 });
  const streetY = px(south + 4);
  const streetH = px(5);
  return {
    bounds,
    floors,
    props,
    lanes: [
      { y: streetY + Math.round(streetH * 0.36), dir: 1 },
      { y: streetY + Math.round(streetH * 0.86), dir: -1 },
    ],
    streetY,
    streetH,
  };
}

// =================================================================== camada base: lajes, fachada, telhado, escada

const SLAB = '#7d766c';
const SLAB_HI = '#a39b8f';
const SLAB_LO = '#5d574f';

/** Pinta na camada base (embaixo das áreas) o que dá a cara de UM prédio: lajes, fachada lateral, telhado e escadas. */
export function kvPaintBase(ctx: CanvasRenderingContext2D, b: { cols: number; kvFloors?: number }): void {
  if (!kvFloorsOn()) return;
  const floors = kvFloorsOf(b);
  const W = b.cols * COL_W * TILE;
  const H = kvBuildingH(floors) * TILE;
  const T = TILE;
  ctx.save();
  // fachada lateral contínua (oeste e leste), do térreo ao telhado
  const side = Math.round(T * 0.5);
  for (const x of [-side, W]) {
    ctx.fillStyle = SLAB;
    ctx.fillRect(x, -T, side, H + T);
    ctx.fillStyle = SLAB_HI;
    ctx.fillRect(x, -T, 2, H + T);
    ctx.fillStyle = SLAB_LO;
    ctx.fillRect(x + side - 2, -T, 2, H + T);
  }
  // lajes entre os andares (viga de concreto com a borda iluminada)
  for (let f = 1; f < floors; f++) {
    const y = (kvFloorY(f) + FLOOR_PITCH - FLOOR_SLAB) * T;
    ctx.fillStyle = SLAB;
    ctx.fillRect(-side, y, W + side * 2, FLOOR_SLAB * T);
    ctx.fillStyle = SLAB_HI;
    ctx.fillRect(-side, y, W + side * 2, 3);
    ctx.fillStyle = SLAB_LO;
    ctx.fillRect(-side, y + FLOOR_SLAB * T - 3, W + side * 2, 3);
    // juntas da viga, uma por coluna
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = COL_W * T; x < W; x += COL_W * T) ctx.fillRect(x - 1, y + 3, 2, FLOOR_SLAB * T - 6);
  }
  paintRoof(ctx, W, b.cols);
  for (let f = 1; f < floors; f++) paintStairs(ctx, 0, (kvFloorY(f) + SOUTH_Y) * T);
  ctx.restore();
}

/** Telhado: laje com platibanda, casa de máquinas sobre a circulação, caixa d'água, condensadoras e antena. */
function paintRoof(ctx: CanvasRenderingContext2D, W: number, cols: number): void {
  const T = TILE;
  const top = -ROOF_H * T;
  const side = Math.round(T * 0.5);
  // laje do telhado
  ctx.fillStyle = '#b9b3a8';
  ctx.fillRect(-side, top, W + side * 2, ROOF_H * T);
  // manta (quadriculado discreto)
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let x = 0; x < W; x += 2 * T) for (let y = top + T; y < -T; y += 2 * T) if (((x + y) / (2 * T)) % 2 === 0) ctx.fillRect(x, y, 2 * T, 2 * T);
  // platibanda
  ctx.fillStyle = '#d7d1c6';
  ctx.fillRect(-side, top, W + side * 2, 5);
  ctx.fillRect(-side, top, 5, ROOF_H * T);
  ctx.fillRect(W + side - 5, top, 5, ROOF_H * T);
  ctx.fillStyle = '#8f887d';
  ctx.fillRect(-side, top + 5, W + side * 2, 2);
  // fachada do último andar: a borda do telhado
  ctx.fillStyle = SLAB;
  ctx.fillRect(-side, -T, W + side * 2, T);
  ctx.fillStyle = SLAB_HI;
  ctx.fillRect(-side, -T, W + side * 2, 3);
  // casa de máquinas dos elevadores, sobre a coluna de circulação
  const mx = 1.5 * T;
  const my = top + 1.6 * T;
  ctx.fillStyle = '#8a8378';
  ctx.fillRect(mx, my + 4, 8 * T, 4 * T);
  ctx.fillStyle = '#cfc8bd';
  ctx.fillRect(mx, my, 8 * T, 4 * T);
  ctx.fillStyle = '#a69e92';
  ctx.fillRect(mx, my, 8 * T, 4);
  ctx.fillStyle = '#6d665c';
  ctx.fillRect(mx + 3 * T, my + 2 * T, 2 * T, 2 * T);
  // caixa d'água (tanque azul-acinzentado com tampa)
  const tx = 11 * T;
  const ty = top + 1.4 * T;
  ctx.fillStyle = '#5b6b78';
  ctx.fillRect(tx, ty + 6, 3.5 * T, 3.6 * T);
  ctx.fillStyle = '#8fa3b2';
  ctx.fillRect(tx, ty, 3.5 * T, 3.6 * T);
  ctx.fillStyle = '#b8c8d3';
  ctx.fillRect(tx + 6, ty + 6, 3.5 * T - 12, 3.6 * T - 12);
  ctx.fillStyle = '#6f8392';
  ctx.fillRect(tx + 1.25 * T, ty + 1.3 * T, T, T);
  // condensadoras ao longo do telhado
  for (let c = 2; c < cols; c++) {
    const x = c * COL_W * T + 5 * T;
    const y = top + 2.2 * T;
    ctx.fillStyle = '#9c968c';
    ctx.fillRect(x, y + 3, 3 * T, 2 * T);
    ctx.fillStyle = '#e4e0d8';
    ctx.fillRect(x, y, 3 * T, 2 * T);
    ctx.fillStyle = '#6b665e';
    ctx.beginPath();
    ctx.arc(x + T, y + T, T * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4640';
    ctx.fillRect(x + T - 1, y + T * 0.35, 2, T * 1.3);
    ctx.fillRect(x + T * 0.35, y + T - 1, T * 1.3, 2);
    if (c % 2 === 0) {
      ctx.fillStyle = '#c9c3b8';
      ctx.fillRect(x + 4 * T, y + 0.5 * T, 4 * T, 3);
    }
  }
  // antena discreta com a luzinha vermelha
  const ax = W - 3 * T;
  ctx.fillStyle = '#5a5650';
  ctx.fillRect(ax, top + 1.2 * T, 2, 4.4 * T);
  ctx.fillRect(ax - 6, top + 5.4 * T, 14, 3);
  ctx.fillStyle = '#e04a3a';
  ctx.fillRect(ax - 1, top + 1.2 * T - 3, 4, 4);
}

/** Escada em "U" (dois lances e o patamar), vista de cima, na área lx 1..9 × ly 2..10 da coluna de circulação. */
function paintStairs(ctx: CanvasRenderingContext2D, x0: number, y0: number): void {
  const T = TILE;
  const x = x0 + 1 * T;
  const y = y0 + 2 * T;
  const w = 8 * T;
  const h = 9 * T;
  ctx.fillStyle = '#8e877c';
  ctx.fillRect(x, y, w, h);
  // patamar no alto
  ctx.fillStyle = '#d6cfc2';
  ctx.fillRect(x + 2, y + 2, w - 4, 2 * T - 2);
  ctx.fillStyle = '#6e665b';
  ctx.fillRect(x + 2, y + 2 * T - 2, w - 4, 2);
  const half = (w - 8) / 2;
  const steps = 10;
  const sh = (h - 2 * T) / steps;
  for (const [fx, dir] of [
    [x + 2, 1],
    [x + half + 6, -1],
  ] as const) {
    for (let i = 0; i < steps; i++) {
      const sy = Math.round(y + 2 * T + i * sh);
      const k = dir > 0 ? i / steps : 1 - i / steps;
      // piso do degrau (mais claro em cima) + espelho escuro (a quina)
      ctx.fillStyle = `rgb(${Math.round(228 - k * 46)},${Math.round(221 - k * 46)},${Math.round(208 - k * 46)})`;
      ctx.fillRect(fx, sy, half, Math.ceil(sh));
      ctx.fillStyle = 'rgba(70,60,50,0.55)';
      ctx.fillRect(fx, sy + Math.ceil(sh) - 3, half, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(fx, sy, half, 1);
    }
    // corrimão
    ctx.fillStyle = '#4f3f30';
    ctx.fillRect(dir > 0 ? fx + 1 : fx + half - 4, y + 2 * T, 3, h - 2 * T - 2);
  }
  // parede central entre os lances
  ctx.fillStyle = '#5c564e';
  ctx.fillRect(x + half + 2, y + 2 * T, 4, h - 2 * T - 2);
  // setas de subida/descida
  ctx.fillStyle = 'rgba(50,42,34,0.7)';
  const arrow = (cx: number, cy: number, up: boolean) => {
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + (up ? 4 : -4));
    ctx.lineTo(cx, cy + (up ? -4 : 4));
    ctx.lineTo(cx + 5, cy + (up ? 4 : -4));
    ctx.closePath();
    ctx.fill();
  };
  arrow(x + 2 + half / 2, y + h - 1.5 * T, true);
  arrow(x + half + 6 + half / 2, y + h - 1.5 * T, false);
}
