import { describe, expect, it } from 'vitest';
import { AreaBuilder } from '../../world/layout/builder';
import { TILE } from '../../world/constants';
import { kvApproachTiles, kvComputeActionSpots } from './themes-spots';

function room() {
  const b = new AreaBuilder('kv:el-x', 'room', { x: 10, y: 20, w: 10, h: 9 });
  const desk = b.furn('reception_desk', 3, 4);
  const wall = b.wall('shelf_wall', 5, undefined);
  const spot = b.spot('stand', 2, 6, 'left');
  return { area: b.build(), desk, wall, spot };
}

describe('kvApproachTiles', () => {
  it('começa embaixo, no meio do móvel, virado para cima', () => {
    const t = kvApproachTiles(3, 4, 3, 1);
    expect(t[0]).toEqual({ tx: 4, ty: 5, dir: 'up' });
    expect(t.some((c) => c.dir === 'right' && c.tx === 2)).toBe(true);
  });
});

describe('kvComputeActionSpots', () => {
  it('acha o lugar de uso de móvel, parede e spot', () => {
    const { area, desk, wall, spot } = room();
    const tags = new Map<string, string | string[]>([
      [desk, ['pessoas', 'registro']],
      [wall, 'organograma'],
      [spot.id, 'agenda'],
    ]);
    const all = kvComputeActionSpots([area], tags, () => true);
    const by = (a: string) => all.find((s) => s.action === a)!;
    expect(by('pessoas')).toMatchObject({ tx: 14, ty: 25, dir: 'up', areaId: 'kv:el-x' });
    expect(by('registro').tx).toBe(14);
    // item de parede na face: o boneco fica na linha 2 (primeira de piso), embaixo dele
    expect(by('organograma')).toMatchObject({ tx: 15, ty: 22, dir: 'up' });
    expect(by('agenda')).toMatchObject({ tx: 12, ty: 26, dir: 'left' });
    expect(by('pessoas').box!.w).toBe(3 * TILE);
  });

  it('pula tiles que não dão para andar e ignora itens sem lugar', () => {
    const { area, desk } = room();
    const blocked = new Set(['14,25', '13,25', '15,25']);
    const s = kvComputeActionSpots([area], new Map([[desk, 'pessoas']]), (x, y) => !blocked.has(`${x},${y}`));
    expect(s[0]).toMatchObject({ dir: 'right', tx: 12 });
    expect(kvComputeActionSpots([area], new Map([[desk, 'pessoas']]), () => false)).toEqual([]);
  });
});
