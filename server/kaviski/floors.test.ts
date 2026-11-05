// Fork Kaviski (KAVISKI.md): andares — `floor` e `dim` no mapa de estilos, ordem das salas por andar e
// HABBLAUD_FLOOR_COLS no meta do snapshot.
import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot, RoomInfo } from '../../shared/types';
import { kvFloorCols, kvFloorLabel, type KvRoomEntry, type KvRoomInfo, type KvSnapshotMeta } from '../../shared/kaviski';
import { setQuiet } from '../log';
import { createKaviski } from './index';
import { kvDecorateRooms } from './pinned';
import { parseRoomStyles } from './room-styles';

setQuiet(true);

function room(path: string, slot: number): RoomInfo {
  return { id: path, name: path.split('/').pop()!, path, slot, seed: 1, createdAt: 1 };
}

function entries(body: Record<string, unknown>): [string, KvRoomEntry][] {
  const r = parseRoomStyles({ rooms: body });
  if ('error' in r) throw new Error(r.error);
  return [...r.rooms];
}

describe('andares no mapa de estilos', () => {
  it('aceita floor (limpo, até 40) e dim; recusa tipos errados; entrada só com floor/dim conta', () => {
    const r = parseRoomStyles({ rooms: { '/p/a': { floor: '  Clientes ·\n Em andamento ', dim: true }, '/p/b': { floor: 'x'.repeat(60) }, '/p/c': { dim: false } } });
    expect('rooms' in r && Object.fromEntries(r.rooms)).toEqual({
      '/p/a': { floor: 'Clientes · Em andamento', dim: true },
      '/p/b': { floor: 'x'.repeat(40) },
    });
    expect(parseRoomStyles({ rooms: { '/p': { floor: 3 } } })).toHaveProperty('error');
    expect(parseRoomStyles({ rooms: { '/p': { dim: 'sim' } } })).toHaveProperty('error');
    expect(kvFloorLabel('   ')).toBeUndefined();
  });

  it('floor e dim vão ao snapshot; salas agrupadas por andar (ordem do mapa) e, dentro dele, por grupo', () => {
    const e = entries({
      '/p/int1': { pinned: true, group: 'Server', floor: 'Kaviski · Interno' },
      '/p/and1': { pinned: true, group: 'Brose', floor: 'Clientes · Em andamento' },
      '/p/int2': { pinned: true, group: 'Sites', floor: 'Kaviski · Interno' },
      '/p/arq1': { pinned: true, group: 'Brose', floor: 'Arquivo', dim: true },
      '/p/and2': { pinned: true, group: 'Acme', floor: 'Clientes · Em andamento' },
      '/p/and3': { pinned: true, group: 'Brose', floor: 'Clientes · Em andamento' },
    });
    const out = kvDecorateRooms([room('/p/solta', 0), room('/p/and3', 1)], e, { createdAt: 1 });
    expect(out.map((r) => r.path)).toEqual(['/p/int1', '/p/int2', '/p/and1', '/p/and3', '/p/and2', '/p/arq1', '/p/solta']);
    expect(out.map((r) => r.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const arq = out.find((r) => r.path === '/p/arq1') as KvRoomInfo;
    expect(arq.kaviski).toEqual({ group: 'Brose', pinned: true, floor: 'Arquivo', dim: true });
    expect((out.find((r) => r.path === '/p/solta') as KvRoomInfo).kaviski).toBeUndefined();
  });

  it('sem floor no mapa a ordem é a de antes (grupos na ordem do mapa)', () => {
    const e = entries({ '/p/a': { pinned: true, group: 'G1' }, '/p/b': { pinned: true, group: 'G2' }, '/p/c': { pinned: true, group: 'G1' } });
    expect(kvDecorateRooms([], e, { createdAt: 1 }).map((r) => r.path)).toEqual(['/p/a', '/p/c', '/p/b']);
  });

  it('HABBLAUD_FLOOR_COLS: inteiro positivo no meta (vazio/0/lixo = sem andares)', () => {
    expect(kvFloorCols('5')).toBe(5);
    expect(kvFloorCols(' 8 ')).toBe(8);
    expect(kvFloorCols('0')).toBeUndefined();
    expect(kvFloorCols('')).toBeUndefined();
    expect(kvFloorCols('abc')).toBeUndefined();
    expect(kvFloorCols('2.5')).toBeUndefined();
    expect(kvFloorCols('999')).toBe(40);
    const snap = (): OfficeSnapshot => ({ rev: 1, serverTime: 1, rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: 1, version: 't' } }) as unknown as OfficeSnapshot;
    const on = snap();
    createKaviski({ dataDir: null, env: { HABBLAUD_FLOOR_COLS: '5' } }).decorate(on);
    expect((on.meta as KvSnapshotMeta).kaviski).toEqual({ floorCols: 5 });
    const off = snap();
    createKaviski({ dataDir: null, env: {} }).decorate(off);
    expect((off.meta as KvSnapshotMeta).kaviski).toBeUndefined();
  });
});
