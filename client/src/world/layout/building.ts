// Montagem do prédio: núcleo + corredor + salas de projeto -> grade de caminhabilidade e spots.
import { FURNITURE } from '../../art/api';
import { BUILDING_H, COL_W } from '../constants';
import { BLOCKED, FREE, SEAT, WalkGrid } from '../path/grid';
import { furnitureBlocks, furnitureIsSeat } from './builder';
import { layoutCafe, layoutLounge, layoutReception, layoutRestroom } from './core';
import { layoutCorridor } from './corridor';
import { buildingRect } from './geometry';
import type { AreaLayout, SpotDef, TileRect } from './types';
import { kvBuildingH } from '../../kaviski/floors'; // fork Kaviski: andares
import { kvUpperFloorAreas } from '../../kaviski/floors-world'; // fork Kaviski: andares

export interface BuildingLayout {
  cols: number;
  rect: TileRect;
  core: AreaLayout[];
  corridor: AreaLayout;
  rooms: AreaLayout[];
  grid: WalkGrid;
  spots: SpotDef[];
  /** Fork Kaviski: número de andares (HABBLAUD_FLOOR_COLS); ausente = 1 (o original). */
  kvFloors?: number;
}

let coreCache: AreaLayout[] | null = null;

/** Áreas fixas do núcleo (calculadas uma vez). */
export function coreAreas(): AreaLayout[] {
  return (coreCache ??= [layoutReception(), layoutRestroom(), layoutCafe(), layoutLounge()]);
}

/** Marca na grade as células caminháveis de uma área, os bloqueios e os assentos. */
export function paintArea(grid: WalkGrid, area: AreaLayout): void {
  for (const r of area.walkable) grid.fill(r.x, r.y, r.w, r.h, FREE);
  for (const r of area.blocked ?? []) grid.fill(r.x, r.y, r.w, r.h, BLOCKED);
  for (const f of area.furniture) {
    const def = FURNITURE[f.kind];
    if (def.mount !== 'floor') continue;
    const { w, h } = def.footprint;
    if (furnitureBlocks(f.kind)) grid.fill(f.tx, f.ty, w, h, BLOCKED);
    else if (furnitureIsSeat(f.kind)) {
      for (let y = f.ty; y < f.ty + h; y++) for (let x = f.tx; x < f.tx + w; x++) if (grid.get(x, y) === FREE) grid.set(x, y, SEAT);
    }
  }
}

export function buildWalkGrid(cols: number, areas: readonly AreaLayout[], version = 0, floors = 1): WalkGrid {
  const grid = new WalkGrid(cols * COL_W, floors > 1 ? kvBuildingH(floors) : BUILDING_H, version); // fork Kaviski: andares
  for (const a of areas) paintArea(grid, a);
  return grid;
}

export function assembleBuilding(cols: number, rooms: readonly AreaLayout[], version = 0, floors = 1): BuildingLayout {
  const core = [...coreAreas(), ...kvUpperFloorAreas(cols, floors)]; // fork Kaviski: núcleo e corredor dos outros andares
  const corridor = layoutCorridor(cols);
  const all = [...core, corridor, ...rooms];
  const grid = buildWalkGrid(cols, all, version, floors); // fork Kaviski: andares
  const spots: SpotDef[] = [];
  for (const a of all) spots.push(...a.spots);
  return { cols, rect: buildingRect(cols, floors), core, corridor, rooms: [...rooms], grid, spots, ...(floors > 1 ? { kvFloors: floors } : {}) }; // fork Kaviski: andares
}
