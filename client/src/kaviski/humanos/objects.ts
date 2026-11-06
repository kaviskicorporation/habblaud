// Fork Kaviski (KAVISKI-HUMANOS.md): objetos de parede no escritório — quadro branco (por sala), mural de avisos
// (recepção e cada sala) e links/documentos presos na parede.
//
// - Desenho no mundo: wall-draw.ts (gancho de 1 linha no renderer).
// - Usar: tecla E perto (interact.ts) ou clique no objeto com o meu boneco na mesma área.
// - Dados: GET /api/kaviski/humanos/objects (já filtrado pelo servidor) e os eventos `objects` e `board` do fluxo de
//   presença (só chegam de áreas que esta pessoa vê).
import type { KvPerson } from '../../../../shared/kaviski-humanos';
import { KV_LINK_TITLE_MAX, KV_NOTE_MAX, kvIsOwnRoomId, kvSafeUrl, type KvBoardEvent, type KvBoardOp, type KvNote, type KvWallLink } from '../../../../shared/kaviski-rooms';
import { tr } from '../../../../shared/i18n';
import { FURNITURE } from '../../art/api';
import { h, iconButton } from '../../ui/dom';
import { ICONS } from '../../ui/icons';
import { TILE } from '../../world/constants';
import type { AreaLayout } from '../../world/layout/types';
import type { Sim } from '../../world/sim/sim';
import { kvRegisterInteract } from './interact';
import type { KvPresenceClient } from './presence';
import { KvWhiteboard } from './whiteboard';
import { kvAreaKey, kvLinkRect, kvMuralItem, kvNewNotes, kvWall, kvWallBoardEvent, kvWallRect, kvWallResetThumbs, PAPER } from './wall-draw';
import { kvPeople } from './world';

const OBJECTS_API = '/api/kaviski/humanos/objects';
const NOTES_API = '/api/kaviski/humanos/notes';
const LINKS_API = '/api/kaviski/humanos/links';
const SEEN_KEY = 'kv-mural-seen';
/** Alcance da tecla E (px de mundo, dos pés até a frente do objeto). */
const REACH = 1.7 * TILE;

const boardListeners = new Set<(ev: KvBoardEvent) => void>();
let board: KvWhiteboard | null = null;
let mural: KvMuralDialog | null = null;

function loadSeen(): void {
  try {
    kvWall.seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    kvWall.seen = {};
  }
}

function markSeen(area: string): void {
  const last = Math.max(0, ...kvWall.notes.filter((n) => n.area === area).map((n) => n.at));
  kvWall.seen[area] = Math.max(kvWall.seen[area] ?? 0, last, Date.now());
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(kvWall.seen));
  } catch {
    // sem localStorage: só nesta página
  }
}

async function reload(): Promise<void> {
  try {
    const res = await fetch(OBJECTS_API, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    const b = (await res.json()) as { notes: KvNote[]; links: KvWallLink[]; boards: typeof kvWall.boards };
    kvWall.notes = b.notes ?? [];
    kvWall.links = b.links ?? [];
    kvWall.boards = b.boards ?? {};
  } catch {
    return;
  }
  kvWallResetThumbs();
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

/** Os objetos das áreas presentes no prédio (para a tecla E e o clique). */
function anchors(sim: Sim): Anchor[] {
  const out: Anchor[] = [];
  const layouts: AreaLayout[] = [...sim.building.core];
  for (const rs of sim.rooms.values()) if (rs.present && !rs.ghost) layouts.push(rs.layout);
  for (const layout of layouts) {
    const area = kvAreaKey(layout);
    if (!area) continue;
    const name = areaName(sim, layout);
    const m = kvMuralItem(layout);
    if (m) {
      const r = kvWallRect(kvWall.art, m);
      out.push({ area, kind: 'mural', rect: r, front: { x: m.cx, y: m.baseY + 10 }, name });
    }
    if (layout.kind === 'room') {
      for (const w of layout.wallItems) {
        if (w.kind !== 'whiteboard') continue;
        const r = kvWallRect(kvWall.art, w);
        out.push({ area, kind: 'board', rect: r, front: { x: w.cx, y: w.baseY + 10 }, name });
      }
    }
    for (const l of kvWall.links) {
      if (l.area !== area) continue;
      const cx = (layout.rect.x + l.x) * TILE;
      const baseY = (layout.rect.y + 2) * TILE;
      out.push({ area, kind: 'link', rect: kvLinkRect(cx, baseY), front: { x: cx, y: baseY + 10 }, name, link: l });
    }
  }
  return out;
}

function use(a: Anchor): void {
  if (a.kind === 'link' && a.link) openLink(a.link.url);
  else if (a.kind === 'mural') (mural ??= new KvMuralDialog()).open(a.area, a.name);
  else if (a.kind === 'board' && kvWall.me) {
    board ??= new KvWhiteboard({ me: kvWall.me.id, canClear: kvWall.me.role === 'admin' || kvWall.me.role === 'equipe', onBoard: (cb) => (boardListeners.add(cb), () => void boardListeners.delete(cb)) });
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

function onBoardEvent(ev: KvBoardEvent): void {
  kvWallBoardEvent(ev);
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
    const restricted = kvWall.me?.role !== 'admin' && kvWall.me?.role !== 'equipe';
    this.noteForm.hidden = restricted && !this.area.startsWith('r:');
    this.linkForm.hidden = restricted;
    const mine = kvWall.notes.filter((n) => n.area === this.area).sort((a, b) => b.at - a.at);
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
            n.by.id === kvWall.me?.id || kvWall.me?.role === 'admin' || this.moderator() ? h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Apagar'), on: { click: () => void this.remove(NOTES_API, n.id) } }) : null,
          ),
        ),
      ),
    );
    if (!mine.length) this.list.append(h('li', { class: 'kv-people__hint', text: tr('Nenhum aviso ainda.') }));
    const ls = kvWall.links.filter((l) => l.area === this.area);
    this.linkList.replaceChildren(
      ...ls.map((l) =>
        h(
          'li',
          { class: 'kv-mural__link' },
          h('a', { text: l.title, attrs: { href: kvSafeUrl(l.url) ?? '#', target: '_blank', rel: 'noopener noreferrer' } }),
          h('span', { class: 'kv-people__hint', text: l.by.name }),
          l.by.id === kvWall.me?.id || kvWall.me?.role === 'admin' || this.moderator() ? h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Tirar'), on: { click: () => void this.remove(LINKS_API, l.id) } }) : null,
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
    return kvIsOwnRoomId(id) && !!kvWall.me && info?.kvOwn?.owner === kvWall.me.id && kvWall.me.role !== 'cliente';
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

  /**
   * Onde o link fica na parede: o trecho livre mais perto do meu boneco (fora da placa, quadro, mural, janela e
   * porta; longe dos outros links).
   */
  private wallX(): number {
    const sim = kvPeople.sim?.();
    const pos = kvPeople.locate?.(null);
    const layout = sim && layoutOf(sim, this.area);
    if (!layout) return 2;
    return kvFreeWallX(layout, kvWall.links.filter((l) => l.area === this.area).map((l) => l.x), pos ? pos.x / TILE - layout.rect.x : 2);
  }

  private async remove(api: string, id: string): Promise<void> {
    if (!confirm(tr('Apagar?'))) return;
    try {
      const res = await fetch(`${api}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
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

/** Trecho livre da parede norte (tiles locais) mais perto de `want`; `want` arredondado se nada servir. */
export function kvFreeWallX(layout: Pick<AreaLayout, 'rect' | 'wallItems' | 'furniture'>, used: readonly number[], want: number): number {
  const spans = layout.wallItems
    .filter((w) => w.on === 'face')
    .map((w) => {
      const half = FURNITURE[w.kind].footprint.w / 2;
      const cx = w.cx / TILE - layout.rect.x;
      return [cx - half - 0.1, cx + half + 0.1] as const;
    });
  // móveis encostados na parede (estante, planta alta...) cobririam o ícone
  for (const f of layout.furniture) {
    if (f.ty - layout.rect.y !== 2 || FURNITURE[f.kind].mount !== 'floor') continue;
    const x = f.tx - layout.rect.x;
    spans.push([x - 0.1, x + FURNITURE[f.kind].footprint.w + 0.1]);
  }
  const free = (x: number) => !spans.some(([a, b]) => x + 0.3 > a && x - 0.3 < b) && !used.some((u) => Math.abs(u - x) < 0.75);
  const start = Math.max(1, Math.min(15, Math.round(want * 2) / 2));
  for (let d = 0; d <= 14; d += 0.5) {
    for (const x of [start - d, start + d]) if (x >= 1 && x <= 15 && free(x)) return x;
  }
  return start;
}

function layoutOf(sim: Sim, area: string): AreaLayout | undefined {
  if (area.startsWith('r:')) return sim.rooms.get(area.slice(2))?.layout;
  return sim.building.core.find((a) => `a:${a.id}` === area);
}

// ------------------------------------------------------------------ começo

export function kvStartObjects(client: KvPresenceClient, person: KvPerson): void {
  if (kvWall.active) return;
  kvWall.active = true;
  kvWall.me = person;
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
