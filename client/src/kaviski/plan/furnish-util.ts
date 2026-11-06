// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): ajudantes dos furnishers padrão. Puro (sem DOM).
import { FURNITURE, type Dir, type FurnitureKind } from '../../art/api';
import type { SpotOpts } from '../../world/layout/builder';
import type { SpotDef, SpotKind } from '../../world/layout/types';
import type { KvFurnishCtx } from './api';

export const PLANTS_TALL = ['palm', 'ficus', 'monstera', 'bonsai'] as const;
export const PLANTS_SMALL = ['fern', 'succulent', 'flower'] as const;
export const POSTERS = ['code', 'coffee', 'rocket', 'cat', 'bug', 'ship_it'] as const;
export const BEANBAGS = ['red', 'blue', 'yellow', 'green'] as const;

/** Variação de uma cor hex (clareia/escurece), como a de room.ts. */
export function kvShade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amount > 0 ? (255 - v) * amount : v * amount))));
  return `#${((ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255)).toString(16).padStart(6, '0')}`;
}

/**
 * Um "pincel" sobre o ctx: guarda também os tiles que o próprio furnisher quer livres (a meia cadeira de uma mesa de 2
 * tiles, a frente das estantes...), para os móveis seguintes não caírem em cima.
 */
export class KvPen {
  private readonly mine = new Set<number>();
  readonly w: number;
  readonly h: number;

  constructor(readonly ctx: KvFurnishCtx) {
    this.w = ctx.rect.w;
    this.h = ctx.rect.h;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.ctx.rng() * arr.length) % arr.length];
  }

  /** Livre para o ctx e para mim. */
  ok(x: number, y: number, w = 1, h = 1): boolean {
    if (!this.ctx.free(x, y, w, h)) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.mine.has(yy * 1000 + xx)) return false;
    return true;
  }

  reserve(x: number, y: number, w = 1, h = 1): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.mine.add(yy * 1000 + xx);
  }

  furn(kind: FurnitureKind, x: number, y: number, variant?: string, o: { dx?: number; dy?: number; order?: number; seat?: string } = {}): string | null {
    const fp = FURNITURE[kind].footprint;
    if (!this.ok(x, y, fp.w, fp.h)) return null;
    return this.ctx.furn(kind, x, y, variant, o);
  }

  seat(kind: SpotKind, fk: FurnitureKind, x: number, y: number, dir: Dir, variant?: string, o: SpotOpts & { order?: number } = {}): SpotDef | null {
    const fp = FURNITURE[fk].footprint;
    if (!this.ok(x, y, fp.w, fp.h)) return null;
    return this.ctx.seat(kind, fk, x, y, dir, variant, o);
  }

  spot(kind: SpotKind, x: number, y: number, dir: Dir, o: SpotOpts = {}): SpotDef | null {
    if (!this.ok(x, y)) return null;
    return this.ctx.spot(kind, x, y, dir, o);
  }

  /** Item de parede no primeiro centro livre da lista. */
  wallAt(kind: FurnitureKind, centers: readonly number[], variant?: string, o: { ly?: number; on?: 'face' | 'south'; order?: number } = {}): { id: string; lcx: number } | null {
    for (const c of centers) {
      const id = this.ctx.wall(kind, c, variant, o);
      if (id) return { id, lcx: c };
    }
    return null;
  }

  /** Centros da face norte, do mais perto de `want` ao mais longe (passo de meio tile). */
  centers(want: number, half = 0.5): number[] {
    const out: number[] = [];
    for (let d = 0; d <= this.w; d += 0.5) {
      for (const c of d ? [want - d, want + d] : [want]) if (c - half >= 0.5 && c + half <= this.w - 0.5) out.push(c);
    }
    return out;
  }

  /** Planta (alta ou baixa) se o tile estiver livre. */
  plant(x: number, y: number, tall: boolean, order = 0.2): string | null {
    return tall ? this.furn('plant_tall', x, y, this.pick(PLANTS_TALL), { order }) : this.furn('plant_small', x, y, this.pick(PLANTS_SMALL), { order });
  }

  /** Pontos em pé (subagentes sem lugar sentado, conversa) em tiles livres espalhados. */
  stands(n: number, dir: Dir = 'down'): void {
    const { inner } = this.ctx;
    let done = 0;
    for (let k = 0; k < 40 && done < n; k++) {
      const x = inner.x + 1 + Math.floor(this.ctx.rng() * Math.max(1, inner.w - 2));
      const y = inner.y + 1 + Math.floor(this.ctx.rng() * Math.max(1, inner.h - 2));
      if (!this.ok(x, y) || !this.ok(x, y + 1)) continue;
      if (this.spot('stand', x, y, dir)) done++;
    }
  }
}

/** Mobília de um canto de reunião 4x4 (assentos extras para subagentes): mesa, mesinhas redondas ou recanto. */
export function kvMeetingCorner(pen: KvPen, x: number, y: number, style: 'table' | 'round' | 'lounge'): boolean {
  const { ctx } = pen;
  if (!pen.ok(x, y, 4, 4)) return false;
  if (style === 'table') {
    pen.furn('meeting_table', x, y + 1, undefined, { order: 0.45 });
    pen.seat('stool', 'stool', x, y, 'down', undefined, { order: 0.65 });
    pen.seat('stool', 'stool', x + 2, y, 'down', undefined, { order: 0.66 });
    pen.seat('stool', 'stool', x, y + 3, 'up', undefined, { order: 0.67 });
    pen.seat('stool', 'stool', x + 2, y + 3, 'up', undefined, { order: 0.68 });
  } else if (style === 'round') {
    pen.furn('cafe_table', x + 1, y, undefined, { order: 0.45 });
    pen.seat('stool', 'stool', x, y, 'right', undefined, { order: 0.65 });
    pen.seat('stool', 'stool', x + 2, y, 'left', undefined, { order: 0.66 });
    pen.furn('cafe_table', x + 1, y + 3, undefined, { order: 0.46 });
    pen.seat('stool', 'stool', x, y + 3, 'right', undefined, { order: 0.67 });
    pen.seat('stool', 'stool', x + 2, y + 3, 'left', undefined, { order: 0.68 });
    pen.plant(x + 2, y + 1, false, 0.47);
  } else {
    ctx.b.rug(x - 0.4, y - 0.3, 4.8, 4.6, kvShade(ctx.theme.carpet2, 0.25), ctx.seed + 2);
    pen.furn('coffee_table', x + 1, y + 2, undefined, { order: 0.45 });
    pen.seat('nook', 'armchair', x, y + 2, 'right', 'right', { order: 0.65 });
    pen.seat('nook', 'armchair', x + 3, y + 2, 'left', 'left', { order: 0.66 });
    pen.seat('nook', 'beanbag', x + 1, y + 3, 'up', pen.pick(BEANBAGS), { order: 0.67 });
    pen.seat('nook', 'beanbag', x + 2, y + 3, 'up', pen.pick(BEANBAGS), { order: 0.68 });
    pen.seat('nook', 'beanbag', x + 2, y, 'down', pen.pick(BEANBAGS), { order: 0.69 });
  }
  pen.reserve(x, y, 4, 4);
  return true;
}

/** Sofá de frente para a TV (na face norte), com mesinha e poltronas: o "descanso" de qualquer sala. */
export function kvSofaCorner(pen: KvPen, x: number, y: number): boolean {
  const { ctx } = pen;
  if (!pen.ok(x, y, 5, 3)) return false;
  ctx.b.rug(x - 0.5, y - 0.3, 6, 3.6, ctx.theme.carpet, ctx.seed + 4);
  const sofa = pen.furn('sofa', x + 1, y + 2, 'up', { order: 0.5 });
  if (sofa) for (let i = 0; i < 3; i++) ctx.seat('nook', 'sofa', x + 1 + i, y + 2, 'up', 'up', { noFurniture: true, furnitureId: sofa } as SpotOpts);
  pen.furn('coffee_table', x + 1, y, undefined, { dx: 8, order: 0.45 });
  pen.reserve(x + 1, y, 3, 1);
  pen.seat('nook', 'armchair', x, y, 'right', 'right', { order: 0.55 });
  pen.seat('nook', 'armchair', x + 4, y, 'left', 'left', { order: 0.56 });
  pen.reserve(x, y, 5, 3);
  return true;
}

/** Plantas e um ou outro puff ao longo de uma linha (rodapé da sala), pulando o que não estiver livre. */
export function kvEdgeDecor(pen: KvPen, y: number, x0: number, x1: number, step = 3): void {
  for (let x = x0; x <= x1; x += step) {
    const r = pen.ctx.rng();
    if (r < 0.45) pen.plant(x, y, r < 0.2);
    else if (r < 0.6) pen.seat('nook', 'beanbag', x, y, 'up', pen.pick(BEANBAGS), { order: 0.6 });
    else if (r < 0.75) pen.furn('floor_lamp', x, y, undefined, { order: 0.3 });
  }
}
