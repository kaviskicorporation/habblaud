// Fork Kaviski (KAVISKI-HUMANOS.md): janela de Atalhos das pessoas (lista em shortcuts-list.ts) e a mesma lista no
// começo da Ajuda do Habblaud (tecla ?), posta em tempo de execução — nenhum gancho no help.ts original.
//
// Cada grupo é um cartão com a cor e o ícone dele; as teclas são teclas 3D em pixel (o mouse é uma pílula). Abre com os
// cartões entrando um depois do outro; busca por texto ou tecla; filtro por grupo; "experimente": com a janela aberta,
// apertar uma tecla acende (e mostra) os atalhos dela.
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { KV_SHORTCUTS, kvKeyName, kvKeyParts, kvOnShortcuts, kvShortcutHit, type KvKey, type KvShortcut, type KvShortcutGroup } from './shortcuts-list';
import { KV_ICONS, kvBtn, kvInput } from './ui/kit';
import { KvModal } from './ui/modal';
import './shortcuts.css';

/** Ícones em pixel dos grupos (shortcuts-list.ts usa o nome). */
export const SHORTCUT_ICONS: Record<string, string> = {
  feet: pixelIcon(['.##.......', '####......', '####......', '####...##.', '.##...####', '......####', '.##...####', '####...##.', '####......', '.##.......']),
  chat: KV_ICONS.chat,
  hand: pixelIcon(['...#.#....', '.#.#.#.#..', '.#.#.#.#..', '.#.#.#.#..', '.#######.#', '.#######.#', '.#########', '.########.', '..######..', '...####...']),
  camera: pixelIcon(['...####...', '##########', '#........#', '#..####..#', '#.#....#.#', '#.#....#.#', '#..####..#', '#........#', '##########']),
  window: pixelIcon(['##########', '#.#.#....#', '##########', '#........#', '#........#', '#........#', '#........#', '##########']),
  ruler: pixelIcon(['##########', '#.#.#.#.##', '#.#.#.#.##', '#.......##', '##########', '......##..', '.....##...', '....##....', '...##.....', '..##......']),
  key: pixelIcon(['.####.....', '#....#####', '#.##.#####', '#....#.#.#', '.####..#..']),
  people: KV_ICONS.users,
  org: pixelIcon(['...####...', '...####...', '....##....', '..######..', '..#....#..', '.####.####', '.####.####']),
};

const KEY_TEXT: Record<string, () => string> = { Espaço: () => tr('Espaço'), Delete: () => tr('Delete'), Backspace: () => tr('Backspace') };

/** Uma parte que é mouse/toque ("clique", "arrastar"): palavra minúscula, não tecla. */
function isMouseWord(p: string): boolean {
  return p.length > 1 && /^\p{Ll}/u.test(p);
}

function keycap(p: string): HTMLElement {
  if (isMouseWord(p)) return h('span', { class: 'kv-sc-mouse', text: p });
  const text = KEY_TEXT[p]?.() ?? p;
  return h('kbd', { class: `kv-sc-key${text.length > 1 ? ' is-wide' : ''}${p === 'Espaço' ? ' is-space' : ''}`, text });
}

function keyNode(k: KvKey): HTMLElement {
  if (typeof k !== 'string') return h('span', { class: 'kv-sc-mouse', text: k.m });
  const parts = kvKeyParts(k);
  if (parts.length === 1) return keycap(parts[0]!);
  const el = h('span', { class: 'kv-sc-combo' });
  parts.forEach((p, i) => {
    if (i) el.append(h('span', { class: 'kv-sc-plus', text: '+' }));
    el.append(keycap(p));
  });
  return el;
}

function keysNode(s: KvShortcut): HTMLElement {
  const el = h('span', { class: 'kv-sc-keys' });
  const arrows = s.keys.length === 4 && s.keys.every((k) => typeof k === 'string' && /^[←↑→↓]$/.test(k));
  if (arrows) {
    // as setas em cruz, como no teclado
    el.classList.add('is-arrows');
    for (const k of ['', '↑', '', '←', '↓', '→']) el.append(k ? keycap(k) : h('span', { class: 'kv-sc-gap' }));
    return el;
  }
  s.keys.forEach((k, i) => {
    if (i) el.append(h('span', { class: 'kv-sc-or', text: s.range ? '…' : s.keys.length === 4 ? '' : tr('ou') }));
    el.append(keyNode(k));
  });
  return el;
}

function searchText(g: KvShortcutGroup, s: KvShortcut): string {
  const keys = s.keys.map((k) => (typeof k === 'string' ? `${k} ${KEY_TEXT[k]?.() ?? ''}` : k.m)).join(' ');
  return `${g.title} ${s.text} ${keys}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
}

function groupIcon(g: KvShortcutGroup): HTMLElement {
  const el = h('span', { class: 'kv-sc-group__ico', attrs: { 'aria-hidden': 'true' } });
  el.innerHTML = SHORTCUT_ICONS[g.icon] ?? SHORTCUT_ICONS.key!;
  return el;
}

/** Os cartões dos grupos (janela e Ajuda). */
function groupCards(team: boolean, compact: boolean): { el: HTMLElement; rows: { row: HTMLElement; s: KvShortcut; g: KvShortcutGroup; text: string }[]; cards: Map<string, HTMLElement> } {
  const rows: { row: HTMLElement; s: KvShortcut; g: KvShortcutGroup; text: string }[] = [];
  const cards = new Map<string, HTMLElement>();
  const el = h('div', { class: `kv-sc-grid${compact ? ' is-compact' : ''}` });
  let i = 0;
  for (const g of KV_SHORTCUTS) {
    if (g.only === 'team' && !team) continue;
    const items = g.items.filter((s) => team || s.only !== 'team');
    if (!items.length) continue;
    const list = h('ul', { class: 'kv-sc-list' });
    for (const s of items) {
      const row = h('li', { class: 'kv-sc-row' }, keysNode(s), h('span', { class: 'kv-sc-text', text: s.text }));
      rows.push({ row, s, g, text: searchText(g, s) });
      list.append(row);
    }
    const card = h(
      'section',
      { class: 'kv-sc-group', attrs: { 'data-group': g.key } },
      h('header', { class: 'kv-sc-group__head' }, groupIcon(g), h('h3', { class: 'kv-sc-group__title', text: g.title }), h('span', { class: 'kv-sc-group__n', text: String(items.length) })),
      list,
    );
    card.style.setProperty('--kv-sc', g.color);
    card.style.setProperty('--i', String(i++));
    cards.set(g.key, card);
    el.append(card);
  }
  return { el, rows, cards };
}

export class KvShortcutsDialog {
  private readonly modal: KvModal;
  private readonly search;
  private readonly chips: HTMLElement;
  private readonly holder: HTMLElement;
  private readonly tryBox: HTMLElement;
  private readonly empty: HTMLElement;
  private rows: { row: HTMLElement; s: KvShortcut; g: KvShortcutGroup; text: string }[] = [];
  private cards = new Map<string, HTMLElement>();
  private only: string | null = null;
  private tryTimer = 0;

  constructor(
    private readonly team: boolean,
    onTour: () => void,
  ) {
    this.modal = new KvModal({ title: tr('Atalhos do escritório'), subtitle: tr('Aperte qualquer tecla para achar o que ela faz.'), icon: SHORTCUT_ICONS.key, width: 980, cls: 'kv-sc' });
    this.search = kvInput({ placeholder: tr('Buscar: andar, sentar, Ctrl+Z…'), icon: KV_ICONS.search, type: 'search', onInput: () => this.filter() });
    this.search.input.addEventListener('keydown', (e) => e.stopPropagation());
    this.chips = h('div', { class: 'kv-sc-chips', role: 'group', attrs: { 'aria-label': tr('Grupos') } });
    this.tryBox = h('div', { class: 'kv-sc-try', attrs: { 'aria-live': 'polite' } });
    this.holder = h('div', { class: 'kv-sc-holder' });
    this.empty = h('p', { class: 'kv-sc-empty', text: tr('Nenhum atalho com isso.'), hidden: true });
    this.modal.body.append(h('div', { class: 'kv-sc-tools' }, this.search.el, this.tryBox), this.chips, this.holder, this.empty);
    this.modal.setFoot(
      h('span', { class: 'kv-sc-foot', text: tr('Botões do topo: conversas, agenda, modo foco, salas e (equipe) convidar visitantes.') }),
      kvBtn(tr('Ver o tour de boas-vindas de novo'), { icon: KV_ICONS.walk, onClick: () => (this.modal.close(), onTour()) }),
    );
    // "experimente": a tecla apertada com a janela aberta acende os atalhos dela (sem fazer nada no escritório)
    this.modal.el.addEventListener('keydown', (e) => this.tryKey(e));
    this.build();
    kvOnShortcuts(() => this.build());
    this.idle();
  }

  /** Mantido para quem usava `dialog.el`. */
  get el(): HTMLDialogElement {
    return this.modal.el;
  }

  open(): void {
    this.search.input.value = '';
    this.only = null;
    this.build();
    // a animação de entrada roda de novo a cada abertura
    this.holder.classList.remove('is-in');
    void this.holder.offsetWidth;
    this.holder.classList.add('is-in');
    this.modal.show();
    this.modal.el.focus();
  }

  private build(): void {
    const { el, rows, cards } = groupCards(this.team, false);
    this.rows = rows;
    this.cards = cards;
    this.holder.replaceChildren(el);
    const chip = (key: string | null, label: string, color?: string, icon?: string) => {
      const b = h('button', { class: `kv-sc-chip${this.only === key ? ' is-on' : ''}`, type: 'button', attrs: { 'aria-pressed': String(this.only === key) }, on: { click: () => ((this.only = key), this.build(), this.filter()) } });
      if (icon) {
        const ico = h('span', { class: 'kv-sc-chip__ico', attrs: { 'aria-hidden': 'true' } });
        ico.innerHTML = SHORTCUT_ICONS[icon] ?? '';
        b.append(ico);
      }
      b.append(h('span', { text: label }));
      if (color) b.style.setProperty('--kv-sc', color);
      return b;
    };
    this.chips.replaceChildren(chip(null, tr('Todos')), ...KV_SHORTCUTS.filter((g) => cards.has(g.key)).map((g) => chip(g.key, g.title, g.color, g.icon)));
    this.filter();
  }

  private filter(): void {
    const q = this.search.input.value.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
    let shown = 0;
    for (const r of this.rows) {
      const on = (!this.only || r.g.key === this.only) && (!q || r.text.includes(q));
      r.row.hidden = !on;
      if (on) shown++;
    }
    for (const [key, card] of this.cards) card.hidden = ![...card.querySelectorAll<HTMLElement>('.kv-sc-row')].some((x) => !x.hidden) || (!!this.only && key !== this.only);
    this.empty.hidden = shown > 0;
  }

  private idle(): void {
    this.tryBox.replaceChildren(h('span', { class: 'kv-sc-try__hint', text: tr('Experimente: aperte uma tecla') }), keycap('E'));
    this.tryBox.classList.remove('is-hit', 'is-miss');
  }

  private tryKey(e: KeyboardEvent): void {
    if (e.target === this.search.input || e.key === 'Tab' || e.key === 'Escape') return;
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement | null)?.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    const name = kvKeyName(e.key);
    const combo = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey && name !== 'Shift' && name.length > 1 ? 'Shift' : '', name].filter(Boolean);
    const hits = this.rows.filter((r) => kvShortcutHit(r.s, e) && (!r.row.hidden || !this.search.input.value));
    for (const r of this.rows) r.row.classList.remove('is-lit');
    if (hits.length) {
      // tira o filtro se o atalho estava escondido
      if (hits.some((r) => r.row.hidden)) {
        this.only = null;
        this.search.input.value = '';
        this.build();
        return this.tryKey(e);
      }
      for (const r of hits) {
        r.row.classList.remove('is-lit');
        void r.row.offsetWidth;
        r.row.classList.add('is-lit');
      }
      hits[0]!.row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const box = h('span', { class: 'kv-sc-combo' });
    combo.forEach((p, i) => {
      if (i) box.append(h('span', { class: 'kv-sc-plus', text: '+' }));
      box.append(keycap(p));
    });
    this.tryBox.replaceChildren(box, h('span', { class: 'kv-sc-try__hint', text: hits.length ? tr('{0} atalho(s)', [hits.length]) : tr('nada nesta tecla') }));
    this.tryBox.classList.toggle('is-hit', hits.length > 0);
    this.tryBox.classList.toggle('is-miss', !hits.length);
    clearTimeout(this.tryTimer);
    this.tryTimer = window.setTimeout(() => {
      for (const r of this.rows) r.row.classList.remove('is-lit');
      this.idle();
    }, 2600);
  }
}

/** Põe as teclas das pessoas no começo da Ajuda original (quando ela existir no DOM). */
export function kvInjectHelp(team: boolean): void {
  const section = () => h('section', { class: 'kv-keys__help kv-sc' }, h('h3', { text: tr('Pessoas no escritório: teclas') }), groupCards(team, true).el);
  const put = (): boolean => {
    const body = document.querySelector('dialog.ui-help .ui-dialog__body');
    if (!body) return false;
    if (body.querySelector('.kv-keys__help')) return true;
    const intro = body.querySelector('.ui-help__intro');
    const sec = section();
    if (intro) intro.after(sec);
    else body.prepend(sec);
    return true;
  };
  kvOnShortcuts(() => {
    const old = document.querySelector('dialog.ui-help .kv-keys__help');
    if (old) old.replaceWith(section());
  });
  if (put()) return;
  const obs = new MutationObserver(() => {
    if (put()) obs.disconnect();
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 60_000);
}
