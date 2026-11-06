// Fork Kaviski (KAVISKI.md, "Barra do topo em grupos"): os botões de painéis do topo, que vêm de vários módulos (o
// original, humanos/*, plan/*: kvTopButton, addPanelButton...), ficam numa ordem só, em grupos com uma divisória sutil:
//   Escritório (conversas, pessoas, salas, agenda, foco) · Agentes e o dia (novo agente, entregas, feed, Meu dia,
//   timelapse, histórico) · Sistema (avisos, configurações, ajuda, Mais).
// Os pouco usados (convidar visitantes, modo clássico, organograma, planta da empresa, Habblaud World) moram no menu
// "Mais" (⋯), com ícone, nome e atalho. Quando a barra aperta (janela estreita, contador de shells aceso...), os de menor
// prioridade também vão para o "Mais", até os cartões de uso caberem no nível médio (sem quebrar a linha).
// Os botões são os mesmos (só mudam de lugar): contadores, estados e o "ir e fazer" (listener de captura) continuam
// neles. Os que estão no "Mais" ficam num depósito invisível em cima do próprio botão ⋯ (conectados ao documento e com
// a posição dele): a janela que se abre ancorada no botão abre embaixo do ⋯.
// Também: o chip da pessoa (menu da conta, online.ts) vai para o fim da barra, à direita.
import { tr } from '../../../shared/i18n';
import { h, iconButton } from '../ui/dom';
import { KV_ICONS } from './humanos/ui/icons';
import { KV_TOP_COMFORT_STEPS, KV_TOP_GROUPS, KV_TOP_STEPS, kvTopSlotOf, kvTopTip, type KvTopGroupKey, type KvTopSlot } from './topbar-model';
import './topbar-groups.css';

let panel: HTMLElement | null = null;
let more: HTMLButtonElement | null = null;
let moreDot: HTMLElement | null = null;
let stash: HTMLElement | null = null;
let wrap: HTMLElement | null = null;
let menu: HTMLElement | null = null;
const seps = new Map<KvTopGroupKey, HTMLElement>();
/** Botões que foram para o "Mais" por falta de espaço (na ordem em que saíram). */
let overflow: HTMLElement[] = [];
let watch: MutationObserver | null = null;
let raf = 0;

/** O grupo dos botões de painéis (o original guarda em TopBar.panelGroup; marcado com .kv-tg-panel). */
export function kvTopPanel(): HTMLElement | null {
  return panel ?? (document.querySelector('.kv-tg-panel') as HTMLElement | null) ?? (document.querySelector('.ui-btn-feed')?.parentElement as HTMLElement | null) ?? null;
}

function isOurs(el: Element): boolean {
  return el === wrap || el.classList.contains('kv-tg-sep');
}

/** Todos os botões do grupo (no topo e no depósito do "Mais"). */
function buttons(): HTMLElement[] {
  if (!panel) return [];
  const inPanel = [...panel.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !isOurs(c));
  const inStash = stash ? [...stash.children].filter((c): c is HTMLElement => c instanceof HTMLElement) : [];
  return [...inPanel, ...inStash];
}

/** Aparece para esta pessoa? (o `hidden` do próprio botão: papel, acesso, modo...) */
function shown(el: HTMLElement): boolean {
  return !el.hidden;
}

/** Está visível no topo agora (fora do depósito e sem display:none das regras de largura)? */
function onBar(el: HTMLElement): boolean {
  return el.parentElement === panel && !el.hidden && el.getClientRects().length > 0;
}

interface Placed {
  el: HTMLElement;
  slot: KvTopSlot | null;
  group: KvTopGroupKey;
  index: number;
}

function layout(): Placed[] {
  const all = buttons();
  const out: Placed[] = all.map((el, i) => {
    const slot = kvTopSlotOf(el);
    return { el, slot, group: slot?.group ?? 'outros', index: slot ? slot.order : 1000 + i };
  });
  const gi = (g: KvTopGroupKey) => KV_TOP_GROUPS.findIndex((x) => x.key === g);
  return out.sort((a, b) => gi(a.group) - gi(b.group) || a.index - b.index);
}

function inMore(p: Placed): boolean {
  return !!p.slot?.more || overflow.includes(p.el);
}

/** Põe cada botão no lugar (topo ou depósito), com as divisórias. Só mexe no DOM se a ordem mudou. */
function arrange(): void {
  if (!panel || !stash || !wrap) return;
  const items = layout();
  const bar: Element[] = [];
  const kept: HTMLElement[] = [];
  let lastGroup: KvTopGroupKey | null = null;
  for (const g of KV_TOP_GROUPS) {
    const mine = items.filter((p) => p.group === g.key);
    const top = mine.filter((p) => !inMore(p));
    for (const p of mine.filter(inMore)) kept.push(p.el);
    const visible = top.some((p) => shown(p.el)) || (g.key === 'sistema' && hasMore());
    if (lastGroup && visible) bar.push(sep(g.key));
    else if (!visible) seps.get(g.key)?.remove();
    bar.push(...top.map((p) => p.el));
    if (g.key === 'sistema') bar.push(wrap);
    if (visible) lastGroup = g.key;
  }
  if (!same(panel, bar)) panel.replaceChildren(...bar);
  if (!same(stash, kept)) stash.replaceChildren(...kept);
  wrap.hidden = !hasMore();
  moreDot?.toggleAttribute('hidden', !kept.some((el) => el instanceof HTMLElement && shown(el) && !!badgeOf(el)));
}

function sep(g: KvTopGroupKey): HTMLElement {
  let s = seps.get(g);
  if (!s) {
    s = h('span', { class: 'kv-tg-sep', attrs: { 'aria-hidden': 'true', 'data-group': g } });
    seps.set(g, s);
  }
  return s;
}

function same(parent: Element, list: Element[]): boolean {
  const cur = parent.children;
  if (cur.length !== list.length) return false;
  return list.every((el, i) => cur[i] === el);
}

function hasMore(): boolean {
  return buttons().some((el) => {
    const slot = kvTopSlotOf(el);
    return shown(el) && (!!slot?.more || overflow.includes(el));
  });
}

function badgeOf(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>('.kv-dock__badge:not([hidden]), .kv-top-badge:not([hidden]), .ui-deliv-badge:not([hidden])');
}

// ------------------------------------------------------------------ encaixe na largura

/** A barra quebrou de linha? (o grupo da direita desceu em relação à marca, ou o próprio grupo quebrou) */
function wrapped(): boolean {
  const left = document.querySelector('.ui-topbar__left')?.getBoundingClientRect();
  const right = document.querySelector('.ui-topbar__right')?.getBoundingClientRect();
  if (!left || !right || right.width === 0) return false;
  return right.top - left.top > 18 || right.height > 48;
}

/** Os cartões de uso cabem na linha da barra com `perCard` px cada? (no celular eles têm linha própria) */
function cardsFit(perCard: number): boolean {
  const bar = document.querySelector<HTMLElement>('.ui-topbar');
  const usage = bar?.querySelector<HTMLElement>('.ui-usage');
  if (!bar || !usage || window.innerWidth <= 600) return true;
  const cards = [...usage.children].filter((c) => c instanceof HTMLElement && c.classList.contains('ui-usage-card') && !c.hidden);
  if (!cards.length) return true;
  const st = getComputedStyle(bar);
  const gap = parseFloat(st.columnGap) || 12;
  const inner = bar.clientWidth - (parseFloat(st.paddingLeft) || 0) - (parseFloat(st.paddingRight) || 0);
  const others = [...bar.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== usage && c.getClientRects().length > 0);
  const used = others.reduce((sum, c) => sum + Math.max(c.offsetWidth, c.scrollWidth), 0) + gap * others.length;
  return inner - used >= cards.length * perCard + 8 * (cards.length - 1);
}

/** Aplica os passos de aperto (KV_TOP_STEPS) até `n` (exclusive), do zero. */
function applySteps(n: number): void {
  const root = document.documentElement;
  for (const st of KV_TOP_STEPS) if (st.cls) root.classList.remove(st.cls);
  overflow = [];
  for (const st of KV_TOP_STEPS.slice(0, n)) {
    if (st.cls) root.classList.add(st.cls);
    else if (st.drop) {
      const el = buttons().find((b) => kvTopSlotOf(b)?.drop === st.drop);
      if (el) overflow.push(el);
    }
  }
  arrange();
}

/**
 * Encaixa a barra: primeiro tenta os cartões de uso no nível de conforto (completo em telas largas, médio nas médias)
 * só com os passos leves; se não der, usa só o necessário para nada quebrar a linha (cartões no mínimo).
 */
function fit(): void {
  if (!panel) return;
  watch?.disconnect();
  try {
    const w = window.innerWidth;
    const comfort = w >= 1800 ? 318 : w >= 1100 ? 184 : 0;
    let done = false;
    if (comfort) {
      for (let n = 0; n <= KV_TOP_COMFORT_STEPS && !done; n++) {
        applySteps(n);
        done = !wrapped() && cardsFit(comfort);
      }
      // no completo não deu com os passos leves: o médio sem passo nenhum já basta
      if (!done && comfort > 184) {
        applySteps(0);
        done = !wrapped() && cardsFit(184);
      }
    }
    if (!done) {
      for (let n = 0; n <= KV_TOP_STEPS.length; n++) {
        applySteps(n);
        if (!wrapped() && cardsFit(84)) break;
      }
    }
    // a fila de cartões vai para a segunda linha só se nem no mínimo couber (mesma conta de ui/usage.ts, que só refaz
    // quando a janela ou as contas mudam)
    if (w > 600) document.querySelector('.ui-root')?.classList.toggle('has-usage-row', !cardsFit(84));
    // menu aberto: refaz a lista (um botão pode ter entrado ou saído do "Mais")
    if (menu && !menu.hidden) {
      if (wrap?.hidden) closeMenu();
      else openMenu(false);
    }
  } finally {
    observe();
  }
}

function later(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(fit);
}

function observe(): void {
  if (!watch || !panel) return;
  watch.takeRecords();
  watch.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

// ------------------------------------------------------------------ menu "Mais"

function closeMenu(): void {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  more?.setAttribute('aria-expanded', 'false');
}

function menuItem(el: HTMLElement, slot: KvTopSlot | null): HTMLElement {
  const icon = h('span', { class: 'kv-tg-menu__ico', attrs: { 'aria-hidden': 'true' } });
  icon.innerHTML = el.querySelector('svg')?.outerHTML ?? '';
  const label = el.getAttribute('aria-label') ?? el.title ?? '';
  const name = slot?.name() ?? label;
  const badge = badgeOf(el);
  const on = el.classList.contains('is-on') || el.getAttribute('aria-pressed') === 'true';
  return h(
    'button',
    {
      class: `kv-tg-menu__item${on ? ' is-on' : ''}`,
      type: 'button',
      role: 'menuitem',
      title: kvTopTip(label, slot),
      on: {
        click: (e: MouseEvent) => {
          closeMenu();
          // o botão de verdade continua o mesmo: o clique dele abre a janela (o "ir e fazer" também vale; Shift abre direto)
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }));
        },
      },
    },
    icon,
    h('span', { class: 'kv-tg-menu__label', text: name }),
    badge ? h('span', { class: 'kv-ui-count', text: badge.textContent ?? '' }) : null,
    slot?.key ? h('kbd', { class: 'kv-tg-menu__key', text: slot.key }) : null,
  );
}

function openMenu(focus = true): void {
  if (!menu || !more || !stash) return;
  const items = layout().filter((p) => inMore(p) && shown(p.el));
  const was = [...menu.querySelectorAll('button')].indexOf(document.activeElement as HTMLButtonElement);
  const parts: HTMLElement[] = [];
  for (const g of KV_TOP_GROUPS) {
    const mine = items.filter((p) => p.group === g.key);
    if (!mine.length) continue;
    parts.push(h('div', { class: 'kv-tg-menu__title', text: g.title() }));
    for (const p of mine) parts.push(menuItem(p.el, p.slot));
  }
  menu.replaceChildren(...parts);
  menu.hidden = false;
  const r = more.getBoundingClientRect();
  const w = Math.min(menu.offsetWidth, window.innerWidth - 16);
  menu.style.maxWidth = `${window.innerWidth - 16}px`;
  menu.style.top = `${Math.round(r.bottom + 8)}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
  more.setAttribute('aria-expanded', 'true');
  const list = menu.querySelectorAll<HTMLButtonElement>('button');
  if (focus) list[0]?.focus();
  else if (was >= 0) (list[was] ?? list[list.length - 1])?.focus();
}

// ------------------------------------------------------------------ conta (chip da pessoa)

function moveAccount(): void {
  const chip = document.querySelector<HTMLElement>('.ui-topbar .kv-me');
  const right = document.querySelector('.ui-topbar__right');
  if (!chip || !right || chip.closest('.kv-tg-acct')) return;
  const name = chip.querySelector('.kv-me__name')?.textContent?.trim() ?? '';
  chip.prepend(h('span', { class: 'kv-me__ini', text: (name[0] ?? '?').toLocaleUpperCase(), attrs: { 'aria-hidden': 'true' } }));
  chip.title = tr('Minha conta e quem está online');
  if (!chip.getAttribute('aria-label')) chip.setAttribute('aria-label', `${name} · ${tr('Minha conta e quem está online')}`);
  right.append(h('div', { class: 'kv-tg-acct' }, chip));
}

// ------------------------------------------------------------------ início

/** Liga os grupos do topo (uma vez, depois que os botões das pessoas entraram). Os que chegam depois se encaixam sozinhos. */
export function kvStartTopGroups(): void {
  if (panel) return;
  panel = (document.querySelector('.ui-btn-feed')?.parentElement as HTMLElement | null) ?? null;
  if (!panel) return;
  panel.classList.add('kv-tg-panel');
  document.documentElement.classList.add('kv-topo');
  more = iconButton(KV_ICONS.dots, tr('Mais: organograma, planta da empresa, convites e outros'), () => (menu && !menu.hidden ? closeMenu() : openMenu()), 'kv-tg-more');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  moreDot = h('span', { class: 'kv-tg-more__dot', hidden: true });
  more.append(moreDot);
  stash = h('span', { class: 'kv-tg-stash', attrs: { 'aria-hidden': 'true' } });
  wrap = h('span', { class: 'kv-tg-more-wrap' }, more, stash);
  menu = h('div', { class: 'kv-tg-menu', role: 'menu', hidden: true, attrs: { 'aria-label': tr('Mais') } });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu!.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') {
      closeMenu();
      if (e.key === 'Escape') more?.focus();
      if (e.key === 'Tab') return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  (document.querySelector('.ui-root') ?? document.body).append(menu);
  document.addEventListener('pointerdown', (e) => {
    if (menu && !menu.hidden && !menu.contains(e.target as Node) && !more?.contains(e.target as Node)) closeMenu();
  });
  moveAccount();
  // dicas com nome + atalho (só onde o módulo do botão não escreve a dele depois)
  for (const el of buttons()) {
    const slot = kvTopSlotOf(el);
    if (slot && !el.dataset.kvTip) {
      el.title = kvTopTip(el.getAttribute('aria-label') ?? el.title, slot);
      el.dataset.kvTip = '1';
    }
  }
  watch = new MutationObserver(() => {
    for (const el of buttons()) {
      const slot = kvTopSlotOf(el);
      if (slot && !el.dataset.kvTip) {
        el.title = kvTopTip(el.getAttribute('aria-label') ?? el.title, slot);
        el.dataset.kvTip = '1';
      }
    }
    later();
  });
  window.addEventListener('resize', () => {
    closeMenu();
    later();
  });
  // o que muda a largura dos vizinhos: contadores (shells), marca (selos), cartões de uso que chegam/saem
  const ro = new ResizeObserver(later);
  for (const sel of ['.ui-topbar__left', '.ui-counters']) {
    const el = document.querySelector(sel);
    if (el) ro.observe(el);
  }
  const usage = document.querySelector('.ui-topbar .ui-usage');
  if (usage) new MutationObserver(later).observe(usage, { childList: true });
  fit();
}
