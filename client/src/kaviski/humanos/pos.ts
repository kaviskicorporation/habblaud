// Fork Kaviski (KAVISKI-HUMANOS.md): posição de uma pessoa no prédio <-> KvPos (shared/kaviski-presence.ts). Puro.
// Cada página monta o prédio do seu jeito (o cliente vê menos salas e as colunas se movem): a posição vai relativa à
// sala (ou à coluna dela, no corredor) e o núcleo, que é igual em todo prédio, vai em px absolutos.
import type { KvDir, KvPos } from '../../../../shared/kaviski-presence';
import { TILE } from '../../world/constants';

export interface KvRoomGeom {
  id: string;
  /** Retângulo da sala em tiles. */
  rect: { x: number; y: number; w: number; h: number };
  side?: 'north' | 'south';
}

export interface KvBuildingGeom {
  rooms: readonly KvRoomGeom[];
  /** Primeira coluna de tiles depois do núcleo (recepção, copa, banheiros, lounge). */
  coreEndTx: number;
  /**
   * Planta livre ligada (plan/engine.ts): a planta é igual para todos, então fora das salas a posição vai absoluta; só o
   * corredor da faixa automática (que cresce diferente em cada prédio) vai relativo à sala da coluna/fileira.
   */
  plan?: { strip: { x: number; y: number; w: number; h: number } | null; vertical: boolean };
}

const inside = (r: KvRoomGeom['rect'], tx: number, ty: number) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;

/** Posição (px de mundo, pés) -> KvPos. */
export function kvEncodePos(geom: KvBuildingGeom, x: number, y: number, d: KvDir, m: 0 | 1 | 2): KvPos {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const round = (n: number) => Math.round(n * 10) / 10;
  for (const r of geom.rooms) {
    if (inside(r.rect, tx, ty)) return { k: 'r', r: r.id, x: round(x - r.rect.x * TILE), y: round(y - r.rect.y * TILE), s: r.side === 'south' ? 's' : 'n', d, m };
  }
  if (geom.plan) {
    const st = geom.plan.strip;
    if (st && inside(st, tx, ty)) {
      // faixa para leste: a sala da coluna (x relativo, y absoluto); para o sul: a da fileira (y relativo, x absoluto)
      const v = geom.plan.vertical;
      const col = geom.rooms.find((r) => (v ? ty >= r.rect.y && ty < r.rect.y + r.rect.h : tx >= r.rect.x && tx < r.rect.x + r.rect.w) && (v ? Math.abs(r.rect.x + r.rect.w / 2 - (st.x + st.w / 2)) < 20 : Math.abs(r.rect.y + r.rect.h / 2 - (st.y + st.h / 2)) < 20));
      if (col) return v ? { k: 'c', r: col.id, x: round(x), y: round(y - col.rect.y * TILE), v: 1, d, m } : { k: 'c', r: col.id, x: round(x - col.rect.x * TILE), y: round(y), d, m };
    }
    return { k: 'a', x: round(x), y: round(y), d, m };
  }
  if (tx >= geom.coreEndTx) {
    const col = geom.rooms.find((r) => tx >= r.rect.x && tx < r.rect.x + r.rect.w);
    if (col) return { k: 'c', r: col.id, x: round(x - col.rect.x * TILE), y: round(y), d, m };
  }
  return { k: 'a', x: round(x), y: round(y), d, m };
}

/** KvPos -> px de mundo neste prédio, ou null se a sala não existe aqui. */
export function kvDecodePos(geom: KvBuildingGeom, p: KvPos): { x: number; y: number } | null {
  if (p.k === 'a') return { x: p.x, y: p.y };
  const r = geom.rooms.find((g) => g.id === p.r);
  if (!r) return null;
  if (p.k === 'c') return p.v ? { x: p.x, y: r.rect.y * TILE + p.y } : { x: r.rect.x * TILE + p.x, y: p.y };
  const mySide = r.side === 'south' ? 's' : 'n';
  // A mesma sala do outro lado do corredor é desenhada espelhada (a porta fica virada para o corredor).
  const y = p.s && p.s !== mySide ? r.rect.h * TILE - p.y : p.y;
  return { x: r.rect.x * TILE + p.x, y: r.rect.y * TILE + y };
}
