// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): as áreas abertas da planta — corredor (piso de concreto,
// passadeira, bebedouros, bancos, plantas e pontos de conversa a cada trecho) e jardim (grama, caminho de pedra,
// bancos, canteiros) — de qualquer tamanho. Puro (sem DOM).
import { mulberry32 } from '../../../../shared/hash';
import { TILE } from '../../world/constants';
import { AreaBuilder } from '../../world/layout/builder';
import type { AreaLayout, ExteriorProp, TileRect } from '../../world/layout/types';
import { kvInRect } from './engine-geom';

const TALL = ['ficus', 'palm', 'monstera', 'bonsai'] as const;
const SMALL = ['fern', 'succulent', 'flower'] as const;
/** Passadeira: a família de cor do corredor original. */
const RUNNERS = ['#8b9bb0', '#8597ab', '#909fb3'] as const;
/** Trecho do corredor com um conjunto de mobília (como uma coluna do original). */
const SEG = 16;

export interface KvOpenInput {
  id: string;
  rect: TileRect;
  seed: number;
  /** Tiles (absolutos) que precisam ficar livres: a frente das portas e das aberturas do núcleo. */
  reserved: readonly TileRect[];
  /** O tile (absoluto) é "fora": grama, sem item da planta. */
  outside: (tx: number, ty: number) => boolean;
}

const busyAt = (reserved: readonly TileRect[], tx: number, ty: number) => reserved.some((r) => kvInRect({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, tx, ty));

/** Corredor de qualquer tamanho. Horizontal (w >= h): mobília encostada nas bordas norte/sul; vertical: nas laterais. */
export function kvLayoutOpenCorridor(inp: KvOpenInput): AreaLayout {
  const { rect } = inp;
  const { w, h } = rect;
  const b = new AreaBuilder(inp.id, 'corridor', rect);
  b.floor('concrete', 0, 0, w, h, 501 + (inp.seed % 97));
  b.walk(0, 0, w, h);
  const horiz = w >= h;
  const free = (lx: number, ly: number) => !busyAt(inp.reserved, rect.x + lx, rect.y + ly);
  const placed = new Set<number>();
  const take = (lx: number, ly: number, fw = 1, fh = 1) => {
    for (let y = ly; y < ly + fh; y++) for (let x = lx; x < lx + fw; x++) if (x < 0 || y < 0 || x >= w || y >= h || !free(x, y) || placed.has(y * 1000 + x)) return false;
    for (let y = ly; y < ly + fh; y++) for (let x = lx; x < lx + fw; x++) placed.add(y * 1000 + x);
    return true;
  };

  // fachada de vidro onde a ponta do corredor encosta na grama (como a entrada do original)
  if (horiz) {
    for (const [lx, ox] of [
      [0, -1],
      [w - 1, w],
    ] as const) {
      for (let ly = 0; ly < h; ly++) {
        if (!inp.outside(rect.x + ox, rect.y + ly) || !take(lx, ly)) continue;
        const end = ly === 0 || ly === h - 1 || !inp.outside(rect.x + ox, rect.y + ly - 1) || !inp.outside(rect.x + ox, rect.y + ly + 1);
        b.furn('glass_partition', lx, ly, end ? 'end' : 'v', { order: 0.1 });
      }
    }
  } else {
    for (const [ly, oy] of [
      [0, -1],
      [h - 1, h],
    ] as const) {
      for (let lx = 0; lx < w; lx++) {
        if (!inp.outside(rect.x + lx, rect.y + oy) || !take(lx, ly)) continue;
        b.furn('glass_partition', lx, ly, lx === 0 || lx === w - 1 ? 'end' : 'h', { order: 0.1 });
      }
    }
  }

  // passadeira estreita no meio, um trecho por segmento
  const len = horiz ? w : h;
  const across = horiz ? h : w;
  const segs = Math.max(1, Math.round(len / SEG));
  const segLen = len / segs;
  const mid = across / 2;
  for (let s = 0; s < segs; s++) {
    const a0 = s * segLen + 2;
    const a1 = (s + 1) * segLen - 2;
    if (a1 - a0 < 2 || across < 3) continue;
    if (horiz) b.rug(a0, mid - 0.55, a1 - a0, 1.1, RUNNERS[s % RUNNERS.length], 502 + s);
    else b.rug(mid - 0.55, a0, 1.1, a1 - a0, RUNNERS[s % RUNNERS.length], 502 + s);
  }

  // mobília encostada nas bordas (só em corredor largo: sempre sobram 3 tiles de passagem), no ritmo das colunas do
  // original: trecho par = bebedouro + planta; ímpar = banco de espera + planta alta, e planta onde as salas se encontram
  const L = (a: number, c: number) => (horiz ? { lx: a, ly: c } : { lx: c, ly: a });
  const put = (a: number, c: number, fw = 1) => {
    const p = L(a, c);
    return horiz ? take(p.lx, p.ly, fw, 1) && p : take(p.lx, p.ly, 1, fw) && p;
  };
  if (across >= 4) {
    for (let s = 0; s < segs; s++) {
      const base = Math.round(s * segLen);
      const odd = (s + (inp.seed & 1)) % 2 === 1;
      if (!odd) {
        for (const a of [base + 3, base + 5, base + 9]) {
          const front = L(a, 1);
          if (!free(front.lx, front.ly) || placed.has(front.ly * 1000 + front.lx)) continue;
          const p = put(a, 0);
          if (!p) continue;
          b.furn('water_cooler', p.lx, p.ly, undefined, { order: 0.5 });
          b.spot('water', front.lx, front.ly, horiz ? 'up' : 'left', { dy: horiz ? -3 : 0 });
          const q = put(a + 1, 0);
          if (q) b.furn('plant_small', q.lx, q.ly, SMALL[s % SMALL.length], { order: 0.5 });
          break;
        }
      } else if (horiz) {
        for (const a of [base + 11, base + 9, base + 4]) {
          const p = put(a, 0, 2);
          if (!p) continue;
          const bench = b.furn('bench', p.lx, p.ly, undefined, { order: 0.5 });
          for (let i = 0; i < 2; i++) b.seat('bench', 'bench', p.lx + i, p.ly, 'down', undefined, { noFurniture: true, furnitureId: bench });
          const t = put(a + 2, 0);
          if (t) b.furn('plant_tall', t.lx, t.ly, TALL[s % TALL.length], { order: 0.5 });
          break;
        }
        const q = put(base + 12, across - 1);
        if (q) b.furn('plant_small', q.lx, q.ly, SMALL[(s + 1) % SMALL.length], { order: 0.5 });
      } else {
        const p = put(base + 13, 0);
        if (p) b.furn('plant_tall', p.lx, p.ly, TALL[(s + 1) % TALL.length], { order: 0.5 });
      }
      // planta alta onde as paredes das salas se encontram (um trecho sim, outro não)
      if (odd && s < segs - 1) {
        const t = put(base + 15, across - 1);
        if (t) b.furn('plant_tall', t.lx, t.ly, TALL[(s + 1) % TALL.length], { order: 0.5 });
      }
    }
  }
  // pontos de conversa no meio de cada trecho
  for (let s = 0; s < segs; s++) {
    const a = Math.round(s * segLen) + 5;
    const c = Math.floor(mid);
    const p1 = L(a, c);
    const p2 = L(a + 1, c);
    if (a + 1 >= len || placed.has(p1.ly * 1000 + p1.lx) || placed.has(p2.ly * 1000 + p2.lx)) continue;
    const g = `talk:${inp.id}:${s}`;
    if (horiz) {
      b.spot('talk', p1.lx, p1.ly, 'right', { group: g, dx: -1 });
      b.spot('talk', p2.lx, p2.ly, 'left', { group: g, dx: 1 });
    } else {
      b.spot('talk', p1.lx, p1.ly, 'down', { group: g });
      b.spot('talk', p2.lx, p2.ly, 'up', { group: g });
    }
  }
  return b.build();
}

/** Jardim (pátio verde caminhável) e os enfeites dele que o mundo desenha como "props" (árvores, flores, pedras). */
export function kvLayoutGarden(inp: KvOpenInput): { area: AreaLayout; props: ExteriorProp[] } {
  const { rect } = inp;
  const { w, h } = rect;
  const rng = mulberry32((inp.seed ^ 0x6a7d) >>> 0);
  const b = new AreaBuilder(inp.id, 'corridor', rect);
  const props: ExteriorProp[] = [];
  b.floor('grass', 0, 0, w, h, 61 + (inp.seed % 89));
  b.walk(0, 0, w, h);
  const horiz = w >= h;
  const placed = new Set<number>();
  const free = (lx: number, ly: number) => lx >= 0 && ly >= 0 && lx < w && ly < h && !placed.has(ly * 1000 + lx) && !busyAt(inp.reserved, rect.x + lx, rect.y + ly);
  const take = (lx: number, ly: number, fw = 1) => {
    for (let x = lx; x < lx + fw; x++) if (!free(x, ly)) return false;
    for (let x = lx; x < lx + fw; x++) placed.add(ly * 1000 + x);
    return true;
  };
  // caminho de pedra no meio (2 tiles), ao longo do lado comprido
  const pathAt = horiz ? Math.max(0, Math.floor(h / 2) - 1) : Math.max(0, Math.floor(w / 2) - 1);
  if (horiz) b.floor('sidewalk', 0, pathAt, w, Math.min(2, h), 62);
  else b.floor('sidewalk', pathAt, 0, Math.min(2, w), h, 62);
  for (let i = 0; i < (horiz ? w : h); i++) for (let k = 0; k < 2; k++) placed.add(horiz ? (pathAt + k) * 1000 + i : i * 1000 + pathAt + k);
  // canteiros e bancos de cada lado do caminho
  const prop = (kind: ExteriorProp['kind'], lx: number, ly: number, block = true) => {
    if (!free(lx, ly)) return;
    placed.add(ly * 1000 + lx);
    props.push({ kind, x: (rect.x + lx) * TILE + TILE / 2, y: (rect.y + ly + 1) * TILE - 2, seed: Math.floor(rng() * 1e9) });
    if (block) b.block(lx, ly, 1, 1);
  };
  const along = horiz ? w : h;
  for (let a = 1; a < along - 1; a += 3) {
    const r = rng();
    for (const side of [-1, 1]) {
      const c = side < 0 ? pathAt - 1 : pathAt + 2;
      const lx = horiz ? a : c;
      const ly = horiz ? c : a;
      if (r < 0.3 && horiz && side < 0 && take(lx, ly, 2)) {
        const bench = b.furn('bench', lx, ly, undefined, { order: 0.5 });
        for (let i = 0; i < 2; i++) b.seat('bench', 'bench', lx + i, ly, 'down', undefined, { noFurniture: true, furnitureId: bench });
      } else if (r < 0.55) prop('flowers', lx, ly, false);
      else if (r < 0.7) {
        if (take(lx, ly)) b.furn('plant_small', lx, ly, SMALL[a % SMALL.length], { order: 0.5 });
      } else if (r < 0.8) prop('bush', lx, ly);
    }
  }
  // árvores nos cantos (bloqueiam o tronco) e uma pedra
  for (const [lx, ly] of [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ] as const) {
    if (w >= 4 && h >= 4 && rng() < 0.8) prop(rng() < 0.3 ? 'pine' : 'tree', lx, ly);
  }
  if (w * h >= 40) prop('rock', Math.floor(w * 0.7), horiz ? Math.max(0, pathAt - 2) : Math.floor(h * 0.3));
  // um lugar para conversar no caminho
  const c = horiz ? { lx: Math.floor(w / 2), ly: pathAt } : { lx: pathAt, ly: Math.floor(h / 2) };
  const g = `talk:${inp.id}`;
  b.spot('talk', c.lx, c.ly, horiz ? 'right' : 'down', { group: g, dx: horiz ? -1 : 0 });
  b.spot('talk', horiz ? c.lx + 1 : c.lx, horiz ? c.ly : c.ly + 1, horiz ? 'left' : 'up', { group: g, dx: horiz ? 1 : 0 });
  return { area: b.build(), props };
}
