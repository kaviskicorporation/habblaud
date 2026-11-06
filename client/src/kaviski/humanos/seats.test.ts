// Fork Kaviski (KAVISKI-HUMANOS.md): regras puras dos móveis do boneco (seats.ts) e do joystick (touch.ts).
import { describe, expect, it } from 'vitest';
import { assembleBuilding } from '../../world/layout/building';
import { FREE } from '../../world/path/grid';
import { TILE } from '../../world/constants';
import { canStand } from '../../world/sim/visitor';
import { followNeedsRepath, freeTileAt, freeTileNear, KV_LOUNGE, KV_SIT_KINDS, nearestSpot, restSeat, seatAt } from './seats';
import { kvStickIntent } from './touch';

const b = assembleBuilding(2, [], 0);

describe('assentos', () => {
  it('descansar: o sofá do lounge primeiro; ocupado, o próximo livre', () => {
    const first = restSeat(b.spots, () => true)!;
    expect(first.areaId).toBe(KV_LOUNGE);
    expect(first.kind).toBe('sofa');
    const sofas = new Set(b.spots.filter((s) => s.areaId === KV_LOUNGE && s.kind === 'sofa').map((s) => s.id));
    const next = restSeat(b.spots, (s) => !sofas.has(s.id))!;
    expect(next.kind).toBe('armchair');
    expect(restSeat(b.spots, () => false)).toBeNull();
  });
  it('o assento de quem está sentado é o mais perto da posição, até 1 tile', () => {
    const seat = b.spots.find((s) => s.kind === 'cafe_seat')!;
    expect(seatAt(b.spots, seat.x + 3, seat.y - 4)?.id).toBe(seat.id);
    expect(seatAt(b.spots, seat.x + 3 * TILE, seat.y + 3 * TILE)?.id).not.toBe(seat.id);
  });
  it('a tecla E alcança o assento perto e respeita o filtro (ocupado)', () => {
    const seat = b.spots.find((s) => s.kind === 'armchair')!;
    const x = seat.tx * TILE + TILE / 2 + TILE;
    const y = seat.ty * TILE + 11;
    expect(nearestSpot(b.spots, x, y, KV_SIT_KINDS, 1.6 * TILE)?.id).toBe(seat.id);
    expect(nearestSpot(b.spots, x, y, KV_SIT_KINDS, 1.6 * TILE, (s) => s.id !== seat.id)?.id).not.toBe(seat.id);
    expect(nearestSpot(b.spots, x + 10 * TILE, y + 10 * TILE, ['armchair'], 1.6 * TILE)).toBeNull();
  });
  it('levantar: um chão livre ao lado do assento, onde o boneco consegue ficar de pé', () => {
    for (const s of b.spots.filter((x) => x.seated)) {
      const t = freeTileNear(b.grid, s.tx, s.ty)!;
      expect(t).not.toBeNull();
      expect(b.grid.get(t.x, t.y)).toBe(FREE);
      expect(canStand(b.grid, t.x * TILE + TILE / 2, t.y * TILE + 11)).toBe(true);
    }
  });
  it('tile livre: o próprio se já é chão; evita os ocupados', () => {
    const s = b.spots.find((x) => x.kind === 'sofa')!;
    const free = freeTileNear(b.grid, s.tx, s.ty)!;
    expect(freeTileAt(b.grid, free.x, free.y)).toEqual(free);
    const other = freeTileNear(b.grid, s.tx, s.ty, 4, (x, y) => x === free.x && y === free.y)!;
    expect(other).not.toEqual(free);
  });
  it('seguir: anda de novo só quando a pessoa se afasta', () => {
    expect(followNeedsRepath({ x: 100, y: 100 }, null)).toBe(true);
    expect(followNeedsRepath({ x: 6 * TILE + 8, y: 6 * TILE + 8 }, { x: 6, y: 7 })).toBe(false);
    expect(followNeedsRepath({ x: 12 * TILE, y: 6 * TILE }, { x: 6, y: 6 })).toBe(true);
  });
});

describe('joystick', () => {
  it('zona morta, 8 direções e correr na borda', () => {
    expect(kvStickIntent(3, 2)).toEqual({ dx: 0, dy: 0, run: false });
    expect(kvStickIntent(30, 0)).toEqual({ dx: 1, dy: 0, run: false });
    expect(kvStickIntent(0, -30)).toEqual({ dx: 0, dy: -1, run: false });
    expect(kvStickIntent(-25, 25)).toEqual({ dx: -1, dy: 1, run: false });
    expect(kvStickIntent(-46, 0)).toEqual({ dx: -1, dy: 0, run: true });
  });
});
