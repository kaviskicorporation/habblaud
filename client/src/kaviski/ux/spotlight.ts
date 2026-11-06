// Fork Kaviski (KAVISKI.md, "Detalhes de UX"): Busca rápida — Ctrl+K (⌘K no Mac) ou o botão da lupa no topo abrem uma
// caixa no meio da tela que acha qualquer coisa do escritório pelo nome: pessoas online (ir até ela ou conversar),
// agentes (abrir a gaveta e levar a câmera), salas, as ações "ir e fazer" das salas temáticas, o meu status e os
// comandos das teclas (visão geral, mini-mapa, próximo pedido...). Vazia, mostra as sugestões: quem pede você primeiro
// e o que usei por último. ↑↓ escolhe, Enter usa, Esc fecha.
import { kvRestricted, type KvMe } from '../../../../shared/kaviski-humanos';
import type { KvStatus } from '../../../../shared/kaviski-presence';
import { tr } from '../../../../shared/i18n';
import type { AgentInfo } from '../../../../shared/types';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import type { WorldApi } from '../../world/api';
import { kvActions } from '../plan/api';
import { kvGoAndDo } from '../plan/go-and-do';
import { kvOpenProfile, whereText } from '../humanos/online';
import { kvOpenPeople } from '../humanos/people';
import { kvSetStatus } from '../humanos/status';
import { kvTopButton } from '../humanos/topbar';
import { kvToast } from '../humanos/ui/toast';
import { kvPeople, STATUS_LABEL } from '../humanos/world';
import { kvMatchRange, kvMatchScore } from './match';

type Tone = 'person' | 'agent' | 'room' | 'action' | 'status' | 'cmd';

interface Item {
  id: string;
  section: string;
  icon: string;
  tone: Tone;
  title: string;
  sub?: string;
  /** Texto a mais que a busca considera (não aparece). */
  keywords?: string;
  /** Tecla do atalho, mostrada à direita. */
  key?: string;
  /** Vem antes nas sugestões (pede você). */
  urgent?: boolean;
  run(): void;
}

const RECENT_KEY = 'habblaud.kv.busca.recentes';
const RECENT_MAX = 6;
const SHOW_MAX = 40;
const SEARCH_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

const AGENT_STATUS: Record<string, () => string> = {
  working: () => tr('trabalhando'),
  waiting: () => tr('pede você'),
  idle: () => tr('parado'),
  shell: () => tr('esperando um comando'),
  done: () => tr('terminou'),
  offline: () => tr('desligado'),
};
const STATUS_ICON: Record<KvStatus, string> = { disponivel: '🟢', ocupado: '🔴', ausente: '🌙', naoperturbe: '⛔' };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const KV_SEARCH_KEY = isMac ? '⌘K' : 'Ctrl+K';

function world(): WorldApi | null {
  return ((window as { habblaud?: { world?: WorldApi } }).habblaud?.world ?? null) as WorldApi | null;
}

/** Aperta uma tecla do escritório (os atalhos do original e os nossos ouvem o documento/janela). */
function press(key: string): void {
  setTimeout(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })), 30);
}

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(id: string): void {
  try {
    const list = [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // sem localStorage: sem recentes
  }
}

class KvSpotlight {
  private readonly dlg: HTMLDialogElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private shown: Item[] = [];
  private sel = 0;

  constructor(
    private readonly store: OfficeStore,
    private readonly me: KvMe,
  ) {
    this.input = h('input', {
      class: 'kv-spot__input',
      attrs: { type: 'search', placeholder: tr('Buscar pessoas, agentes, salas, ações…'), 'aria-label': tr('Busca rápida'), autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'kv-spot-list' },
    }) as HTMLInputElement;
    this.list = h('div', { class: 'kv-spot__list', attrs: { id: 'kv-spot-list', role: 'listbox', 'aria-label': tr('Resultados') } });
    this.empty = h('div', { class: 'kv-spot__empty', hidden: true }, h('span', { text: '🔭', attrs: { 'aria-hidden': 'true' } }), h('span', { text: tr('Nada com esse nome por aqui.') }));
    const ico = h('span', { class: 'kv-spot__glass', attrs: { 'aria-hidden': 'true' } });
    ico.innerHTML = SEARCH_ICON;
    this.dlg = h(
      'dialog',
      { class: 'kv-spot', attrs: { 'aria-label': tr('Busca rápida') } },
      h('div', { class: 'kv-spot__box' }, ico, this.input, h('kbd', { class: 'kv-spot__esc', text: 'Esc' })),
      this.list,
      this.empty,
      h(
        'div',
        { class: 'kv-spot__foot', attrs: { 'aria-hidden': 'true' } },
        h('span', {}, h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), ` ${tr('escolher')}`),
        h('span', {}, h('kbd', { text: '↵' }), ` ${tr('abrir')}`),
        h('span', {}, h('kbd', { text: KV_SEARCH_KEY }), ` ${tr('abre de qualquer lugar')}`),
      ),
    ) as HTMLDialogElement;
    document.body.append(this.dlg);
    this.input.addEventListener('input', () => {
      this.sel = 0;
      this.render();
    });
    this.dlg.addEventListener('keydown', (e) => this.onKey(e));
    // clique fora da caixa fecha (o <dialog> ocupa só a caixa; o fundo é o ::backdrop)
    this.dlg.addEventListener('pointerdown', (e) => {
      if (e.target === this.dlg) this.close();
    });
    this.dlg.addEventListener('close', () => document.documentElement.classList.remove('kv-spot-open'));
  }

  get isOpen(): boolean {
    return this.dlg.open;
  }

  open(): void {
    if (this.dlg.open) return void this.input.select();
    this.input.value = '';
    this.sel = 0;
    this.render();
    this.dlg.showModal();
    document.documentElement.classList.add('kv-spot-open');
    this.input.focus();
  }

  close(): void {
    if (this.dlg.open) this.dlg.close();
  }

  toggle(): void {
    if (this.dlg.open) this.close();
    else this.open();
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation(); // as teclas daqui não andam com o boneco nem abrem outras janelas
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.shown.length) return;
      const n = this.shown.length;
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this.paintSel(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = this.shown[this.sel];
      if (it) this.use(it);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.close();
    }
  }

  private use(it: Item): void {
    saveRecent(it.id);
    this.close();
    try {
      it.run();
    } catch {
      kvToast(tr('Não deu para abrir agora.'), { kind: 'warn' });
    }
  }

  // ------------------------------------------------------------------ o que dá para achar

  private items(): Item[] {
    const out: Item[] = [];
    const snap = this.store.snapshot;
    const restricted = kvRestricted(this.me.person);
    const rooms = new Map((snap?.rooms ?? []).map((r) => [r.id, r]));
    const state = kvPeople.client?.state;

    // pessoas online (menos eu)
    for (const p of state?.people ?? []) {
      if (p.id === state?.me) continue;
      const near = kvPeople.inside && !!p.pos && !!kvPeople.locate?.(p.id);
      out.push({
        id: `p:${p.id}`,
        section: tr('Pessoas'),
        icon: STATUS_ICON[p.status] ?? '🙂',
        tone: 'person',
        title: p.name,
        sub: [STATUS_LABEL[p.status], p.note, whereText(p, snap)].filter(Boolean).join(' · '),
        keywords: tr('pessoa conversar ir até'),
        run: () => {
          if (near && kvPeople.goNear?.(p.id)) return kvToast(tr('Indo até {0}…', [p.name]), { kind: 'info', ms: 2200 });
          if (kvPeople.openDirect) return kvPeople.openDirect(p.id);
          kvToast(tr('{0} não está à vista agora.', [p.name]), { kind: 'info' });
        },
      });
    }

    // agentes (quem pede você vem primeiro nas sugestões)
    for (const a of snap?.agents ?? []) {
      if (a.status === 'offline') continue;
      const room = rooms.get(a.roomId);
      out.push({
        id: `a:${a.id}`,
        section: tr('Agentes'),
        icon: a.status === 'waiting' ? '🔔' : a.status === 'working' ? '⚡' : a.status === 'done' ? '✅' : '🤖',
        tone: 'agent',
        title: a.name,
        sub: [AGENT_STATUS[a.status]?.() ?? a.status, room?.name].filter(Boolean).join(' · '),
        keywords: `${tr('agente')} ${room?.path ?? ''}`,
        urgent: a.status === 'waiting',
        run: () => this.openAgent(a),
      });
    }

    // salas
    for (const r of snap?.rooms ?? []) {
      const n = (snap?.agents ?? []).filter((a) => a.roomId === r.id && a.status !== 'offline').length;
      out.push({
        id: `r:${r.id}`,
        section: tr('Salas'),
        icon: '🚪',
        tone: 'room',
        title: r.name,
        sub: n === 1 ? tr('1 agente aqui') : n ? tr('{0} agentes aqui', [n]) : tr('vazia'),
        keywords: `${tr('sala projeto')} ${r.path}`,
        run: () => world()?.select({ type: 'room', id: r.id }, { focus: true }),
      });
    }

    // ações das salas temáticas ("ir e fazer")
    for (const a of kvActions()) {
      if (a.allowed && !a.allowed()) continue;
      out.push({ id: `x:${a.key}`, section: tr('Ações'), icon: /^[\w-]+$/.test(a.icon) ? '✨' : a.icon, tone: 'action', title: a.label, keywords: tr('ir e fazer'), run: () => kvGoAndDo(a.key) });
    }

    // eu
    if (this.me.person) {
      out.push({ id: 'c:desk', section: tr('Eu'), icon: '💺', tone: 'cmd', title: tr('Ir até a minha mesa'), run: () => void (kvPeople.goDesk?.(null) || kvToast(tr('A sua mesa não está neste prédio agora.'), { kind: 'info' })) });
      out.push({ id: 'c:me', section: tr('Eu'), icon: '🧑‍🎨', tone: 'cmd', title: tr('Meu avatar e perfil'), keywords: tr('aparência roupa cabelo'), run: () => kvOpenProfile() });
      for (const s of ['disponivel', 'ocupado', 'ausente', 'naoperturbe'] as KvStatus[]) {
        out.push({
          id: `s:${s}`,
          section: tr('Eu'),
          icon: STATUS_ICON[s],
          tone: 'status',
          title: tr('Ficar {0}', [STATUS_LABEL[s]]),
          keywords: tr('status'),
          run: () => {
            kvSetStatus({ status: s });
            kvToast(tr('Agora você está {0}.', [STATUS_LABEL[s]]), { kind: 'ok', ms: 2200 });
          },
        });
      }
    }
    if (this.me.local || this.me.person?.role === 'admin') out.push({ id: 'c:people', section: tr('Comandos'), icon: '👥', tone: 'cmd', title: tr('Pessoas: contas, papéis e salas'), run: () => kvOpenPeople() });

    // as teclas do escritório
    const cmd = (id: string, icon: string, title: string, key: string, team = false) => {
      if (team && restricted) return;
      out.push({ id: `k:${id}`, section: tr('Comandos'), icon, tone: 'cmd', title, key, run: () => press(key) });
    };
    cmd('overview', '🏢', tr('Visão geral do prédio'), 'O');
    cmd('perm', '🔔', tr('Próximo pedido de permissão ou pergunta'), 'P');
    cmd('minimap', '🗺️', tr('Mostrar ou recolher o mini-mapa'), 'N');
    cmd('help', '⌨️', tr('Atalhos e ajuda'), '?');
    cmd('day', '📊', tr('Meu dia: para onde foi o tempo'), 'M', true);
    cmd('timelapse', '⏪', tr('Timelapse do dia'), 'L', true);
    cmd('sidebar', '📋', tr('Mostrar ou esconder a lista de salas'), '[');
    cmd('feed', '📰', tr('Mostrar ou esconder as novidades'), ']');
    return out;
  }

  private openAgent(a: AgentInfo): void {
    const w = world();
    if (!w) return;
    w.select({ type: 'agent', id: a.id }, { focus: true });
  }

  // ------------------------------------------------------------------ desenho

  private render(): void {
    const q = this.input.value.trim();
    const all = this.items();
    let shown: Item[];
    if (!q) {
      // sugestões: quem pede você, depois os recentes, depois as pessoas e os comandos de sempre
      const byId = new Map(all.map((i) => [i.id, i]));
      const urgent = all.filter((i) => i.urgent).map((i) => ({ ...i, section: tr('Pedem você') }));
      const recent = loadRecent()
        .map((id) => byId.get(id))
        .filter((i): i is Item => !!i && !i.urgent)
        .map((i) => ({ ...i, section: tr('Recentes') }));
      const used = new Set([...urgent, ...recent].map((i) => i.id));
      const rest = all.filter((i) => !used.has(i.id) && (i.tone === 'person' || i.id === 'c:desk' || i.id === 'k:overview' || i.id === 'k:help'));
      shown = [...urgent, ...recent, ...rest.map((i) => ({ ...i, section: i.tone === 'person' ? tr('Pessoas') : tr('Sugestões') }))];
    } else {
      shown = all
        .map((i) => ({ i, s: Math.max(kvMatchScore(q, i.title), kvMatchScore(q, `${i.title} ${i.sub ?? ''} ${i.keywords ?? ''}`) * 0.6) + (i.urgent ? 5 : 0) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.i);
      // as seções na ordem do melhor resultado de cada uma
      const order = [...new Set(shown.map((i) => i.section))];
      shown.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
    }
    this.shown = shown.slice(0, SHOW_MAX);
    if (this.sel >= this.shown.length) this.sel = 0;
    const rows: HTMLElement[] = [];
    let section = '';
    this.shown.forEach((it, i) => {
      if (it.section !== section) {
        section = it.section;
        rows.push(h('div', { class: 'kv-spot__section', text: section, attrs: { role: 'presentation' } }));
      }
      rows.push(this.row(it, i, q));
    });
    this.list.replaceChildren(...rows);
    this.empty.hidden = this.shown.length > 0;
    this.paintSel(false);
  }

  private row(it: Item, i: number, q: string): HTMLElement {
    const title = h('span', { class: 'kv-spot__title' });
    const r = q ? kvMatchRange(q, it.title) : null;
    if (r) title.append(it.title.slice(0, r[0]), h('mark', { text: it.title.slice(r[0], r[1]) }), it.title.slice(r[1]));
    else title.textContent = it.title;
    const el = h(
      'div',
      { class: `kv-spot__row kv-spot--${it.tone}`, attrs: { role: 'option', id: `kv-spot-${i}`, 'aria-selected': 'false' } },
      h('span', { class: 'kv-spot__ico', text: it.icon, attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'kv-spot__txt' }, title, it.sub ? h('span', { class: 'kv-spot__sub', text: it.sub }) : null),
      it.key ? h('kbd', { class: 'kv-spot__key', text: it.key }) : h('span', { class: 'kv-spot__go', text: '↵', attrs: { 'aria-hidden': 'true' } }),
    );
    el.addEventListener('pointermove', () => {
      if (this.sel !== i) {
        this.sel = i;
        this.paintSel(false);
      }
    });
    el.addEventListener('click', () => this.use(it));
    return el;
  }

  private paintSel(scroll: boolean): void {
    this.list.querySelectorAll('.kv-spot__row').forEach((el, i) => {
      const on = i === this.sel;
      el.classList.toggle('is-sel', on);
      el.setAttribute('aria-selected', String(on));
      if (on) {
        this.input.setAttribute('aria-activedescendant', el.id);
        if (scroll) el.scrollIntoView({ block: 'nearest' });
      }
    });
  }
}

let spot: KvSpotlight | null = null;

/** Abre a Busca rápida (botão do topo, Ctrl+K). */
export function kvOpenSpotlight(): void {
  spot?.open();
}

export function kvStartSpotlight(store: OfficeStore, me: KvMe, root: ParentNode = document): void {
  if (spot) return;
  spot = new KvSpotlight(store, me);
  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.key !== 'k' && e.key !== 'K') || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      // outra janela modal aberta: deixa quieto (a não ser a própria busca, que fecha)
      if (!spot?.isOpen && document.querySelector('dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation();
      spot?.toggle();
    },
    true,
  );
  const btn = kvTopButton(SEARCH_ICON, tr('Busca rápida ({0})', [KV_SEARCH_KEY]), () => spot?.open(), 'kv-btn-search', 5, root);
  btn?.setAttribute('aria-haspopup', 'dialog');
}
