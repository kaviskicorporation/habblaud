// Fork Kaviski (KAVISKI-HUMANOS.md): salas próprias (rooms.json) no prédio desta página.
//
// O servidor manda só as salas que esta pessoa vê (GET /api/kaviski/humanos/rooms) e avisa pelo fluxo de presença
// (evento `rooms`) quando algo muda. Elas entram no Sim como salas "injetadas" (o mesmo mecanismo de depuração do Sim,
// `sim.injected.rooms`): o snapshot do servidor não muda e nada disso vai ao Habblaud World. Ficam sempre (mesmo sem
// agentes) e com a luz acesa; o layout por tipo vem de rooms-layout.ts (gancho no sim.ts).
import type { RoomInfo } from '../../../../shared/types';
import type { KvOwnRoom, KvOwnRoomKind } from '../../../../shared/kaviski-rooms';
import { hash32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import { roomTheme } from '../../art';
import type { Sim } from '../../world/sim/sim';
import { kvLayoutRoom, type KvOwnRoomInfo } from './rooms-layout';
import { kvPeople } from './world';
import type { KvPresenceClient } from './presence';

export const ROOMS_API = '/api/kaviski/humanos/rooms';

export type KvOwnRoomView = KvOwnRoom & { canEdit?: boolean };

export interface KvRoomsState {
  rooms: KvOwnRoomView[];
  canCreate: KvOwnRoomKind[];
  /** Id da minha sala pessoal. */
  mine: string | null;
  /** Pessoas que dá para escolher (só para a equipe). */
  people?: { id: string; name: string; role: string }[];
}

export const KIND_LABEL: Record<KvOwnRoomKind, string> = {
  pessoal: tr('Sala pessoal'),
  reuniao: tr('Reunião'),
  descanso: tr('Descanso'),
  outra: tr('Outra'),
};

let state: KvRoomsState = { rooms: [], canCreate: [], mine: null };
const listeners = new Set<(s: KvRoomsState) => void>();
let started = false;
let injectedSim: Sim | null = null;
let injectedKey = '';
/** Assinatura do layout de cada sala montada (tipo, paleta, decoração): mudou = remonta no lugar. */
const layoutSig = new Map<string, string>();

export function kvRoomsState(): KvRoomsState {
  return state;
}

/** Avisa quando a lista muda (devolve a função que para de ouvir). */
export function kvOnOwnRooms(cb: (s: KvRoomsState) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** As salas próprias que vejo, com o retângulo e a porta (tiles) quando montadas no prédio. */
export function kvOwnRooms(): { id: string; name: string; kind: KvOwnRoomKind; owner?: string; area: string; rect?: { x: number; y: number; w: number; h: number }; door?: { x: number; y: number; w: number; h: number } }[] {
  const sim = kvPeople.sim?.();
  return state.rooms.map((r) => {
    const rs = sim?.rooms.get(r.id);
    const present = rs && rs.present && !rs.ghost;
    return { id: r.id, name: r.name, kind: r.kind, ...(r.owner ? { owner: r.owner } : {}), area: `r:${r.id}`, ...(present ? { rect: { ...rs.layout.rect }, ...(rs.layout.door ? { door: { ...rs.layout.door } } : {}) } : {}) };
  });
}

/** Só as salas de reunião (a agenda aponta para elas). */
export function kvMeetingRooms(): ReturnType<typeof kvOwnRooms> {
  return kvOwnRooms().filter((r) => r.kind === 'reuniao');
}

/** A minha sala pessoal (id), se eu tiver. */
export function kvMyRoom(): string | null {
  return state.mine;
}

/** Semente da sala: o resto por 10 escolhe a paleta (roomTheme), o resto varia com o id. */
export function kvOwnSeed(r: Pick<KvOwnRoom, 'id' | 'style'>): number {
  return r.style + 10 * (hash32(r.id) % 100_000);
}

/** RoomInfo de uma sala própria (slot alto: na carga, as salas de projeto ficam nas vagas de sempre). */
export function kvOwnRoomInfo(r: KvOwnRoom, i: number): KvOwnRoomInfo {
  const group = r.kind === 'outra' ? undefined : KIND_LABEL[r.kind];
  return {
    id: r.id,
    name: r.name,
    path: '',
    slot: 100_000 + i,
    seed: kvOwnSeed(r),
    createdAt: r.createdAt,
    kaviski: { ...(r.color ? { color: r.color } : {}), ...(group ? { group } : {}) },
    kvOwn: { kind: r.kind, decor: r.decor, ...(r.owner ? { owner: r.owner } : {}), ...(r.kind === 'reuniao' && r.meet ? { meet: r.meet } : {}) },
  } as KvOwnRoomInfo;
}

export async function kvReloadRooms(): Promise<void> {
  try {
    const res = await fetch(ROOMS_API, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as KvRoomsState;
    state = { rooms: body.rooms ?? [], canCreate: body.canCreate ?? [], mine: body.mine ?? null, ...(body.people ? { people: body.people } : {}) };
  } catch {
    return;
  }
  injectedKey = '';
  sync();
  for (const cb of listeners) cb(state);
}

/** Põe/atualiza as salas no Sim (uma vez por mudança; o timelapse recria o Sim e recebe de novo). */
function sync(): void {
  const sim = kvPeople.sim?.();
  if (!sim || !sim.initialized) return;
  const now = Date.now();
  const key = JSON.stringify(state.rooms.map((r) => [r.id, r.name, r.style, r.color, r.kind, r.decor, r.meet?.layout]));
  if (sim !== injectedSim || key !== injectedKey) {
    injectedSim = sim;
    injectedKey = key;
    const mine = state.rooms.map((r, i) => kvOwnRoomInfo(r, i));
    // as outras salas injetadas (depuração do Sim) continuam
    const others = sim.injected.rooms.filter((r) => !(r as KvOwnRoomInfo).kvOwn);
    sim.injected = { ...sim.injected, rooms: [...others, ...mine] };
    sim.reapply(now);
    let dirty = false;
    for (const info of mine) {
      const rs = sim.rooms.get(info.id);
      if (!rs) continue;
      const sig = `${info.seed}|${JSON.stringify(info.kvOwn)}`;
      if (layoutSig.get(info.id) === sig && rs.layout.id === info.id) continue;
      const had = layoutSig.has(info.id);
      layoutSig.set(info.id, sig);
      if (!had) continue; // acabou de nascer: o createRoom já usou o layout certo
      // paleta ou decoração mudou: remonta a sala no lugar
      rs.theme = roomTheme(info.seed);
      rs.layout = kvLayoutRoom({ id: rs.id, slot: rs.slot, seed: info.seed }, rs.theme, info);
      rs.version++;
      dirty = true;
    }
    if (dirty) sim.relayout();
  }
  // sempre com a luz acesa (não há agente para acender; mudar de vaga apaga a luz no Sim)
  for (const r of state.rooms) {
    const rs = sim.rooms.get(r.id);
    if (rs && rs.listed && !rs.ghost && !rs.lightOn) rs.setLight(true, now);
  }
}

export function kvStartRooms(client: KvPresenceClient): void {
  if (started) return;
  started = true;
  (kvPeople as { myRoom?: () => string | null }).myRoom = kvMyRoom;
  void kvReloadRooms();
  const es = (client as unknown as { es: EventSource | null }).es;
  es?.addEventListener('rooms', () => void kvReloadRooms());
  // reconectou: o servidor pode ter mudado enquanto isso
  let opened = false;
  es?.addEventListener('open', () => {
    if (opened) void kvReloadRooms();
    opened = true;
  });
  setInterval(sync, 500);
}
