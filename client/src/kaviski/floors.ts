// Fork Kaviski (KAVISKI.md): prédio em ANDARES (HABBLAUD_FLOOR_COLS, vindo em meta.kaviski.floorCols).
//
// Sem a variável o prédio é o original: uma faixa (fileira norte + corredor + fileira sul) que cresce para leste.
// Com ela, cada andar é essa mesma faixa com FLOOR_COLS colunas de projeto (2 salas por coluna) mais o núcleo
// (CORE_COLS colunas), e os andares se empilham PARA BAIXO no mundo (y cresce): o térreo, com a recepção, fica no
// topo (y = 0, junto da rua, que passa ao norte) e o andar f começa em f * FLOOR_PITCH. Assim nenhuma coordenada já
// usada muda quando um andar novo aparece (ele só se acrescenta embaixo).
//
// O slot da sala (o "endereço" no cliente) vira um número de célula: slot = andar * salasPorAndar + local, local na
// ordem original (par = norte, ímpar = sul, coluna = local / 2). A escolha do andar de cada sala (por rótulo) fica em
// floors-world.ts; aqui só a aritmética, pura e testável. Este módulo não importa nada do layout (é importado por
// geometry.ts e exterior.ts).
import { BUILDING_H, CORE_COLS, CORRIDOR_H, CORRIDOR_Y, TILE } from '../world/constants';
import type { TileRect } from '../world/layout/types';
import { tr } from '../../../shared/i18n';

/** Faixa de grama entre dois andares (tiles): onde vai a placa do andar. */
export const FLOOR_GAP = 5;
/** Distância (tiles) do topo de um andar ao do seguinte. */
export const FLOOR_PITCH = BUILDING_H + FLOOR_GAP;

let floorCols = 0;

/** Liga os andares (uma vez por página; 0/undefined = original). Mudar no meio desmontaria o prédio: só a 1ª vale. */
export function kvSetFloorCols(n: number | undefined): void {
  if (floorCols || !n || !Number.isInteger(n) || n < 1) return;
  floorCols = n;
}

/** Testes: volta ao original. */
export function kvResetFloorsForTest(n = 0): void {
  floorCols = n;
}

export function kvFloorCols(): number {
  return floorCols;
}

export function kvFloorsOn(): boolean {
  return floorCols > 0;
}

/** Salas por andar (2 por coluna). */
export function kvRoomsPerFloor(): number {
  return floorCols * 2;
}

/** Andar de um slot (0 = térreo). */
export function kvSlotFloor(slot: number): number {
  return floorCols ? Math.floor(Math.max(0, slot) / kvRoomsPerFloor()) : 0;
}

/** Posição do slot dentro do andar (0 .. salasPorAndar-1). */
export function kvSlotLocal(slot: number): number {
  return floorCols ? Math.max(0, slot) % kvRoomsPerFloor() : Math.max(0, slot);
}

/** Coluna do prédio de um slot (com andares). */
export function kvSlotColumn(slot: number): number {
  return CORE_COLS + Math.floor(kvSlotLocal(slot) / 2);
}

/** Topo (tile) do andar f. */
export function kvFloorY(f: number): number {
  return floorCols ? Math.max(0, f) * FLOOR_PITCH : 0;
}

/** Andar de uma linha de tile (as linhas da faixa entre andares contam como do andar de baixo). */
export function kvFloorOfTile(ty: number): number {
  if (!floorCols) return 0;
  return Math.max(0, Math.floor((ty + FLOOR_GAP) / FLOOR_PITCH));
}

/** Linha dentro do próprio andar (0 = topo da fileira norte). */
export function kvLocalY(ty: number): number {
  return floorCols ? ty - kvFloorY(kvFloorOfTile(ty)) : ty;
}

/** Linha do topo de uma fileira norte (de qualquer andar): é o que o original testa com `y === 0`. */
export function kvIsTopRow(ty: number): boolean {
  return floorCols ? ty >= 0 && kvLocalY(ty) === 0 : ty === 0;
}

/** Slot de uma coluna/lado/andar (inverso de kvSlotColumn/slotSide/kvSlotFloor). */
export function kvSlotAt(col: number, side: 'north' | 'south', floor: number): number {
  return Math.max(0, floor) * kvRoomsPerFloor() + (col - CORE_COLS) * 2 + (side === 'north' ? 0 : 1);
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
  return floorCols ? n * FLOOR_PITCH - FLOOR_GAP : BUILDING_H;
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

/** Fechamento de slot (jardim) de outro andar: o do slot equivalente do térreo, deslocado em y e com o slot real. */
export function kvShiftShell<
  T extends { slot: number; rect: TileRect; walls: { y: number }[]; windows: { id: string; baseY: number }[]; floors: { y: number }[]; props: { y: number; kind: string; slot?: number; whenRoom?: number }[] },
>(sh: T, dyTiles: number, slot: number): T {
  const py = dyTiles * TILE;
  const fix = (n: number | undefined) => (n === sh.slot ? slot : n);
  return {
    ...sh,
    slot,
    rect: { ...sh.rect, y: sh.rect.y + dyTiles },
    walls: sh.walls.map((w) => ({ ...w, y: w.y + py })),
    windows: sh.windows.map((w) => ({ ...w, id: w.id.replace(`shell:${sh.slot}:`, `shell:${slot}:`), baseY: w.baseY + py })),
    floors: sh.floors.map((f) => ({ ...f, y: f.y + py })),
    // o caminho até a calçada (paving) só faz sentido no térreo original
    props: sh.props.filter((p) => p.kind !== 'paving').map((p) => ({ ...p, y: p.y + py, slot: fix(p.slot), whenRoom: fix(p.whenRoom) })),
  };
}

/** Número do andar por extenso curto (o rótulo vem à parte). */
export function kvFloorOrdinal(f: number): string {
  return f === 0 ? tr('Térreo') : tr('{0}º andar', [f]);
}
