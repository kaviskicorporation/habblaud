// Fork Kaviski (KAVISKI.md): prédio em andares (HABBLAUD_FLOOR_COLS) — geometria, montagem, vagas por rótulo e
// a viagem de elevador entre andares.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../world/api';
import { BUILDING_H, COL_W, CORE_COLS, CORRIDOR_Y, SOUTH_Y, TILE } from '../world/constants';
import { assembleBuilding } from '../world/layout/building';
import { buildingRect, columnsFor, slotAt, slotColumn, slotRect, slotSide } from '../world/layout/geometry';
import { layoutProjectRoom } from '../world/layout/room';
import { slotShell } from '../world/layout/exterior';
import { Sim } from '../world/sim/sim';
import {
  FLOOR_PITCH,
  FLOOR_SLAB,
  kvBubbleArea,
  kvBuildingH,
  kvFloorCapacity,
  kvFloorOfTile,
  kvFloorPlan,
  kvFloorsFor,
  kvGroundY,
  kvIsTopRow,
  kvLocalY,
  kvResetFloorsForTest,
  kvSetFloorCols,
  kvSlotFloor,
  kvSpillsSouth,
  ROOF_H,
  UPPER_CORE_COLS,
} from './floors';
import { kvFloorEntries, kvFloorHop, kvFloorTitle, kvRoomSlot } from './floors-sim';
import { kvBuildingCore, kvLayoutExterior, kvShiftArea, kvSplitAreaId } from './floors-world';
import { kvSortByFloor } from './floors-list';

const theme: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};
const appearance = { skin: '#f0c8a0', hair: '#3a2a20', hairStyle: 'short', eyes: '#222', top: '#3f7fd8', topAccent: '#fff', topStyle: 'tshirt', bottom: '#333', shoes: '#111', accessory: 'none', accessoryColor: '#000', lanyard: null, look: 'm' } as Appearance;
const art = { appearanceFromSeed: () => appearance, roomTheme: () => theme } as unknown as ArtModule;
const T0 = 1_700_000_000_000;

function room(id: string, slot: number, floor?: string): RoomInfo {
  return { id, name: id.replace('/', ''), path: id, slot, seed: slot * 99 + 7, createdAt: T0, ...(floor ? { kaviski: { pinned: true, floor } } : {}) } as RoomInfo;
}

function agent(id: string, roomId: string, status: AgentInfo['status']): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId,
    name: id,
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: '.claude',
    status,
    recent: [],
    tasks: [],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: id.length * 1234567,
  };
}

function snap(rooms: RoomInfo[], agents: AgentInfo[], rev = 1, floorCols = 1): OfficeSnapshot {
  return {
    rev,
    serverTime: T0,
    rooms,
    agents,
    accounts: [{ id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' }],
    meta: { demo: true, sources: [], startedAt: T0, version: 't', kaviski: { floorCols } } as OfficeSnapshot['meta'],
  };
}

function run(sim: Sim, clock: { now: number }, seconds: number, each?: () => boolean | void): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    clock.now += 1000 / 30;
    sim.update(1 / 30, clock.now);
    if (each?.()) return;
  }
}

beforeEach(() => kvResetFloorsForTest());
afterEach(() => kvResetFloorsForTest());

describe('andares: geometria', () => {
  it('sem HABBLAUD_FLOOR_COLS a geometria é a original', () => {
    expect(slotColumn(9)).toBe(CORE_COLS + 4);
    expect(slotRect(1).y).toBe(SOUTH_Y);
    expect(columnsFor([2, 11])).toBe(8);
    expect(buildingRect(4).h).toBe(BUILDING_H);
    expect(kvFloorOfTile(500)).toBe(0);
    expect(kvGroundY()).toBe(0);
    expect(kvBubbleArea(40, CORRIDOR_Y + 1, COL_W, SOUTH_Y)).toBe('2:c');
  });

  it('slot -> andar/coluna/lado e o inverso (térreo com o núcleo, andares com a circulação)', () => {
    kvResetFloorsForTest(5, 3);
    kvSetFloorCols(9); // já ligado: não muda
    expect(kvFloorCapacity(0)).toBe(10);
    expect(kvFloorCapacity(1)).toBe(12);
    expect(slotColumn(0)).toBe(CORE_COLS);
    expect(slotColumn(9)).toBe(CORE_COLS + 4);
    expect(kvSlotFloor(9)).toBe(0);
    expect(kvSlotFloor(10)).toBe(1);
    expect(slotColumn(10)).toBe(UPPER_CORE_COLS);
    expect(kvSlotFloor(21)).toBe(1);
    expect(kvSlotFloor(22)).toBe(2);
    expect(slotSide(10)).toBe('north');
    expect(slotSide(11)).toBe('south');
    // térreo embaixo, andares por cima
    expect(slotRect(0).y).toBe(2 * FLOOR_PITCH);
    expect(slotRect(10)).toEqual({ x: UPPER_CORE_COLS * COL_W, y: FLOOR_PITCH, w: COL_W, h: 12 });
    expect(slotRect(23).y).toBe(SOUTH_Y);
    for (let s = 0; s < 60; s++) expect(slotAt(slotColumn(s), slotSide(s), kvSlotFloor(s))).toBe(s);
    expect(columnsFor([0, 59])).toBe(CORE_COLS + 5);
    expect(kvFloorsFor([0, 9])).toBe(1);
    expect(kvFloorsFor([0, 10, 33])).toBe(3);
  });

  it('altura, andar de cada linha e jardins dos slots vazios', () => {
    kvResetFloorsForTest(5, 4);
    expect(kvBuildingH(1)).toBe(BUILDING_H);
    expect(kvBuildingH(4)).toBe(4 * BUILDING_H + 3 * FLOOR_SLAB);
    expect(buildingRect(7, 4).h).toBe(kvBuildingH(4));
    expect(kvGroundY()).toBe(3 * FLOOR_PITCH);
    expect(kvFloorOfTile(0)).toBe(3);
    expect(kvFloorOfTile(3 * FLOOR_PITCH + 5)).toBe(0);
    expect(kvFloorOfTile(FLOOR_PITCH + 2)).toBe(2);
    expect(kvLocalY(FLOOR_PITCH * 2 + 3)).toBe(3);
    expect(kvIsTopRow(FLOOR_PITCH * 3)).toBe(true);
    expect(kvSpillsSouth(3 * FLOOR_PITCH + SOUTH_Y, 12)).toBe(true);
    expect(kvSpillsSouth(SOUTH_Y, 12)).toBe(false);
    expect(kvBubbleArea(40, FLOOR_PITCH + CORRIDOR_Y + 1, COL_W, SOUTH_Y)).toBe('2:2:c');
    const sh = slotShell(23, false);
    expect(sh.slot).toBe(23);
    expect(sh.rect).toEqual(slotRect(23));
    expect(sh.props.every((p) => p.slot === undefined || p.slot === 23)).toBe(true);
    expect(sh.props.some((p) => p.kind === 'paving')).toBe(false);
    expect(slotShell(1, false).rect).toEqual(slotRect(1));
    expect(slotShell(1, false).props.some((p) => p.kind === 'paving')).toBe(true);
  });

  it('plano por rótulo (o mesmo da simulação e da lista lateral)', () => {
    kvResetFloorsForTest(1);
    const rs = [room('/a', 0, 'Interno'), room('/b', 1, 'Interno'), room('/c', 2, 'Interno'), room('/x', 3), room('/d', 4, 'Arquivo')];
    const p = kvFloorPlan(rs, (r) => (r as { kaviski?: { floor?: string } }).kaviski?.floor ?? '');
    expect(p.floors).toEqual([
      { label: 'Interno', cont: false },
      { label: 'Interno', cont: true },
      { label: 'Arquivo', cont: false },
      { label: '', cont: false },
    ]);
    expect([...p.roomFloor]).toEqual([
      ['/a', 0],
      ['/b', 0],
      ['/c', 1],
      ['/d', 2],
      ['/x', 3],
    ]);
  });
});

describe('andares: montagem do prédio', () => {
  it('um prédio só: núcleo no térreo (embaixo), circulação alinhada nos andares, sem ligação a pé entre andares', () => {
    kvResetFloorsForTest(2, 3);
    const cols = columnsFor([]);
    const rooms = [0, 1, 4, 9].map((slot) => layoutProjectRoom({ id: `/p/${slot}`, slot, seed: 1000 + slot }, theme));
    const b = assembleBuilding(cols, rooms, 0, 3);
    expect(b.kvFloors).toBe(3);
    expect(b.grid.h).toBe(kvBuildingH(3));
    const ids = b.core.map((a) => a.id);
    expect(ids.filter((i) => i.startsWith('core:'))).toEqual(['core:recepcao', 'core:banheiros', 'core:copa', 'core:lounge', 'core:corredor~1', 'core:corredor~2']);
    expect(ids).toContain('kv:hall~1');
    expect(ids).toContain('kv:escada~2');
    const reception = b.core.find((a) => a.id === 'core:recepcao')!;
    expect(reception.rect.y).toBe(kvGroundY());
    expect(b.corridor.rect.y).toBe(kvGroundY() + CORRIDOR_Y);
    // copa/lounge/banheiros só no térreo
    expect(b.core.filter((a) => a.kind === 'lounge').length).toBe(1);
    const spotIds = b.spots.map((s) => s.id);
    expect(new Set(spotIds).size).toBe(spotIds.length);
    const elev = b.spots.filter((s) => s.kind === 'elevator');
    expect(elev.length).toBe(6);
    expect(elev.map((s) => kvFloorOfTile(s.ty)).sort()).toEqual([0, 0, 1, 1, 2, 2]);
    // poço alinhado: os elevadores de todos os andares no mesmo x
    expect(new Set(elev.map((s) => s.x)).size).toBe(2);
    // café em cada andar
    expect(b.spots.filter((s) => s.kind === 'coffee' && kvFloorOfTile(s.ty) === 2).length).toBeGreaterThan(0);
    const e0 = elev.find((s) => kvFloorOfTile(s.ty) === 0)!;
    const seen = b.grid.reachableFrom(e0.tx, e0.ty);
    const desk = (i: number) => rooms[i].spots.find((s) => s.kind === 'desk')!;
    expect(seen[desk(0).ty * b.grid.w + desk(0).tx]).toBe(1);
    expect(seen[desk(2).ty * b.grid.w + desk(2).tx]).toBe(0);
    const e1 = elev.find((s) => kvFloorOfTile(s.ty) === 1)!;
    expect(b.grid.reachableFrom(e1.tx, e1.ty)[desk(2).ty * b.grid.w + desk(2).tx]).toBe(1);
    expect(kvBuildingCore(cols, 3)![0]).toBe(kvBuildingCore(cols, 3)![0]);
  });

  it('cópia deslocada mantém o desenho e troca os ids', () => {
    kvResetFloorsForTest(2);
    const r = layoutProjectRoom({ id: '/x', slot: 0, seed: 5 }, theme);
    const c = kvShiftArea(r, 10, '~1');
    expect(c.id).toBe('/x~1');
    expect(c.rect.y).toBe(r.rect.y + 10);
    expect(c.spots[0].areaId).toBe('/x~1');
    expect(c.spots[0].ty).toBe(r.spots[0].ty + 10);
    expect(kvShiftArea(r, 0, '')).toBe(r);
    expect(kvSplitAreaId('kv:hall~3')).toEqual({ base: 'kv:hall', floor: 3 });
    expect(kvSplitAreaId('core:copa')).toEqual({ base: 'core:copa', floor: 0 });
  });

  it('área externa com andares: rua ao sul do térreo, telhado ao norte; sem andares, null', () => {
    expect(kvLayoutExterior(4, {})).toBeNull();
    kvResetFloorsForTest(2, 3);
    const ext = kvLayoutExterior(4, { kvFloors: 3 })!;
    expect(ext.streetY).toBeGreaterThan(kvBuildingH(3) * TILE);
    expect(ext.bounds.y).toBeLessThan(-ROOF_H);
  });
});

describe('andares: vagas por rótulo', () => {
  it('cada rótulo começa um andar, continua no seguinte e os sem rótulo vão para "Outros" no topo', () => {
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }));
    const rooms = [room('/a', 0, 'Interno'), room('/b', 1, 'Interno'), room('/c', 2, 'Interno'), room('/d', 3, 'Arquivo'), room('/e', 4)];
    sim.applySnapshot(snap(rooms, []), T0);
    expect(kvFloorEntries(sim)).toEqual([
      { label: 'Interno', cont: false },
      { label: 'Interno', cont: true },
      { label: 'Arquivo', cont: false },
      { label: '', cont: false },
    ]);
    const slot = (id: string) => sim.rooms.get(id)!.slot;
    // FLOOR_COLS = 1: térreo com 2 salas, andares de cima com 4
    expect([slot('/a'), slot('/b'), slot('/c'), slot('/d'), slot('/e')]).toEqual([0, 1, 2, 6, 10]);
    expect(sim.building.kvFloors).toBe(4);
    expect(sim.rooms.get('/a')!.layout.rect.y).toBe(3 * FLOOR_PITCH);
    expect(sim.rooms.get('/e')!.layout.rect.y).toBe(0);
    expect(kvFloorTitle(sim, 0)).toEqual({ ordinal: 'Térreo', label: 'Interno' });
    expect(kvFloorTitle(sim, 1).label).toBe('Interno (cont.)');
    expect(kvFloorTitle(sim, 3)).toEqual({ ordinal: '3º andar', label: 'Outros' });
    expect(kvRoomSlot(sim, room('/f', 9, 'Arquivo'))).toBe(7);
  });

  it('andar novo: o prédio cresce para cima e tudo se reposiciona (salas e quem está nelas)', () => {
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }));
    const clock = { now: T0 };
    const rooms = [room('/a', 0, 'Interno'), room('/b', 1, 'Arquivo')];
    sim.applySnapshot(snap(rooms, [agent('ana', '/a', 'working')]), clock.now);
    run(sim, clock, 0.5);
    const a = sim.rooms.get('/a')!;
    const y0 = a.layout.rect.y;
    const ana = sim.chars.get('ana')!;
    expect(ana.atSpot).toBe(ana.homeSpot);
    const ty0 = ana.ty;
    sim.applySnapshot(snap([...rooms, room('/n', 2, 'Novo')], [agent('ana', '/a', 'working')], 2), clock.now);
    expect(sim.building.kvFloors).toBe(3);
    expect(a.layout.rect.y).toBe(y0 + FLOOR_PITCH);
    expect(ana.ty).toBe(ty0 + FLOOR_PITCH);
    expect(ana.atSpot).toBe(ana.homeSpot);
    expect(sim.rooms.get('/n')!.layout.rect.y).toBe(0);
    run(sim, clock, 1);
    expect(sim.building.grid.walkable(ana.tx, ana.ty)).toBe(true);
  });

  it('sem rótulos: andares em sequência, sem nome', () => {
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }));
    sim.applySnapshot(snap([room('/a', 0), room('/b', 1), room('/c', 2)], []), T0);
    expect(kvFloorEntries(sim).length).toBe(2);
    expect(kvFloorTitle(sim, 1)).toEqual({ ordinal: '1º andar', label: '' });
  });
});

describe('andares: elevador entre andares', () => {
  it('quem chega usa o elevador do andar da sala; ir a outro andar passa pelo elevador e nunca atravessa parede', () => {
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }));
    const clock = { now: T0 };
    const rooms = [room('/a', 0, 'Interno'), room('/b', 1, 'Interno'), room('/c', 2, 'Arquivo')];
    sim.applySnapshot(snap(rooms, [agent('ana', '/a', 'working')]), clock.now);
    run(sim, clock, 0.3);
    expect(sim.rooms.get('/c')!.slot).toBe(2);
    expect(kvSlotFloor(2)).toBe(1);
    // chegada na sala do 1º andar
    sim.applySnapshot(snap(rooms, [agent('ana', '/a', 'working'), agent('caio', '/c', 'working')], 2), clock.now);
    const caio = sim.chars.get('caio')!;
    const out = (caio.step ?? caio.queue[0]) as { t: string; elev: number };
    expect(out.t).toBe('elevOut');
    expect(kvFloorOfTile(sim.spots.get(sim.elevators[out.elev].spotId)!.ty)).toBe(1);
    const wallOk = (): void => {
      if (!caio.inside && caio.alpha > 0.01) expect(sim.building.grid.walkable(caio.tx, caio.ty)).toBe(true);
    };
    run(sim, clock, 60, () => {
      wallOk();
      return !!caio.homeSpot && caio.atSpot === caio.homeSpot && !caio.step && !caio.queue.length;
    });
    expect(caio.atSpot).toBe(caio.homeSpot);
    expect(kvFloorOfTile(caio.ty)).toBe(1);
    // manda o caio à recepção do térreo: vai pelo elevador
    const t = sim.building.grid.nearestWalkable(6, kvGroundY() + 8)!;
    sim.clearPlan(caio);
    caio.queue.push({ t: 'exit' }, { t: 'go', tx: t.x, ty: t.y });
    const kinds = new Set<string>();
    run(sim, clock, 60, () => {
      wallOk();
      if (caio.step) kinds.add(caio.step.t);
      return caio.tx === t.x && caio.ty === t.y && !caio.step;
    });
    expect(kinds.has('kvLift')).toBe(true);
    expect(caio.tx).toBe(t.x);
    expect(caio.ty).toBe(t.y);
    expect(caio.alpha).toBe(1);
    expect(caio.inside).toBe(false);
    // e volta para a mesa sozinho (de novo pelo elevador)
    run(sim, clock, 60, () => {
      wallOk();
      return caio.atSpot === caio.homeSpot && !caio.step && !caio.queue.length;
    });
    expect(kvFloorOfTile(caio.ty)).toBe(1);
    // vai embora pelo elevador do próprio andar
    sim.applySnapshot(snap(rooms, [agent('ana', '/a', 'working'), agent('caio', '/c', 'offline')], 3), clock.now);
    let usedFloor = -1;
    run(sim, clock, 60, () => {
      const s = caio.step;
      if (s?.t === 'elevIn') usedFloor = kvFloorOfTile(sim.spots.get(sim.elevators[s.elev].spotId)!.ty);
      return !sim.chars.has('caio');
    });
    expect(sim.chars.has('caio')).toBe(false);
    expect(usedFloor).toBe(1);
  });

  it('sem andares o passo "go" fica como está', () => {
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS }));
    sim.applySnapshot({ ...snap([room('/a', 0)], [agent('ana', '/a', 'working')]), meta: { demo: true, sources: [], startedAt: T0, version: 't' } }, T0);
    const ana = sim.chars.get('ana')!;
    const s = { t: 'go' as const, tx: 3, ty: 3 };
    expect(kvFloorHop(sim, ana, s)).toBe(false);
    expect(s).toEqual({ t: 'go', tx: 3, ty: 3 });
  });
});

describe('andares: lista lateral', () => {
  it('salas na ordem do prédio (a ordem do usuário dentro do andar); sem andares, igual', () => {
    const rooms = [room('/a', 0, 'Interno'), room('/d', 1, 'Arquivo'), room('/b', 2, 'Interno')];
    const s0 = { rooms, agents: [], meta: { demo: true, sources: [], startedAt: T0, version: 't' } } as unknown as OfficeSnapshot;
    const groups = [{ room: { id: '/d' } }, { room: { id: '/b' } }, { room: { id: '/a' } }];
    expect(kvSortByFloor(groups, s0)).toBe(groups);
    const s1 = snap(rooms, [], 1, 1);
    expect(kvSortByFloor(groups, s1).map((g) => g.room.id)).toEqual(['/b', '/a', '/d']);
  });
});
