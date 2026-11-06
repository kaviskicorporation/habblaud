// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): o lado de fora do prédio da planta — grama, bosque, calçada e
// rua em volta do retângulo da planta (como layoutExterior do original) — e as "cascas" desenhadas na camada base:
// pátio com deck das vagas vazias (e das salas que quem vê não tem), fechamento do corredor onde ele encosta na grama
// (fachada com janelas ao norte, mureta ao sul, parede nas laterais) e os enfeites dos jardins. Puro (sem DOM).
import { mulberry32 } from '../../../../shared/hash';
import { EXT_EAST, EXT_NORTH, EXT_SOUTH, EXT_WEST, TILE } from '../../world/constants';
import { EXTERIOR_WALL, type ExteriorLayout, type SlotShell } from '../../world/layout/exterior';
import type { ExteriorProp, FloorPatch, TileRect, WallItemPlacement, WallSegment } from '../../world/layout/types';

const px = (t: number) => t * TILE;

/**
 * Área externa em volta do prédio de `W` x `H` tiles (origem 0,0). `gap(tx, ty)` = tile dentro da planta sem nada
 * (grama entre as salas): ganha uma ou outra moita/flor longe das paredes; `keep(tx, ty)` = tile que não pode ter enfeite.
 */
/** Entrada principal: a ponta do corredor da recepção que dá para a grama (fachada de vidro). */
export interface KvEntrance {
  side: 'w' | 'e';
  /** x do tile do vidro (ponta do corredor) e as linhas do corredor. */
  x: number;
  y: number;
  h: number;
}

export function kvPlanExterior(W: number, H: number, gap: (tx: number, ty: number) => boolean, keep: (tx: number, ty: number) => boolean, seed = 0, entrance: KvEntrance | null = null): ExteriorLayout {
  const bounds: TileRect = { x: -EXT_WEST, y: -EXT_NORTH, w: W + EXT_WEST + EXT_EAST, h: H + EXT_NORTH + EXT_SOUTH };
  const floors: FloorPatch[] = [];
  const props: ExteriorProp[] = [];
  const rng = mulberry32(0xc0de + W * 7 + H * 13 + seed);
  floors.push({ kind: 'grass', x: px(bounds.x), y: px(bounds.y), w: px(bounds.w), h: px(bounds.h), seed: 11 });
  const south = H;
  floors.push({ kind: 'sidewalk', x: px(bounds.x), y: px(south + 2), w: px(bounds.w), h: px(2), seed: 12 });
  floors.push({ kind: 'street', x: px(bounds.x), y: px(south + 4), w: px(bounds.w), h: px(5), seed: 13 });
  floors.push({ kind: 'sidewalk', x: px(bounds.x), y: px(south + 9), w: px(bounds.w), h: px(2), seed: 14 });
  const R = () => Math.floor(rng() * 1e9);
  // entrada principal: caminho de pedra da fachada de vidro até a calçada, banco e totem com a marca (como o original)
  const nearEntrance = (tx: number, ty: number) => !!entrance && ty >= entrance.y - 2 && ty <= south + 2 && (entrance.side === 'w' ? tx >= entrance.x - 6 && tx < entrance.x : tx > entrance.x && tx <= entrance.x + 6);
  if (entrance) {
    const o = entrance.side === 'w' ? entrance.x - 3 : entrance.x + 1;
    const p = entrance.side === 'w' ? entrance.x - 3 : entrance.x + 2;
    floors.push({ kind: 'sidewalk', x: px(o), y: px(entrance.y), w: px(3), h: px(entrance.h), seed: 15 });
    floors.push({ kind: 'sidewalk', x: px(p), y: px(entrance.y + entrance.h), w: px(2), h: px(Math.max(0, south + 2 - entrance.y - entrance.h)), seed: 16 });
    props.push({ kind: 'bench', x: px(entrance.side === 'w' ? entrance.x - 4 : entrance.x + 5), y: px(entrance.y + 3) + 6, seed: 1 });
    props.push({ kind: 'totem', x: px(entrance.side === 'w' ? entrance.x - 3 : entrance.x + 4) + 6, y: px(entrance.y + 1), seed: 2 });
  }

  // árvores ao norte e o bosque, cada vez mais esparso
  for (let x = bounds.x + 1; x < bounds.x + bounds.w - 1; x += 4 + Math.floor(rng() * 3)) {
    props.push({ kind: rng() < 0.25 ? 'pine' : 'tree', x: px(x) + Math.floor(rng() * 8), y: px(-3) - Math.floor(rng() * 20), seed: R() });
    if (rng() < 0.6) props.push({ kind: 'bush', x: px(x + 2), y: px(-1) - 2, seed: R() });
  }
  for (const [row, gapT] of [
    [-6, 5],
    [-10, 6],
    [-14, 8],
  ] as const) {
    for (let x = bounds.x + 2; x < bounds.x + bounds.w - 1; x += gapT + Math.floor(rng() * 4)) {
      props.push({ kind: rng() < 0.3 ? 'pine' : 'tree', x: px(x) + Math.floor(rng() * 8), y: px(row) - Math.floor(rng() * 12), seed: R() });
    }
  }
  // laterais
  for (const side of [-1, 1]) {
    for (const band of [0, 7, 13]) {
      const baseX = side < 0 ? -6 - band : W + 4 + band;
      for (let y = 1; y < H; y += 3 + Math.floor(rng() * 3)) {
        if (nearEntrance(baseX, y) || nearEntrance(baseX + 4, y)) continue;
        props.push({ kind: rng() < 0.3 ? 'pine' : 'tree', x: px(baseX + Math.floor(rng() * 5)), y: px(y + 1), seed: R() });
        if (band === 0 && rng() < 0.5 && !nearEntrance(side < 0 ? -2 : W + 1, y + 2)) props.push({ kind: 'bush', x: px(side < 0 ? -2 : W + 1), y: px(y + 2), seed: R() });
      }
    }
  }
  // cerca viva e flores ao longo da calçada; postes; o bosque do outro lado da rua
  for (let x = 0; x < W; x += 2) if (!nearEntrance(x, south + 1) && !keep(x, south) && !keep(x + 1, south)) props.push({ kind: (x / 2) % 3 === 1 ? 'flowers' : 'hedge', x: px(x) + TILE, y: px(south + 1) + 10, seed: x * 7 + 3 });
  for (let x = bounds.x + 4; x < bounds.x + bounds.w; x += 10) props.push({ kind: 'lamp', x: px(x), y: px(south + 3) + 6, seed: x });
  for (const row of [13, 17, 21]) {
    for (let x = bounds.x + 3; x < bounds.x + bounds.w - 2; x += 6 + Math.floor(rng() * 5)) {
      props.push({ kind: rng() < 0.2 ? 'pine' : 'tree', x: px(x) + Math.floor(rng() * 10), y: px(south + row) + Math.floor(rng() * 10), seed: R() });
      if (rng() < 0.3) props.push({ kind: 'bush', x: px(x + 3), y: px(south + row + 1), seed: R() });
    }
  }
  // grama entre as salas: moitas e flores (só onde há folga de 1 tile de tudo)
  const roomy = (tx: number, ty: number, r: number) => {
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) if (!gap(x, y) || keep(x, y)) return false;
    return true;
  };
  for (let ty = 0; ty < H; ty += 2) {
    for (let tx = 0; tx < W; tx += 2) {
      if (!roomy(tx, ty, 1) || rng() > 0.22 || nearEntrance(tx, ty)) continue;
      const big = roomy(tx, ty, 2) && rng() < 0.35;
      props.push({ kind: big ? (rng() < 0.3 ? 'pine' : 'tree') : rng() < 0.55 ? 'bush' : 'flowers', x: px(tx) + TILE / 2, y: px(ty + 1) - 2, seed: R() });
    }
  }
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

/** Lados de um retângulo encostados numa área aberta (corredor/jardim): trechos [a, b) ao longo do lado. */
export interface KvEdgeRuns {
  n: [number, number][];
  s: [number, number][];
  w: [number, number][];
  e: [number, number][];
}

/** Junta tiles consecutivos de um lado em trechos (coordenada absoluta ao longo do lado). */
export function kvRuns(from: number, to: number, hit: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = from; i <= to; i++) {
    const on = i < to && hit(i);
    if (on && start < 0) start = i;
    else if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

/**
 * Pátio de uma vaga vazia (ou de uma sala que quem vê não tem): deck de madeira com mesas e guarda-sóis, canteiros, e a
 * parede que fecha o corredor nos lados encostados nele (como slotShell do original). Some quando a sala chega.
 */
export function kvPatioShell(slot: number, rect: TileRect, open: KvEdgeRuns): SlotShell {
  const rng = mulberry32(0x9a7d + slot * 31 + rect.x * 7 + rect.y * 3);
  const walls: WallSegment[] = [];
  const windows: WallItemPlacement[] = [];
  const floors: FloorPatch[] = [];
  const props: ExteriorProp[] = [];
  const x0 = px(rect.x);
  const y0 = px(rect.y);
  const seed = () => Math.floor(rng() * 1e9);
  // fechamentos
  let wi = 0;
  for (const [a, b] of open.s) {
    // o corredor passa embaixo: fachada com janelas nas 2 últimas linhas
    walls.push({ kind: 'face', x: px(a), y: px(rect.y + rect.h - 2), w: px(b - a), style: EXTERIOR_WALL });
    for (let cx = a + 3; cx <= b - 2; cx += 5) windows.push({ id: `shell:${slot}:janela${wi++}`, kind: 'window', cx: px(cx), baseY: px(rect.y + rect.h), on: 'face', order: 0 });
  }
  for (const [a, b] of open.n) walls.push({ kind: 'south', x: px(a), y: y0, w: px(b - a), style: EXTERIOR_WALL });
  for (const [a, b] of open.w) walls.push({ kind: 'cap', x: x0, y: px(a), w: TILE / 2, h: px(b - a), style: EXTERIOR_WALL });
  for (const [a, b] of open.e) walls.push({ kind: 'cap', x: px(rect.x + rect.w) - TILE / 2, y: px(a), w: TILE / 2, h: px(b - a), style: EXTERIOR_WALL });
  // deck no meio (deixa as paredes de fora)
  const top = open.n.length ? 2 : 1.5;
  const bottom = open.s.length ? 3 : 1.5;
  const dw = Math.max(2, rect.w - 6);
  const dh = Math.max(2, Math.min(rect.h - top - bottom - 1, Math.round(rect.h * 0.45)));
  const dx = (rect.w - dw) / 2;
  const dy = top + Math.max(0, (rect.h - top - bottom - dh) / 2);
  if (rect.w >= 8 && rect.h >= 7) {
    floors.push({ kind: 'sidewalk', x: x0 + px(dx), y: y0 + px(dy), w: px(dw), h: px(dh), seed: slot + 7 });
    floors.push({ kind: 'wood', x: x0 + px(dx) + 4, y: y0 + px(dy) + 4, w: px(dw) - 8, h: px(dh) - 8, seed: slot + 8 });
    const n = Math.max(1, Math.floor(dw / 5));
    for (let i = 0; i < n; i++) props.push({ kind: 'parasol', x: x0 + px(dx + (dw * (i + 0.5)) / n), y: y0 + px(dy + dh * 0.7) + 4, seed: seed(), slot });
    props.push({ kind: 'bush', x: x0 + px(dx + 0.5), y: y0 + px(dy) + 6, seed: seed(), slot });
    props.push({ kind: 'bush', x: x0 + px(dx + dw - 0.5), y: y0 + px(dy) + 6, seed: seed(), slot });
  }
  // canteiros e árvores nos cantos
  for (let cx = 2; cx < rect.w - 1; cx += 5) props.push({ kind: 'flowers', x: x0 + px(cx), y: y0 + px(open.s.length ? rect.h - 2.5 : rect.h - 1) + 4, seed: slot * 3 + cx, slot });
  props.push({ kind: 'tree', x: x0 + px(1) + 6, y: y0 + px(Math.min(rect.h - 1, 3)), seed: seed(), slot });
  props.push({ kind: rng() < 0.5 ? 'pine' : 'tree', x: x0 + px(rect.w - 1) - 6, y: y0 + px(Math.min(rect.h - 1, 3)) + 6, seed: seed(), slot });
  if (rect.h >= 10) props.push({ kind: 'rock', x: x0 + px(rect.w - 2), y: y0 + px(rect.h - 3), seed: slot + 3, slot });
  return { slot, rect, walls, windows, floors, props };
}

/** Fechamento de um corredor nos lados encostados na grama (nunca some: slot que nenhuma sala usa). */
export function kvCorridorClosure(slot: number, rect: TileRect, out: KvEdgeRuns, vertical: boolean): SlotShell | null {
  const walls: WallSegment[] = [];
  const windows: WallItemPlacement[] = [];
  let wi = 0;
  for (const [a, b] of out.n) {
    walls.push({ kind: 'face', x: px(a), y: px(rect.y - 2), w: px(b - a), style: EXTERIOR_WALL });
    for (let cx = a + 2.5; cx <= b - 2; cx += 5) windows.push({ id: `shell:${slot}:janela${wi++}`, kind: 'window', cx: px(cx), baseY: px(rect.y), on: 'face', order: 0 });
  }
  for (const [a, b] of out.s) walls.push({ kind: 'south', x: px(a), y: px(rect.y + rect.h), w: px(b - a), style: EXTERIOR_WALL });
  if (vertical) {
    for (const [a, b] of out.w) walls.push({ kind: 'cap', x: px(rect.x) - TILE / 2, y: px(a), w: TILE / 2, h: px(b - a), style: EXTERIOR_WALL });
    for (const [a, b] of out.e) walls.push({ kind: 'cap', x: px(rect.x + rect.w), y: px(a), w: TILE / 2, h: px(b - a), style: EXTERIOR_WALL });
  }
  if (!walls.length) return null;
  return { slot, rect: { x: rect.x, y: rect.y - 1, w: rect.w, h: 1 }, walls, windows, floors: [], props: [] };
}
