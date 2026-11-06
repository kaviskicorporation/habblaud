// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): a parte pura do editor da empresa (editor-model.ts).
import { describe, expect, it } from 'vitest';
import type { KvPlan, KvPlanItem } from '../../../../shared/kaviski-plan';
import {
  KvUndo,
  kvAutoDoor,
  kvDoorOutside,
  kvDuplicate,
  kvFindFree,
  kvFitPlan,
  kvFixDoors,
  kvHit,
  kvItemAt,
  kvMagnet,
  kvMoveDoor,
  kvNewItem,
  kvPlanWarnings,
  kvResize,
  kvToggleDoor,
  kvTouch,
  kvTrimPlan,
  kvWallAt,
} from './editor-model';

const it_ = (id: string, kind: KvPlanItem['kind'], x: number, y: number, w: number, h: number, extra: Partial<KvPlanItem> = {}): KvPlanItem => ({ id: `el-${id}`, kind, x, y, w, h, ...extra });
const base = (): KvPlan => ({
  v: 1,
  on: true,
  w: 100,
  h: 50,
  auto: { x: 64, y: 0, dir: 'e' },
  items: [
    it_('rec', 'nucleo', 0, 0, 16, 12, { ref: 'recepcao' }),
    it_('cor', 'corredor', 0, 12, 64, 5),
    it_('a', 'projeto', 16, 0, 16, 12, { ref: '/x/a', doors: [{ side: 's', at: 7 }] }),
    it_('b', 'projeto', 16, 17, 16, 12, { ref: '/x/b', doors: [{ side: 'n', at: 7 }] }),
  ],
});

describe('editor: mover, ímã e redimensionar', () => {
  it('acha item no tile e sobreposição', () => {
    const p = base();
    expect(kvItemAt(p, 20, 5)?.id).toBe('el-a');
    expect(kvItemAt(p, 70, 40)).toBeNull();
    expect(kvHit(p, { x: 30, y: 0, w: 4, h: 4 })?.id).toBe('el-a');
    expect(kvHit(p, { x: 32, y: 0, w: 4, h: 4 })).toBeNull();
    expect(kvHit(p, { x: 30, y: 0, w: 4, h: 4 }, 'el-a')).toBeNull();
  });

  it('ímã encosta na parede do vizinho e no corredor a até 1 tile', () => {
    const p = base();
    expect(kvMagnet(p, { x: 33, y: 1, w: 12, h: 10 }, 'el-x')).toEqual({ x: 32, y: 2, w: 12, h: 10 });
    expect(kvMagnet(p, { x: 35, y: 1, w: 12, h: 10 }, 'el-x')).toEqual({ x: 35, y: 2, w: 12, h: 10 });
    expect(kvMagnet(p, { x: 40, y: 30, w: 12, h: 10 }, 'el-x')).toEqual({ x: 40, y: 30, w: 12, h: 10 });
    // nunca para cima de outro
    expect(kvMagnet(p, { x: 31, y: 30, w: 12, h: 10 }, 'el-x')).toEqual({ x: 31, y: 29, w: 12, h: 10 });
  });

  it('redimensiona pelas alças dentro dos limites do tipo (núcleo e vaga não mudam)', () => {
    const r = { x: 16, y: 0, w: 16, h: 12 };
    expect(kvResize(r, 'projeto', 'e', 4, 0)).toEqual({ x: 16, y: 0, w: 20, h: 12 });
    expect(kvResize(r, 'projeto', 'w', 10, 0)).toEqual({ x: 22, y: 0, w: 10, h: 12 }); // mínimo 10
    expect(kvResize(r, 'projeto', 'se', 100, 100)).toEqual({ x: 16, y: 0, w: 48, h: 32 }); // máximo 48×32
    expect(kvResize(r, 'projeto', 'nw', -30, 0)).toEqual({ x: 0, y: 0, w: 32, h: 12 }); // não passa de 0
    expect(kvResize(r, 'nucleo', 'se', 5, 5)).toEqual(r);
    expect(kvResize(r, 'vaga', 'e', 5, 0)).toEqual(r);
  });

  it('acha lugar livre perto e a planta cresce para caber', () => {
    const p = base();
    const s = kvFindFree(p, 16, 12, 24, 6)!;
    expect(kvHit(p, { ...s, w: 16, h: 12 })).toBeNull();
    const big = kvFitPlan({ ...p, items: [...p.items, it_('z', 'jardim', 90, 45, 20, 10)] });
    expect(big.w).toBe(118);
    expect(big.h).toBe(63);
    expect(kvTrimPlan(p)).toMatchObject({ w: 72, h: 37 });
  });

  it('duplica temática/corredor ao lado; projeto e núcleo não (são uma sala só)', () => {
    const p = base();
    p.items.push(it_('rh', 'tema', 40, 0, 12, 10, { ref: 'rh', locked: true, doors: [{ side: 's', at: 5 }] }));
    const d = kvDuplicate(p, 'el-rh')!;
    const copy = d.plan.items.find((i) => i.id === d.id)!;
    expect(copy).toMatchObject({ kind: 'tema', ref: 'rh', w: 12, h: 10 });
    expect(copy.locked).toBeUndefined();
    expect(kvHit(d.plan, copy, copy.id)).toBeNull();
    expect(kvDuplicate(p, 'el-a')).toBeNull();
    expect(kvDuplicate(p, 'el-rec')).toBeNull();
  });
});

describe('editor: portas', () => {
  const room = it_('a', 'projeto', 16, 0, 16, 12, { ref: '/x/a', doors: [{ side: 's', at: 7 }] });

  it('acha a parede perto do ponteiro (a face norte tem 2 linhas)', () => {
    expect(kvWallAt(room, 20.5, 12.2)).toMatchObject({ side: 's' });
    expect(kvWallAt(room, 20.5, 1.5)).toMatchObject({ side: 'n' });
    expect(kvWallAt(room, 16.2, 6)).toMatchObject({ side: 'w' });
    expect(kvWallAt(room, 31.9, 6)).toMatchObject({ side: 'e' });
    expect(kvWallAt(room, 24, 6)).toBeNull();
    expect(kvWallAt(room, 16.1, 12.1)?.side).not.toBe('w'); // canto: vale a parede mais perto, longe da ponta
  });

  it('clicar na parede põe porta; na porta tira; porta não passa da parede', () => {
    const a = kvToggleDoor(room, 'n', 4);
    expect(a.doors).toEqual([{ side: 's', at: 7 }, { side: 'n', at: 3 }]);
    expect(kvToggleDoor(a, 's', 8).doors).toEqual([{ side: 'n', at: 3 }]);
    expect(kvToggleDoor(room, 'e', 1).doors?.[1]).toEqual({ side: 'e', at: 2 }); // lateral começa depois da face
    expect(kvToggleDoor(room, 's', 15.8).doors?.[1]).toEqual({ side: 's', at: 13 });
  });

  it('arrastar a porta pela parede (e trocar de parede); não sobrepõe outra', () => {
    const two = { ...room, doors: [{ side: 's' as const, at: 2 }, { side: 's' as const, at: 10 }] };
    expect(kvMoveDoor(two, 0, 's', 6).doors).toEqual([{ side: 's', at: 5 }, { side: 's', at: 10 }]);
    expect(kvMoveDoor(two, 0, 's', 11).doors).toEqual(two.doors);
    expect(kvMoveDoor(two, 0, 'w', 6).doors?.[0]).toEqual({ side: 'w', at: 5 });
  });

  it('depois de encolher, porta que não cabe sai e a sala nunca fica sem porta', () => {
    const r = kvFixDoors({ ...room, w: 10, doors: [{ side: 's', at: 12 }] });
    expect(r.doors).toEqual([{ side: 's', at: 4 }]);
    expect(kvDoorOutside(room, { side: 's', at: 7 })).toEqual([
      { x: 23, y: 12 },
      { x: 24, y: 12 },
    ]);
  });

  it('item novo vem com tamanho e porta padrão', () => {
    const n = kvNewItem('tema', { ref: 'rh', rand: () => 0.5 });
    expect(n).toMatchObject({ kind: 'tema', ref: 'rh', w: 12, h: 10, doors: [{ side: 's', at: 5 }] });
    expect(n.id).toMatch(/^el-[a-z0-9]{10}$/);
    expect(kvNewItem('corredor').doors).toBeUndefined();
  });
});

describe('editor: avisos ao vivo', () => {
  it('planta certinha: sem avisos', () => {
    expect(kvPlanWarnings(base())).toEqual([]);
  });

  it('sala com porta para a grama: "porta"; a Corrigir põe a porta encostada no corredor', () => {
    const p = base();
    p.items[2] = { ...p.items[2], doors: [{ side: 'n', at: 7 }] };
    expect(kvPlanWarnings(p)).toEqual([{ id: 'el-a', kind: 'porta' }]);
    const fixed = kvAutoDoor(p, p.items[2])!;
    expect(fixed.doors).toContainEqual({ side: 's', at: 7 });
    p.items[2] = fixed;
    expect(kvPlanWarnings(p)).toEqual([]);
  });

  it('corredor solto, sem ligar na recepção: as salas dele ficam "sem caminho"', () => {
    const p = base();
    p.items.push(it_('c2', 'corredor', 70, 30, 20, 4), it_('far', 'tema', 70, 34, 12, 10, { ref: 'rh', doors: [{ side: 'n', at: 5 }] }));
    expect(kvPlanWarnings(p)).toEqual([{ id: 'el-far', kind: 'caminho' }]);
    // ligando os corredores (encostados), o caminho existe
    p.items.push(it_('c3', 'corredor', 64, 12, 6, 22));
    expect(kvPlanWarnings(p)).toEqual([]);
    expect(kvTouch(p.items[1], p.items[6])).toBe(true);
  });

  it('sem recepção e item fora da planta', () => {
    const p = base();
    p.items.shift();
    p.items.push(it_('fora', 'jardim', 95, 45, 10, 10));
    const w = kvPlanWarnings(p);
    expect(w).toContainEqual({ kind: 'recepcao' });
    expect(w).toContainEqual({ id: 'el-fora', kind: 'fora' });
  });
});

describe('editor: desfazer e refazer', () => {
  it('volta e avança pelas fotos; mudança nova apaga o refazer', () => {
    const u = new KvUndo(3);
    const a = base();
    const b = { ...a, name: 'b' };
    const c = { ...a, name: 'c' };
    u.push(a);
    u.push(b);
    expect(u.undo(c)?.name).toBe('b');
    expect(u.canRedo).toBe(true);
    expect(u.redo(b)?.name).toBe('c');
    u.undo(c);
    u.push({ ...a, name: 'x' });
    expect(u.canRedo).toBe(false);
    for (let i = 0; i < 10; i++) u.push({ ...a, name: `n${i}` });
    let n = 0;
    while (u.undo(a)) n++;
    expect(n).toBe(3);
  });
});
