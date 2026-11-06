// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): o contrato entre as frentes da planta livre, só tipos e registros
// (sem lógica de prédio). Quem implementa cada parte:
// - motor do prédio (client/src/kaviski/plan/engine*.ts): monta o prédio a partir da planta, chama os furnishers, guarda
//   o "rascunho" do editor e expõe `kvPlanWorld`;
// - editor (client/src/kaviski/plan/editor*.ts): desenha a planta por cima do mundo, grava no servidor;
// - salas temáticas (client/src/kaviski/plan/themes*.ts e interações): registram furnishers e as ações "ir e fazer".
import type { Dir, FurnitureKind, RoomTheme } from '../../art/api';
import type { AreaBuilder, SpotOpts } from '../../world/layout/builder';
import type { SpotDef, SpotKind, TileRect } from '../../world/layout/types';
import type { KvPlan, KvPlanItem } from '../../../../shared/kaviski-plan';

/**
 * O que o motor entrega a quem mobilia uma sala. A casca (piso, paredes, portas, placa, interruptor, caminhabilidade)
 * já está pronta no `b`; o furnisher só põe móveis, itens de parede e spots, em coordenadas LOCAIS da sala
 * (0,0 = canto de cima à esquerda do retângulo da sala), sem tocar em `keepFree`.
 */
export interface KvFurnishCtx {
  item: KvPlanItem;
  /** Retângulo da sala (tiles absolutos). */
  rect: TileRect;
  /** Miolo caminhável, em coordenadas locais: colunas 1..w-2, linhas 2..h-2. */
  inner: TileRect;
  /** Tiles (locais) que precisam ficar livres: a passagem na frente de cada porta e o interruptor. */
  keepFree: { x: number; y: number }[];
  /** Linhas/colunas de parede livres para itens de parede (locais, em px do centro), já sem portas, placa e interruptor. */
  wallSlots: { on: 'face' | 'south'; lcx: number; ly?: number }[];
  theme: RoomTheme;
  seed: number;
  rng: () => number;
  b: AreaBuilder;
  /** Atalhos que respeitam `keepFree` e o que já foi posto (false = não coube). */
  furn(kind: FurnitureKind, lx: number, ly: number, variant?: string, o?: { dx?: number; dy?: number; order?: number; seat?: string }): string | null;
  seat(kind: SpotKind, fk: FurnitureKind, lx: number, ly: number, dir: Dir, variant?: string, o?: SpotOpts & { order?: number }): SpotDef | null;
  spot(kind: SpotKind, lx: number, ly: number, dir: Dir, o?: SpotOpts): SpotDef | null;
  wall(kind: FurnitureKind, lcx: number, variant?: string, o?: { ly?: number; on?: 'face' | 'south'; order?: number }): string | null;
  /** O tile local está livre (dentro do miolo, fora de keepFree e de móveis já postos)? */
  free(lx: number, ly: number, w?: number, h?: number): boolean;
  /**
   * Marca um móvel/spot como item interativo de uma ação (`KvActionKey`): o motor guarda `furnitureId → key` e o
   * interact/"ir e fazer" acha o lugar por aqui. Pode haver vários itens para a mesma ação.
   */
  tag(furnitureOrSpotId: string, action: string): void;
}

/** Mobilia uma sala (tema, propria por tipo, projeto por estilo). */
export type KvFurnisher = (ctx: KvFurnishCtx) => void;

const furnishers = new Map<string, KvFurnisher>();

/**
 * Registra a mobília de um tipo de sala. Chave: `tema:<KvThemeKey>`, `propria:<KvOwnRoomKind>`, `projeto` ou
 * `projeto:<style>`. A última registrada vence (o motor registra as padrão primeiro).
 */
export function kvRegisterFurnisher(key: string, f: KvFurnisher): void {
  furnishers.set(key, f);
}

export function kvFurnisher(key: string): KvFurnisher | undefined {
  return furnishers.get(key);
}

/** Item interativo achado no prédio (o motor preenche a partir dos `tag`). */
export interface KvActionSpot {
  action: string;
  /** Sala/área em que está (id da área do Sim). */
  areaId: string;
  /** Tile de onde o boneco usa o item (caminhável). */
  tx: number;
  ty: number;
  /** Para onde o boneco olha usando. */
  dir: Dir;
  /** Centro do item em px de mundo (dica, destaque). */
  x: number;
  y: number;
  furnitureId?: string;
  /** Caixa do item em px de mundo (contorno aceso ao passar o mouse, clique no item). */
  box?: { x: number; y: number; w: number; h: number };
}

/**
 * O que o motor expõe aos outros módulos (preenchido por engine.ts; vazio enquanto não há planta ligada).
 * Editor: `preview(draft)` mostra o rascunho no mundo sem gravar; `preview(null)` volta à planta gravada.
 */
export const kvPlanWorld: {
  /** A planta em uso no prédio (gravada ou o rascunho do editor); null = prédio original. */
  plan: KvPlan | null;
  /** Mostra um rascunho no mundo (editor), ou volta à planta gravada (null). */
  preview?: (draft: KvPlan | null) => void;
  /** Itens interativos do prédio atual (por ação). */
  actionSpots: () => KvActionSpot[];
  /** O item da planta que ocupa o tile (para o editor e a dica). */
  itemAt?: (tx: number, ty: number) => KvPlanItem | null;
  /** O prédio mudou (planta nova, sala nova): chamados depois do relayout. */
  onChange: Set<() => void>;
} = { plan: null, actionSpots: () => [], onChange: new Set() };

/**
 * Ações "ir e fazer" (frente das salas temáticas): cada função do sistema com o seu item físico. `kvGoAndDo(key)` faz o
 * boneco andar até o item mais perto da ação e, ao chegar, chama `run`. Sem boneco, sem planta ou sem item: `run`
 * direto.
 */
export interface KvAction {
  key: string;
  label: string;
  /** Emoji ou nome de ícone do kit. */
  icon: string;
  run: () => void;
  /** Pose usando o item (padrão 'use'). */
  pose?: 'use' | 'read' | 'stand';
  /** Quem pode (padrão: todos). */
  allowed?: () => boolean;
}

const actions = new Map<string, KvAction>();

export function kvRegisterAction(a: KvAction): void {
  actions.set(a.key, a);
}

export function kvAction(key: string): KvAction | undefined {
  return actions.get(key);
}

export function kvActions(): KvAction[] {
  return [...actions.values()];
}
