// Fork Kaviski (KAVISKI.md): a empresa inteira no escritório. Cada sala do mapa de estilos com `pinned: true` existe
// sempre, mesmo sem ninguém: enquanto não há agente nela, o fork acrescenta ao snapshot uma sala "vazia" (mesmo id,
// caminho e semente que o Office daria a ela, então a sala é a mesma quando alguém chega). Também aplica o `name` do
// mapa (quando não há apelido manual) e põe as salas na ordem dos clientes: as do mapa primeiro, agrupadas pelo `group`
// (os grupos na ordem em que aparecem no mapa; dentro do grupo, a ordem do mapa), depois as outras na ordem de chegada.
// O slot do snapshot é só ordem (o cliente põe cada sala na primeira vaga livre, nessa ordem, ao carregar).
//
// Nada disso vai ao Habblaud World: o prédio enviado (server/world/uplink.ts) conta só as salas com agentes.
import type { RoomInfo } from '../../shared/types';
import { hash32 } from '../../shared/hash';
import { kvPathKey, type KvRoomEntry, type KvRoomInfo, type KvRoomStyle } from '../../shared/kaviski';
import { roomDisplayNames } from '../model/rooms';

export interface KvDecorateOptions {
  /** Apelido manual da sala (Renomear), que vence o `name` do mapa. */
  alias?: (path: string) => string | undefined;
  /** createdAt das salas vazias (fixo, para o snapshot não mudar à toa). */
  createdAt: number;
}

/** O que vai ao snapshot (sem nome nem caminho, que já estão na sala). */
function publicStyle(e: KvRoomEntry): KvRoomStyle {
  const s: KvRoomStyle = {};
  if (e.color) s.color = e.color;
  if (e.group) s.group = e.group;
  if (e.pinned) s.pinned = true;
  if (e.floor) s.floor = e.floor;
  if (e.dim) s.dim = true;
  return s;
}

/**
 * Salas do snapshot com o estilo do fork: estilo e nome nas que existem, as fixas vazias acrescentadas e tudo na ordem
 * dos clientes (só quando há sala fixa; sem nenhuma, a ordem fica a original). Devolve uma lista nova; as salas que já
 * existiam são alteradas no lugar (o snapshot é novo a cada commit do Office).
 */
export function kvDecorateRooms(rooms: readonly RoomInfo[], entries: readonly [string, KvRoomEntry][], opts: KvDecorateOptions): KvRoomInfo[] {
  if (!entries.length) return rooms as KvRoomInfo[];
  const byKey = new Map(entries);
  const out = rooms as KvRoomInfo[];
  for (const room of out) {
    const e = byKey.get(kvPathKey(room.path)) ?? byKey.get(kvPathKey(room.id));
    if (!e) continue;
    const style = publicStyle(e);
    if (style.color || style.group || style.pinned || style.floor || style.dim) room.kaviski = style;
    if (e.name && !opts.alias?.(room.path)) room.name = e.name;
  }

  const present = new Set<string>();
  for (const r of out) {
    present.add(kvPathKey(r.path));
    present.add(kvPathKey(r.id));
  }
  const empty: KvRoomInfo[] = [];
  for (const [key, e] of entries) {
    if (!e.pinned || !e.path || present.has(key)) continue;
    present.add(key);
    empty.push({ id: e.path, name: '', path: e.path, slot: 0, seed: hash32(e.path), createdAt: opts.createdAt, kaviski: publicStyle(e) });
  }
  if (!empty.length && !entries.some(([, e]) => e.pinned)) return out;

  // Nomes das vazias: apelido > name do mapa > nome da pasta (desambiguado contra todas as salas, como o Office faz).
  if (empty.length) {
    const paths = new Map<string, string>();
    for (const r of [...out, ...empty]) paths.set(r.id, r.path);
    const names = roomDisplayNames(paths);
    for (const r of empty) {
      const e = byKey.get(kvPathKey(r.path));
      r.name = opts.alias?.(r.path) ?? e?.name ?? names.get(r.id) ?? r.path;
    }
  }

  // Ordem: as do mapa agrupadas pelo andar (`floor`, ordem de primeira aparição) e, dentro dele, pelo grupo (idem),
  // depois as outras pela ordem de chegada. Sem `floor` no mapa, todas ficam no mesmo "andar" (a ordem de antes).
  const index = new Map(entries.map(([k], i) => [k, i]));
  const floorRank = new Map<string, number>();
  const groupRank = new Map<string, number>();
  entries.forEach(([, e], i) => {
    const f = (e.floor ?? '').toLowerCase();
    if (!floorRank.has(f)) floorRank.set(f, i);
    const g = `${f}\u0000${(e.group ?? '').toLowerCase()}`;
    if (!groupRank.has(g)) groupRank.set(g, i);
  });
  const rank = (r: KvRoomInfo): [number, number, number, number] => {
    const k = kvPathKey(r.path);
    const i = index.get(k) ?? index.get(kvPathKey(r.id));
    if (i === undefined) return [1, 0, 0, r.slot];
    const e = entries[i][1];
    const f = (e.floor ?? '').toLowerCase();
    return [0, floorRank.get(f) ?? i, groupRank.get(`${f}\u0000${(e.group ?? '').toLowerCase()}`) ?? i, i];
  };
  const all = [...out, ...empty]
    .map((r) => ({ r, k: rank(r) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3])
    .map((x) => x.r);
  all.forEach((r, i) => (r.slot = i));
  return all;
}
