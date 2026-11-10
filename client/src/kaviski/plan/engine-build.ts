// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): monta o prédio a partir da planta — as áreas fixas (núcleo
// transladado, corredores, jardins, salas temáticas, corredor da faixa automática), as cascas da camada base (pátios das
// vagas vazias, fechamentos do corredor, enfeites dos jardins, salas sem acesso de cliente/visitante), a grade de caminhabilidade e, se alguma parte ficou sem
// caminho até a recepção, um caminho de pedra pela grama (o Sim nunca teletransporta). Puro (sem DOM).
import type { RoomTheme } from '../../art/api';
import { hash32 } from '../../../../shared/hash';
import { KV_ROOM_H, KV_ROOM_W, kvRectsOverlap, type KvCoreRef, type KvPlan, type KvPlanItem } from '../../../../shared/kaviski-plan';
import { TILE } from '../../world/constants';
import { AreaBuilder } from '../../world/layout/builder';
import { coreAreas, paintArea, type BuildingLayout } from '../../world/layout/building';
import { RECEPTION_ID } from '../../world/layout/core';
import type { SlotShell } from '../../world/layout/exterior';
import type { AreaLayout, FloorPatch, SpotDef, TileRect } from '../../world/layout/types';
import { BLOCKED, FREE, WalkGrid } from '../../world/path/grid';
import { kvCoreFronts, kvDoorFront, kvIndexPlan, kvInRect, kvStripCorridor, kvStripPlace, kvStripRect, type KvPlanIndex } from './engine-geom';
import { kvCorridorClosure, kvPatioShell, kvRuns, type KvEdgeRuns, type KvEntrance } from './engine-ext';
import { kvLayoutGarden, kvLayoutOpenCorridor } from './engine-open';
import { kvLayoutPlanRoom } from './engine-room';
import { kvBlockedShell } from './engine-blocked';

/** Onde fica cada área do núcleo no prédio original (para transladar). */
const CORE_HOME: Record<KvCoreRef, { x: number; y: number }> = {
  recepcao: { x: 0, y: 0 },
  copa: { x: 16, y: 0 },
  banheiros: { x: 0, y: 17 },
  lounge: { x: 16, y: 17 },
};
/** Folga da grade em volta da planta (o caminho de pedra pode contornar). */
const MARGIN = 3;
/** Slots das cascas que nenhuma sala usa (fechamento do corredor, jardins). */
const CLOSURE_SLOT = -1_000_000;
const GARDEN_SLOT = -2_000_000;
const BLOCKED_SLOT = -3_000_000;

/** Área transladada (dx, dy tiles): rect, pisos, tapetes, paredes, itens de parede, móveis, spots, porta, sombra. */
export function kvTranslateArea(a: AreaLayout, dx: number, dy: number): AreaLayout {
  if (!dx && !dy) return a;
  const px = dx * TILE;
  const py = dy * TILE;
  const r = (q: TileRect): TileRect => ({ x: q.x + dx, y: q.y + dy, w: q.w, h: q.h });
  return {
    ...a,
    rect: r(a.rect),
    floors: a.floors.map((f) => ({ ...f, x: f.x + px, y: f.y + py })),
    rugs: a.rugs.map((g) => ({ ...g, x: g.x + px, y: g.y + py })),
    walls: a.walls.map((w) => ({ ...w, x: w.x + px, y: w.y + py })),
    wallItems: a.wallItems.map((w) => ({ ...w, cx: w.cx + px, baseY: w.baseY + py })),
    furniture: a.furniture.map((f) => ({ ...f, tx: f.tx + dx, ty: f.ty + dy })),
    spots: a.spots.map((s) => ({ ...s, tx: s.tx + dx, ty: s.ty + dy, x: s.x + px, y: s.y + py, sortY: s.sortY === undefined ? undefined : s.sortY + py })),
    walkable: a.walkable.map(r),
    blocked: a.blocked?.map(r),
    door: a.door && r(a.door),
    shade: a.shade && { ...a.shade, x: a.shade.x + px, y: a.shade.y + py },
  };
}

/** A recepção traz os elevadores: sem ela na planta, entra num lugar livre (o editor avisa). */
function withReception(plan: KvPlan): KvPlanItem[] {
  const items = plan.items;
  if (items.some((it) => it.kind === 'nucleo' && it.ref === 'recepcao')) return items;
  const W = Math.max(plan.w, ...items.map((it) => it.x + it.w));
  const H = Math.max(plan.h, ...items.map((it) => it.y + it.h));
  const fits = (x: number, y: number) => !items.some((it) => kvRectsOverlap(it, { x: x - 1, y: y - 1, w: 18, h: 19 }));
  for (let y = 0; y + 12 <= H; y += 2) for (let x = 0; x + 16 <= W; x += 2) if (fits(x, y)) return [...items, { id: 'el-recepcaoauto', kind: 'nucleo', ref: 'recepcao', x, y, w: 16, h: 12 }];
  return [...items, { id: 'el-recepcaoauto', kind: 'nucleo', ref: 'recepcao', x: W + 2, y: 0, w: 16, h: 12 }];
}

export interface KvStatics {
  plan: KvPlan;
  ix: KvPlanIndex;
  stripN: number;
  /** Itens efetivos (a planta + a recepção que faltava). */
  items: KvPlanItem[];
  W: number;
  H: number;
  /** Áreas fixas: núcleo, corredores, jardins, salas temáticas, corredor da faixa. */
  areas: AreaLayout[];
  /** O corredor "principal" (área `c` da voz/conversa): o da faixa ou o maior. */
  corridor: AreaLayout;
  shells: SlotShell[];
  tags: Map<string, string[]>;
  /** Área -> item da planta (para nomes, dica, editor). */
  itemOf: Map<string, KvPlanItem>;
  /** 1 = tile coberto por um item ou pela faixa. */
  covered: Uint8Array;
  /** 1 = tile de chão livre por onde o caminho de pedra pode passar; 2 = fechamento do corredor (abre um vão). */
  ground: Uint8Array;
  /** 1 = tile de área aberta (corredor/jardim): um móvel ali pode sair para o caminho passar. */
  open: Uint8Array;
  /** Até onde vão as salas (sem a folga da grade): o lado de fora começa aqui. */
  contentW: number;
  contentH: number;
  /** A entrada principal (ponta do corredor da recepção para a grama). */
  entrance: KvEntrance | null;
  key: number;
}

let keySeq = 0;

/** Tem um item (ou a faixa) em cima do tile? */
function coverMap(W: number, H: number, rects: readonly TileRect[]): Uint8Array {
  const m = new Uint8Array(W * H);
  for (const r of rects) for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) m[y * W + x] = 1;
  return m;
}

/** Lados que dão para fora de um retângulo, pelo mapa de cobertura (o que sai da grade também é fora). */
export function kvOutsideSides(covered: Uint8Array, W: number, H: number, r: TileRect): Record<'n' | 's' | 'e' | 'w', boolean> {
  const out = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || !covered[y * W + x];
  const all = (n: number, f: (i: number) => boolean) => {
    let k = 0;
    for (let i = 0; i < n; i++) if (f(i)) k++;
    return k >= n / 2;
  };
  return {
    n: all(r.w, (i) => out(r.x + i, r.y - 1)),
    s: all(r.w, (i) => out(r.x + i, r.y + r.h)),
    w: all(r.h, (i) => out(r.x - 1, r.y + i)),
    e: all(r.h, (i) => out(r.x + r.w, r.y + i)),
  };
}

/**
 * As áreas fixas e as cascas de uma planta com `stripN` posições na faixa. `themeFor(seed, paleta)` dá o tema das
 * salas temáticas (a página usa o roomTheme da arte).
 */
export function kvPlanStatics(plan: KvPlan, stripN: number, themeFor: (seed: number, palette?: number) => RoomTheme, ix: KvPlanIndex = kvIndexPlan(plan)): KvStatics {
  const items = withReception(plan);
  const strip: TileRect[] = [];
  for (let k = 0; k < stripN; k++) strip.push(kvStripPlace(plan.auto, k).rect);
  const stripCorr = kvStripCorridor(plan.auto, stripN);
  const stripAll = kvStripRect(plan.auto, stripN);
  let W = plan.w;
  let H = plan.h;
  for (const r of [...items, ...(stripAll ? [stripAll] : [])]) {
    W = Math.max(W, r.x + r.w);
    H = Math.max(H, r.y + r.h);
  }
  const contentW = W;
  const contentH = H;
  W += MARGIN;
  H += MARGIN;
  const covered = coverMap(W, H, [...items, ...strip, ...(stripCorr ? [stripCorr] : [])]);
  const outside = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || !covered[y * W + x];

  // frentes das portas (o corredor não põe móvel na frente)
  const fronts: TileRect[] = [];
  for (const it of items) {
    if (it.kind === 'nucleo' && it.ref) fronts.push(...kvCoreFronts(it.ref, it.x, it.y));
    else for (const d of it.doors ?? []) fronts.push(kvDoorFront(it, d));
  }
  for (let k = 0; k < stripN; k++) {
    const p = kvStripPlace(plan.auto, k);
    for (const d of p.doors) fronts.push(kvDoorFront(p.rect, d));
  }

  const areas: AreaLayout[] = [];
  const shells: SlotShell[] = [];
  const tags = new Map<string, string[]>();
  const itemOf = new Map<string, KvPlanItem>();
  const opens: TileRect[] = [];
  const corridors: AreaLayout[] = [];
  const core = coreAreas();
  let gardenN = 0;
  for (const it of items) {
    const seed = hash32(it.id);
    if (it.kind === 'nucleo' && it.ref) {
      const home = CORE_HOME[it.ref as KvCoreRef];
      const src = core.find((a) => a.id === `core:${it.ref}`);
      if (!home || !src) continue;
      const a = kvTranslateArea(src, it.x - home.x, it.y - home.y);
      areas.push(a);
      itemOf.set(a.id, it);
    } else if (it.kind === 'corredor') {
      const a = kvLayoutOpenCorridor({ id: `kv:${it.id}`, rect: { x: it.x, y: it.y, w: it.w, h: it.h }, seed, reserved: fronts, outside });
      areas.push(a);
      corridors.push(a);
      opens.push(a.rect);
      itemOf.set(a.id, it);
    } else if (it.kind === 'jardim') {
      const g = kvLayoutGarden({ id: `kv:${it.id}`, rect: { x: it.x, y: it.y, w: it.w, h: it.h }, seed, reserved: fronts, outside });
      areas.push(g.area);
      opens.push(g.area.rect);
      itemOf.set(g.area.id, it);
      if (g.props.length) shells.push({ slot: GARDEN_SLOT - gardenN++, rect: g.area.rect, walls: [], windows: [], floors: [], props: g.props });
    } else if (it.kind === 'tema' && it.ref) {
      const rect = { x: it.x, y: it.y, w: it.w, h: it.h };
      const a = kvLayoutPlanRoom({
        id: `kv:${it.id}`,
        kind: 'lounge',
        rect,
        doors: it.doors ?? [],
        theme: themeFor(seed, it.palette),
        seed,
        item: it,
        outside: kvOutsideSides(covered, W, H, rect),
        furnisher: `tema:${it.ref}`,
        tags,
      });
      areas.push(a);
      itemOf.set(a.id, it);
    }
  }
  if (stripCorr) {
    const a = kvLayoutOpenCorridor({ id: 'kv:auto', rect: stripCorr, seed: 77, reserved: fronts, outside });
    areas.push(a);
    corridors.push(a);
    opens.push(stripCorr);
  }
  const openMap = coverMap(W, H, opens);
  const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !!openMap[y * W + x];

  // corredor principal: o da faixa (como o original) ou o maior
  let corridor = corridors.find((a) => a.id === 'kv:auto') ?? [...corridors].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
  if (!corridor) {
    corridor = new AreaBuilder('kv:none', 'corridor', { x: -64, y: -64, w: 1, h: 1 }).build();
  }

  // pátios: vagas, salas com lugar fixo (some quando a sala chega) e posições vazias da faixa
  const edges = (r: TileRect, hit: (x: number, y: number) => boolean): KvEdgeRuns => ({
    n: kvRuns(r.x, r.x + r.w, (x) => hit(x, r.y - 1)),
    s: kvRuns(r.x, r.x + r.w, (x) => hit(x, r.y + r.h)),
    w: kvRuns(r.y, r.y + r.h, (y) => hit(r.x - 1, y)),
    e: kvRuns(r.y, r.y + r.h, (y) => hit(r.x + r.w, y)),
  });
  ix.vagas.forEach((v, i) => shells.push(kvPatioShell(i, v, edges(v, isOpen))));
  plan.items.forEach((it, i) => {
    // sala sem acesso (cliente/visitante): casca fechada, nunca pátio (engine-blocked.ts)
    if (it.blocked) shells.push(kvBlockedShell(BLOCKED_SLOT - i, it));
    else if (it.kind === 'projeto' || it.kind === 'propria') shells.push(kvPatioShell(-1 - i, it, edges(it, isOpen)));
  });
  for (let k = 0; k < stripN; k++) shells.push(kvPatioShell(ix.vagas.length + k, strip[k], edges(strip[k], isOpen)));
  // fechamento dos corredores onde encostam na grama
  const noGround = new Uint8Array(W * H);
  corridors.forEach((a, i) => {
    const r = a.rect;
    const vertical = r.h > r.w;
    const out = edges(r, outside);
    const runs: KvEdgeRuns = vertical ? { n: [], s: [], w: out.w, e: out.e } : { n: out.n, s: out.s, w: [], e: [] };
    const sh = kvCorridorClosure(CLOSURE_SLOT - i, r, runs, vertical);
    if (sh) shells.push(sh);
    const mark = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (noGround[y * W + x] = 1);
    for (const [a0, a1] of runs.n) for (let x = a0; x < a1; x++) for (const y of [r.y - 1, r.y - 2]) mark(x, y);
    for (const [a0, a1] of runs.s) for (let x = a0; x < a1; x++) mark(x, r.y + r.h);
    for (const [a0, a1] of runs.w) for (let y = a0; y < a1; y++) mark(r.x - 1, y);
    for (const [a0, a1] of runs.e) for (let y = a0; y < a1; y++) mark(r.x + r.w, y);
  });
  const ground = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ground[i] = covered[i] ? 0 : noGround[i] ? 2 : 1;

  // entrada: a ponta (oeste, senão leste) do corredor encostado na recepção que dá para a grama
  let entrance: KvEntrance | null = null;
  const rec = items.find((it) => it.kind === 'nucleo' && it.ref === 'recepcao');
  if (rec) {
    const front = kvCoreFronts('recepcao', rec.x, rec.y)[0];
    const c = corridors.find((a) => a.rect.h <= a.rect.w && kvRectsOverlap(a.rect, front));
    if (c) {
      const r = c.rect;
      const allOut = (x: number) => [...Array(r.h).keys()].every((i) => outside(x, r.y + i));
      if (allOut(r.x - 1)) entrance = { side: 'w', x: r.x, y: r.y, h: r.h };
      else if (allOut(r.x + r.w)) entrance = { side: 'e', x: r.x + r.w - 1, y: r.y, h: r.h };
    }
  }

  return { plan, ix, stripN, items, W, H, areas, corridor, shells, tags, itemOf, covered, ground, open: openMap, contentW, contentH, entrance, key: ++keySeq };
}

/** O prédio da planta (o que o Sim usa) com os extras do motor. */
export interface KvBuilding extends BuildingLayout {
  kv: {
    statics: KvStatics;
    /** Caminhos de pedra pela grama (tiles), ligando o que ficou sem caminho. */
    bridges: TileRect[];
    /** Chave da camada base (muda quando a planta, a faixa ou os caminhos de pedra mudam). */
    baseKey: number;
    /** As cascas com o vão por onde passa o caminho de pedra. */
    shells: SlotShell[];
  };
}

/** Cópias das áreas/cascas abertas para o caminho de pedra (mesma identidade enquanto o caminho não muda). */
const cutCache = new Map<string, { areas: AreaLayout[]; shells: SlotShell[] }>();

/** Grade + spots com as salas presentes. */
export function kvBuildFromStatics(st: KvStatics, rooms: readonly AreaLayout[], version = 0): KvBuilding {
  const grid = new WalkGrid(st.W, st.H, version);
  for (const a of [...st.areas, ...rooms]) paintArea(grid, a);
  const bridges = kvBridge(grid, st, [...st.areas, ...rooms]);
  let sig = st.key;
  for (const b of bridges) sig = (Math.imul(sig, 31) + b.x * 977 + b.y * 131 + b.w) | 0;
  // o caminho passou por um móvel (vidro da ponta do corredor) ou por um fechamento: tira o móvel e abre o vão
  let areas = st.areas;
  let shells = st.shells;
  if (bridges.length) {
    const ck = `${st.key}|${sig}`;
    let cut = cutCache.get(ck);
    if (!cut) {
      cut = cutFor(st, bridges);
      if (cutCache.size > 16) cutCache.clear();
      cutCache.set(ck, cut);
    }
    areas = cut.areas;
    shells = cut.shells;
  }
  const corridor = areas[st.areas.indexOf(st.corridor)] ?? st.corridor;
  const spots: SpotDef[] = [];
  for (const a of [...areas, ...rooms]) spots.push(...a.spots);
  return {
    cols: Math.ceil(st.W / 16),
    rect: { x: 0, y: 0, w: st.W, h: st.H },
    core: areas.filter((a) => a !== corridor),
    corridor,
    rooms: [...rooms],
    grid,
    spots,
    kv: { statics: st, bridges, baseKey: -Math.abs(sig || 1), shells },
  };
}

function cutFor(st: KvStatics, bridges: readonly TileRect[]): { areas: AreaLayout[]; shells: SlotShell[] } {
  const on = new Set<number>();
  for (const b of bridges) for (let i = 0; i < b.w; i++) on.add(b.y * st.W + b.x + i);
  const hits = (tx: number, ty: number, w: number, h: number) => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (on.has(y * st.W + x)) return true;
    return false;
  };
  const areas = st.areas.map((a) => {
    const gone = a.furniture.filter((f) => hits(f.tx, f.ty, 1, 1));
    if (!gone.length) return a;
    const ids = new Set(gone.map((f) => f.id));
    return { ...a, furniture: a.furniture.filter((f) => !ids.has(f.id)), spots: a.spots.filter((p) => !p.furnitureId || !ids.has(p.furnitureId)) };
  });
  // vãos nas paredes dos fechamentos (face/mureta: doorway; lateral: corta)
  const shells = st.shells.map((sh) => {
    if (!sh.walls.length) return sh;
    let changed = false;
    const walls = sh.walls.flatMap((w) => {
      const tx0 = Math.floor(w.x / TILE);
      const ty0 = Math.floor(w.y / TILE);
      if (w.kind === 'cap') {
        const tx = Math.floor((w.x + w.w / 2) / TILE);
        const cuts: number[] = [];
        for (let y = ty0; y < ty0 + Math.ceil(w.h / TILE); y++) if (on.has(y * st.W + tx) || on.has(y * st.W + tx - 1)) cuts.push(y);
        if (!cuts.length) return [w];
        changed = true;
        const out: typeof sh.walls = [];
        let y0 = w.y;
        for (const y of cuts) {
          if (y * TILE > y0) out.push({ ...w, y: y0, h: y * TILE - y0 });
          y0 = (y + 1) * TILE;
        }
        if (y0 < w.y + w.h) out.push({ ...w, y: y0, h: w.y + w.h - y0 });
        return out;
      }
      const rows = w.kind === 'face' ? [ty0, ty0 + 1] : [ty0];
      const gaps: { x: number; w: number }[] = [];
      for (let x = tx0; x < tx0 + Math.ceil(w.w / TILE); x++) if (rows.some((y) => on.has(y * st.W + x))) gaps.push({ x: x * TILE, w: TILE });
      if (!gaps.length) return [w];
      changed = true;
      return [{ ...w, doorways: [...(w.doorways ?? []), ...gaps] }];
    });
    return changed ? { ...sh, walls, windows: sh.windows.filter((wi) => !gapUnder(on, st.W, wi.cx, wi.baseY)) } : sh;
  });
  return { areas, shells };
}

const gapUnder = (on: Set<number>, W: number, cx: number, baseY: number) => on.has((Math.floor(baseY / TILE) - 1) * W + Math.floor(cx / TILE));

/**
 * Liga à recepção (elevadores) tudo o que ficou sem caminho: procura pela grama livre o caminho mais curto de cada
 * parte solta até o resto e o torna caminhável. Devolve os trechos (1 tile de altura) para a camada base desenhar.
 */
export function kvBridge(grid: WalkGrid, st: Pick<KvStatics, 'W' | 'H' | 'ground' | 'open'>, areas: readonly AreaLayout[]): TileRect[] {
  const W = st.W;
  const H = st.H;
  const elev = areas.find((a) => a.id === RECEPTION_ID)?.spots.find((s) => s.kind === 'elevator');
  let sx = elev?.tx ?? -1;
  let sy = elev?.ty ?? -1;
  if (!grid.walkable(sx, sy)) {
    const n = elev ? grid.nearestWalkable(sx, sy, 4) : null;
    if (!n) return [];
    sx = n.x;
    sy = n.y;
  }
  // só vale ligar o que tem algo para fazer lá (spots) ou é grande
  const spotAt = new Uint8Array(W * H);
  for (const a of areas) for (const s of a.spots) if (s.tx >= 0 && s.ty >= 0 && s.tx < W && s.ty < H) spotAt[s.ty * W + s.tx] = 1;
  const path: number[] = [];
  const prev = new Int32Array(W * H);
  const queue = new Int32Array(W * H);
  for (let round = 0; round < 24; round++) {
    const reach = grid.reachableFrom(sx, sy);
    // a primeira parte solta que interessa
    const seen = new Uint8Array(W * H);
    let comp: number[] | null = null;
    for (let i = 0; i < W * H && !comp; i++) {
      if (reach[i] || seen[i] || grid.cells[i] === BLOCKED) continue;
      const tiles: number[] = [];
      let useful = false;
      let head = 0;
      tiles.push(i);
      seen[i] = 1;
      while (head < tiles.length) {
        const j = tiles[head++];
        if (spotAt[j]) useful = true;
        const x = j % W;
        const y = (j - x) / W;
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (seen[k] || grid.cells[k] === BLOCKED) continue;
          seen[k] = 1;
          tiles.push(k);
        }
      }
      if (useful || tiles.length >= 6) comp = tiles;
    }
    if (!comp) break;
    // BFS da parte solta pela grama até qualquer tile alcançável
    prev.fill(-1);
    let head = 0;
    let tail = 0;
    const inComp = new Uint8Array(W * H);
    for (const j of comp) {
      inComp[j] = 1;
      prev[j] = j;
      queue[tail++] = j;
    }
    let hit = -1;
    while (head < tail && hit < 0) {
      const j = queue[head++];
      const x = j % W;
      const y = (j - x) / W;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (prev[k] !== -1) continue;
        if (reach[k]) {
          prev[k] = j;
          hit = k;
          break;
        }
        // da parte solta só se sai pela grama livre (ou pelo fechamento/vidro de um corredor, que ganha um vão)
        if (grid.cells[k] !== BLOCKED || !(st.ground[k] || st.open[k])) continue;
        prev[k] = j;
        queue[tail++] = k;
      }
    }
    if (hit < 0) {
      // não há caminho possível (cercado de paredes): marca como visto e segue com as outras
      for (const j of comp) grid.cells[j] = grid.cells[j] === FREE ? FREE : grid.cells[j];
      break;
    }
    for (let j = prev[hit]; !inComp[j]; j = prev[j]) {
      grid.cells[j] = FREE;
      path.push(j);
    }
  }
  // trechos horizontais para desenhar
  const set = new Set(path);
  const out: TileRect[] = [];
  for (const j of [...set].sort((a, b) => a - b)) {
    const x = j % W;
    const y = (j - x) / W;
    const last = out[out.length - 1];
    if (last && last.y === y && last.x + last.w === x) last.w++;
    else out.push({ x, y, w: 1, h: 1 });
  }
  return out;
}

/** Pisos de pedra dos caminhos pela grama. */
export function kvBridgeFloors(bridges: readonly TileRect[]): FloorPatch[] {
  return bridges.map((b, i) => ({ kind: 'sidewalk', x: b.x * TILE, y: b.y * TILE, w: b.w * TILE, h: b.h * TILE, seed: 900 + i }));
}

/** Uma sala da faixa automática ganha um item de mentira (os furnishers olham `item.style`). */
export function kvStripItem(rect: TileRect, doors: KvPlanItem['doors']): KvPlanItem {
  return { id: 'el-auto', kind: 'projeto', x: rect.x, y: rect.y, w: rect.w || KV_ROOM_W, h: rect.h || KV_ROOM_H, doors };
}

export { kvInRect };
