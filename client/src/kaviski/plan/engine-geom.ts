// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): onde cada sala fica na planta. Puro (sem DOM).
//
// As salas continuam com um número de vaga (`RoomState.slot`), como no original, mas com a planta ligada o número quer
// dizer outra coisa:
//   slot < 0       a sala tem lugar marcado na planta: item `-1 - slot` (projeto ou sala própria);
//   0 <= slot < V  uma das V vagas (`vaga`) da planta, na ordem de `order` (depois y, x);
//   slot >= V      a faixa automática (`KvPlan.auto`): pares norte/sul de 16x12 dos lados de um corredor gerado.
// A compactação do Sim só mexe nas salas da faixa automática (as outras têm lugar fixo).
import { KV_ROOM_H, KV_ROOM_W, kvPlanRoomRef, type KvPlan, type KvPlanDoor, type KvPlanItem } from '../../../../shared/kaviski-plan';
import type { TileRect } from '../../world/layout/types';

/** Altura do corredor da faixa automática (a mesma do original). */
export const KV_STRIP_CORRIDOR = 5;

export interface KvPlanIndex {
  plan: KvPlan;
  /** Vagas na ordem em que as salas as ocupam. */
  vagas: KvPlanItem[];
  /** ref da sala (projeto: kvPlanRoomRef(id); própria: id) -> índice do item em plan.items. */
  byRef: Map<string, number>;
}

export function kvIndexPlan(plan: KvPlan): KvPlanIndex {
  const vagas = plan.items
    .filter((it) => it.kind === 'vaga')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.y - b.y || a.x - b.x);
  const byRef = new Map<string, number>();
  plan.items.forEach((it, i) => {
    if ((it.kind === 'projeto' || it.kind === 'propria') && it.ref && !byRef.has(it.ref)) byRef.set(it.ref, i);
  });
  return { plan, vagas, byRef };
}

/** A sala tem lugar marcado na planta? Devolve o slot negativo do item (ou undefined). */
export function kvFixedSlot(ix: KvPlanIndex, roomId: string): number | undefined {
  const i = ix.byRef.get(roomId) ?? ix.byRef.get(kvPlanRoomRef(roomId));
  return i === undefined ? undefined : -1 - i;
}

/** Onde fica uma sala: retângulo, portas e (só na faixa) o lado do corredor. */
export interface KvSlotPlace {
  rect: TileRect;
  doors: KvPlanDoor[];
  /** Faixa automática: lado do corredor (espelha a posição das pessoas, como no original). */
  side?: 'north' | 'south';
  /** O item da planta (sala fixa ou vaga). */
  item?: KvPlanItem;
  strip: boolean;
}

/** Retângulo de uma posição da faixa automática (k = 0, 1, 2...). */
export function kvStripPlace(auto: KvPlan['auto'], k: number): KvSlotPlace {
  const c = Math.floor(Math.max(0, k) / 2);
  const first = Math.max(0, k) % 2 === 0;
  if (auto.dir === 's') {
    // fileiras oeste/leste de um corredor vertical; portas para o corredor
    const rect = { x: first ? auto.x : auto.x + KV_ROOM_W + KV_STRIP_CORRIDOR, y: auto.y + c * KV_ROOM_H, w: KV_ROOM_W, h: KV_ROOM_H };
    return { rect, doors: [{ side: first ? 'e' : 'w', at: 5 }], strip: true };
  }
  const rect = { x: auto.x + c * KV_ROOM_W, y: first ? auto.y : auto.y + KV_ROOM_H + KV_STRIP_CORRIDOR, w: KV_ROOM_W, h: KV_ROOM_H };
  return { rect, doors: [{ side: first ? 's' : 'n', at: 7 }], side: first ? 'north' : 'south', strip: true };
}

/** Corredor da faixa automática para `n` posições em uso (null = faixa vazia). */
export function kvStripCorridor(auto: KvPlan['auto'], n: number): TileRect | null {
  if (n <= 0) return null;
  const cols = Math.ceil(n / 2);
  if (auto.dir === 's') return { x: auto.x + KV_ROOM_W, y: auto.y, w: KV_STRIP_CORRIDOR, h: cols * KV_ROOM_H };
  return { x: auto.x, y: auto.y + KV_ROOM_H, w: cols * KV_ROOM_W, h: KV_STRIP_CORRIDOR };
}

/** Retângulo total da faixa para `n` posições (as duas fileiras e o corredor). */
export function kvStripRect(auto: KvPlan['auto'], n: number): TileRect | null {
  if (n <= 0) return null;
  const cols = Math.ceil(n / 2);
  if (auto.dir === 's') return { x: auto.x, y: auto.y, w: 2 * KV_ROOM_W + KV_STRIP_CORRIDOR, h: cols * KV_ROOM_H };
  return { x: auto.x, y: auto.y, w: cols * KV_ROOM_W, h: 2 * KV_ROOM_H + KV_STRIP_CORRIDOR };
}

/** Onde fica o slot nesta planta. */
export function kvSlotPlace(ix: KvPlanIndex, slot: number): KvSlotPlace {
  if (slot < 0) {
    const item = ix.plan.items[-1 - slot];
    if (item) return { rect: { x: item.x, y: item.y, w: item.w, h: item.h }, doors: item.doors ?? [], item, strip: false };
    return kvStripPlace(ix.plan.auto, 0);
  }
  if (slot < ix.vagas.length) {
    const item = ix.vagas[slot];
    return { rect: { x: item.x, y: item.y, w: item.w, h: item.h }, doors: item.doors ?? [], item, strip: false };
  }
  return kvStripPlace(ix.plan.auto, slot - ix.vagas.length);
}

/** Quantas posições da faixa estão em uso (a maior + 1, arredondada para o par). */
export function kvStripCount(ix: KvPlanIndex, slots: Iterable<number>): number {
  let max = -1;
  for (const s of slots) if (s >= ix.vagas.length) max = Math.max(max, s - ix.vagas.length);
  return max < 0 ? 0 : (Math.floor(max / 2) + 1) * 2;
}

/** Tiles (locais) de cada porta de uma sala. */
export function kvDoorTiles(w: number, h: number, d: KvPlanDoor): TileRect {
  const dw = d.w ?? 2;
  if (d.side === 'n') return { x: d.at, y: 0, w: dw, h: 2 };
  if (d.side === 's') return { x: d.at, y: h - 1, w: dw, h: 1 };
  if (d.side === 'w') return { x: 0, y: d.at, w: 1, h: dw };
  return { x: w - 1, y: d.at, w: 1, h: dw };
}

/** Tiles (absolutos) logo do lado de fora da porta: onde o corredor precisa estar livre. */
export function kvDoorFront(rect: TileRect, d: KvPlanDoor): TileRect {
  const dw = d.w ?? 2;
  if (d.side === 'n') return { x: rect.x + d.at, y: rect.y - 1, w: dw, h: 1 };
  if (d.side === 's') return { x: rect.x + d.at, y: rect.y + rect.h, w: dw, h: 1 };
  if (d.side === 'w') return { x: rect.x - 1, y: rect.y + d.at, w: 1, h: dw };
  return { x: rect.x + rect.w, y: rect.y + d.at, w: 1, h: dw };
}

/** As aberturas fixas das áreas do núcleo (coordenadas locais), para o corredor não pôr nada na frente. */
export function kvCoreFronts(ref: string, x: number, y: number): TileRect[] {
  if (ref === 'recepcao') return [{ x: x + 4, y: y + 12, w: 8, h: 1 }];
  if (ref === 'copa') return [{ x: x + 6, y: y + 12, w: 4, h: 1 }];
  if (ref === 'banheiros') return [{ x: x + 7, y: y - 1, w: 2, h: 1 }];
  return [{ x: x + 7, y: y - 1, w: 3, h: 1 }];
}

export function kvInRect(r: TileRect, tx: number, ty: number): boolean {
  return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
}
