// Fork Kaviski (KAVISKI.md): salas escondidas ("hidden" no mapa de estilos) somem do snapshot com os agentes delas.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../shared/types';
import { setQuiet } from '../log';
import { createKaviski } from './index';
import { parseRoomStyles } from './room-styles';

setQuiet(true);

const A = '/home/u/projetos/Clientes/01-Acme/01.Site';
const B = '/home/u/projetos/Clientes/01-Acme/02.Velho *';

function room(path: string, slot: number): RoomInfo {
  return { id: path.toLowerCase(), name: path.split('/').pop()!, path, slot, seed: 1, createdAt: 1 };
}

function agent(id: string, roomId: string): AgentInfo {
  return { id, roomId: roomId.toLowerCase() } as AgentInfo;
}

describe('salas escondidas', () => {
  it('hidden vence os outros campos e precisa ser booleano', () => {
    const r = parseRoomStyles({ rooms: { [B]: { hidden: true, color: '#fff', pinned: true, name: 'x' } } });
    expect('error' in r ? r.error : [...r.rooms.values()]).toEqual([{ hidden: true }]);
    expect('error' in parseRoomStyles({ rooms: { [B]: { hidden: 'sim' } } })).toBe(true);
  });

  it('tira do snapshot a sala escondida e todos os agentes dela', () => {
    const kv = createKaviski({ dataDir: null, env: {} });
    const r = parseRoomStyles({ rooms: { [B]: { hidden: true } } });
    if ('error' in r) throw new Error(r.error);
    kv.styles.replace(r.rooms);
    const snap = {
      rooms: [room(A, 0), room(B, 1)],
      agents: [agent('a', A), agent('b', B), agent('b:sub', B)],
      meta: {},
    } as unknown as OfficeSnapshot;
    kv.decorate(snap);
    expect(snap.rooms.map((x) => x.path)).toEqual([A]);
    expect(snap.agents.map((x) => x.id)).toEqual(['a']);
  });

  it('sem salas escondidas, nada some', () => {
    const kv = createKaviski({ dataDir: null, env: {} });
    const snap = { rooms: [room(A, 0)], agents: [agent('a', A)], meta: {} } as unknown as OfficeSnapshot;
    kv.decorate(snap);
    expect(snap.rooms).toHaveLength(1);
    expect(snap.agents).toHaveLength(1);
  });
});
