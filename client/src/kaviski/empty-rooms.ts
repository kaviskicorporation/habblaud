// Fork Kaviski (KAVISKI.md): salas vazias (as salas fixas do mapa de estilos, que existem sem ninguém; ver
// server/kaviski/pinned.ts). No original toda sala do snapshot tem pelo menos um agente, então estas regras não mudam
// nada sem salas fixas:
// - no mundo, a sala vazia nasce apagada na carga (e no timelapse; não na visita a outro prédio, que tem regra
//   própria de luz); quem chegar acende a luz, como sempre;
// - o contador "salas" do topo conta só as salas com alguém;
// - a lista lateral não mostra as salas vazias (o prédio mostra).
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../shared/types';
import type { RoomState } from '../world/sim/room-state';
import type { KvRoomInfo } from '../../../shared/kaviski';

/** Sala sem nenhum agente no snapshot. */
export function kvRoomEmpty(room: Pick<RoomInfo, 'id'>, agents: readonly Pick<AgentInfo, 'roomId'>[]): boolean {
  return !agents.some((a) => a.roomId === room.id);
}

/** Salas fixas já vistas ao vivo (o timelapse grava as salas sem o campo do fork). */
const pinnedIds = new Set<string>();

/**
 * Sala recém-criada no mundo: se é uma sala fixa e não há ninguém nela, começa apagada. Só as fixas: outras salas sem
 * ninguém (a visita a outro prédio do mundo) ficam como no original.
 */
export function kvDarkIfEmpty(rs: RoomState, snap: Pick<OfficeSnapshot, 'agents'>, visiting = false): void {
  const pinned = (rs.info as KvRoomInfo).kaviski?.pinned === true;
  if (pinned) pinnedIds.add(rs.info.id);
  if (visiting || (!pinned && !pinnedIds.has(rs.info.id))) return;
  if (!rs.lightOn || !kvRoomEmpty(rs.info, snap.agents)) return;
  rs.lightOn = false;
  rs.lightAt = -1e9;
}

/** Quantas salas têm alguém (o contador "salas" do topo). */
export function kvRoomCount(snap: Pick<OfficeSnapshot, 'rooms' | 'agents'>): number {
  const used = new Set(snap.agents.map((a) => a.roomId));
  return snap.rooms.filter((r) => used.has(r.id)).length;
}
