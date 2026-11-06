// Fork Kaviski (KAVISKI-HUMANOS.md): o que os objetos de parede desenham no mundo — o gancho do renderer
// (`kvDrawWallExtras`, logo depois dos itens de parede, antes dos móveis e da luz): o mural de cortiça no lugar do pôster
// da sala (na recepção, no lugar do quadro), com papeizinhos e uma bolinha vermelha quando há nota nova; o ícone de cada
// link; nas salas próprias, a miniatura do desenho no quadro branco. Sem interface (a cena Visita importa o renderer):
// os dados chegam por `kvWall`, preenchido por objects.ts.
import type { KvPerson } from '../../../../shared/kaviski-humanos';
import { kvIsOwnRoomId, type KvBoardEvent, type KvBoardOp, type KvNote, type KvWallLink } from '../../../../shared/kaviski-rooms';
import type { ArtModule } from '../../art/api';
import { TILE } from '../../world/constants';
import { opaqueBounds, wallItemOrigin, wallSprites, type AreaVis, type WallVis } from '../../world/render/scene';
import type { AreaLayout } from '../../world/layout/types';
import { BOARD_API, kvApplyBoardEvent, kvDrawBoardOps } from './board-draw';

export const PAPER = ['#fff3a3', '#ffc9de', '#bfe3ff', '#c8f0c4', '#ffd8a8', '#e3d4ff'];

/** Estado dos objetos desta página (null/vazio até objects.ts ligar). */
export const kvWall: {
  active: boolean;
  me: KvPerson | null;
  notes: KvNote[];
  links: KvWallLink[];
  boards: Record<string, { count: number; rev: number; at: number }>;
  /** Última nota vista por área (mural). */
  seen: Record<string, number>;
  /** O módulo de arte (para medir os itens de parede fora do renderer). */
  art: ArtModule | null;
} = { active: false, me: null, notes: [], links: [], boards: {}, seen: {}, art: null };

/** Miniaturas dos quadros das salas próprias (desenhadas na parede). */
const thumbs = new Map<string, { rev: number; ops: KvBoardOp[]; canvas: HTMLCanvasElement | null; loading: boolean }>();

/** Área (chat/voz/objetos) de uma área do layout: sala `r:<id>`, núcleo `a:<id>`; corredor não tem objetos. */
export function kvAreaKey(layout: Pick<AreaLayout, 'id' | 'kind'>): string | null {
  if (layout.kind === 'room') return `r:${layout.id}`;
  if (layout.kind === 'corridor') return null;
  return `a:${layout.id}`;
}

/** Notas novas (de outras pessoas, depois da última vez que abri o mural). */
export function kvNewNotes(area: string): number {
  const t = kvWall.seen[area] ?? 0;
  return kvWall.notes.filter((n) => n.area === area && n.at > t && n.by.id !== kvWall.me?.id).length;
}

export /** O pôster (sala) ou o quadro (recepção) onde fica o mural de avisos. */
function kvMuralItem(layout: AreaLayout): AreaLayout['wallItems'][number] | undefined {
  if (layout.kind === 'reception') return layout.wallItems.find((w) => w.kind === 'painting');
  if (layout.kind === 'room') return layout.wallItems.find((w) => w.kind === 'poster' && w.on === 'face');
  return undefined;
}

function wallRect(art: ArtModule | null, w: { kind: WallVis['kind']; variant?: string; cx: number; baseY: number; on: 'face' | 'south' }, seed = 0): { x: number; y: number; w: number; h: number } {
  const s = art ? wallSprites(art, w.kind, w.variant, 0, seed) : null;
  if (!s) return { x: w.cx - 8, y: w.baseY - 22, w: 16, h: 14 };
  const o = wallItemOrigin({ ...w, id: '', seed, order: 0, areaId: '' }, s.base);
  const b = opaqueBounds(s.base.canvas);
  return { x: o.x + b.x, y: o.y + b.y, w: b.w, h: b.h };
}

/** Retângulo (px de mundo) de um item de parede. */
export function kvWallRect(art: ArtModule | null, w: { kind: WallVis['kind']; variant?: string; cx: number; baseY: number; on: 'face' | 'south' }, seed = 0): { x: number; y: number; w: number; h: number } {
  const s = art ? wallSprites(art, w.kind, w.variant, 0, seed) : null;
  if (!s) return { x: w.cx - 8, y: w.baseY - 22, w: 16, h: 14 };
  const o = wallItemOrigin({ ...w, id: '', seed, order: 0, areaId: '' }, s.base);
  const b = opaqueBounds(s.base.canvas);
  return { x: o.x + b.x, y: o.y + b.y, w: b.w, h: b.h };
}

export function kvLinkRect(cx: number, baseY: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(cx - 4), y: baseY - 21, w: 9, h: 11 };
}

/** Gancho do renderer (drawWalls): o mural, os links e a miniatura do quadro desta área. */
export function kvDrawWallExtras(ctx: CanvasRenderingContext2D, art: ArtModule, vis: AreaVis, rise: number, now: number): void {
  if (!kvWall.active) return;
  kvWall.art = art;
  const layout = vis.layout;
  const area = kvAreaKey(layout);
  if (!area) return;
  const m = kvMuralItem(layout);
  if (m) drawMural(ctx, kvWallRect(art, m), area, rise, now);
  if (layout.kind === 'room') {
    for (const w of layout.wallItems) if (w.kind === 'whiteboard') drawBoardThumb(ctx, art, w, area, rise);
  }
  for (const l of kvWall.links) {
    if (l.area !== area) continue;
    const r = kvLinkRect((layout.rect.x + l.x) * TILE, (layout.rect.y + 2) * TILE);
    drawLinkIcon(ctx, r.x, r.y + rise);
  }
}

function drawMural(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, area: string, rise: number, now: number): void {
  const x = r.x - 1;
  const y = r.y - 1 + rise;
  const w = Math.max(14, r.w + 2);
  const hh = Math.max(12, r.h + 2);
  ctx.fillStyle = '#7a5638';
  ctx.fillRect(x, y, w, hh);
  ctx.fillStyle = '#c99c62';
  ctx.fillRect(x + 1, y + 1, w - 2, hh - 2);
  ctx.fillStyle = 'rgba(122,86,56,0.35)';
  for (let i = 0; i < w - 2; i += 3) ctx.fillRect(x + 1 + i, y + 1 + ((i * 7) % (hh - 3)), 1, 1);
  const mine = kvWall.notes.filter((n) => n.area === area);
  const cols = Math.max(1, Math.floor((w - 2) / 5));
  const rows = Math.max(1, Math.floor((hh - 3) / 5));
  mine.slice(-cols * rows).forEach((n, i) => {
    const px = x + 2 + (i % cols) * 5;
    const py = y + 2 + Math.floor(i / cols) * 5;
    ctx.fillStyle = PAPER[n.id.charCodeAt(0) % PAPER.length]!;
    ctx.fillRect(px, py, 4, 4);
    ctx.fillStyle = '#d23b3b';
    ctx.fillRect(px + 1, py, 1, 1);
  });
  if (kvNewNotes(area) > 0 && Math.floor(now / 600) % 2 === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + w - 4, y - 2, 5, 5);
    ctx.fillStyle = '#e2312f';
    ctx.fillRect(x + w - 3, y - 1, 3, 3);
  }
}

function drawLinkIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // folha com o canto dobrado e uma "corrente" azul; tachinha vermelha em cima
  ctx.fillStyle = 'rgba(20,24,36,0.25)';
  ctx.fillRect(x + 1, y + 1, 9, 11);
  ctx.fillStyle = '#f8f8f4';
  ctx.fillRect(x, y, 9, 11);
  ctx.fillStyle = '#d9d6cc';
  ctx.fillRect(x + 6, y, 3, 3);
  ctx.fillStyle = '#9aa0ad';
  ctx.fillRect(x, y, 1, 11);
  ctx.fillRect(x, y + 10, 9, 1);
  ctx.fillStyle = '#3f7fd8';
  ctx.fillRect(x + 2, y + 5, 3, 2);
  ctx.fillRect(x + 4, y + 7, 3, 2);
  ctx.fillStyle = '#e2312f';
  ctx.fillRect(x + 3, y - 1, 2, 2);
}

function drawBoardThumb(ctx: CanvasRenderingContext2D, art: ArtModule, w: AreaLayout['wallItems'][number], area: string, rise: number): void {
  const info = kvWall.boards[area];
  if (!info?.count) return;
  const s = wallSprites(art, 'whiteboard', w.variant, 0, 0);
  const rb = s?.base.rects?.board;
  if (!s || !rb) return;
  const o = wallItemOrigin({ ...w, seed: 0, areaId: '' }, s.base);
  const r = { x: o.x + rb.x, y: o.y + rise + rb.y, w: rb.w, h: rb.h };
  if (!kvIsOwnRoomId(area.slice(2))) {
    // sala de projeto: o quadro do original continua (tarefas); só um sinal de que há desenho
    ctx.fillStyle = '#3f7fd8';
    ctx.fillRect(r.x + r.w - 4, r.y + 1, 3, 3);
    return;
  }
  const t = thumbFor(area, info.rev);
  if (!t?.canvas) return;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(t.canvas, r.x, r.y, r.w, r.h);
  ctx.restore();
}

function thumbFor(area: string, rev: number) {
  let t = thumbs.get(area);
  if (!t) {
    t = { rev, ops: [], canvas: null, loading: true };
    thumbs.set(area, t);
    const entry = t;
    void fetch(`${BOARD_API}?area=${encodeURIComponent(area)}`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { ops: KvBoardOp[]; rev: number } | null) => {
        if (!b) return;
        entry.ops = b.ops;
        entry.rev = b.rev;
        paintThumb(entry);
      })
      .catch(() => {})
      .finally(() => (entry.loading = false));
  }
  return t;
}

function paintThumb(t: { ops: KvBoardOp[]; canvas: HTMLCanvasElement | null }): void {
  const c = t.canvas ?? document.createElement('canvas');
  c.width = 160;
  c.height = 100;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.save();
  x.scale(0.1, 0.1);
  kvDrawBoardOps(x, t.ops);
  x.restore();
  t.canvas = c;
}

/** Quadro mudou (evento `board`): o resumo e a miniatura acompanham. */
export function kvWallBoardEvent(ev: KvBoardEvent): void {
  const info = (kvWall.boards[ev.area] ??= { count: 0, rev: 0, at: 0 });
  info.rev = ev.rev;
  info.at = Date.now();
  if (ev.kind === 'clear') info.count = 0;
  else if (ev.kind === 'remove') info.count = Math.max(0, info.count - 1);
  else if (!ev.append) info.count++;
  const t = thumbs.get(ev.area);
  if (t && !t.loading) {
    kvApplyBoardEvent(t.ops, ev);
    t.rev = ev.rev;
    paintThumb(t);
  }
}

/** Depois de reler os objetos: miniatura velha é buscada de novo. */
export function kvWallResetThumbs(): void {
  for (const [area, t] of thumbs) if ((kvWall.boards[area]?.rev ?? 0) !== t.rev) thumbs.delete(area);
}
