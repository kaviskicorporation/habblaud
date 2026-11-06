// Fork Kaviski (KAVISKI-HUMANOS.md): select e multisseleção próprios (nunca o <select> nativo), no tema do Habblaud.
//
// Teclado: no botão, ↓/↑/Enter/Espaço abrem; na lista, ↑/↓ andam, Home/End vão às pontas, Enter escolhe, Esc fecha,
// Tab fecha e segue. Com muitas opções (ou `search: true`), a lista abre com uma busca no topo; sem busca, digitar
// pula para a opção que começa com as letras (como no select nativo). ARIA: combobox + listbox + option.
// A lista abre na camada certa: dentro de um <dialog> aberto ela vai para o próprio diálogo (a camada do topo).
import { tr } from '../../../../../shared/i18n';
import { h } from '../../../ui/dom';
import { KV_ICONS } from './icons';
import { kvChip, kvLayerFor } from './kit';

export interface KvOption<T extends string = string> {
  value: T;
  label: string;
  /** Linha menor embaixo do rótulo. */
  hint?: string;
  /** Elemento à esquerda (avatar, bolinha) ou SVG. */
  icon?: HTMLElement | string;
  disabled?: boolean;
  /** Texto extra só para a busca (ex.: o caminho da pasta). */
  keywords?: string;
}

/** Filtra opções pela busca (sem acentos, sem caixa). */
export function kvFilterOptions<T extends string>(opts: readonly KvOption<T>[], q: string): KvOption<T>[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
  const n = norm(q.trim());
  if (!n) return [...opts];
  return opts.filter((o) => norm(`${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`).includes(n));
}

const SEARCH_FROM = 8;
let seq = 0;

function iconNode(icon: HTMLElement | string | undefined): HTMLElement | null {
  if (!icon) return null;
  if (typeof icon !== 'string') return icon.cloneNode(true) as HTMLElement;
  const s = h('span', { class: 'kv-ui-ico', attrs: { 'aria-hidden': 'true' } });
  s.innerHTML = icon;
  return s;
}

/** A lista que abre embaixo do botão (compartilhada pelo select e pela multisseleção). */
class KvPopList<T extends string> {
  readonly el: HTMLElement;
  readonly list: HTMLElement;
  private readonly search: HTMLInputElement | null;
  private readonly footer: HTMLElement;
  private shown: KvOption<T>[] = [];
  private active = -1;
  private anchor: HTMLElement | null = null;
  private typed = '';
  private typedAt = 0;
  readonly id = `kv-ui-list${++seq}`;
  onPick: (o: KvOption<T>) => void = () => {};
  onClose: () => void = () => {};
  /** Opção "usar o que digitei" (multisseleção com valores livres). */
  custom: ((q: string) => KvOption<T> | null) | null = null;

  constructor(
    private options: () => KvOption<T>[],
    private readonly selected: (v: T) => boolean,
    withSearch: boolean,
    private readonly multi: boolean,
    placeholder: string,
  ) {
    this.search = withSearch
      ? h('input', { class: 'kv-ui-pop__search', type: 'search', attrs: { placeholder, 'aria-label': placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-controls': this.id } })
      : null;
    this.list = h('ul', { class: 'kv-ui-pop__list', role: 'listbox', attrs: { id: this.id, ...(multi ? { 'aria-multiselectable': 'true' } : {}) } });
    this.footer = h('p', { class: 'kv-ui-pop__empty', text: tr('Nada encontrado.'), hidden: true });
    this.el = h('div', { class: 'kv-ui-pop', hidden: true }, this.search ? h('div', { class: 'kv-ui-pop__head' }, this.search) : null, this.list, this.footer);
    this.search?.addEventListener('input', () => this.render(0));
    this.el.addEventListener('keydown', (e) => this.key(e));
    // a lista não rouba o foco do botão/busca ao clicar
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target !== this.search) e.preventDefault();
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(anchor: HTMLElement): void {
    this.anchor = anchor;
    kvLayerFor(anchor).append(this.el);
    this.el.hidden = false;
    if (this.search) this.search.value = '';
    const sel = this.options().findIndex((o) => this.selected(o.value));
    this.render(Math.max(0, sel));
    this.place();
    this.search?.focus({ preventScroll: true });
    this.scrollActive();
    document.addEventListener('pointerdown', this.outside, true);
    window.addEventListener('resize', this.closeNow);
    window.addEventListener('scroll', this.onScroll, true);
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    document.removeEventListener('pointerdown', this.outside, true);
    window.removeEventListener('resize', this.closeNow);
    window.removeEventListener('scroll', this.onScroll, true);
    this.onClose();
  }

  private readonly closeNow = () => this.hide();
  // a página (ou o painel) rolou: a lista acompanha o botão; se ele saiu da tela, fecha
  private readonly onScroll = (e: Event) => {
    if (this.el.contains(e.target as Node) || !this.anchor) return;
    const r = this.anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) this.hide();
    else this.place();
  };
  private readonly outside = (e: Event) => {
    const t = e.target as Node;
    if (!this.el.contains(t) && !this.anchor?.contains(t)) this.hide();
  };

  /** Abaixo do botão (ou acima, se não cabe), da mesma largura (mínimo 220 px). */
  private place(): void {
    if (!this.anchor) return;
    const r = this.anchor.getBoundingClientRect();
    const w = Math.max(r.width, 220);
    const vh = window.innerHeight;
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const want = Math.min(this.el.scrollHeight, 320);
    const up = below < Math.min(want, 200) && above > below;
    const maxH = Math.max(120, Math.min(320, up ? above - 6 : below - 6));
    this.el.style.width = `${Math.round(w)}px`;
    this.el.style.maxHeight = `${Math.round(maxH)}px`;
    this.el.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left)))}px`;
    if (up) {
      this.el.style.top = '';
      this.el.style.bottom = `${Math.round(vh - r.top + 6)}px`;
    } else {
      this.el.style.bottom = '';
      this.el.style.top = `${Math.round(r.bottom + 6)}px`;
    }
  }

  render(active = this.active): void {
    const q = this.search?.value ?? '';
    this.shown = kvFilterOptions(this.options(), q);
    const extra = q.trim() && this.custom ? this.custom(q.trim()) : null;
    if (extra && !this.shown.some((o) => o.value === extra.value)) this.shown.push(extra);
    this.active = Math.min(active, this.shown.length - 1);
    this.list.replaceChildren(
      ...this.shown.map((o, i) => {
        const on = this.selected(o.value);
        const li = h(
          'li',
          {
            class: `kv-ui-pop__opt${on ? ' is-on' : ''}${i === this.active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`,
            role: 'option',
            attrs: { id: `${this.id}-${i}`, 'aria-selected': String(on), ...(o.disabled ? { 'aria-disabled': 'true' } : {}) },
            on: {
              click: () => this.pick(i),
              pointermove: () => this.setActive(i, false),
            },
          },
          this.multi ? h('span', { class: `kv-ui-pop__box${on ? ' is-on' : ''}` }) : null,
          iconNode(o.icon),
          h('span', { class: 'kv-ui-pop__text' }, h('span', { class: 'kv-ui-pop__label', text: o.label }), o.hint ? h('span', { class: 'kv-ui-pop__hint', text: o.hint }) : null),
        );
        if (!this.multi && on) {
          const c = h('span', { class: 'kv-ui-pop__check', attrs: { 'aria-hidden': 'true' } });
          c.innerHTML = KV_ICONS.check;
          li.append(c);
        }
        return li;
      }),
    );
    this.footer.hidden = this.shown.length > 0;
    this.syncActive();
  }

  private syncActive(): void {
    const id = this.active >= 0 ? `${this.id}-${this.active}` : '';
    (this.search ?? this.anchor)?.setAttribute('aria-activedescendant', id);
  }

  private setActive(i: number, scroll = true): void {
    if (i === this.active) return;
    this.list.children[this.active]?.classList.remove('is-active');
    this.active = i;
    this.list.children[i]?.classList.add('is-active');
    this.syncActive();
    if (scroll) this.scrollActive();
  }

  private scrollActive(): void {
    (this.list.children[this.active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }

  private pick(i: number): void {
    const o = this.shown[i];
    if (!o || o.disabled) return;
    this.onPick(o);
    if (this.multi) this.render(i);
  }

  /** Teclas vindas do botão (lista fechada ou aberta sem busca) ou da busca. true = tratou. */
  key(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    const n = this.shown.length;
    const move = (i: number) => {
      e.preventDefault();
      if (n) this.setActive((i + n) % n);
    };
    switch (e.key) {
      case 'ArrowDown':
        move(this.active + 1);
        return true;
      case 'ArrowUp':
        move(this.active - 1);
        return true;
      case 'Home':
        if (this.search && e.target === this.search) return false;
        move(0);
        return true;
      case 'End':
        if (this.search && e.target === this.search) return false;
        move(n - 1);
        return true;
      case 'Enter':
        e.preventDefault();
        this.pick(this.active);
        return true;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        this.anchor?.focus();
        return true;
      case 'Tab':
        this.hide();
        return false;
    }
    if (!this.search && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = Date.now();
      this.typed = t - this.typedAt > 700 ? e.key : this.typed + e.key;
      this.typedAt = t;
      const q = this.typed.toLocaleLowerCase();
      const i = this.shown.findIndex((o) => o.label.toLocaleLowerCase().startsWith(q));
      if (i >= 0) this.setActive(i);
      return true;
    }
    return false;
  }
}

/** Select próprio (um valor). */
export class KvSelect<T extends string = string> {
  readonly el: HTMLButtonElement;
  private readonly pop: KvPopList<T>;
  private readonly face: HTMLElement;
  private opts: KvOption<T>[];
  private current: T | null;

  constructor(o: { options: KvOption<T>[]; value?: T | null; placeholder?: string; search?: boolean; label?: string; onChange?: (v: T) => void }) {
    this.opts = o.options;
    this.current = o.value ?? null;
    this.face = h('span', { class: 'kv-ui-select__face' });
    const chev = h('span', { class: 'kv-ui-select__chev', attrs: { 'aria-hidden': 'true' } });
    chev.innerHTML = KV_ICONS.chevron;
    this.el = h('button', { class: 'kv-ui-select', type: 'button', role: 'combobox', attrs: { 'aria-haspopup': 'listbox', 'aria-expanded': 'false', ...(o.label ? { 'aria-label': o.label } : {}) } }, this.face, chev);
    const withSearch = o.search ?? this.opts.length >= SEARCH_FROM;
    this.pop = new KvPopList<T>(() => this.opts, (v) => v === this.current, withSearch, false, tr('Buscar…'));
    this.el.setAttribute('aria-controls', this.pop.id);
    this.pop.onPick = (opt) => {
      this.pop.hide();
      this.el.focus();
      if (opt.value === this.current) return;
      this.current = opt.value;
      this.paint();
      o.onChange?.(opt.value);
    };
    this.pop.onClose = () => {
      this.el.setAttribute('aria-expanded', 'false');
      this.el.classList.remove('is-open');
    };
    this.el.addEventListener('click', () => (this.pop.open ? this.pop.hide() : this.show()));
    this.el.addEventListener('keydown', (e) => {
      if (this.pop.key(e)) return;
      if (!this.pop.open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.show();
      }
    });
    this.paint(o.placeholder);
  }

  private show(): void {
    if (this.el.disabled) return;
    this.el.setAttribute('aria-expanded', 'true');
    this.el.classList.add('is-open');
    this.pop.show(this.el);
  }

  private placeholder = '';

  private paint(placeholder?: string): void {
    if (placeholder !== undefined) this.placeholder = placeholder;
    const o = this.opts.find((x) => x.value === this.current);
    this.face.replaceChildren(iconNode(o?.icon) ?? '', h('span', { class: `kv-ui-select__label${o ? '' : ' is-placeholder'}`, text: o?.label ?? this.placeholder }));
  }

  get value(): T | null {
    return this.current;
  }

  set value(v: T | null) {
    this.current = v;
    this.paint();
  }

  setOptions(opts: KvOption<T>[]): void {
    this.opts = opts;
    this.paint();
    if (this.pop.open) this.pop.render();
  }

  set disabled(v: boolean) {
    this.el.disabled = v;
  }
}

/** Multisseleção com chips (ex.: as salas que um cliente vê). Com `allowCustom`, aceita um valor digitado. */
export class KvMultiSelect<T extends string = string> {
  readonly el: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly add: HTMLButtonElement;
  private readonly pop: KvPopList<T>;
  private opts: KvOption<T>[];
  private values: T[];

  constructor(
    private readonly o: {
      options: KvOption<T>[];
      values?: T[];
      addLabel?: string;
      emptyText?: string;
      searchPlaceholder?: string;
      /** Valor livre a partir do que foi digitado (null = não aceita). */
      allowCustom?: (q: string) => KvOption<T> | null;
      /** Rótulo do chip de um valor que não está nas opções. */
      labelOf?: (v: T) => { label: string; title?: string };
      onChange?: (v: T[]) => void;
    },
  ) {
    this.opts = o.options;
    this.values = [...(o.values ?? [])];
    this.chips = h('div', { class: 'kv-ui-multi__chips' });
    const plus = h('span', { class: 'kv-ui-ico', attrs: { 'aria-hidden': 'true' } });
    plus.innerHTML = KV_ICONS.plus;
    this.add = h('button', { class: 'kv-ui-multi__add', type: 'button', attrs: { 'aria-haspopup': 'listbox', 'aria-expanded': 'false' } }, plus, h('span', { text: o.addLabel ?? tr('Adicionar') }));
    this.el = h('div', { class: 'kv-ui-multi' }, this.chips, this.add);
    this.pop = new KvPopList<T>(() => this.opts, (v) => this.values.includes(v), true, true, o.searchPlaceholder ?? tr('Buscar…'));
    this.pop.custom = o.allowCustom ?? null;
    this.add.setAttribute('aria-controls', this.pop.id);
    this.pop.onPick = (opt) => {
      this.toggle(opt.value, opt);
    };
    this.pop.onClose = () => this.add.setAttribute('aria-expanded', 'false');
    this.add.addEventListener('click', () => {
      if (this.pop.open) return this.pop.hide();
      this.add.setAttribute('aria-expanded', 'true');
      this.pop.show(this.el);
    });
    this.add.addEventListener('keydown', (e) => {
      if (this.pop.key(e)) return;
      if (!this.pop.open && e.key === 'ArrowDown') {
        e.preventDefault();
        this.add.click();
      }
    });
    this.paint();
  }

  private toggle(v: T, opt?: KvOption<T>): void {
    if (this.values.includes(v)) this.values = this.values.filter((x) => x !== v);
    else {
      this.values = [...this.values, v];
      // valor livre (digitado): entra nas opções com o rótulo curto, não com o "Usar ..." da busca
      if (opt && !this.opts.some((x) => x.value === v)) {
        const l = this.o.labelOf?.(v);
        this.opts = [...this.opts, l ? { ...opt, label: l.label, hint: l.title ?? opt.hint } : opt];
      }
    }
    this.paint();
    this.o.onChange?.(this.values);
  }

  private paint(): void {
    this.chips.replaceChildren(
      ...this.values.map((v) => {
        const opt = this.opts.find((x) => x.value === v);
        const l = opt ? { label: opt.label, title: opt.hint ?? opt.keywords } : (this.o.labelOf?.(v) ?? { label: v });
        return kvChip(l.label, { title: l.title, icon: KV_ICONS.door, onRemove: this.add.disabled ? undefined : () => this.toggle(v) });
      }),
    );
    if (!this.values.length && this.o.emptyText) this.chips.append(h('span', { class: 'kv-ui-multi__empty', text: this.o.emptyText }));
  }

  get value(): T[] {
    return [...this.values];
  }

  set value(v: T[]) {
    this.values = [...v];
    this.paint();
  }

  setOptions(opts: KvOption<T>[]): void {
    this.opts = opts;
    this.paint();
  }

  set disabled(v: boolean) {
    this.add.disabled = v;
    this.el.classList.toggle('is-disabled', v);
    this.paint();
  }
}
