// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): o planejador que mobilia uma sala de qualquer tamanho
// sem fechar caminho. Puro (sem DOM). Por cima do `KvFurnishCtx` do motor: guarda o que já ocupou, reserva o tile de uso
// de cada item interativo e só aceita um móvel se, depois dele, a porta ainda alcança todos esses tiles e todos os
// assentos (busca em largura no miolo da sala). Coordenadas LOCAIS da sala.
import { FURNITURE, type Dir, type FurnitureKind } from '../../art/api';
import type { SpotDef, SpotKind } from '../../world/layout/types';
import type { KvFurnishCtx } from './api';
import { kvSpriteDims } from './themes-dims';
import { kvApproachTiles } from './themes-spots';

const FREE = 0;
const BLOCK = 1;
const SEAT = 2;
/** Tile de uso reservado (caminhável; ninguém põe móvel ali). */
const KEEP = 3;

export type Cand = readonly [number, number];

export interface PutOpts {
  /** Ações deste item (tag). */
  use?: string | readonly string[];
  order?: number;
  dx?: number;
  dy?: number;
  /** Mesas: o lugar cuja tela segue quem senta (ver room.ts). */
  seat?: string;
}

export class KvPlacer {
  readonly w: number;
  readonly h: number;
  /** Miolo: x0..x1, y0..y1 (inclusive). */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  private readonly occ: Uint8Array;
  private readonly sources: { x: number; y: number }[] = [];
  private readonly usedWall = new Set<number>();
  /** Tiles que precisam continuar alcançáveis (uso de itens) e assentos (um vizinho alcançável basta). */
  private readonly need: { x: number; y: number; seat: boolean }[] = [];
  readonly placed: string[] = [];

  constructor(readonly ctx: KvFurnishCtx) {
    this.w = ctx.item.w;
    this.h = ctx.item.h;
    this.x0 = ctx.inner.x;
    this.y0 = ctx.inner.y;
    this.x1 = ctx.inner.x + ctx.inner.w - 1;
    this.y1 = ctx.inner.y + ctx.inner.h - 1;
    this.occ = new Uint8Array(this.w * this.h);
    for (const k of ctx.keepFree) {
      if (this.inside(k.x, k.y)) {
        this.occ[k.y * this.w + k.x] = KEEP;
        this.sources.push(k);
        // a porta e o interruptor continuam ligados entre si
        this.need.push({ x: k.x, y: k.y, seat: false });
      }
    }
  }

  get iw(): number {
    return this.x1 - this.x0 + 1;
  }

  get ih(): number {
    return this.y1 - this.y0 + 1;
  }

  /** Centro do miolo. */
  get cx(): number {
    return Math.floor((this.x0 + this.x1) / 2);
  }

  get cy(): number {
    return Math.floor((this.y0 + this.y1) / 2);
  }

  inside(x: number, y: number): boolean {
    return x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1;
  }

  private at(x: number, y: number): number {
    return this.inside(x, y) ? this.occ[y * this.w + x]! : BLOCK;
  }

  /** O retângulo está livre (para o motor e para mim; tiles reservados não contam como livres). */
  free(x: number, y: number, w = 1, h = 1): boolean {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.at(xx, yy) !== FREE) return false;
    return this.ctx.free(x, y, w, h);
  }

  /** Tile em que dá para ficar em pé (livre ou reservado para uso). */
  private walk(x: number, y: number): boolean {
    const v = this.at(x, y);
    return v === FREE || v === KEEP;
  }

  /** A porta ainda alcança todos os tiles de uso e um vizinho de cada assento? */
  private connected(): boolean {
    const seen = new Uint8Array(this.w * this.h);
    const q: number[] = [];
    // parte de UM tile da porta: os outros (o resto da passagem, o interruptor) entram como tiles que precisam ser alcançados
    let starts = this.sources.filter((s) => this.walk(s.x, s.y)).slice(0, 1);
    if (!starts.length) {
      // sem passagem marcada (teste): começa no primeiro tile livre da borda do miolo
      const any = this.firstFree();
      starts = any ? [any] : [];
    }
    for (const s of starts) {
      seen[s.y * this.w + s.x] = 1;
      q.push(s.x, s.y);
    }
    while (q.length) {
      const y = q.pop()!;
      const x = q.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inside(nx, ny) || seen[ny * this.w + nx] || !this.walk(nx, ny)) continue;
        seen[ny * this.w + nx] = 1;
        q.push(nx, ny);
      }
    }
    const ok = (x: number, y: number) => this.inside(x, y) && seen[y * this.w + x] === 1;
    return this.need.every((n) => (n.seat ? ok(n.x, n.y) || ok(n.x + 1, n.y) || ok(n.x - 1, n.y) || ok(n.x, n.y + 1) || ok(n.x, n.y - 1) : ok(n.x, n.y)));
  }

  private firstFree(): { x: number; y: number } | null {
    for (let y = this.y1; y >= this.y0; y--) for (let x = this.x0; x <= this.x1; x++) if (this.walk(x, y)) return { x, y };
    return null;
  }

  private mark(x: number, y: number, w: number, h: number, v: number): number[] {
    const prev: number[] = [];
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = yy * this.w + xx;
        prev.push(i, this.occ[i]!);
        this.occ[i] = v;
      }
    return prev;
  }

  private undo(prev: number[]): void {
    for (let i = prev.length - 2; i >= 0; i -= 2) this.occ[prev[i]!] = prev[i + 1]!;
  }

  private footprint(kind: FurnitureKind, variant?: string): { w: number; h: number; blocks: boolean; seat: boolean } {
    const d = FURNITURE[kind];
    const kv = kvSpriteDims(variant);
    return { w: kv?.w ?? d.footprint.w, h: kv?.h ?? d.footprint.h, blocks: d.blocks, seat: !!d.seat };
  }

  /** Móvel de chão no primeiro lugar que der certo (com o tile de uso, se `use`). */
  put(kind: FurnitureKind, cands: Iterable<Cand>, variant?: string, o: PutOpts = {}): string | null {
    for (const [x, y] of cands) {
      const id = this.putAt(kind, x, y, variant, o);
      if (id) return id;
    }
    return null;
  }

  putAt(kind: FurnitureKind, x: number, y: number, variant?: string, o: PutOpts = {}): string | null {
    const fp = this.footprint(kind, variant);
    if (!this.free(x, y, fp.w, fp.h)) return null;
    const prev = this.mark(x, y, fp.w, fp.h, fp.blocks ? BLOCK : SEAT);
    const uses = o.use === undefined ? [] : typeof o.use === 'string' ? [o.use] : [...o.use];
    let approach: { tx: number; ty: number } | undefined;
    if (uses.length) {
      approach = kvApproachTiles(x, y, fp.w, fp.h).find((t) => this.walk(t.tx, t.ty) && this.ctx.free(t.tx, t.ty));
      if (!approach) {
        this.undo(prev);
        return null;
      }
      prev.push(...this.mark(approach.tx, approach.ty, 1, 1, KEEP));
      this.need.push({ x: approach.tx, y: approach.ty, seat: false });
    }
    if (!this.connected()) {
      this.undo(prev);
      if (approach) this.need.pop();
      return null;
    }
    const id = this.ctx.furn(kind, x, y, variant, { order: o.order, dx: o.dx, dy: o.dy, seat: o.seat });
    if (!id) {
      this.undo(prev);
      if (approach) this.need.pop();
      return null;
    }
    for (const u of uses) this.ctx.tag(id, u);
    this.placed.push(id);
    return id;
  }

  /** Assento (cadeira, banqueta, sofá...) que fica alcançável. */
  seat(spot: SpotKind, kind: FurnitureKind, x: number, y: number, dir: Dir, variant?: string, o: { order?: number; dx?: number; deskId?: string; side?: 'S' | 'N'; rank?: number } = {}): SpotDef | null {
    const fp = this.footprint(kind, variant);
    if (!this.free(x, y, fp.w, fp.h)) return null;
    const prev = this.mark(x, y, fp.w, fp.h, SEAT);
    this.need.push({ x, y, seat: true });
    if (!this.connected()) {
      this.need.pop();
      this.undo(prev);
      return null;
    }
    const s = this.ctx.seat(spot, kind, x, y, dir, variant, o);
    if (!s) {
      this.need.pop();
      this.undo(prev);
    }
    return s;
  }

  /** Spot em pé (fliperama, quadro...) num tile que fica reservado. */
  spot(kind: SpotKind, x: number, y: number, dir: Dir, o: { furnitureId?: string; use?: string } = {}): SpotDef | null {
    if (!this.walk(x, y) || !this.ctx.free(x, y)) return null;
    const s = this.ctx.spot(kind, x, y, dir, { furnitureId: o.furnitureId });
    if (!s) return null;
    this.mark(x, y, 1, 1, KEEP);
    this.need.push({ x, y, seat: false });
    if (o.use) this.ctx.tag(s.id, o.use);
    return s;
  }

  /**
   * Item de parede (face norte) com `n` colunas livres seguidas, perto de `near` (coluna local; padrão: o meio).
   * Com `use`, reserva o tile de piso embaixo dele (de onde o boneco usa).
   */
  wall(kind: FurnitureKind, n: number, variant?: string, o: { near?: number; use?: string | readonly string[]; order?: number; avoid?: (lcx: number) => boolean } = {}): string | null {
    const cols = this.ctx.wallSlots
      .filter((s) => s.on === 'face')
      .map((s) => Math.floor(s.lcx))
      .filter((c) => !this.usedWall.has(c))
      .sort((a, b) => a - b);
    const set = new Set(cols);
    const near = o.near ?? (this.w - 1) / 2;
    const runs: number[] = [];
    for (const c of cols) {
      let ok = true;
      for (let i = 0; i < n; i++) if (!set.has(c + i)) ok = false;
      if (ok) runs.push(c);
    }
    runs.sort((a, b) => Math.abs(a + n / 2 - 0.5 - near) - Math.abs(b + n / 2 - 0.5 - near) || a - b);
    const uses = o.use === undefined ? [] : typeof o.use === 'string' ? [o.use] : [...o.use];
    for (const c of runs) {
      const lcx = c + n / 2;
      if (o.avoid?.(lcx)) continue;
      // o tile de uso: embaixo do item, na primeira linha do piso
      let use: { x: number; y: number } | null = null;
      if (uses.length) {
        const under = [Math.floor(lcx), Math.floor(lcx) - 1, Math.floor(lcx) + 1, Math.floor(lcx) - 2, Math.floor(lcx) + 2].find((x) => this.walk(x, this.y0) && this.ctx.free(x, this.y0));
        if (under === undefined) continue;
        use = { x: under, y: this.y0 };
      }
      const id = this.ctx.wall(kind, lcx, variant, { order: o.order });
      if (!id) continue;
      for (let i = 0; i < n; i++) this.usedWall.add(c + i);
      if (use) {
        this.mark(use.x, use.y, 1, 1, KEEP);
        this.need.push({ ...use, seat: false });
      }
      for (const u of uses) this.ctx.tag(id, u);
      return id;
    }
    return null;
  }

  /** Quantas colunas livres de parede ainda há. */
  wallLeft(): number {
    return this.ctx.wallSlots.filter((s) => s.on === 'face' && !this.usedWall.has(Math.floor(s.lcx))).length;
  }

  // ------------------------------------------------------------------ candidatos

  /** Encostado na parede norte (linha y0), do `near` para as pontas. */
  north(w: number, near = this.cx - Math.floor(w / 2), row = this.y0): Cand[] {
    return this.spread(w, near).map((x) => [x, row] as const);
  }

  /** Encostado na parede sul. */
  south(w: number, h = 1, near = this.cx - Math.floor(w / 2)): Cand[] {
    return this.spread(w, near).map((x) => [x, this.y1 - h + 1] as const);
  }

  /** Encostado na parede oeste (x0), de `near` (linha) para as pontas. */
  west(h = 1, near = this.cy): Cand[] {
    return this.spreadY(h, near).map((y) => [this.x0, y] as const);
  }

  east(w = 1, h = 1, near = this.cy): Cand[] {
    return this.spreadY(h, near).map((y) => [this.x1 - w + 1, y] as const);
  }

  /** Perto de (x, y), em anéis. */
  around(x: number, y: number, r = 4): Cand[] {
    const out: Cand[] = [];
    for (let d = 0; d <= r; d++)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === d) out.push([x + dx, y + dy]);
    return out;
  }

  /** Os quatro cantos do miolo (para plantas), num tamanho w x h. */
  corners(w = 1, h = 1): Cand[] {
    return [
      [this.x0, this.y0],
      [this.x1 - w + 1, this.y0],
      [this.x0, this.y1 - h + 1],
      [this.x1 - w + 1, this.y1 - h + 1],
    ];
  }

  private spread(w: number, near: number): number[] {
    const xs: number[] = [];
    for (let x = this.x0; x + w - 1 <= this.x1; x++) xs.push(x);
    return xs.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b);
  }

  private spreadY(h: number, near: number): number[] {
    const ys: number[] = [];
    for (let y = this.y0; y + h - 1 <= this.y1; y++) ys.push(y);
    return ys.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b);
  }
}
