// Fork Kaviski (KAVISKI.md): prédio em ANDARES (HABBLAUD_FLOOR_COLS, vindo em meta.kaviski.floorCols).
//
// Sem a variável o prédio é o original: uma faixa (fileira norte + corredor + fileira sul) que cresce para leste.
// Com ela é UM prédio de vários andares, como um corte: cada andar é a faixa original, os andares se empilham PARA
// CIMA (o térreo, com recepção/copa/lounge/banheiros, fica embaixo, junto da rua ao sul) separados só por uma laje
// (SLAB) e, nos andares de cima, a coluna 0 é a circulação vertical (hall dos elevadores + escada), alinhada sobre a
// recepção; o resto do andar é das salas.
//
//   térreo:        núcleo (colunas 0 e 1) + FLOOR_COLS colunas de projeto  -> 2 × FLOOR_COLS salas
//   andar f >= 1:  circulação (coluna 0) + FLOOR_COLS + 1 colunas         -> 2 × (FLOOR_COLS + 1) salas
//
// O número de andares (F) é global (o mesmo para todas as simulações da página) e só cresce: o andar f começa em
// y = (F - 1 - f) × PITCH. Quando F muda, tudo desce PITCH tiles e cada simulação se reposiciona (floors-sim.ts).
// O slot da sala vira número de célula (andar + posição no andar, na ordem original: par = norte, ímpar = sul).
// Aritmética pura; este módulo não importa nada do layout (é importado por geometry.ts e exterior.ts).
import { BUILDING_H, COL_W, CORE_COLS, CORRIDOR_H, CORRIDOR_Y, TILE } from '../world/constants';
import type { TileRect } from '../world/layout/types';
import { tr } from '../../../shared/i18n';

/** Laje entre dois andares (tiles). */
export const FLOOR_SLAB = 1;
/** Distância (tiles) do topo de um andar ao do de cima. */
export const FLOOR_PITCH = BUILDING_H + FLOOR_SLAB;
/** Colunas de circulação nos andares de cima (hall dos elevadores + escada). */
export const UPPER_CORE_COLS = 1;
/** Altura do telhado (tiles, acima do último andar; só desenho). */
export const ROOF_H = 7;

let floorCols = 0;
let floorCount = 1;
let geomVersion = 0;

/** Liga os andares (uma vez por página; 0/undefined = original). Mudar no meio desmontaria o prédio: só a 1ª vale. */
export function kvSetFloorCols(n: number | undefined): void {
  if (floorCols || !n || !Number.isInteger(n) || n < 1) return;
  floorCols = n;
  geomVersion++;
}

/** Testes: volta ao original. */
export function kvResetFloorsForTest(n = 0, floors = 1): void {
  floorCols = n;
  floorCount = floors;
  geomVersion++;
}

export function kvFloorCols(): number {
  return floorCols;
}

export function kvFloorsOn(): boolean {
  return floorCols > 0;
}

/** Andares do prédio (global, só cresce). */
export function kvFloorCount(): number {
  return floorsOnly(floorCount);
}

function floorsOnly(n: number): number {
  return floorCols ? Math.max(1, n) : 1;
}

/** Garante pelo menos `n` andares. Retorna true se cresceu (tudo desce: as simulações se reposicionam). */
export function kvEnsureFloors(n: number): boolean {
  if (!floorCols || n <= floorCount) return false;
  floorCount = n;
  geomVersion++;
  return true;
}

/** Muda a cada mudança de geometria (andares ligados, número de andares). */
export function kvGeomVersion(): number {
  return geomVersion;
}

/** Primeira coluna de projeto do andar. */
export function kvFirstCol(f: number): number {
  return f > 0 ? UPPER_CORE_COLS : CORE_COLS;
}

/** Salas no andar f. */
export function kvFloorCapacity(f: number): number {
  return f > 0 ? (floorCols + CORE_COLS - UPPER_CORE_COLS) * 2 : floorCols * 2;
}

/** Primeiro slot do andar f. */
export function kvFloorFirstSlot(f: number): number {
  return f <= 0 ? 0 : kvFloorCapacity(0) + (f - 1) * kvFloorCapacity(1);
}

/** Andar de um slot (0 = térreo). */
export function kvSlotFloor(slot: number): number {
  if (!floorCols) return 0;
  const s = Math.max(0, slot);
  const c0 = kvFloorCapacity(0);
  return s < c0 ? 0 : 1 + Math.floor((s - c0) / kvFloorCapacity(1));
}

/** Posição do slot dentro do andar. */
export function kvSlotLocal(slot: number): number {
  return floorCols ? Math.max(0, slot) - kvFloorFirstSlot(kvSlotFloor(slot)) : Math.max(0, slot);
}

/** Coluna do prédio de um slot (com andares). */
export function kvSlotColumn(slot: number): number {
  return kvFirstCol(kvSlotFloor(slot)) + Math.floor(kvSlotLocal(slot) / 2);
}

/** Topo (tile) do andar f: o térreo embaixo, os outros por cima. */
export function kvFloorY(f: number): number {
  return floorCols ? (kvFloorCount() - 1 - Math.max(0, f)) * FLOOR_PITCH : 0;
}

/** Topo (tile) do térreo. */
export function kvGroundY(): number {
  return kvFloorY(0);
}

/** Andar de uma linha de tile (a laje conta como do andar de cima dela... isto é, do andar logo acima). */
export function kvFloorOfTile(ty: number): number {
  if (!floorCols) return 0;
  const k = Math.floor(ty / FLOOR_PITCH);
  return Math.max(0, Math.min(kvFloorCount() - 1, kvFloorCount() - 1 - k));
}

/** Linha dentro do próprio andar (0 = topo da fileira norte). */
export function kvLocalY(ty: number): number {
  return floorCols ? ty - Math.floor(ty / FLOOR_PITCH) * FLOOR_PITCH : ty;
}

/** Topo de uma fileira norte (de qualquer andar): é o que o original testa com `y === 0`. */
export function kvIsTopRow(ty: number): boolean {
  return floorCols ? ty >= 0 && kvLocalY(ty) === 0 : ty === 0;
}

/** Sala/área cuja parede sul dá para fora (o jardim e a calçada): só as do térreo. */
export function kvSpillsSouth(y: number, h: number): boolean {
  if (!floorCols) return y + h >= BUILDING_H;
  return kvFloorOfTile(y) === 0 && kvLocalY(y) + h >= BUILDING_H;
}

/** Célula vaga de um andar de cima (espaço livre, não jardim): a luz a trata como interior. */
export function kvVacantCell(r: { y: number }): boolean {
  return floorCols > 0 && kvFloorOfTile(r.y) > 0;
}

/** Slot de uma coluna/lado/andar (inverso de kvSlotColumn/slotSide/kvSlotFloor). */
export function kvSlotAt(col: number, side: 'north' | 'south', floor: number): number {
  const f = Math.max(0, floor);
  return kvFloorFirstSlot(f) + (col - kvFirstCol(f)) * 2 + (side === 'north' ? 0 : 1);
}

/** Colunas do prédio com andares: núcleo + FLOOR_COLS (todos os andares com a mesma largura). */
export function kvColumns(): number {
  return CORE_COLS + floorCols;
}

/** Andares necessários para um conjunto de slots (mínimo 1). */
export function kvFloorsFor(slots: Iterable<number>): number {
  let f = 0;
  for (const s of slots) f = Math.max(f, kvSlotFloor(s));
  return f + 1;
}

/** Altura total do prédio (tiles) com `floors` andares. */
export function kvBuildingH(floors: number): number {
  const n = Math.max(1, floors | 0);
  return floorCols ? n * FLOOR_PITCH - FLOOR_SLAB : BUILDING_H;
}

/** Andares de um prédio montado (BuildingLayout.kvFloors; ausente = 1). */
export function kvFloorsOf(b: { kvFloors?: number }): number {
  return floorCols ? Math.max(1, b.kvFloors ?? 1) : 1;
}

/** Altura (tiles) de um prédio montado. */
export function kvHeightOf(b: { kvFloors?: number }): number {
  return kvBuildingH(kvFloorsOf(b));
}

/** Chave que muda quando a largura OU o número de andares muda (o original compara só as colunas). */
export function kvBuildingKey(b: { cols: number; kvFloors?: number }): number {
  return b.cols + (kvFloorsOf(b) - 1) * 10_000;
}

/** y (px) do meio do corredor de cada andar. */
export function kvCorridorMidsPx(b: { kvFloors?: number }): number[] {
  const out: number[] = [];
  for (let f = 0; f < kvFloorsOf(b); f++) out.push((kvFloorY(f) + CORRIDOR_Y + CORRIDOR_H / 2) * TILE);
  return out;
}

/** Chave da área física (balões racionados na visão geral): coluna + andar + norte/corredor/sul. */
export function kvBubbleArea(tx: number, ty: number, colW: number, southY: number): string {
  const ly = kvLocalY(ty);
  const f = kvFloorOfTile(ty);
  return `${Math.floor(tx / colW)}:${f ? `${f}:` : ''}${ly < CORRIDOR_Y ? 'n' : ly < southY ? 'c' : 's'}`;
}

/** Roda `fn` com a geometria original (sem andares): para reaproveitar o desenho do original e só deslocá-lo. */
export function kvWithoutFloors<T>(fn: () => T): T {
  const saved = floorCols;
  floorCols = 0;
  try {
    return fn();
  } finally {
    floorCols = saved;
  }
}

/** Fechamento de slot (jardim) num andar: um do original (sem andares), deslocado em x/y e com o slot real. */
export function kvShiftShell<
  T extends {
    slot: number;
    rect: TileRect;
    walls: { x: number; y: number }[];
    windows: { id: string; cx: number; baseY: number }[];
    floors: { kind: string; x: number; y: number; w: number; h: number; seed: number }[];
    props: { x: number; y: number; kind: string; slot?: number; whenRoom?: number }[];
  },
>(sh: T, dxTiles: number, dyTiles: number, slot: number, keepPaving: boolean): T {
  const px = dxTiles * TILE;
  const py = dyTiles * TILE;
  const fix = (n: number | undefined) => (n === sh.slot ? slot : n);
  return {
    ...sh,
    slot,
    rect: { ...sh.rect, x: sh.rect.x + dxTiles, y: sh.rect.y + dyTiles },
    walls: sh.walls.map((w) => ({ ...w, x: w.x + px, y: w.y + py })),
    windows: sh.windows.map((w) => ({ ...w, id: w.id.replace(`shell:${sh.slot}:`, `shell:${slot}:`), cx: w.cx + px, baseY: w.baseY + py })),
    floors: sh.floors.map((f) => ({ ...f, x: f.x + px, y: f.y + py })),
    // o caminho até a calçada (paving) só existe no térreo
    props: sh.props.filter((p) => keepPaving || p.kind !== 'paving').map((p) => ({ ...p, x: p.x + px, y: p.y + py, slot: fix(p.slot), whenRoom: fix(p.whenRoom) })),
  };
}

/** Slot de um jardim vazio de qualquer andar: o mesmo desenho do original, deslocado. null sem andares. */
export function kvSlotShell<T extends Parameters<typeof kvShiftShell>[0]>(slot: number, lastColumn: boolean, original: (slot: number, last: boolean) => T): T | null {
  if (!floorCols) return null;
  const f = kvSlotFloor(slot);
  const local = kvSlotLocal(slot);
  const col = kvSlotColumn(slot);
  // slot do original na coluna CORE_COLS + k (k varia o sorteio do jardim), mesmo lado
  const k = (col + f * 3) % 5;
  const s0 = k * 2 + (local % 2);
  const base = kvWithoutFloors(() => original(s0, lastColumn));
  const sh = kvShiftShell(base, (col - (CORE_COLS + k)) * COL_W, kvFloorY(f), slot, f === 0) as T;
  if (f === 0) return sh;
  // andar de cima: nada de jardim dentro do prédio — espaço livre (laje de concreto) fechado para o corredor
  const r = sh.rect;
  return { ...sh, floors: [{ kind: 'concrete', x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE, seed: 900 + slot }], props: [] };
}

/** Número do andar por extenso curto. */
export function kvFloorOrdinal(f: number): string {
  return f === 0 ? tr('Térreo') : tr('{0}º andar', [f]);
}

/** Número curto do andar (diretório): "T", "1", "2"... */
export function kvFloorShort(f: number): string {
  return f === 0 ? tr('T') : String(f);
}

// =================================================================== plano por rótulo (puro)

export interface KvFloorEntry {
  /** Rótulo do mapa ('' = sala sem rótulo). */
  label: string;
  /** Continuação de um rótulo que não coube no andar anterior. */
  cont: boolean;
}

/**
 * Plano dos andares a partir das salas (na ordem dos slots do servidor) e do rótulo de cada uma: um andar novo por
 * rótulo, na ordem de aparição (os sem rótulo por último, "Outros"); rótulo que não cabe continua no andar seguinte.
 * O mesmo plano é usado pela simulação (na carga) e pela lista lateral.
 */
export function kvFloorPlan<R extends { id: string; slot: number }>(rooms: readonly R[], labelOf: (r: R) => string): { floors: KvFloorEntry[]; roomFloor: Map<string, number> } {
  const floors: KvFloorEntry[] = [];
  const roomFloor = new Map<string, number>();
  if (!floorCols) return { floors, roomFloor };
  const sorted = [...rooms].sort((a, b) => a.slot - b.slot);
  const byLabel = new Map<string, R[]>();
  for (const r of sorted) {
    const l = labelOf(r);
    let list = byLabel.get(l);
    if (!list) byLabel.set(l, (list = []));
    list.push(r);
  }
  const labels = [...[...byLabel.keys()].filter((l) => l), ...[...byLabel.keys()].filter((l) => !l)];
  for (const l of labels) {
    const list = byLabel.get(l)!;
    let i = 0;
    let first = true;
    while (i < list.length) {
      const f = floors.length;
      floors.push({ label: l, cont: !first });
      first = false;
      const cap = kvFloorCapacity(f);
      for (let k = 0; k < cap && i < list.length; k++) roomFloor.set(list[i++].id, f);
    }
  }
  return { floors, roomFloor };
}
