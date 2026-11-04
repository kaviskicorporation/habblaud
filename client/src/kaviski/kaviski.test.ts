// Fork Kaviski (KAVISKI.md): salas fixas vazias no cliente e a marca no título.
import { describe, expect, it } from 'vitest';
import type { RoomState } from '../world/sim/room-state';
import { kvDarkIfEmpty, kvRoomCount, kvRoomEmpty } from './empty-rooms';
import { kvTitle } from './brand';

const fakeRoom = (id: string, pinned: boolean) => ({ info: { id, kaviski: pinned ? { pinned: true } : undefined }, lightOn: true, lightAt: 0 }) as unknown as RoomState;

describe('salas fixas vazias', () => {
  it('contador conta só salas com alguém', () => {
    const snap = { rooms: [{ id: '/a' }, { id: '/b' }, { id: '/c' }], agents: [{ roomId: '/a' }, { roomId: '/a' }, { roomId: '/c' }] } as never;
    expect(kvRoomCount(snap)).toBe(2);
    expect(kvRoomEmpty({ id: '/b' }, [{ roomId: '/a' }])).toBe(true);
  });

  it('sala fixa sem ninguém nasce apagada; outras salas (visita) ficam como estão', () => {
    const empty = { agents: [] };
    const pinned = fakeRoom('/fixa', true);
    kvDarkIfEmpty(pinned, empty);
    expect(pinned.lightOn).toBe(false);
    const other = fakeRoom('/outra', false);
    kvDarkIfEmpty(other, empty);
    expect(other.lightOn).toBe(true);
    // no timelapse a sala vem sem o campo do fork: a fixa já vista continua apagada
    const replay = fakeRoom('/fixa', false);
    kvDarkIfEmpty(replay, empty);
    expect(replay.lightOn).toBe(false);
    const busy = fakeRoom('/fixa', true);
    kvDarkIfEmpty(busy, { agents: [{ roomId: '/fixa' }] } as never);
    expect(busy.lightOn).toBe(true);
    const visiting = fakeRoom('/fixa', true);
    kvDarkIfEmpty(visiting, empty, true);
    expect(visiting.lightOn).toBe(true);
  });

  it('título sem marca fica igual', () => {
    expect(kvTitle('Habblaud')).toBe('Habblaud');
  });
});
