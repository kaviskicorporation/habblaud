// Fork Kaviski (KAVISKI.md): layout dos andares (ver floors.ts para a aritmética).
//
// - Cada andar acima do térreo repete o núcleo (hall dos elevadores no lugar da recepção — sem o balcão —, banheiros,
//   copa e lounge) e o corredor, deslocados para o y do andar. Ids com o sufixo `~<andar>` (e os grupos dos spots
//   também, para o ping-pong/papo de um andar não formar par com o de outro). O térreo é o original, intocado.
// - Área externa com andares: a rua passa AO NORTE, junto do térreo (que fica no topo), com a entrada a oeste ligada à
//   calçada; entre um andar e outro, uma faixa de grama com cerca viva onde vai a placa do andar.
import { mulberry32 } from '../../../shared/hash';
import { COL_W, CORE_COLS, CORRIDOR_Y, EXT_EAST, EXT_WEST, TILE } from '../world/constants';
import { layoutCafe, layoutLounge, layoutReception, layoutRestroom } from '../world/layout/core';
import { layoutCorridor } from '../world/layout/corridor';
import type { ExteriorLayout, SlotShell } from '../world/layout/exterior';
import { slotShell } from '../world/layout/exterior';
import type { AreaLayout, ExteriorProp, FloorPatch, TileRect } from '../world/layout/types';
import { FLOOR_GAP, kvBuildingH, kvFloorsOf, kvFloorsOn, kvFloorY, kvSlotAt } from './floors';

/** Sufixo dos ids das áreas de um andar acima do térreo. */
export function kvFloorSuffix(f: number): string {
  return `~${f}`;
}

/** Id da área original (sem o sufixo do andar) e o andar. */
export function kvSplitAreaId(id: string): { base: string; floor: number } {
  const m = /^(.*)~(\d+)$/.exec(id);
  return m ? { base: m[1], floor: Number(m[2]) } : { base: id, floor: 0 };
}

/** Cópia de uma área deslocada `dy` tiles para baixo, com ids (área, móveis, spots, grupos) sufixados. */
export function kvShiftArea(a: AreaLayout, dy: number, sfx: string): AreaLayout {
  const py = dy * TILE;
  const id = a.id + sfx;
  const rid = (s: string | undefined): string | undefined => (s && s.startsWith(`${a.id}#`) ? id + s.slice(a.id.length) : s);
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
      ...(s.group ? { group: s.group + sfx } : {}),
    })),
    walkable: a.walkable.map(tr),
    ...(a.blocked ? { blocked: a.blocked.map(tr) } : {}),
    ...(a.door ? { door: tr(a.door) } : {}),
    ...(a.shade ? { shade: { ...a.shade, y: a.shade.y + py } } : {}),
  };
}

/** Hall dos elevadores dos outros andares: a recepção sem o balcão (ninguém recepciona no 3º andar). */
function layoutFloorHall(): AreaLayout {
  const a = layoutReception();
  return { ...a, furniture: a.furniture.filter((f) => f.kind !== 'reception_desk' && f.kind !== 'filing_cabinet') };
}

let coreFloorCache: AreaLayout[] | null = null;

/** Núcleo (no y do térreo) usado como molde dos outros andares. */
function coreAreasForFloors(): AreaLayout[] {
  return (coreFloorCache ??= [layoutFloorHall(), layoutRestroom(), layoutCafe(), layoutLounge()]);
}

const upperCache = new Map<string, AreaLayout[]>();

/** Núcleo + corredor de cada andar acima do térreo (vazio sem andares). Cache por (colunas, andar): identidade estável. */
export function kvUpperFloorAreas(cols: number, floors: number): AreaLayout[] {
  if (!kvFloorsOn() || floors <= 1) return [];
  const out: AreaLayout[] = [];
  for (let f = 1; f < floors; f++) {
    const key = `${cols}:${f}`;
    let list = upperCache.get(key);
    if (!list) {
      const dy = kvFloorY(f);
      const sfx = kvFloorSuffix(f);
      list = [...coreAreasForFloors(), layoutCorridor(cols)].map((a) => kvShiftArea(a, dy, sfx));
      upperCache.set(key, list);
    }
    out.push(...list);
  }
  return out;
}

/** Fechamentos (jardins) dos slots dos andares acima do térreo (o térreo o renderer já faz). */
export function kvUpperShells(b: { cols: number; kvFloors?: number }): SlotShell[] {
  const out: SlotShell[] = [];
  const floors = kvFloorsOf(b);
  for (let f = 1; f < floors; f++) {
    for (let col = CORE_COLS; col < b.cols; col++) {
      for (const side of ['north', 'south'] as const) out.push(slotShell(kvSlotAt(col, side, f), col === b.cols - 1));
    }
  }
  return out;
}

/** Margem ao norte (tiles) com a rua: placa do térreo, cerca, calçada, rua, calçada e o bosque. */
const KV_EXT_NORTH = 30;
const KV_EXT_SOUTH = 18;

/** Área externa com andares (null sem andares: fica a original). */
export function kvLayoutExterior(cols: number, b: { kvFloors?: number }): ExteriorLayout | null {
  if (!kvFloorsOn()) return null;
  const w = cols * COL_W;
  const H = kvBuildingH(kvFloorsOf(b));
  const floors = kvFloorsOf(b);
  const bounds: TileRect = { x: -EXT_WEST, y: -KV_EXT_NORTH, w: w + EXT_WEST + EXT_EAST, h: H + KV_EXT_NORTH + KV_EXT_SOUTH };
  const px = (t: number) => t * TILE;
  const floorsOut: FloorPatch[] = [];
  const props: ExteriorProp[] = [];
  const rng = mulberry32(0xc0de + cols * 7 + floors);
  const seed = () => Math.floor(rng() * 1e9);

  floorsOut.push({ kind: 'grass', x: px(bounds.x), y: px(bounds.y), w: px(bounds.w), h: px(bounds.h), seed: 11 });
  // rua ao norte do térreo: cerca (y -5), calçada (-7..-5), rua (-12..-7), calçada (-14..-12)
  const hedgeY = -FLOOR_GAP;
  const walkY = hedgeY - 2;
  const streetTop = walkY - 5;
  floorsOut.push({ kind: 'sidewalk', x: px(bounds.x), y: px(walkY), w: px(bounds.w), h: px(2), seed: 12 });
  floorsOut.push({ kind: 'street', x: px(bounds.x), y: px(streetTop), w: px(bounds.w), h: px(5), seed: 13 });
  floorsOut.push({ kind: 'sidewalk', x: px(bounds.x), y: px(streetTop - 2), w: px(bounds.w), h: px(2), seed: 14 });
  // entrada principal: fachada de vidro a oeste do corredor do térreo, caminho de pedra até a calçada
  floorsOut.push({ kind: 'sidewalk', x: px(-3), y: px(CORRIDOR_Y), w: px(3), h: px(5), seed: 15 });
  floorsOut.push({ kind: 'sidewalk', x: px(-3), y: px(hedgeY), w: px(2), h: px(CORRIDOR_Y - hedgeY), seed: 16 });

  // bosque ao norte da rua
  for (const [row, gap] of [
    [streetTop - 4, 4],
    [streetTop - 8, 5],
    [streetTop - 12, 7],
  ] as const) {
    for (let x = bounds.x + 1; x < bounds.x + bounds.w - 1; x += gap + Math.floor(rng() * 4)) {
      props.push({ kind: rng() < 0.3 ? 'pine' : 'tree', x: px(x) + Math.floor(rng() * 8), y: px(row) - Math.floor(rng() * 12), seed: seed() });
      if (row === streetTop - 4 && rng() < 0.4) props.push({ kind: 'bush', x: px(x + 2), y: px(row + 1) - 2, seed: seed() });
    }
  }
  // postes na calçada do lado do prédio
  for (let x = bounds.x + 4; x < bounds.x + bounds.w; x += 10) props.push({ kind: 'lamp', x: px(x), y: px(walkY + 1) + 6, seed: x });
  // cerca viva + flores na frente do térreo (com a passagem do caminho da entrada) e entre os andares
  const hedgeRow = (ty: number, from: number, to: number, gateX?: number) => {
    for (let x = from; x < to; x += 2) {
      if (gateX !== undefined && x >= gateX - 1 && x <= gateX + 1) continue;
      props.push({ kind: (x / 2) % 3 === 1 ? 'flowers' : 'hedge', x: px(x) + TILE, y: px(ty) + 10, seed: x * 7 + ty * 3 + 3 });
    }
  };
  hedgeRow(hedgeY, -2, w, -3);
  for (let f = 1; f < floors; f++) hedgeRow(kvFloorY(f) - FLOOR_GAP, 0, w);
  // depois do último andar: cerca, gramado e árvores
  hedgeRow(H, 0, w);
  for (const row of [4, 8, 12]) {
    for (let x = bounds.x + 3; x < bounds.x + bounds.w - 2; x += 6 + Math.floor(rng() * 5)) {
      props.push({ kind: rng() < 0.2 ? 'pine' : 'tree', x: px(x) + Math.floor(rng() * 10), y: px(H + row) + Math.floor(rng() * 10), seed: seed() });
      if (rng() < 0.3) props.push({ kind: 'bush', x: px(x + 3), y: px(H + row + 1), seed: seed() });
    }
  }
  // árvores a oeste e a leste (sem tapar o caminho da entrada)
  for (const side of [-1, 1]) {
    for (const band of [0, 7, 13]) {
      const baseX = side < 0 ? -6 - band : w + 4 + band;
      for (let y = 1; y < H; y += 3 + Math.floor(rng() * 3)) {
        if (side < 0 && band === 0 && y <= CORRIDOR_Y + 6) continue;
        props.push({ kind: rng() < 0.3 ? 'pine' : 'tree', x: px(baseX + Math.floor(rng() * 5)), y: px(y + 1), seed: seed() });
        if (band === 0 && rng() < 0.5) props.push({ kind: 'bush', x: px(side < 0 ? -2 : w + 1), y: px(y + 2), seed: seed() });
      }
    }
  }
  props.push({ kind: 'bench', x: px(-4), y: px(CORRIDOR_Y + 3) + 6, seed: 1 });
  props.push({ kind: 'totem', x: px(-3) + 6, y: px(CORRIDOR_Y + 1), seed: 2 });

  const streetY = px(streetTop);
  const streetH = px(5);
  return {
    bounds,
    floors: floorsOut,
    props,
    lanes: [
      { y: streetY + Math.round(streetH * 0.36), dir: 1 },
      { y: streetY + Math.round(streetH * 0.86), dir: -1 },
    ],
    streetY,
    streetH,
  };
}
