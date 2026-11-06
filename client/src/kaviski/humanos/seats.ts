// Fork Kaviski (KAVISKI-HUMANOS.md): móveis que o meu boneco usa — regras puras (sem DOM nem Sim), testadas em
// seats.test.ts. Sentar (cadeira de mesa, banqueta, poltrona, sofá, puff, banco), usar uma máquina (café, água),
// jogar fliperama, ler na estante; qual assento serve de mesa fixa; qual lugar do lounge para descansar; e um tile
// livre ao lado de alguém (para ir até, teleportar ou levantar).
import type { SpotDef, SpotKind } from '../../world/layout/types';
import { FREE, type WalkGrid } from '../../world/path/grid';
import { TILE } from '../../world/constants';

/** Assentos em que a pessoa pode sentar. */
export const KV_SIT_KINDS: readonly SpotKind[] = ['desk', 'stool', 'nook', 'cafe_seat', 'sofa', 'armchair', 'beanbag', 'bench'];
/** Assentos que podem ser a mesa fixa (dentro de uma sala de projeto). */
export const KV_DESK_KINDS: readonly SpotKind[] = ['desk', 'stool', 'nook'];
/** Lugares do lounge para descansar (modo foco), na ordem de preferência. */
export const KV_REST_KINDS: readonly SpotKind[] = ['sofa', 'armchair', 'beanbag'];
export const KV_LOUNGE = 'core:lounge';

/** Coisas em pé: o que fazer ali (pose, item na mão, quanto tempo de "usar" antes). */
export interface KvUseDef {
  pose: 'drink' | 'game' | 'read';
  held: 'coffee' | 'water' | 'controller' | 'book';
  /** ms da pose 'use' (operando a máquina) antes. */
  useMs: number;
}
export const KV_USE: Partial<Record<SpotKind, KvUseDef>> = {
  coffee: { pose: 'drink', held: 'coffee', useMs: 1900 },
  water: { pose: 'drink', held: 'water', useMs: 1000 },
  arcade: { pose: 'game', held: 'controller', useMs: 0 },
  shelf: { pose: 'read', held: 'book', useMs: 600 },
};

/** Até quantos px (do meu boneco ao lugar) a tecla E alcança. */
export const KV_REACH_PX = 1.6 * TILE;

/** Distância dos pés (x, y) ao spot: o menor entre o lugar final e o centro do tile de aproximação. */
export function spotDist(s: SpotDef, x: number, y: number): number {
  const a = Math.hypot(s.x - x, s.y - y);
  const b = Math.hypot(s.tx * TILE + TILE / 2 - x, s.ty * TILE + TILE / 2 - y);
  return Math.min(a, b);
}

/** O spot mais perto de (x, y) entre os tipos pedidos, até `max` px. */
export function nearestSpot(spots: Iterable<SpotDef>, x: number, y: number, kinds: readonly SpotKind[], max: number, ok: (s: SpotDef) => boolean = () => true): SpotDef | null {
  let best: SpotDef | null = null;
  let bestD = max;
  for (const s of spots) {
    if (!kinds.includes(s.kind) || !ok(s)) continue;
    const d = spotDist(s, x, y);
    if (d <= bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** O assento em que alguém sentado em (x, y) está (a posição que veio pela rede): o lugar final mais perto, até 1 tile. */
export function seatAt(spots: Iterable<SpotDef>, x: number, y: number): SpotDef | null {
  let best: SpotDef | null = null;
  let bestD = TILE;
  for (const s of spots) {
    if (!s.seated) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Lugar para descansar no lounge: o primeiro tipo com vaga, o mais perto de `near` (tiles). */
export function restSeat(spots: Iterable<SpotDef>, free: (s: SpotDef) => boolean, near?: { tx: number; ty: number }): SpotDef | null {
  const list = [...spots].filter((s) => s.areaId === KV_LOUNGE && KV_REST_KINDS.includes(s.kind) && free(s));
  if (!list.length) return null;
  const d = (s: SpotDef) => KV_REST_KINDS.indexOf(s.kind) * 1000 + (near ? Math.abs(s.tx - near.tx) + Math.abs(s.ty - near.ty) : 0);
  return list.sort((a, b) => d(a) - d(b))[0];
}

const RING: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Um tile de chão livre (sem móvel nem assento) perto de (tx, ty), sem ser ele: primeiro os vizinhos, depois anéis
 * maiores até `maxR`. `taken` evita tiles já ocupados (outra pessoa parada ali).
 */
export function freeTileNear(grid: WalkGrid, tx: number, ty: number, maxR = 4, taken: (x: number, y: number) => boolean = () => false): { x: number; y: number } | null {
  for (const [dx, dy] of RING) {
    if (grid.get(tx + dx, ty + dy) === FREE && !taken(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
  }
  for (let r = 2; r <= maxR; r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (grid.get(tx + dx, ty + dy) !== FREE || taken(tx + dx, ty + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x: tx + dx, y: ty + dy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** O próprio tile, se for chão livre; senão o livre mais perto. */
export function freeTileAt(grid: WalkGrid, tx: number, ty: number, maxR = 4): { x: number; y: number } | null {
  return grid.get(tx, ty) === FREE ? { x: tx, y: ty } : freeTileNear(grid, tx, ty, maxR);
}

/** Segue alguém: anda de novo quando a pessoa se afastou mais que isto (tiles) do último destino. */
export const KV_FOLLOW_REPATH = 1.5;

/** Precisa recalcular o caminho de quem segue? (alvo em px, destino atual em tiles). */
export function followNeedsRepath(target: { x: number; y: number }, goal: { x: number; y: number } | null): boolean {
  if (!goal) return true;
  return Math.hypot(target.x / TILE - (goal.x + 0.5), target.y / TILE - (goal.y + 0.5)) > KV_FOLLOW_REPATH + 0.5;
}
