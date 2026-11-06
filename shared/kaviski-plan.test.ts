import { describe, expect, it } from 'vitest';
import { kvNormDoors, kvNormPlan, kvPlanBounds, kvRectsOverlap } from './kaviski-plan';

describe('planta livre (fork Kaviski)', () => {
  it('limpa a planta: tamanhos, refs, portas e sobreposição', () => {
    const { plan, problems } = kvNormPlan({
      w: 100,
      h: 60,
      items: [
        { id: 'el-a', kind: 'nucleo', ref: 'recepcao', x: 0, y: 0, w: 16, h: 12 },
        { id: 'el-b', kind: 'corredor', x: 0, y: 12, w: 60, h: 5 },
        { id: 'el-c', kind: 'projeto', ref: '/Home/X/Proj/', x: 16, y: 0, w: 16, h: 12, fixed: true, doors: [{ side: 's', at: 7 }] },
        { id: 'el-d', kind: 'tema', ref: 'rh', x: 20, y: 0, w: 12, h: 10 },
        { id: 'el-e', kind: 'tema', ref: 'nada', x: 40, y: 0, w: 12, h: 10 },
        { id: 'el-f', kind: 'projeto', ref: '/home/x/proj', x: 40, y: 20, w: 16, h: 12 },
        { id: 'XX', kind: 'corredor', x: 0, y: 50, w: 5, h: 5 },
        { id: 'el-g', kind: 'propria', ref: 'kvsala-abc', x: 70, y: 0, w: 10, h: 9 },
      ],
    });
    expect(plan!.items.map((i) => i.id)).toEqual(['el-a', 'el-b', 'el-c', 'el-g']);
    expect(plan!.items[2]).toMatchObject({ ref: '/home/x/proj', fixed: true, doors: [{ side: 's', at: 7 }] });
    expect(plan!.items[3].doors).toEqual([{ side: 's', at: 4 }]);
    expect(plan!.items[0].doors).toBeUndefined();
    expect(problems.map((p) => p.msg)).toEqual(['sobrepõe el-c', 'sala sem referência', 'sala repetida', 'item sem id válido']);
    expect(plan!.on).toBe(true);
    expect(kvPlanBounds(plan!)).toEqual({ x: 0, y: 0, w: 80, h: 17 });
  });

  it('portas: dentro da parede, sem sobrepor, laterais fora da face norte', () => {
    expect(kvNormDoors({ w: 16, h: 12 }, [{ side: 'n', at: 0 }, { side: 'n', at: 3 }, { side: 'n', at: 4 }, { side: 'e', at: 1 }, { side: 'e', at: 5, w: 3 }, { side: 'x', at: 2 }])).toEqual([
      { side: 'n', at: 3 },
      { side: 'e', at: 5, w: 3 },
    ]);
  });

  it('sobreposição: encostar não conta', () => {
    expect(kvRectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(kvRectsOverlap({ x: 0, y: 0, w: 3, h: 2 }, { x: 2, y: 1, w: 2, h: 2 })).toBe(true);
  });

  it('nunca lança com lixo', () => {
    expect(kvNormPlan(null).plan).toBeNull();
    expect(kvNormPlan({ items: 'x', agents: [1, { id: 'ag-1', name: 'A', room: '/r', match: 'main' }] }).plan!.agents).toEqual([{ id: 'ag-1', name: 'A', room: '/r', match: 'main' }]);
  });
});
