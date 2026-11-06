// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): os ganchos do motor da planta nos arquivos originais do Habblaud
// (sim.ts, renderer.ts, lighting.ts, overlay.ts, world/index.ts). Este arquivo é leve e não importa o motor: enquanto o
// motor não liga (sem HABBLAUD_HUMANOS, sem planta ligada, ou numa visita a outro prédio), cada gancho devolve
// null/undefined e o original segue igual.
import type { RoomInfo } from '../../../../shared/types';
import type { RoomTheme } from '../../art/api';
import type { ExteriorLayout, SlotShell } from '../../world/layout/exterior';
import type { BuildingLayout } from '../../world/layout/building';
import type { RoomInput } from '../../world/layout/room';
import type { AreaLayout } from '../../world/layout/types';
import type { Sim } from '../../world/sim/sim';

type Halo = (img: HTMLCanvasElement, cx: number, cy: number, w: number, h: number, a: number) => void;

export interface KvPlanEngineHooks {
  assemble(sim: Sim, rooms: readonly AreaLayout[], version: number): BuildingLayout | null;
  slot(sim: Sim, info: RoomInfo): number | undefined;
  layoutRoom(room: RoomInput, theme: RoomTheme, info: RoomInfo | null | undefined, sim: Sim | undefined): AreaLayout | null;
  canCompact(sim: Sim, slot: number): boolean;
  baseKey(sim: Sim): number | null;
  exterior(sim: Sim): ExteriorLayout | null;
  shells(sim: Sim): SlotShell[] | null;
  finishBase(sim: Sim, ctx: CanvasRenderingContext2D, ext: ExteriorLayout): boolean;
  rectPx(sim: Sim): { x: number; y: number; w: number; h: number } | null;
  windowSpill(sim: Sim, lit: Map<{ layout: AreaLayout; wallItems: { kind: string; cx: number }[] }, number>, k: number, halo: Halo, warm: HTMLCanvasElement): boolean;
  signText(areaId: string): string | null;
  areaOfTile(sim: Sim, tx: number, ty: number): string | null;
  geom(sim: Sim): { strip: { x: number; y: number; w: number; h: number } | null; vertical: boolean } | null;
  areaName(areaId: string): string | null;
  areaColor(areaId: string): string | null;
}

/** Preenchido por engine.ts quando o motor liga. */
export const kvPlanHooks: { impl: KvPlanEngineHooks | null } = { impl: null };

/** sim.ts relayout(): o prédio da planta (null = o original). */
export function kvAssembleBuilding(sim: Sim, rooms: readonly AreaLayout[], version: number): BuildingLayout | null {
  return kvPlanHooks.impl?.assemble(sim, rooms, version) ?? null;
}

/** sim.ts createRoom(): vaga da sala com lugar marcado na planta (undefined = a primeira livre, como o original). */
export function kvPlanSlot(sim: Sim, info: RoomInfo): number | undefined {
  return kvPlanHooks.impl?.slot(sim, info);
}

/** sim.ts compact(): a sala pode se mudar? (na planta, só as da faixa automática) */
export function kvCanCompact(sim: Sim, slot: number): boolean {
  return kvPlanHooks.impl ? kvPlanHooks.impl.canCompact(sim, slot) : true;
}

/** humanos/rooms-layout.ts kvLayoutRoom(): a sala na planta (null = o layout original). */
export function kvPlanLayoutRoom(room: RoomInput, theme: RoomTheme, info: RoomInfo | null | undefined, sim: Sim | undefined): AreaLayout | null {
  return kvPlanHooks.impl?.layoutRoom(room, theme, info, sim) ?? null;
}

/** renderer.ts: chave da camada base (o original usa o número de colunas). */
export function kvBaseKey(sim: Sim): number {
  return kvPlanHooks.impl?.baseKey(sim) ?? sim.building.cols;
}

export function kvPlanExteriorOf(sim: Sim): ExteriorLayout | null {
  return kvPlanHooks.impl?.exterior(sim) ?? null;
}

export function kvPlanShells(sim: Sim): SlotShell[] | null {
  return kvPlanHooks.impl?.shells(sim) ?? null;
}

/** renderer.ts finishBase(): vinheta e caminhos de pedra da planta (false = o original). */
export function kvFinishBase(sim: Sim, ctx: CanvasRenderingContext2D, ext: ExteriorLayout): boolean {
  return kvPlanHooks.impl?.finishBase(sim, ctx, ext) ?? false;
}

/** world/index.ts: o retângulo do prédio em px (câmera, enquadramento). */
export function kvBuildingRectPx(sim: Sim): { x: number; y: number; w: number; h: number } | null {
  return kvPlanHooks.impl?.rectPx(sim) ?? null;
}

/** lighting.ts paintWindowSpill(): a luz das janelas no gramado em volta da planta (false = o original). */
export function kvWindowSpill(sim: Sim, lit: Map<{ layout: AreaLayout; wallItems: { kind: string; cx: number }[] }, number>, k: number, halo: Halo, warm: HTMLCanvasElement): boolean {
  return kvPlanHooks.impl?.windowSpill(sim, lit, k, halo, warm) ?? false;
}

/** overlay.ts: o texto da placa de uma área da planta (sala temática, corredor com nome). */
export function kvPlanSignText(areaId: string): string | null {
  return kvPlanHooks.impl?.signText(areaId) ?? null;
}

/** humanos/world.ts: a planta para a posição das pessoas (null = prédio original). */
export function kvPlanGeomOf(sim: Sim): { strip: { x: number; y: number; w: number; h: number } | null; vertical: boolean } | null {
  return kvPlanHooks.impl?.geom(sim) ?? null;
}

/** humanos/bar.ts: nome de uma área da planta (`kv:<item>`). */
export function kvPlanAreaLabel(areaId: string): string | null {
  return kvPlanHooks.impl?.areaName(areaId) ?? null;
}

/** humanos/minimap.ts: cor de uma área da planta no mini-mapa (null = a do tipo). */
export function kvPlanAreaColor(areaId: string): string | null {
  return kvPlanHooks.impl?.areaColor(areaId) ?? null;
}

/** overlay.ts: a área física de um tile (para agrupar balões), ou null = a regra original por coluna. */
export function kvPlanAreaOfTile(sim: Sim, tx: number, ty: number): string | null {
  return kvPlanHooks.impl?.areaOfTile(sim, tx, ty) ?? null;
}
