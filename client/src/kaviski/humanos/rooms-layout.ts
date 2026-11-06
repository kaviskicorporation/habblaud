// Fork Kaviski (KAVISKI-HUMANOS.md): layout das salas próprias (rooms.json), com a mesma casca da sala de projeto
// (16x12, porta no mesmo lugar, placa, interruptor) e a mobília pelo tipo:
//   reuniao  = pelo layout da sala de reunião (`meet.layout`, rooms-meet.ts): cabine, bate-papo, reunião (mesa grande
//              com banquetas em volta), conselho, treinamento ou criativa; com o painel de reservas na parede;
//   descanso = sofá e poltronas de frente para a TV, puffs;
//   pessoal  = mesa de trabalho + estante, cantinho com poltronas para visitas e quadro branco;
//   outra    = duas mesas e uma mesa de reunião.
// Mais a decoração escolhida pelo dono (plantas, luminária, quadros, tapetes...) em lugares livres. Puro (sem DOM).
// Gancho no original: client/src/world/sim/sim.ts troca `layoutProjectRoom(...)` por `kvLayoutRoom(..., info)`.
//
// Os assentos usam só tipos de lugar "da sala" (nook, stool, desk): os agentes não vêm descansar aqui.
import { FURNITURE, type Dir, type FurnitureKind, type RoomTheme, type WallStyle } from '../../art/api';
import type { RoomInfo } from '../../../../shared/types';
import { hash32, mulberry32 } from '../../../../shared/hash';
import type { KvDecorItem, KvOwnRoomKind } from '../../../../shared/kaviski-rooms';
import type { KvMeetConfig, KvMeetLayout } from '../../../../shared/kaviski-meetings';
import { DOOR_W, DOOR_X, TILE } from '../../world/constants';
import { AreaBuilder } from '../../world/layout/builder';
import { slotRect, slotSide } from '../../world/layout/geometry';
import { layoutProjectRoom, type RoomInput } from '../../world/layout/room';
import type { AreaLayout } from '../../world/layout/types';
import type { Sim } from '../../world/sim/sim';
import { kvPlanLayoutRoom } from '../plan/hooks';
import { kvMeetRoom16 } from './rooms-meet';

/** O que a página põe no RoomInfo de uma sala própria (só no navegador; nunca vem do servidor no snapshot). */
export interface KvOwnRoomMark {
  kind: KvOwnRoomKind;
  decor: readonly KvDecorItem[];
  owner?: string;
  /** Sala de reunião: o layout (cabine, bate-papo, reunião, conselho, treinamento, criativa) e o resto da configuração. */
  meet?: KvMeetConfig;
}
export type KvOwnRoomInfo = RoomInfo & { kvOwn?: KvOwnRoomMark };

export function kvOwnMark(info: RoomInfo | undefined | null): KvOwnRoomMark | undefined {
  return (info as KvOwnRoomInfo | undefined | null)?.kvOwn;
}

/** Gancho do sim.ts: com a planta ligada, a sala na planta; sala própria = layout por tipo; sala de projeto = o original. */
export function kvLayoutRoom(room: RoomInput, theme: RoomTheme, info?: RoomInfo | null, sim?: Sim): AreaLayout {
  return kvPlanLayoutRoom(room, theme, info, sim) ?? kvLayoutRoomOriginal(room, theme, info); // planta livre (KAVISKI-HUMANOS.md)
}

/** O layout de sempre (vagas do prédio original), sem a planta. */
export function kvLayoutRoomOriginal(room: RoomInput, theme: RoomTheme, info?: RoomInfo | null): AreaLayout {
  const mark = kvOwnMark(info);
  return mark ? layoutOwnRoom(room, theme, mark) : layoutProjectRoom(room, theme);
}

/** Itens interativos ("ir e fazer") de cada layout de sala própria: id do item -> ações (o painel `reunioes`). */
const ownTags = new WeakMap<AreaLayout, Map<string, string[]>>();

/**
 * Os itens marcados de uma sala própria montada por `layoutOwnRoom` (o painel de reservas das salas de reunião), para
 * o motor da planta juntá-los aos `tag` dos furnishers quando usa o layout de sempre transladado (os ids não mudam).
 */
export function kvOwnRoomTags(a: AreaLayout): Map<string, string[]> | undefined {
  return ownTags.get(a);
}

const PLANTS_TALL = ['palm', 'ficus', 'monstera', 'bonsai'] as const;
const PLANTS_SMALL = ['fern', 'succulent', 'flower'] as const;

const DECOR_FURN: Record<string, FurnitureKind> = {
  planta: 'plant_small',
  planta_alta: 'plant_tall',
  luminaria: 'floor_lamp',
  estante: 'binder_shelf',
  arquivo: 'filing_cabinet',
  puff: 'beanbag',
  quadro: 'painting',
  poster: 'poster',
  relogio: 'clock',
};

/** Tiles (locais) que a decoração não pode ocupar: a passagem da porta e a frente do quadro, da placa e do mural. */
function reserved(north: boolean): (lx: number, ly: number) => boolean {
  return (lx, ly) => {
    // encostado na parede, um móvel alto cobriria o quadro (x 1–4), a placa e o mural (x 9–13)
    if (ly === 2 && ((lx >= 1 && lx <= 4) || (lx >= 9 && lx <= 13))) return true;
    if (lx >= DOOR_X - 1 && lx < DOOR_X + DOOR_W + 1) {
      if (north && ly >= 8) return true;
      if (!north && ly <= 3) return true;
    }
    return false;
  };
}

export function layoutOwnRoom(room: RoomInput, theme: RoomTheme, mark: KvOwnRoomMark): AreaLayout {
  const rect = slotRect(room.slot);
  const side = slotSide(room.slot);
  const north = side === 'north';
  const rng = mulberry32(hash32(room.id) ^ 0x51a5);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
  const b = new AreaBuilder(room.id, 'room', rect);
  const area = b.area;
  area.side = side;
  const wall: WallStyle = theme.wall;
  const door = { lx: DOOR_X, w: DOOR_W };
  const kind = mark.kind;

  // ---- piso, paredes, porta (a mesma casca da sala de projeto)
  b.floor(kind === 'descanso' ? 'wood' : 'marble', 0, 0, 16, 12, room.seed);
  area.floorTint = theme.carpet;
  b.rug(DOOR_X - 0.25, north ? 9.5 : 2, DOOR_W + 0.5, 1.25, theme.carpet2, room.seed + 1);
  if (north) {
    b.face(0.5, 15, wall);
    b.south(0.5, 15, 11, wall, [door]);
  } else {
    b.face(0.5, 15, wall, [door]);
    b.south(0.5, 15, 11, { ...wall, exterior: true });
    b.wall('door_frame', DOOR_X + DOOR_W / 2, undefined, { order: 0.05 });
  }
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);
  b.walk(1, 2, 14, 9);
  area.door = north ? { x: rect.x + DOOR_X, y: rect.y + 11, w: DOOR_W, h: 1 } : { x: rect.x + DOOR_X, y: rect.y, w: DOOR_W, h: 2 };
  b.walk(area.door.x - rect.x, area.door.y - rect.y, area.door.w, area.door.h);

  // ---- parede: quadro branco (ou TV), placa e o lugar do mural (pôster) no MESMO lugar dos dois lados do corredor
  // (a sala fica de um lado num prédio e do outro em outro); sem relógio nem janela fixos: sobra parede para a
  // decoração (x 4–6 e 13–15, livres nos dois lados)
  area.signId = b.wall('sign', 10.5, undefined, { order: 0.95 });
  if (kind === 'descanso') b.wall('tv', 2.5, undefined, { order: 0.6 });
  else {
    b.wall('whiteboard', 2.5, undefined, { order: 0.6 });
    b.spot('whiteboard', 2, 2, 'up', { dx: 8, dy: 2 });
  }
  b.wall('poster', 12.6, pick(['code', 'coffee', 'rocket', 'cat'] as const), { order: 0.5 });
  if (north) {
    b.wall('light_switch', DOOR_X - 0.5, 'on', { ly: 12, on: 'south', order: 0.8 });
    b.spot('switch', DOOR_X - 1, 10, 'down', { dy: -1 });
  } else {
    b.wall('light_switch', DOOR_X - 0.5, 'on', { order: 0.8 });
    b.spot('switch', DOOR_X - 1, 2, 'up', { dy: -3 });
  }

  const seat = (fk: FurnitureKind, lx: number, ly: number, dir: Dir, variant?: string, o: { dx?: number; deskId?: string; order?: number } = {}) =>
    b.seat(fk === 'office_chair' || fk === 'office_chair_front' ? 'desk' : fk === 'stool' ? 'stool' : 'nook', fk, lx, ly, dir, variant, { order: 0.6, ...o });

  switch (kind) {
    case 'reuniao': {
      // pelo layout da sala de reunião (cabine, bate-papo, reunião, conselho, treinamento, criativa): rooms-meet.ts
      const tags = new Map<string, string[]>();
      kvMeetRoom16({ b, theme, seed: room.seed, north, pick, tags }, mark.meet?.layout ?? 'reuniao');
      ownTags.set(area, tags);
      break;
    }
    case 'descanso': {
      // sofá de costas para a câmera, de frente para a TV; poltronas e puffs
      b.rug(1.5, 3.2, 7, 5.2, theme.carpet, room.seed + 2);
      const sx = 1;
      const sofa = b.furn('sofa', sx, 6, 'up', { order: 0.5 });
      for (let i = 0; i < 3; i++) b.seat('nook', 'sofa', sx + i, 6, 'up', 'up', { noFurniture: true, furnitureId: sofa });
      b.furn('coffee_table', sx, 4, undefined, { dx: TILE / 2, order: 0.45 });
      b.block(sx + 2, 4, 1, 1);
      seat('armchair', sx + 3, 4, 'left', 'left');
      b.rug(9.6, 5.6, 4.8, 3.6, theme.carpet2, room.seed + 3);
      (['red', 'blue', 'yellow'] as const).forEach((c, i) => seat('beanbag', 9 + i * 2, 8, 'up', c, { order: 0.62 + i * 0.01 }));
      b.furn('cafe_table', 11, 6, undefined, { order: 0.44 });
      b.furn('binder_shelf', 14, 4, undefined, { order: 0.3 });
      b.furn('plant_tall', 14, 10, pick(PLANTS_TALL), { order: 0.2 });
      b.furn('floor_lamp', 1, 9, undefined, { order: 0.31 });
      b.furn('plant_small', 12, 10, pick(PLANTS_SMALL), { order: 0.22 });
      break;
    }
    case 'pessoal': {
      // mesa de trabalho com o monitor para a câmera, estante e um cantinho para visitas
      b.rug(1.6, 4.6, 5, 3.6, theme.carpet, room.seed + 2);
      const desk = b.furn('desk', 3, 6, theme.deskVariant, { order: 0.4, seat: 'S0' });
      seat('office_chair', 3, 7, 'up', theme.chairVariant, { dx: TILE / 2, deskId: desk });
      b.furn('trash_bin', 5, 6, undefined, { order: 0.42 });
      b.furn('bookshelf', 1, 9, undefined, { order: 0.25 });
      b.furn('binder_shelf', 14, 4, undefined, { order: 0.3 });
      b.furn('binder_shelf', 14, 5, undefined, { order: 0.31 });
      b.furn('plant_tall', 14, 9, pick(PLANTS_TALL), { order: 0.2 });
      // visitas: mesinha com duas poltronas
      b.rug(9.6, 4.7, 4.8, 3.2, theme.carpet2, room.seed + 3);
      b.furn('cafe_table', 11, 6, undefined, { order: 0.45 });
      seat('armchair', 10, 6, 'right', 'right');
      seat('armchair', 12, 6, 'left', 'left');
      b.furn('floor_lamp', 1, 6, undefined, { order: 0.33 });
      b.spot('stand', 11, 4, 'down');
      break;
    }
    default: {
      // outra: duas mesas face a face e uma mesa de reunião
      b.rug(1.5, 3.25, 5, 5.5, theme.carpet, room.seed + 2);
      const back = b.furn('desk_back', 2, 5, theme.deskVariant, { order: 0.35, seat: 'N0' });
      const front = b.furn('desk', 2, 6, theme.deskVariant, { order: 0.4, seat: 'S0' });
      seat('office_chair_front', 2, 4, 'down', theme.chairVariant, { dx: TILE / 2, deskId: back });
      seat('office_chair', 2, 7, 'up', theme.chairVariant, { dx: TILE / 2, deskId: front });
      b.furn('meeting_table', 10, 5, undefined, { order: 0.45 });
      seat('stool', 10, 4, 'down');
      seat('stool', 12, 4, 'down');
      seat('stool', 10, 7, 'up');
      seat('stool', 12, 7, 'up');
      b.furn('bookshelf', 12, 9, undefined, { order: 0.25 });
      b.furn('plant_tall', 1, 10, pick(PLANTS_TALL), { order: 0.2 });
      b.furn('printer', 14, 8, undefined, { order: 0.32 });
      b.spot('stand', 5, 4, 'down');
    }
  }

  applyDecor(b, mark.decor, north, room.seed);

  const p = { x: rect.x * TILE, y: rect.y * TILE, w: rect.w * TILE, h: rect.h * TILE };
  area.shade = north ? { x: p.x, y: p.y, w: p.w, h: p.h - TILE } : { x: p.x, y: p.y, w: p.w, h: p.h };
  return b.build();
}

/** Tiles locais ocupados (móveis de chão e lugares) — onde a decoração não entra. */
function occupied(a: AreaLayout): Set<string> {
  const out = new Set<string>();
  for (const f of a.furniture) {
    const fp = FURNITURE[f.kind].footprint;
    for (let y = 0; y < fp.h; y++) for (let x = 0; x < fp.w; x++) out.add(`${f.tx - a.rect.x + x},${f.ty - a.rect.y + y}`);
  }
  for (const s of a.spots) out.add(`${s.tx - a.rect.x},${s.ty - a.rect.y}`);
  for (const r of a.blocked ?? []) for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) out.add(`${r.x - a.rect.x + x},${r.y - a.rect.y + y}`);
  return out;
}

/** Faixas (cx ± meia largura, em tiles locais) já ocupadas na parede norte. */
function wallSpans(a: AreaLayout): [number, number][] {
  return a.wallItems
    .filter((w) => w.on === 'face')
    .map((w) => {
      const half = FURNITURE[w.kind].footprint.w / 2;
      const cx = w.cx / TILE - a.rect.x;
      return [cx - half, cx + half] as [number, number];
    });
}

function applyDecor(b: AreaBuilder, decor: readonly KvDecorItem[], north: boolean, seed: number): void {
  const a = b.area;
  const used = occupied(a);
  const res = reserved(north);
  const spans = wallSpans(a);
  decor.forEach((d, i) => {
    if (d.kind === 'tapete') {
      if (d.w && d.h && d.color) b.rug(d.x, d.y, d.w, d.h, d.color, seed + 10 + i);
      return;
    }
    const fk = DECOR_FURN[d.kind];
    if (!fk) return;
    const def = FURNITURE[fk];
    if (def.mount === 'wall') {
      const half = def.footprint.w / 2;
      const lo = d.x - half;
      const hi = d.x + half;
      if (lo < 0.5 || hi > 15.5 || spans.some(([a0, a1]) => lo < a1 && hi > a0)) return;
      spans.push([lo, hi]);
      b.wall(fk, d.x, d.variant, { order: 0.5 });
      return;
    }
    const key = `${d.x},${d.y}`;
    if (d.x < 1 || d.x > 14 || d.y < 2 || d.y > 10 || used.has(key) || res(d.x, d.y)) return;
    used.add(key);
    if (fk === 'beanbag') b.seat('nook', 'beanbag', d.x, d.y, 'down', d.variant, { order: 0.6 });
    else b.furn(fk, d.x, d.y, d.variant, { order: 0.5 });
  });
}

/**
 * Para a tela de decoração: tiles livres (para itens de chão) e faixas de parede livres de uma sala deste tipo, sem a
 * decoração. Vale para os dois lados do corredor (o livre é o que está livre nos dois). Sala de reunião: passe o layout.
 */
export function kvDecorFree(kind: KvOwnRoomKind, theme: RoomTheme, layout?: KvMeetLayout): { floor: Set<string>; wall: [number, number][] } {
  // sala de reunião: a mobília muda com o layout (sem layout = a "reunião" de sempre)
  const mark: KvOwnRoomMark = { kind, decor: [], meet: layout ? ({ layout } as KvMeetConfig) : undefined };
  const north = layoutOwnRoom({ id: 'kvsala-preview', slot: 0, seed: 0 }, theme, mark);
  const south = layoutOwnRoom({ id: 'kvsala-preview', slot: 1, seed: 0 }, theme, mark);
  const busy = new Set([...occupied(north), ...occupied(south)]);
  const rn = reserved(true);
  const rs = reserved(false);
  const floor = new Set<string>();
  for (let y = 2; y <= 10; y++) for (let x = 1; x <= 14; x++) if (!busy.has(`${x},${y}`) && !rn(x, y) && !rs(x, y)) floor.add(`${x},${y}`);
  return { floor, wall: [...wallSpans(north), ...wallSpans(south)] };
}
