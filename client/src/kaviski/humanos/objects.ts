// Fork Kaviski (KAVISKI-HUMANOS.md): objetos de parede no escritório — quadro branco (por sala), mural de avisos
// (recepção e cada sala) e links/documentos presos na parede.
//
// - Desenho: gancho de 1 linha no renderer (`kvDrawWallExtras`, logo depois dos itens de parede, antes dos móveis e da
//   luz): o mural de cortiça no lugar do pôster da sala (na recepção, no lugar do quadro), com papeizinhos e uma bolinha
//   vermelha quando há nota nova; o ícone de cada link; nas salas próprias, a miniatura do desenho no quadro branco.
// - Usar: tecla E perto (interact.ts) ou clique no objeto com o meu boneco na mesma área.
// - Dados: GET /api/kaviski/humanos/objects (já filtrado pelo servidor) e os eventos `objects` e `board` do fluxo de
//   presença (só chegam de áreas que esta pessoa vê).
import type { KvPerson } from '../../../../shared/kaviski-humanos';
import { KV_LINK_TITLE_MAX, KV_NOTE_MAX, kvIsOwnRoomId, kvSafeUrl, type KvBoardEvent, type KvBoardOp, type KvNote, type KvWallLink } from '../../../../shared/kaviski-rooms';
import { tr } from '../../../../shared/i18n';
import type { ArtModule } from '../../art/api';
import { h, iconButton } from '../../ui/dom';
import { ICONS } from '../../ui/icons';
import { TILE } from '../../world/constants';
import { opaqueBounds, wallItemOrigin, wallSprites, type AreaVis, type WallVis } from '../../world/render/scene';
import type { AreaLayout } from '../../world/layout/types';
import type { Sim } from '../../world/sim/sim';
import { kvRegisterInteract } from './interact';
import type { KvPresenceClient } from './presence';
import { kvApplyBoardEvent, kvDrawBoardOps, KvWhiteboard, BOARD_API } from './whiteboard';
import { kvPeople } from './world';

const OBJECTS_API = '/api/kaviski/humanos/objects';
const NOTES_API = '/api/kaviski/humanos/notes';
const LINKS_API = '/api/kaviski/humanos/links';
const SEEN_KEY = 'kv-mural-seen';
/** Alcance da tecla E (px de mundo, dos pés até a frente do objeto). */
const REACH = 1.7 * TILE;
const PAPER = ['#fff3a3', '#ffc9de', '#bfe3ff', '#c8f0c4', '#ffd8a8', '#e3d4ff'];

let me: KvPerson | null = null;
let active = false;
let notes: KvNote[] = [];
let links: KvWallLink[] = [];
let boards: Record<string, { count: number; rev: number; at: number }> = {};
let seen: Record<string, number> = {};
const boardListeners = new Set<(ev: KvBoardEvent) => void>();
/** Miniaturas dos quadros das salas próprias (desenhadas na parede). */
const thumbs = new Map<string, { rev: number; ops: KvBoardOp[]; canvas: HTMLCanvasElement | null; loading: boolean }>();
let board: KvWhiteboard | null = null;
let mural: KvMuralDialog | null = null;

/** Área (chat/voz/objetos) de uma área do layout: sala `r:<id>`, núcleo `a:<id>`; corredor não tem objetos. */
export function kvAreaKey(layout: Pick<AreaLayout, 'id' | 'kind'>): string | null {
  if (layout.kind === 'room') return `r:${layout.id}`;
  if (layout.kind === 'corridor') return null;
  return `a:${layout.id}`;
}

function loadSeen(): void {
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    seen = {};
  }
}

function markSeen(area: string): void {
  const last = Math.max(0, ...notes.filter((n) => n.area === area).map((n) => n.at));
  seen[area] = Math.max(seen[area] ?? 0, last, Date.now());
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // sem localStorage: só nesta página
  }
}

/** Notas novas (de outras pessoas, depois da última vez que abri o mural). */
export function kvNewNotes(area: string): number {
  const t = seen[area] ?? 0;
  return notes.filter((n) => n.area === area && n.at > t && n.by.id !== me?.id).length;
}

async function reload(): Promise<void> {
  try {
    const res = await fetch(OBJECTS_API, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    const b = (await res.json()) as { notes: KvNote[]; links: KvWallLink[]; boards: typeof boards };
    notes = b.notes ?? [];
    links = b.links ?? [];
    boards = b.boards ?? {};
  } catch {
    return;
  }
  for (const [area, t] of thumbs) if ((boards[area]?.rev ?? 0) !== t.rev) thumbs.delete(area);
  mural?.refresh();
}

// ------------------------------------------------------------------ onde estão os objetos no prédio

interface Anchor {
  area: string;
  kind: 'mural' | 'board' | 'link';
  /** Retângulo do objeto na parede (px de mundo) e o ponto em frente a ele (onde o boneco fica). */
  rect: { x: number; y: number; w: number; h: number };
  front: { x: number; y: number };
  name: string;
  link?: KvWallLink;
}

function areaName(sim: Sim, layout: AreaLayout): string {
  if (layout.kind === 'room') return sim.rooms.get(layout.id)?.info.name ?? layout.id;
  return (
    {
      reception: tr('Recepção'),
      cafe: tr('Copa'),
      lounge: tr('Lounge'),
      restroom: tr('Banheiros'),
    } as Record<string, string>
  )[layout.kind] ?? layout.id;
}

/** O pôster (sala) ou o quadro (recepção) onde fica o mural de avisos. */
function muralItem(layout: AreaLayout): AreaLayout['wallItems'][number] | undefined {
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

/** Os objetos das áreas presentes no prédio (para a tecla E e o clique). */
function anchors(sim: Sim): Anchor[] {
  const out: Anchor[] = [];
  const layouts: AreaLayout[] = [...sim.building.core];
  for (const rs of sim.rooms.values()) if (rs.present && !rs.ghost) layouts.push(rs.layout);
  for (const layout of layouts) {
    const area = kvAreaKey(layout);
    if (!area) continue;
    const name = areaName(sim, layout);
    const m = muralItem(layout);
    if (m) {
      const r = wallRect(artRef, m);
      out.push({ area, kind: 'mural', rect: r, front: { x: m.cx, y: m.baseY + 10 }, name });
    }
    if (layout.kind === 'room') {
      for (const w of layout.wallItems) {
        if (w.kind !== 'whiteboard') continue;
        const r = wallRect(artRef, w);
        out.push({ area, kind: 'board', rect: r, front: { x: w.cx, y: w.baseY + 10 }, name });
      }
    }
    for (const l of links) {
      if (l.area !== area) continue;
      const cx = (layout.rect.x + l.x) * TILE;
      const baseY = (layout.rect.y + 2) * TILE;
      out.push({ area, kind: 'link', rect: linkRect(cx, baseY), front: { x: cx, y: baseY + 10 }, name, link: l });
    }
  }
  return out;
}

function linkRect(cx: number, baseY: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(cx - 4), y: baseY - 21, w: 9, h: 11 };
}

function use(a: Anchor): void {
  if (a.kind === 'link' && a.link) openLink(a.link.url);
  else if (a.kind === 'mural') (mural ??= new KvMuralDialog()).open(a.area, a.name);
  else if (a.kind === 'board' && me) {
    board ??= new KvWhiteboard({ me: me.id, canClear: me.role === 'admin' || me.role === 'equipe', onBoard: (cb) => (boardListeners.add(cb), () => void boardListeners.delete(cb)) });
    void board.open(a.area, a.name);
  }
}

function openLink(url: string): void {
  const safe = kvSafeUrl(url);
  if (!safe) return;
  const w = window.open(safe, '_blank', 'noopener,noreferrer');
  if (w) w.opener = null;
}

const LABEL = {
  mural: () => tr('Mural de avisos'),
  board: () => tr('Quadro branco'),
};

// ------------------------------------------------------------------ desenho na parede (gancho do renderer)

let artRef: ArtModule | null = null;

/** Gancho do renderer (drawWalls): o mural, os links e a miniatura do quadro desta área. */
export function kvDrawWallExtras(ctx: CanvasRenderingContext2D, art: ArtModule, vis: AreaVis, rise: number, now: number): void {
  if (!active) return;
  artRef = art;
  const layout = vis.layout;
  const area = kvAreaKey(layout);
  if (!area) return;
  const m = muralItem(layout);
  if (m) drawMural(ctx, wallRect(art, m), area, rise, now);
  if (layout.kind === 'room') {
    for (const w of layout.wallItems) if (w.kind === 'whiteboard') drawBoardThumb(ctx, art, w, area, rise);
  }
  for (const l of links) {
    if (l.area !== area) continue;
    const r = linkRect((layout.rect.x + l.x) * TILE, (layout.rect.y + 2) * TILE);
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
  const mine = notes.filter((n) => n.area === area);
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
  const info = boards[area];
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

function onBoardEvent(ev: KvBoardEvent): void {
  const info = (boards[ev.area] ??= { count: 0, rev: 0, at: 0 });
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
  for (const cb of boardListeners) cb(ev);
}

// ------------------------------------------------------------------ mural (notas e links da área)

class KvMuralDialog {
  readonly el: HTMLDialogElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private readonly text: HTMLTextAreaElement;
  private readonly noteForm: HTMLFormElement;
  private readonly linkList: HTMLElement;
  private readonly linkForm: HTMLFormElement;
  private readonly linkTitle: HTMLInputElement;
  private readonly linkUrl: HTMLInputElement;
  private readonly error: HTMLElement;
  private area = '';

  constructor() {
    this.title = h('h2', { text: tr('Mural de avisos') });
    this.list = h('ul', { class: 'kv-mural__list' });
    this.text = h('textarea', { class: 'kv-people__input', attrs: { rows: '3', maxlength: String(KV_NOTE_MAX), placeholder: tr('Escreva um aviso curto…') } });
    this.noteForm = h(
      'form',
      { class: 'kv-mural__form', on: { submit: (e: Event) => void this.addNote(e) } },
      this.text,
      h('div', { class: 'kv-people__actions' }, h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: tr('Fixar no mural') })),
    );
    this.linkList = h('ul', { class: 'kv-mural__links' });
    this.linkTitle = h('input', { class: 'kv-people__input', attrs: { maxlength: String(KV_LINK_TITLE_MAX), placeholder: tr('Título (ex.: Planilha de horas)'), required: 'true' } });
    this.linkUrl = h('input', { class: 'kv-people__input', attrs: { type: 'url', placeholder: 'https://…', required: 'true', spellcheck: 'false' } });
    this.linkForm = h(
      'form',
      { class: 'kv-mural__form', on: { submit: (e: Event) => void this.addLink(e) } },
      h('label', { class: 'kv-people__label', text: tr('Prender um link na parede (fica onde o seu boneco está)') }),
      this.linkTitle,
      this.linkUrl,
      h('div', { class: 'kv-people__actions' }, h('button', { class: 'ui-btn', type: 'submit', text: tr('Prender link') })),
    );
    this.error = h('p', { class: 'kv-people__error', attrs: { role: 'alert' } });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    this.el = h(
      'dialog',
      { class: 'ui-dialog kv-mural' },
      h('div', { class: 'ui-dialog__head' }, this.title, close),
      h(
        'div',
        { class: 'ui-dialog__body kv-mural__body' },
        h('section', {}, this.list, this.noteForm),
        h('section', {}, h('h3', { text: tr('Links desta parede') }), this.linkList, this.linkForm),
        this.error,
      ),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
  }

  open(area: string, name: string): void {
    this.area = area;
    this.title.textContent = tr('Mural de avisos · {0}', [name]);
    this.error.textContent = '';
    this.refresh();
    if (!this.el.open) this.el.showModal();
    markSeen(area);
  }

  refresh(): void {
    if (!this.area) return;
    const restricted = me?.role !== 'admin' && me?.role !== 'equipe';
    this.noteForm.hidden = restricted && !this.area.startsWith('r:');
    this.linkForm.hidden = restricted;
    const mine = notes.filter((n) => n.area === this.area).sort((a, b) => b.at - a.at);
    this.list.replaceChildren(
      ...mine.map((n) =>
        h(
          'li',
          { class: 'kv-mural__note', style: `--paper:${PAPER[n.id.charCodeAt(0) % PAPER.length]}` },
          h('p', { class: 'kv-mural__text', text: n.text }),
          h(
            'div',
            { class: 'kv-mural__meta' },
            h('span', { text: `${n.by.name} · ${new Date(n.at).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` }),
            n.by.id === me?.id || me?.role === 'admin' || this.moderator() ? h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Apagar'), on: { click: () => void this.remove(NOTES_API, n.id) } }) : null,
          ),
        ),
      ),
    );
    if (!mine.length) this.list.append(h('li', { class: 'kv-people__hint', text: tr('Nenhum aviso ainda.') }));
    const ls = links.filter((l) => l.area === this.area);
    this.linkList.replaceChildren(
      ...ls.map((l) =>
        h(
          'li',
          { class: 'kv-mural__link' },
          h('a', { text: l.title, attrs: { href: kvSafeUrl(l.url) ?? '#', target: '_blank', rel: 'noopener noreferrer' } }),
          h('span', { class: 'kv-people__hint', text: l.by.name }),
          l.by.id === me?.id || me?.role === 'admin' || this.moderator() ? h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Tirar'), on: { click: () => void this.remove(LINKS_API, l.id) } }) : null,
        ),
      ),
    );
    if (!ls.length) this.linkList.append(h('li', { class: 'kv-people__hint', text: tr('Nenhum link nesta parede.') }));
    if (this.el.open) markSeen(this.area);
  }

  /** Dono da sala própria (o servidor confere de novo). */
  private moderator(): boolean {
    const id = this.area.slice(2);
    const info = kvPeople.sim?.().rooms.get(id)?.info as { kvOwn?: { owner?: string } } | undefined;
    return kvIsOwnRoomId(id) && !!me && info?.kvOwn?.owner === me.id && me.role !== 'cliente';
  }

  private async post(url: string, body: unknown): Promise<boolean> {
    this.error.textContent = '';
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) return true;
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      this.error.textContent = b.error ?? res.statusText;
    } catch {
      this.error.textContent = tr('Sem conexão com o servidor.');
    }
    return false;
  }

  private async addNote(e: Event): Promise<void> {
    e.preventDefault();
    const text = this.text.value.trim();
    if (!text) return;
    if (await this.post(NOTES_API, { area: this.area, text })) {
      this.text.value = '';
      await reload();
    }
  }

  private async addLink(e: Event): Promise<void> {
    e.preventDefault();
    const url = kvSafeUrl(this.linkUrl.value);
    if (!url) {
      this.error.textContent = tr('endereço inválido (use http:// ou https://)');
      return;
    }
    if (await this.post(LINKS_API, { area: this.area, x: this.wallX(), title: this.linkTitle.value, url })) {
      this.linkTitle.value = '';
      this.linkUrl.value = '';
      await reload();
    }
  }

  /** Onde o link fica na parede: a coluna do meu boneco na área (ou uma vaga livre perto da porta). */
  private wallX(): number {
    const sim = kvPeople.sim?.();
    const pos = kvPeople.locate?.(null);
    const layout = sim && layoutOf(sim, this.area);
    if (!layout) return 2;
    const used = links.filter((l) => l.area === this.area).map((l) => l.x);
    let x = pos ? pos.x / TILE - layout.rect.x : 2;
    x = Math.max(1, Math.min(15, Math.round(x * 2) / 2));
    // não em cima de outro link
    for (let i = 0; i < 30 && used.some((u) => Math.abs(u - x) < 0.75); i++) x = x + 0.75 > 15 ? 1 : x + 0.75;
    return x;
  }

  private async remove(api: string, id: string): Promise<void> {
    if (!confirm(tr('Apagar?'))) return;
    try {
      const res = await fetch(`${api}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        this.error.textContent = b.error ?? res.statusText;
      }
    } catch {
      this.error.textContent = tr('Sem conexão com o servidor.');
    }
    await reload();
  }
}

function layoutOf(sim: Sim, area: string): AreaLayout | undefined {
  if (area.startsWith('r:')) return sim.rooms.get(area.slice(2))?.layout;
  return sim.building.core.find((a) => `a:${a.id}` === area);
}

// ------------------------------------------------------------------ começo

export function kvStartObjects(client: KvPresenceClient, person: KvPerson): void {
  if (active) return;
  active = true;
  me = person;
  loadSeen();
  void reload();
  const es = (client as unknown as { es: EventSource | null }).es;
  const parse = (ev: Event): unknown => {
    try {
      return JSON.parse((ev as MessageEvent<string>).data);
    } catch {
      return null;
    }
  };
  es?.addEventListener('objects', () => void reload());
  es?.addEventListener('board', (ev) => {
    const d = parse(ev) as KvBoardEvent | null;
    if (d && typeof d.area === 'string') onBoardEvent(d);
  });
  // salas mudaram (uma sala própria nova traz o mural dela) ou reconectou
  es?.addEventListener('rooms', () => void reload());
  let opened = false;
  es?.addEventListener('open', () => {
    if (opened) void reload();
    opened = true;
  });

  // tecla E: o objeto mais perto do meu boneco
  kvRegisterInteract((pos) => {
    const sim = kvPeople.sim?.();
    if (!sim || !kvPeople.area) return null;
    let best: { a: Anchor; d: number } | null = null;
    for (const a of anchors(sim)) {
      if (a.area !== kvPeople.area) continue;
      const d = Math.hypot(a.front.x - pos.x, a.front.y - pos.y);
      if (d <= REACH && (!best || d < best.d)) best = { a, d };
    }
    if (!best) return null;
    const a = best.a;
    const fresh = a.kind === 'mural' ? kvNewNotes(a.area) : 0;
    const label = a.kind === 'link' ? tr('Abrir “{0}”', [a.link!.title]) : fresh ? tr('{0} ({1} novo)', [LABEL.mural(), fresh]) : LABEL[a.kind]();
    return { id: `${a.kind}:${a.area}:${a.link?.id ?? ''}`, label, dist: best.d, run: () => use(a) };
  });

  // clique no objeto (com o meu boneco na mesma área): usa, e o clique não vira "andar até lá"
  const canvas = document.getElementById('world');
  let swallow: number | null = null;
  canvas?.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || !kvPeople.inside || !kvPeople.area) return;
      const sim = kvPeople.sim?.();
      const p = kvPeople.locate?.(null);
      if (!sim || !p) return;
      const wx = p.x + (e.clientX - p.sx) / p.zoom;
      const wy = p.y + (e.clientY - p.sy) / p.zoom;
      const hit = anchors(sim).find((a) => a.area === kvPeople.area && wx >= a.rect.x - 1 && wx <= a.rect.x + a.rect.w + 1 && wy >= a.rect.y - 1 && wy <= a.rect.y + a.rect.h + 1);
      if (!hit) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      swallow = e.pointerId;
      use(hit);
    },
    true,
  );
  canvas?.addEventListener(
    'pointerup',
    (e) => {
      if (swallow === e.pointerId) {
        swallow = null;
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}
