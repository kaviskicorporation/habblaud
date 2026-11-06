// Fork Kaviski (KAVISKI-HUMANOS.md): quadro branco compartilhado da sala. Tela de desenho (caneta, cores, borracha,
// texto, desfazer o meu último, limpar) sincronizada ao vivo: cada traço sai em pedaços (~12 por segundo) por POST
// /api/kaviski/humanos/board e chega às outras páginas pelo evento `board` do fluxo de presença (só quem vê a sala).
import {
  KV_BOARD_COLORS,
  KV_BOARD_H,
  KV_BOARD_TEXT_MAX,
  KV_BOARD_W,
  type KvBoardEvent,
  type KvBoardOp,
  type KvBoardState,
  type KvBoardTool,
} from '../../../../shared/kaviski-rooms';
import { tr } from '../../../../shared/i18n';
import { h, iconButton } from '../../ui/dom';
import { ICONS } from '../../ui/icons';

export const BOARD_API = '/api/kaviski/humanos/board';
const FLUSH_MS = 80;
const SIZES = [4, 10, 24] as const;
const TEXT_SIZE = 40;

/** Desenha os traços/textos no contexto (já escalado para as coordenadas do quadro). */
export function kvDrawBoardOps(ctx: CanvasRenderingContext2D, ops: readonly KvBoardOp[], from = 0): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = from; i < ops.length; i++) kvDrawBoardOp(ctx, ops[i]!);
}

export function kvDrawBoardOp(ctx: CanvasRenderingContext2D, op: KvBoardOp, start = 0): void {
  const p = op.pts ?? [];
  if (op.tool === 'text') {
    if (!op.text || p.length < 2) return;
    ctx.fillStyle = op.color;
    ctx.font = `600 ${op.size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(op.text, p[0]!, p[1]!);
    return;
  }
  if (p.length < 2) return;
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = Math.max(0, start - 2);
  if (p.length - s <= 2) {
    ctx.beginPath();
    ctx.arc(p[s]!, p[s + 1]!, op.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[s]!, p[s + 1]!);
  for (let i = s + 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  ctx.stroke();
}

/** Aplica um evento `board` à lista de traços (no lugar). Devolve 'redraw' quando é preciso redesenhar tudo. */
export function kvApplyBoardEvent(ops: KvBoardOp[], ev: KvBoardEvent): { redraw: boolean; op?: KvBoardOp; from?: number } {
  if (ev.kind === 'clear') {
    ops.length = 0;
    return { redraw: true };
  }
  if (ev.kind === 'remove') {
    const i = ops.findIndex((o) => o.id === ev.id);
    if (i >= 0) ops.splice(i, 1);
    return { redraw: i >= 0 };
  }
  if (ev.append) {
    const cur = ops.find((o) => o.id === ev.op.id);
    if (!cur) return { redraw: false };
    const from = cur.pts?.length ?? 0;
    cur.pts = [...(cur.pts ?? []), ...(ev.op.pts ?? [])];
    return { redraw: false, op: cur, from };
  }
  if (ops.some((o) => o.id === ev.op.id)) return { redraw: false };
  const op = { ...ev.op, pts: [...(ev.op.pts ?? [])] };
  ops.push(op);
  return { redraw: false, op, from: 0 };
}

const rid = () => Math.random().toString(36).slice(2, 12).padEnd(6, '0');

export interface KvWhiteboardDeps {
  me: string;
  /** Pode limpar o quadro (equipe). */
  canClear: boolean;
  /** Ouvir os eventos `board` (devolve a função que para). */
  onBoard(cb: (ev: KvBoardEvent) => void): () => void;
}

export class KvWhiteboard {
  readonly el: HTMLDialogElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly textInput: HTMLInputElement;
  private area = '';
  private ops: KvBoardOp[] = [];
  private tool: KvBoardTool = 'pen';
  private color = KV_BOARD_COLORS[0]!;
  private size: number = SIZES[0];
  private drawing: { op: KvBoardOp; sent: number; created: boolean } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private off: (() => void) | null = null;
  private textAt: { x: number; y: number } | null = null;

  constructor(private readonly deps: KvWhiteboardDeps) {
    this.canvas = h('canvas', { class: 'kv-board__canvas', attrs: { width: String(KV_BOARD_W), height: String(KV_BOARD_H), 'aria-label': tr('Quadro branco') } });
    this.ctx = this.canvas.getContext('2d')!;
    this.title = h('h2', { text: tr('Quadro branco') });
    this.status = h('span', { class: 'kv-board__status', attrs: { 'aria-live': 'polite' } });
    const tools = h('div', { class: 'kv-board__tools', role: 'toolbar' });
    const toolBtn = (t: KvBoardTool, label: string, glyph: string) => {
      const b = h('button', { class: 'ui-btn ui-btn--sm kv-board__tool', type: 'button', text: glyph, title: label, attrs: { 'aria-label': label, 'data-tool': t }, on: { click: () => this.setTool(t) } });
      tools.append(b);
    };
    toolBtn('pen', tr('Caneta'), '✎');
    toolBtn('eraser', tr('Borracha'), '⌫');
    toolBtn('text', tr('Texto'), 'T');
    for (const c of KV_BOARD_COLORS) {
      tools.append(h('button', { class: 'kv-board__color', type: 'button', title: c, style: `--c:${c}`, attrs: { 'aria-label': tr('Cor {0}', [c]), 'data-color': c }, on: { click: () => this.setColor(c) } }));
    }
    SIZES.forEach((s, i) => {
      tools.append(h('button', { class: 'ui-btn ui-btn--sm kv-board__size', type: 'button', text: ['·', '•', '●'][i], title: tr('Espessura {0}', [s]), attrs: { 'aria-label': tr('Espessura {0}', [s]), 'data-size': String(s) }, on: { click: () => this.setSize(s) } }));
    });
    const undo = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Desfazer'), on: { click: () => this.undo() } });
    this.clearBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Limpar tudo'), on: { click: () => this.clear() } });
    tools.append(undo, this.clearBtn);
    this.textInput = h('input', { class: 'kv-board__text', attrs: { maxlength: String(KV_BOARD_TEXT_MAX), placeholder: tr('Escreva e aperte Enter'), hidden: true } });
    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.placeText();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hideText();
      }
    });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    const stage = h('div', { class: 'kv-board__stage' }, this.canvas, this.textInput);
    this.el = h(
      'dialog',
      { class: 'ui-dialog kv-board' },
      h('div', { class: 'ui-dialog__head' }, this.title, h('div', { class: 'kv-board__head' }, this.status, close)),
      h('div', { class: 'ui-dialog__body kv-board__body' }, tools, stage),
    );
    this.el.addEventListener('close', () => this.detach());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
    this.setTool('pen');
    this.setColor(this.color);
    this.setSize(this.size);
  }

  get openArea(): string | null {
    return this.el.open ? this.area : null;
  }

  async open(area: string, name: string): Promise<void> {
    this.detach();
    this.area = area;
    this.title.textContent = tr('Quadro branco · {0}', [name]);
    this.clearBtn.hidden = !this.deps.canClear;
    this.ops = [];
    this.redraw();
    this.status.textContent = tr('Carregando…');
    if (!this.el.open) this.el.showModal();
    this.off = this.deps.onBoard((ev) => this.onEvent(ev));
    try {
      const res = await fetch(`${BOARD_API}?area=${encodeURIComponent(area)}`, { credentials: 'same-origin', cache: 'no-store' });
      const body = (await res.json()) as KvBoardState & { error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      if (this.area !== area) return;
      // os eventos que chegaram durante a carga já estão no estado do servidor
      this.ops = body.ops.map((o) => ({ ...o, pts: [...(o.pts ?? [])] }));
      this.redraw();
      this.status.textContent = '';
    } catch (err) {
      this.status.textContent = tr('Não deu para abrir o quadro: {0}', [(err as Error).message]);
    }
  }

  private detach(): void {
    this.off?.();
    this.off = null;
    this.finish();
    this.hideText();
  }

  private onEvent(ev: KvBoardEvent): void {
    if (ev.area !== this.area) return;
    // os meus traços já estão desenhados (só a remoção/limpeza volta para mim)
    if (ev.kind === 'op' && ev.op.by === this.deps.me) return;
    const r = kvApplyBoardEvent(this.ops, ev);
    if (r.redraw) this.redraw();
    else if (r.op) {
      this.ctx.save();
      kvDrawBoardOp(this.ctx, r.op, r.from ?? 0);
      this.ctx.restore();
    }
    if (ev.kind === 'clear') this.status.textContent = tr('{0} limpou o quadro', [ev.by]);
  }

  private redraw(): void {
    const c = this.ctx;
    c.save();
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, KV_BOARD_W, KV_BOARD_H);
    kvDrawBoardOps(c, this.ops);
    c.restore();
  }

  private setTool(t: KvBoardTool): void {
    this.tool = t;
    this.el.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === t));
    this.canvas.style.cursor = t === 'text' ? 'text' : 'crosshair';
    if (t !== 'text') this.hideText();
  }

  private setColor(c: string): void {
    this.color = c;
    if (this.tool === 'eraser') this.setTool('pen');
    this.el.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.classList.toggle('is-on', b.dataset.color === c));
  }

  private setSize(s: number): void {
    this.size = s;
    this.el.querySelectorAll<HTMLElement>('[data-size]').forEach((b) => b.classList.toggle('is-on', b.dataset.size === String(s)));
  }

  private point(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * KV_BOARD_W), y: Math.round(((e.clientY - r.top) / r.height) * KV_BOARD_H) };
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    const p = this.point(e);
    if (this.tool === 'text') {
      this.showText(p);
      return;
    }
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ponteiro já liberado
    }
    const size = this.tool === 'eraser' ? this.size * 3 : this.size;
    const op: KvBoardOp = { id: `${this.deps.me}:${rid()}`, tool: this.tool, color: this.tool === 'eraser' ? '#ffffff' : this.color, size, pts: [p.x, p.y], by: this.deps.me, at: Date.now() };
    this.ops.push(op);
    this.drawing = { op, sent: 0, created: false };
    this.ctx.save();
    kvDrawBoardOp(this.ctx, op);
    this.ctx.restore();
    this.scheduleFlush();
  }

  private move(e: PointerEvent): void {
    const d = this.drawing;
    if (!d) return;
    const p = this.point(e);
    const pts = d.op.pts!;
    if (Math.abs(pts[pts.length - 2]! - p.x) + Math.abs(pts[pts.length - 1]! - p.y) < 3) return;
    const from = pts.length;
    pts.push(p.x, p.y);
    this.ctx.save();
    kvDrawBoardOp(this.ctx, d.op, from);
    this.ctx.restore();
    this.scheduleFlush();
  }

  private up(_e: PointerEvent): void {
    if (!this.drawing) return;
    this.finish();
  }

  private finish(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.drawing) this.flush();
    this.drawing = null;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_MS);
  }

  /** Manda o que falta do traço atual (em ordem: o primeiro pedaço cria o traço, os outros acrescentam). */
  private flush(): void {
    const d = this.drawing;
    if (!d) return;
    const pts = d.op.pts!.slice(d.sent);
    if (!pts.length && d.created) return;
    d.sent = d.op.pts!.length;
    const first = !d.created;
    d.created = true;
    const cid = d.op.id.slice(this.deps.me.length + 1);
    const body = first
      ? { area: this.area, kind: 'op', op: { id: cid, tool: d.op.tool, color: d.op.tool === 'eraser' ? KV_BOARD_COLORS[0] : d.op.color, size: d.op.size, pts } }
      : { area: this.area, kind: 'op', append: true, op: { id: cid, pts } };
    this.send(body);
  }

  private send(body: unknown): void {
    this.chain = this.chain
      .then(() => fetch(BOARD_API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      .then(async (res) => {
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          this.status.textContent = b.error ?? tr('Não deu para salvar no quadro');
        }
      })
      .catch(() => {
        this.status.textContent = tr('Sem conexão: o quadro não foi salvo');
      });
  }

  private showText(p: { x: number; y: number }): void {
    this.textAt = p;
    const r = this.canvas.getBoundingClientRect();
    const stage = this.canvas.parentElement!.getBoundingClientRect();
    this.textInput.hidden = false;
    this.textInput.style.left = `${r.left - stage.left + (p.x / KV_BOARD_W) * r.width}px`;
    this.textInput.style.top = `${r.top - stage.top + (p.y / KV_BOARD_H) * r.height - 14}px`;
    this.textInput.style.color = this.color;
    this.textInput.value = '';
    this.textInput.focus();
  }

  private hideText(): void {
    this.textInput.hidden = true;
    this.textAt = null;
  }

  private placeText(): void {
    const text = this.textInput.value.trim();
    const at = this.textAt;
    this.hideText();
    if (!text || !at) return;
    const cid = rid();
    const op: KvBoardOp = { id: `${this.deps.me}:${cid}`, tool: 'text', color: this.color, size: TEXT_SIZE, pts: [at.x, at.y], text, by: this.deps.me, at: Date.now() };
    this.ops.push(op);
    this.ctx.save();
    kvDrawBoardOp(this.ctx, op);
    this.ctx.restore();
    this.send({ area: this.area, kind: 'op', op: { id: cid, tool: 'text', color: this.color, size: TEXT_SIZE, pts: [at.x, at.y], text } });
  }

  private undo(): void {
    this.finish();
    this.send({ area: this.area, kind: 'undo' });
  }

  private clear(): void {
    if (!confirm(tr('Limpar o quadro para todo mundo?'))) return;
    this.finish();
    this.send({ area: this.area, kind: 'clear' });
  }
}
