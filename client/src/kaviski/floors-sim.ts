// Fork Kaviski (KAVISKI.md): andares na simulação.
//
// - Tabela de andares (por Sim): lista dos andares físicos, cada um com o rótulo do mapa de estilos (`floor`, vindo em
//   RoomInfo.kaviski.floor). Montada na ordem em que os rótulos aparecem no snapshot (a ordem dos slots do servidor):
//   cada rótulo começa um andar novo e, se passar de FLOOR_COLS colunas, continua no andar seguinte ("(cont.)"). Salas
//   sem rótulo (fora do mapa) vão para um andar próprio ("Outros") depois dos rotulados. A tabela só cresce: nenhuma
//   sala muda de lugar enquanto a página está aberta.
// - A vaga de uma sala nova é a primeira célula livre de um andar com o rótulo dela (com andares, a compactação do
//   original, que fecharia os buracos, fica desligada: os buracos são de propósito).
// - Entre andares: o caminho (A*) não atravessa andares. Um passo 'go' para outro andar vira: ir ao elevador do andar
//   atual -> 'kvLift' (entra, as portas fecham, viaja, sai no elevador do andar de destino, com as mesmas animações de
//   chegada/saída do original) -> o 'go' original. Quem vai embora usa o elevador do andar onde está.
import type { OfficeSnapshot, RoomInfo } from '../../../shared/types';
import type { KvRoomInfo, KvSnapshotMeta } from '../../../shared/kaviski';
import { tr } from '../../../shared/i18n';
import { FOOT_DX, FOOT_DY, TILE } from '../world/constants';
import type { SpotDef } from '../world/layout/types';
import { layoutProjectRoom } from '../world/layout/room';
import type { Character } from '../world/sim/character';
import { Elevator } from '../world/sim/elevator';
import type { Sim } from '../world/sim/sim';
import type { Step } from '../world/sim/steps';
import {
  FLOOR_PITCH,
  kvEnsureFloors,
  kvFloorCapacity,
  kvFloorCount as kvGlobalFloors,
  kvFloorFirstSlot,
  kvFloorOfTile,
  kvFloorOrdinal,
  kvFloorPlan,
  kvFloorsFor,
  kvFloorsOn,
  kvGeomVersion,
  kvSetFloorCols,
  kvSlotFloor,
  type KvFloorEntry,
} from './floors';

export type { KvFloorEntry };

interface FloorTable {
  floors: KvFloorEntry[];
}

const tables = new WeakMap<object, FloorTable>();

function table(sim: object): FloorTable {
  let t = tables.get(sim);
  if (!t) tables.set(sim, (t = { floors: [] }));
  return t;
}

/** Rótulo do andar de uma sala ('' sem rótulo). */
export function kvRoomFloorLabel(r: RoomInfo): string {
  return (r as KvRoomInfo).kaviski?.floor ?? '';
}

/** Os andares da tabela (cópia). */
export function kvFloorEntries(sim: object): KvFloorEntry[] {
  return [...table(sim).floors];
}

/**
 * Início de cada snapshot: liga os andares (meta.kaviski.floorCols) e acrescenta à tabela os andares que faltam para
 * as salas do snapshot (na carga, o plano inteiro de kvFloorPlan; depois, só no fim). Garante o número global de
 * andares e reposiciona a simulação se ele mudou.
 */
export function kvPlanFloors(sim: Sim, snap: Pick<OfficeSnapshot, 'rooms' | 'meta'>, now = 0): void {
  kvSetFloorCols((snap.meta as KvSnapshotMeta | undefined)?.kaviski?.floorCols);
  if (!kvFloorsOn()) return;
  const t = table(sim);
  if (!t.floors.length) t.floors = kvFloorPlan(snap.rooms, kvRoomFloorLabel).floors;
  const count = new Map<string, number>();
  for (const r of snap.rooms) count.set(kvRoomFloorLabel(r), (count.get(kvRoomFloorLabel(r)) ?? 0) + 1);
  const order = [...[...count.keys()].filter((l) => l), ...[...count.keys()].filter((l) => !l)];
  for (const l of order) {
    let cap = 0;
    let have = 0;
    t.floors.forEach((e, f) => {
      if (e.label !== l) return;
      have++;
      cap += kvFloorCapacity(f);
    });
    while (cap < (count.get(l) ?? 0)) {
      t.floors.push({ label: l, cont: have++ > 0 });
      cap += kvFloorCapacity(t.floors.length - 1);
    }
  }
  kvEnsureFloors(t.floors.length);
  kvSyncGeometry(sim, now);
}

/** Vaga (slot) de uma sala nova com andares: primeira célula livre de um andar com o rótulo dela. null = sem andares. */
export function kvRoomSlot(sim: Sim, r: RoomInfo): number | null {
  if (!kvFloorsOn()) return null;
  const t = table(sim);
  const used = new Set<number>();
  for (const rs of sim.rooms.values()) if (rs.phase !== 'gone') used.add(rs.slot);
  const label = kvRoomFloorLabel(r);
  const pick = (f: number): number | null => {
    const first = kvFloorFirstSlot(f);
    for (let i = 0; i < kvFloorCapacity(f); i++) if (!used.has(first + i)) return first + i;
    return null;
  };
  let seen = false;
  for (let f = 0; f < t.floors.length; f++) {
    if (t.floors[f].label !== label) continue;
    seen = true;
    const s = pick(f);
    if (s !== null) return s;
  }
  t.floors.push({ label, cont: seen });
  // andar novo: o prédio cresce (tudo desce) antes de a sala nova ser montada
  if (kvEnsureFloors(t.floors.length)) kvSyncGeometry(sim, sim.now);
  return pick(t.floors.length - 1) ?? kvFloorFirstSlot(t.floors.length - 1);
}

/** Andares do prédio: o número global (que cobre a tabela e as salas). */
export function kvFloorCount(sim: { rooms: Map<string, { slot: number; present: boolean }> }): number {
  if (!kvFloorsOn()) return 1;
  const slots = [...sim.rooms.values()].filter((r) => r.present).map((r) => r.slot);
  kvEnsureFloors(Math.max(table(sim).floors.length, kvFloorsFor(slots)));
  return kvGlobalFloors();
}

/** Rótulo (já com "Outros"/"(cont.)") do andar f desta simulação. */
export function kvFloorLabelText(floors: readonly KvFloorEntry[], f: number): string {
  const e = floors[f];
  const anyLabel = floors.some((x) => x.label);
  let label = e ? e.label || (anyLabel ? tr('Outros') : '') : '';
  if (label && e?.cont) label = tr('{0} (cont.)', [label]);
  return label;
}

/** Texto da placa do andar f: "Térreo" + "Kaviski · Interno". */
export function kvFloorTitle(sim: object, f: number): { ordinal: string; label: string } {
  return { ordinal: kvFloorOrdinal(f), label: kvFloorLabelText(table(sim).floors, f) };
}

/** Andar onde a sala fica (pelo slot). */
export function kvRoomFloor(slot: number): number {
  return kvSlotFloor(slot);
}

/** Desliga a compactação do original (com andares os buracos são de propósito). */
export function kvNoCompact(): boolean {
  return kvFloorsOn();
}

// =================================================================== reposicionar quando o prédio cresce

const seenGeom = new WeakMap<object, { version: number; floors: number }>();

/**
 * O número de andares mudou (um rótulo novo, "Outros", ou outra simulação da página): o térreo desce e todo o
 * prédio com ele. Refaz as salas no lugar novo, remonta o prédio, desloca quem está andando e conclui os planos (como
 * ao voltar de uma aba oculta). Barato quando nada mudou (chamado também a cada frame).
 */
export function kvSyncGeometry(sim: Sim, now: number): void {
  if (!kvFloorsOn()) return;
  const v = kvGeomVersion();
  const prev = seenGeom.get(sim);
  if (prev && prev.version === v) return;
  const floors = kvGlobalFloors();
  seenGeom.set(sim, { version: v, floors });
  if (prev && prev.floors === floors && sim.rooms.size === 0) return;
  for (const room of sim.rooms.values()) room.layout = layoutProjectRoom({ id: room.id, slot: room.slot, seed: room.seed }, room.theme);
  sim.relayout(true);
  if (!prev || !sim.chars.size) return;
  const dy = (floors - prev.floors) * FLOOR_PITCH;
  if (!dy) return;
  for (const ch of sim.chars.values()) {
    ch.ty += dy;
    ch.y += dy * TILE;
    if (ch.standTile) ch.standTile = { x: ch.standTile.x, y: ch.standTile.y + dy };
    for (const s of ch.step ? [ch.step, ...ch.queue] : ch.queue) {
      if (s.t !== 'go') continue;
      s.ty += dy;
      if (s.fy !== undefined) s.fy += dy * TILE;
      s.path = undefined;
    }
  }
  sim.fastForward(now || sim.now);
}

// =================================================================== elevadores

/** Acrescenta um Elevator para cada spot de elevador novo (os andares de cima). Nunca remove (índices estáveis). */
export function kvSyncElevators(elevators: Elevator[], spots: readonly SpotDef[]): void {
  if (!kvFloorsOn()) return;
  const known = new Set(elevators.map((e) => e.spotId));
  for (const s of spots) if (!known.has(s.id)) elevators.push(new Elevator(elevators.length, s.id));
}

/** Elevadores de um andar (com o spot ainda existindo). */
export function kvElevatorsOn(sim: Pick<Sim, 'elevators' | 'spots'>, floor: number): Elevator[] {
  return sim.elevators.filter((e) => {
    const s = sim.spots.get(e.spotId);
    return !!s && kvFloorOfTile(s.ty) === floor;
  });
}

/**
 * Elevadores entre os quais o original escolhe (pickElevator): quem chega usa o do andar da própria sala; quem vai
 * embora, o do andar onde está. Sem andares: todos (o original).
 */
export function kvElevatorPool(sim: Pick<Sim, 'elevators' | 'spots' | 'rooms'>, ch: Character): Elevator[] {
  if (!kvFloorsOn()) return sim.elevators;
  const room = sim.rooms.get(ch.roomId);
  const floor = ch.leaving || !room ? kvFloorOfTile(ch.ty) : kvSlotFloor(room.slot);
  const pool = kvElevatorsOn(sim, floor);
  return pool.length ? pool : sim.elevators.slice(0, 2);
}

function leastLoaded(pool: Elevator[], rng: () => number): Elevator {
  let best = pool[0];
  for (const e of pool) if (e.load < best.load || (e.load === best.load && rng() < 0.5)) best = e;
  return best;
}

/** Destino de um 'go' até a frente do elevador (o mesmo de planLeave). */
function approach(es: SpotDef): { tx: number; ty: number; fx: number; fy: number; dir: 'up' } {
  return { tx: es.tx, ty: es.ty, fx: es.tx * TILE + FOOT_DX + (es.x - (es.tx * TILE + FOOT_DX)) * 0.5, fy: es.ty * TILE + FOOT_DY - 2, dir: 'up' };
}

/** Passo do fork: viagem de elevador entre andares (não interrompível: quem entrou sai do outro lado). */
export interface KvLiftStep {
  t: 'kvLift';
  from: number;
  to: number;
  phase: number;
  inn: { t: 'elevIn'; elev: number; phase: number };
  out: { t: 'elevOut'; elev: number; phase: number };
}

type GoStep = Extract<Step, { t: 'go' }>;

/** Tempo dentro do elevador: base + por andar (ms). */
const LIFT_BASE_MS = 650;
const LIFT_PER_FLOOR_MS = 260;

/**
 * Início de um 'go' (antes de calcular o caminho): destino em outro andar -> vai ao elevador deste andar, viaja e
 * retoma o 'go' do outro lado. Se o passo seguinte é entrar no elevador para ir embora, só troca para o elevador deste
 * andar. Retorna true se mexeu no plano.
 */
export function kvFloorHop(sim: Pick<Sim, 'elevators' | 'spots'>, ch: Character, s: GoStep): boolean {
  if (!kvFloorsOn() || s.path) return false;
  const from = kvFloorOfTile(ch.ty);
  const to = kvFloorOfTile(s.ty);
  if (from === to) return false;
  const here = kvElevatorsOn(sim, from);
  if (!here.length) return false;
  const a = leastLoaded(here, ch.rng);
  const sa = sim.spots.get(a.spotId)!;
  const next = ch.queue[0];
  if (next && next.t === 'elevIn') {
    Object.assign(s, approach(sa));
    next.elev = a.index;
    return true;
  }
  const there = kvElevatorsOn(sim, to);
  if (!there.length) return false;
  const b = leastLoaded(there, ch.rng);
  const orig: GoStep = { ...s, path: undefined, i: 0, fine: false };
  Object.assign(s, approach(sa), { fine: false, i: 0 });
  const lift: KvLiftStep = { t: 'kvLift', from: a.index, to: b.index, phase: 0, inn: { t: 'elevIn', elev: a.index, phase: 0 }, out: { t: 'elevOut', elev: b.index, phase: 0 } };
  ch.queue.unshift(lift, orig);
  return true;
}

interface LiftSim {
  elevators: Elevator[];
  spots: Sim['spots'];
  stepElevIn(ch: Character, s: KvLiftStep['inn'], dt: number, now: number): boolean;
  stepElevOut(ch: Character, s: KvLiftStep['out'], dt: number, now: number): boolean;
}

/** Executa o passo 'kvLift' reaproveitando as animações do original (entrar no elevador / sair do elevador). */
export function kvStepLift(sim: Sim, ch: Character, s: KvLiftStep, dt: number, now: number): boolean {
  const ls = sim as unknown as LiftSim;
  if (s.phase === 0) {
    if (!ls.stepElevIn(ch, s.inn, dt, now)) return false;
    const b = ls.elevators[s.to];
    const sb = b && ls.spots.get(b.spotId);
    if (!sb) {
      ch.inside = false;
      ch.alpha = 1;
      return true;
    }
    const floors = Math.abs(kvFloorOfTile(sb.ty) - kvFloorOfTile(ch.ty));
    ch.placeAtTile(sb.tx, sb.ty);
    ch.x = sb.x;
    ch.y = sb.y - 6;
    ch.dir = 'down';
    ch.alpha = 0;
    ch.inside = true;
    ch.hiddenUntil = b.reserveAppear(now + LIFT_BASE_MS + LIFT_PER_FLOOR_MS * floors);
    s.phase = 1;
    return false;
  }
  return ls.stepElevOut(ch, s.out, dt, now);
}

/** Lugares sorteados (randomFree): prefere os do mesmo andar de quem vai (mexe na lista). */
export function kvKeepSameFloor(cands: SpotDef[], ty: number): void {
  if (!kvFloorsOn() || cands.length < 2) return;
  const f = kvFloorOfTile(ty);
  const same = cands.filter((s) => kvFloorOfTile(s.ty) === f);
  if (!same.length || same.length === cands.length) return;
  cands.length = 0;
  cands.push(...same);
}
