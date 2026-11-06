// Fork Kaviski (KAVISKI-HUMANOS.md): conversas do escritório no jeito do Teams, com a cara do Habblaud (kit ui/).
//
// Uma janela embaixo da barra do topo (botão de balão no topo, na barra do boneco ou Enter):
// - à esquerda, a lista: "Aqui" (a conversa da área em que o meu boneco está), "Recentes" (cada conversa 1:1 e cada
//   sala de projeto em que estive, a mais nova primeiro) e "Online agora"; busca por pessoa e, com 2+ letras, nas
//   mensagens das minhas conversas (no servidor); "Nova conversa" escolhe a pessoa;
// - à direita, as abas das conversas abertas (lembradas neste navegador) e a conversa: dias separados ("Hoje",
//   "Ontem"), falas seguidas agrupadas, bolhas minhas (azuis, à direita) e dos outros (com boneco e nome), links
//   clicáveis e seguros, "digitando…" (1:1), emojis, urgente (1:1), Enter manda e Shift+Enter quebra a linha.
// Cada conversa é guardada separada no servidor: a 1:1 (direct.ts, em páginas: "Carregar anteriores") e a de cada sala
// de projeto (chat.ts do servidor). As áreas abertas (núcleo, corredor) são por proximidade e não ficam guardadas.
// Quem não participa nunca recebe (filtro no servidor). Cumprimentos: a roda do Habblaud World (G).
// Contratos: `kvOpenDirect(id)` / `kvPeople.openDirect(id)` abrem a 1:1; `kvChatAudible`, `kvWhen`, `CHAT_RANGE`.
import type { KvChatMessage, KvContact, KvDirectMessage, KvLook, KvPresencePerson, KvStatus } from '../../../../shared/kaviski-presence';
import { KV_CHAT_MAX } from '../../../../shared/kaviski-presence';
import type { KvRole } from '../../../../shared/kaviski-humanos';
import { greetingIcon, greetingLabel } from '../../../../shared/world/social-labels';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { TILE } from '../../world/constants';
import { modalOpen } from '../../world/input';
import { GreetingWheel, pickGreetTarget, RateGate, BALLOON_MS } from '../../world/city/greetings';
import '../../world/city/social.css';
import { kvAreaLabel, type KvBar } from './bar';
import { kvHeads, kvMessageMini } from './heads';
import type { KvPresenceClient } from './presence';
import { ROLE_LABEL } from './people';
import { kvPeople, STATUS_LABEL } from './world';
import { kvGoArea } from './walk';
import { KV_EMOJIS, kvDayLabel, kvLinkify, kvParseRooms, kvRememberRoom, kvSameGroup, kvTime, kvWhen } from './chat-format';
import { KV_ICONS, kvAvatar, kvBtn, kvEmpty, kvIconBtn, kvInput, kvRoleBadge } from './ui/kit';
import { KvModal } from './ui/modal';
import { kvToast } from './ui/toast';
import './chat.css';

export { kvWhen };

/** Alcance da conversa nas áreas abertas (px de mundo): o mesmo em que a voz some. */
export const CHAT_RANGE = 11 * TILE;
const SAY_MS = 7_000;
const TABS_MAX = 6;
const TYPING_MS = 4_500;
const TYPING_SEND_MS = 2_000;
const K_TABS = 'habblaud.kv.conversas.abas';
const K_ROOMS = 'habblaud.kv.conversas.salas';
const K_SEEN = 'habblaud.kv.conversas.lidas';

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // sem localStorage
  }
}

/** A fala da área chega a mim? Sala de projeto: sempre; área aberta: só se quem falou está perto (ou fui eu). */
export function kvChatAudible(m: Pick<KvChatMessage, 'area' | 'from'>, me: string, dist: number | null): boolean {
  if (m.from.id === me || m.area.startsWith('r:') || m.area.startsWith('b:')) return true; // W2: b: = roda privada
  return dist !== null && dist <= CHAT_RANGE;
}

/** 'here' = a área em que estou; 'room:r:<id>' = uma sala em que estive; 'dm:<id>' = a 1:1. */
type ConvKey = 'here' | `room:${string}` | `dm:${string}`;

/** Uma fala na tela (da área, de uma sala ou da 1:1). */
interface Msg {
  id: string;
  at: number;
  from: { id: string; name: string; role: KvRole };
  text?: string;
  greet?: string;
  to?: { id: string; name: string };
  urgent?: boolean;
}

let instance: KvChatPanel | null = null;

/** Abre a conversa 1:1 com a pessoa (o cartão da pessoa, os avisos, a lista de online). */
export function kvOpenDirect(personId: string): void {
  instance?.openDirect(personId);
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export class KvChatPanel {
  private readonly el: HTMLElement;
  private readonly convs: HTMLElement;
  private readonly search;
  private readonly tabsEl: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private readonly typingEl: HTMLElement;
  private readonly composer: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly urgentBtn: HTMLButtonElement;
  private readonly greetBtn: HTMLButtonElement;
  private readonly emojiBtn: HTMLButtonElement;
  private readonly emojiPop: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly readonlyBar: HTMLElement;
  private readonly wheel = new GreetingWheel();
  private readonly greetGate = new RateGate(20, 3_000);
  private picker: { modal: KvModal; search: HTMLInputElement; render: () => void } | null = null;

  private conv: ConvKey = 'here';
  private tabs: ConvKey[] = [];
  private area: string | null = null;
  private areaUnread = 0;
  private contacts: KvContact[] = [];
  private msgs: Msg[] = [];
  private more = false;
  private loadSeq = 0;
  private urgent = false;
  private rooms: { area: string; at: number }[] = [];
  private readonly roomLast = new Map<string, Msg | null>();
  private roomSeen: Record<string, number> = {};
  private readonly typingFrom = new Map<string, number>();
  private typingSent = 0;
  private searchHits: { with: { id: string; name: string }; message: KvDirectMessage }[] = [];
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private contactsTimer: ReturnType<typeof setTimeout> | null = null;
  private highlight: string | null = null;
  /** Botão de conversas no topo (sempre à mão, mesmo sem o boneco no escritório). */
  private topBtn: HTMLButtonElement | null = null;

  constructor(
    private readonly client: KvPresenceClient,
    private readonly bar: KvBar,
    private readonly store: OfficeStore,
  ) {
    instance = this;
    this.tabs = load<string[]>(K_TABS, []).filter((k): k is ConvKey => k === 'here' || /^(room:r:|dm:)/.test(k)).slice(0, TABS_MAX);
    this.rooms = kvParseRooms(localStorage.getItem?.(K_ROOMS) ?? null);
    this.roomSeen = load<Record<string, number>>(K_SEEN, {});

    // ---- lista
    this.search = kvInput({ placeholder: tr('Buscar pessoas e mensagens'), icon: KV_ICONS.search, type: 'search', onInput: () => this.onSearch() });
    this.convs = h('div', { class: 'kv-cv__convs' });
    const newBtn = kvIconBtn(KV_ICONS.plus, tr('Nova conversa'), () => this.openPicker(), { variant: 'primary', size: 'sm' });
    const side = h('aside', { class: 'kv-cv__side' }, h('div', { class: 'kv-cv__side-head' }, h('strong', { class: 'kv-cv__side-title', text: tr('Conversas') }), newBtn), h('div', { class: 'kv-cv__search' }, this.search.el), this.convs);

    // ---- conversa
    this.tabsEl = h('div', { class: 'kv-cv__tabs', role: 'tablist', attrs: { 'aria-label': tr('Conversas abertas') } });
    this.head = h('header', { class: 'kv-cv__head' });
    this.list = h('ol', { class: 'kv-cv__list', attrs: { 'aria-live': 'polite' } });
    this.list.addEventListener('scroll', () => {
      if (this.list.scrollTop < 40 && this.more) void this.loadOlder();
    });
    this.typingEl = h('div', { class: 'kv-cv__typing', hidden: true });
    this.input = h('textarea', {
      class: 'kv-cv__input',
      attrs: { rows: '1', maxlength: String(KV_CHAT_MAX), placeholder: tr('Escreva uma mensagem'), 'aria-label': tr('Mensagem') },
      on: { keydown: (e) => this.onInputKey(e as KeyboardEvent), input: () => this.onInputChange() },
    });
    this.emojiPop = h('div', { class: 'kv-cv__emojis', hidden: true, role: 'dialog', attrs: { 'aria-label': tr('Emojis') } });
    for (const e of KV_EMOJIS) this.emojiPop.append(h('button', { class: 'kv-cv__emoji', type: 'button', text: e, on: { click: () => this.insert(e) } }));
    this.emojiBtn = kvIconBtn(KV_ICONS.smile, tr('Emojis'), () => this.toggleEmoji(), { size: 'sm' });
    this.greetBtn = kvIconBtn(KV_ICONS.wave, tr('Cumprimentar (G)'), () => this.openWheel(null), { size: 'sm' });
    this.urgentBtn = kvIconBtn(KV_ICONS.alert, tr('Marcar como urgente'), () => (this.setUrgent(!this.urgent), this.input.focus()), { size: 'sm', cls: 'kv-cv__urgent' });
    this.sendBtn = kvIconBtn(KV_ICONS.send, tr('Enviar (Enter)'), () => void this.send(), { variant: 'primary', cls: 'kv-cv__send' });
    this.composer = h('div', { class: 'kv-cv__compose' }, h('div', { class: 'kv-cv__tools' }, this.emojiBtn, this.greetBtn, this.urgentBtn), this.input, this.sendBtn, this.emojiPop);
    this.foot = h('p', { class: 'kv-cv__foot' });
    this.readonlyBar = h('div', { class: 'kv-cv__readonly', hidden: true });
    const main = h('div', { class: 'kv-cv__main' }, this.tabsEl, this.head, this.list, this.typingEl, this.readonlyBar, this.composer, this.foot);

    this.el = h('section', { class: 'kv-cv', hidden: true, attrs: { 'aria-label': tr('Conversas') } }, side, main);
    const root = document.querySelector('.ui-root') ?? document.body;
    root.append(this.el, this.wheel.el);

    client.onEvent<KvChatMessage>('chat', (m) => this.receive(m));
    client.onEvent<KvDirectMessage>('dm', (m) => this.receiveDirect(m));
    client.onEvent<{ from: string; at: number }>('typing', (t) => this.receiveTyping(t.from));
    client.on(() => {
      this.renderConvs();
      this.paintHead();
    });
    kvPeople.openDirect = (id) => this.openDirect(id);
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!this.emojiPop.hidden && !this.emojiPop.contains(t) && !this.emojiBtn.contains(t)) this.emojiPop.hidden = true;
      if (
        this.open &&
        !this.el.contains(t) &&
        !this.bar.el.contains(t) &&
        !this.topBtn?.contains(t) &&
        !t.closest?.('.kv-person-card, .ui-city-wheel, .kv-ui-toasts, dialog, .kv-ui-pop, .kv-online')
      )
        this.toggle(false);
    });
    setInterval(() => this.watchArea(), 400);
    setInterval(() => this.expireTyping(), 1_000);
    this.select(this.tabs[0] ?? 'here', false);
    void this.loadContacts();
    setInterval(() => void this.loadContacts(), 60_000);
  }

  /** O botão do topo (topbar.ts) que abre as conversas; recebe o contador de não lidas. */
  attachTopButton(btn: HTMLButtonElement | null): void {
    this.topBtn = btn;
    if (btn) btn.append(h('span', { class: 'kv-dock__badge kv-top-badge', hidden: true }));
    this.paintUnread();
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.open): void {
    this.el.hidden = !open;
    this.bar.setChatOpen(open);
    this.topBtn?.classList.toggle('is-on', open);
    this.topBtn?.setAttribute('aria-pressed', String(open));
    if (!open) {
      this.emojiPop.hidden = true;
      return;
    }
    void this.loadContacts();
    void this.refreshRooms();
    this.markSeen();
    this.scrollEnd();
    if (!this.el.classList.contains('is-reading') || window.innerWidth > 700) this.input.focus();
  }

  openDirect(id: string): void {
    kvHeads.drop(id, 'dm');
    this.toggle(true);
    this.select(`dm:${id}`);
  }

  // ------------------------------------------------------------------ teclas

  /** Teclas (captura): Enter abre a conversa, G a roda; com a roda aberta, ela fica com as teclas. */
  private onKey(e: KeyboardEvent): void {
    if (this.wheel.open) {
      if (this.wheel.key(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.key === 'Escape' && this.open) {
      if (!this.emojiPop.hidden) {
        e.preventDefault();
        this.emojiPop.hidden = true;
        return;
      }
      if (!isTyping(e.target) || (e.target === this.input && !this.input.value)) {
        e.preventDefault();
        this.toggle(false);
      }
      return;
    }
    if (!kvPeople.inside || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || modalOpen(e.target as HTMLElement | null)) return;
    // Só com o foco no escritório (página ou canvas): Enter num botão continua apertando o botão.
    const t = e.target as HTMLElement | null;
    if (t && t !== document.body && t !== document.documentElement && t.tagName !== 'CANVAS') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.toggle(true);
      this.select('here');
    } else if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      this.openWheel(null);
    }
  }

  private onInputKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void this.send();
    }
  }

  private onInputChange(): void {
    this.autosize();
    const n = [...this.input.value].length;
    this.paintFoot(n > KV_CHAT_MAX - 60 ? tr('{0} de {1} caracteres', [n, KV_CHAT_MAX]) : '');
    // "digitando…" para a outra pessoa (1:1), no máximo a cada 2 s
    const now = Date.now();
    if (this.conv.startsWith('dm:') && this.input.value.trim() && now - this.typingSent > TYPING_SEND_MS) {
      this.typingSent = now;
      void fetch('/api/kaviski/humanos/dm/typing', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: this.conv.slice(3) }),
      }).catch(() => {});
    }
  }

  private autosize(): void {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(132, this.input.scrollHeight)}px`;
  }

  private insert(text: string): void {
    const { selectionStart: a, selectionEnd: b, value } = this.input;
    this.input.value = value.slice(0, a) + text + value.slice(b);
    this.input.selectionStart = this.input.selectionEnd = a + text.length;
    this.emojiPop.hidden = true;
    this.input.focus();
    this.onInputChange();
  }

  private toggleEmoji(): void {
    this.emojiPop.hidden = !this.emojiPop.hidden;
    if (!this.emojiPop.hidden) this.emojiPop.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private setUrgent(on: boolean): void {
    this.urgent = on;
    this.urgentBtn.classList.toggle('is-on', on);
    this.urgentBtn.setAttribute('aria-pressed', String(on));
    this.composer.classList.toggle('is-urgent', on);
    this.paintFoot();
  }

  private paintFoot(extra = ''): void {
    this.foot.classList.remove('is-error');
    this.foot.textContent = extra || (this.urgent ? tr('Urgente: a pessoa recebe um aviso que só some quando ela clicar.') : tr('Enter envia · Shift+Enter quebra a linha'));
  }

  private showError(msg: string): void {
    this.foot.textContent = msg;
    this.foot.classList.add('is-error');
  }

  // ------------------------------------------------------------------ dados

  private async loadContacts(): Promise<void> {
    const r = await getJson<{ contacts?: KvContact[] }>('/api/kaviski/humanos/contacts');
    if (!r) return;
    this.contacts = r.contacts ?? [];
    // a conversa aberta conta como lida
    if (this.open && this.conv.startsWith('dm:')) {
      const c = this.contact(this.conv.slice(3));
      if (c) c.unread = 0;
    }
    this.renderConvs();
    this.renderTabs();
    this.paintHead();
  }

  private scheduleContacts(): void {
    if (this.contactsTimer) return;
    this.contactsTimer = setTimeout(() => {
      this.contactsTimer = null;
      void this.loadContacts();
    }, 600);
  }

  /** A última fala de cada sala em que estive (para a lista). */
  private async refreshRooms(): Promise<void> {
    const visible = this.rooms.filter((r) => this.roomName(r.area)).slice(0, 8);
    await Promise.all(
      visible.map(async (r) => {
        const msgs = await this.client.history(r.area);
        const last = msgs[msgs.length - 1];
        this.roomLast.set(r.area, last ? this.fromChat(last) : null);
      }),
    );
    this.renderConvs();
  }

  private contact(id: string): KvContact | undefined {
    return this.contacts.find((x) => x.id === id);
  }

  private online(id: string): KvPresencePerson | undefined {
    return this.client.state?.people.find((p) => p.id === id);
  }

  private lookOf(id: string): KvLook | undefined {
    return this.online(id)?.look ?? this.contact(id)?.look;
  }

  private statusOf(id: string): KvStatus | 'off' {
    return this.online(id)?.status ?? (this.contact(id)?.online ? (this.contact(id)!.status ?? 'disponivel') : 'off');
  }

  private nameOf(id: string): string {
    return this.online(id)?.name ?? this.contact(id)?.name ?? '';
  }

  /** Nome da sala (só se ainda a vejo). */
  private roomName(area: string): string {
    const id = area.slice(2);
    return this.store.liveSnapshot?.rooms.find((r) => r.id === id)?.name ?? '';
  }

  private fromChat(m: KvChatMessage): Msg {
    return { id: m.id, at: m.at, from: m.from, text: m.text, greet: m.greet, to: m.to };
  }

  private fromDirect(m: KvDirectMessage): Msg {
    return { id: m.id, at: m.at, from: m.from, text: m.text, urgent: m.urgent };
  }

  // ------------------------------------------------------------------ lista de conversas

  private onSearch(): void {
    this.renderConvs();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const q = this.search.input.value.trim();
    if (q.length < 2) {
      this.searchHits = [];
      return;
    }
    this.searchTimer = setTimeout(async () => {
      const r = await getJson<{ results?: KvChatPanel['searchHits'] }>(`/api/kaviski/humanos/dm/search?q=${encodeURIComponent(q)}`);
      if (this.search.input.value.trim() !== q) return;
      this.searchHits = r?.results ?? [];
      this.renderConvs();
    }, 250);
  }

  private renderConvs(): void {
    const q = this.search.input.value.trim().toLocaleLowerCase();
    const out: HTMLElement[] = [];
    const section = (title: string) => out.push(h('div', { class: 'kv-cv__section', text: title }));
    if (q) {
      const people = this.contacts.filter((c) => c.name.toLocaleLowerCase().includes(q));
      if (people.length) {
        section(tr('Pessoas'));
        for (const c of people) out.push(this.dmItem(c));
      }
      const rooms = this.rooms.filter((r) => this.roomName(r.area).toLocaleLowerCase().includes(q));
      if (rooms.length) {
        section(tr('Salas'));
        for (const r of rooms) out.push(this.roomItem(r.area));
      }
      if (this.searchHits.length) {
        section(tr('Mensagens'));
        for (const hit of this.searchHits) out.push(this.hitItem(hit, q));
      }
      if (!out.length) out.push(kvEmpty(KV_ICONS.search, tr('Nada encontrado'), q.length < 2 ? tr('Escreva mais uma letra para buscar nas mensagens.') : tr('Ninguém nem nenhuma mensagem com isso.')));
      this.convs.replaceChildren(...out);
      this.paintUnread();
      return;
    }
    out.push(this.hereItem());
    // recentes: 1:1 com conversa e salas em que estive, a mais nova primeiro
    type Recent = { at: number; el: () => HTMLElement };
    const recent: Recent[] = [];
    for (const c of this.contacts) if (c.last || c.unread) recent.push({ at: c.last?.at ?? 0, el: () => this.dmItem(c) });
    for (const r of this.rooms) {
      if (r.area === this.areaNow() || !this.roomName(r.area)) continue;
      const last = this.roomLast.get(r.area);
      recent.push({ at: Math.max(r.at, last?.at ?? 0), el: () => this.roomItem(r.area) });
    }
    recent.sort((a, b) => b.at - a.at);
    if (recent.length) {
      section(tr('Recentes'));
      for (const r of recent) out.push(r.el());
    }
    const onlineNew = this.contacts.filter((c) => !c.last && !c.unread && this.online(c.id));
    if (onlineNew.length) {
      section(tr('Online agora'));
      for (const c of onlineNew) out.push(this.dmItem(c));
    }
    if (!this.contacts.length && !recent.length) out.push(kvEmpty(KV_ICONS.chat, tr('Nenhuma conversa ainda'), tr('Clique em + para começar uma conversa com alguém.')));
    this.convs.replaceChildren(...out);
    this.paintUnread();
  }

  private item(key: ConvKey | null, lead: HTMLElement, name: string, preview: string, unread: number, when: string, onClick: () => void, extra = ''): HTMLElement {
    const on = key !== null && this.conv === key;
    return h(
      'button',
      { class: `kv-cv__conv${on ? ' is-on' : ''}${unread ? ' has-unread' : ''} ${extra}`.trim(), type: 'button', attrs: on ? { 'aria-current': 'true' } : {}, on: { click: onClick } },
      lead,
      h(
        'span',
        { class: 'kv-cv__conv-text' },
        h('span', { class: 'kv-cv__conv-top' }, h('strong', { class: 'kv-cv__conv-name', text: name }), when ? h('time', { class: 'kv-cv__conv-when', text: when }) : null),
        h('span', { class: 'kv-cv__conv-prev', text: preview }),
      ),
      unread ? h('span', { class: 'kv-ui-count', text: unread > 99 ? '99+' : String(unread) }) : null,
    );
  }

  private areaNow(): string | null {
    return kvPeople.inside ? this.area : null;
  }

  private convIcon(svg: string, cls: string): HTMLElement {
    const el = h('span', { class: `kv-cv__icon ${cls}`, attrs: { 'aria-hidden': 'true' } });
    el.innerHTML = svg;
    return el;
  }

  private hereItem(): HTMLElement {
    const area = this.areaNow();
    const name = area ? kvAreaLabel(area, this.store) : '';
    const last = this.conv === 'here' ? this.msgs[this.msgs.length - 1] : undefined;
    const preview = last ? this.previewOf(last) : !name ? tr('Entre no escritório para conversar') : area?.startsWith('r:') ? tr('Todos nesta sala leem') : area?.startsWith('b:') ? tr('Só quem está na roda lê') : tr('Só quem está perto lê');
    return this.item('here', this.convIcon(KV_ICONS.pin, 'is-here'), name ? tr('Aqui · {0}', [name]) : tr('Aqui'), preview, this.areaUnread, last ? kvWhen(last.at) : '', () => this.select('here'));
  }

  private dmItem(c: KvContact): HTMLElement {
    const typing = this.isTypingNow(c.id);
    const preview = typing ? tr('digitando…') : c.last ? `${c.last.mine ? `${tr('Você')}: ` : ''}${c.last.text}` : `${ROLE_LABEL[c.role]} · ${this.statusText(c.id)}`;
    const el = this.item(`dm:${c.id}`, kvAvatar({ id: c.id, name: c.name, look: this.lookOf(c.id) }, 'sm', this.statusOf(c.id)), c.name, preview, c.unread, c.last ? kvWhen(c.last.at) : '', () => this.select(`dm:${c.id}`), typing ? 'is-typing' : '');
    return el;
  }

  private roomItem(area: string): HTMLElement {
    const last = this.roomLast.get(area);
    const unread = last && last.at > (this.roomSeen[area] ?? 0) && last.from.id !== this.client.state?.me ? 1 : 0;
    return this.item(`room:${area}`, this.convIcon(KV_ICONS.door, 'is-room'), this.roomName(area), last ? this.previewOf(last) : tr('Sala onde você esteve'), unread, last ? kvWhen(last.at) : '', () => this.select(`room:${area}`));
  }

  private hitItem(hit: { with: { id: string; name: string }; message: KvDirectMessage }, q: string): HTMLElement {
    const text = hit.message.text;
    const i = text.toLocaleLowerCase().indexOf(q);
    const prev = h('span', { class: 'kv-cv__conv-prev' });
    if (i >= 0) prev.append(text.slice(Math.max(0, i - 24), i), h('mark', { text: text.slice(i, i + q.length) }), text.slice(i + q.length, i + q.length + 60));
    else prev.textContent = text;
    const el = this.item(null, kvAvatar({ id: hit.with.id, name: hit.with.name, look: this.lookOf(hit.with.id) }, 'sm'), hit.with.name, '', 0, kvWhen(hit.message.at), () => {
      this.highlight = hit.message.id;
      this.select(`dm:${hit.with.id}`);
    });
    el.querySelector('.kv-cv__conv-prev')!.replaceWith(prev);
    return el;
  }

  private previewOf(m: Msg): string {
    const who = m.from.id === this.client.state?.me ? tr('Você') : m.from.name.split(' ')[0];
    if (m.greet) return `${who}: ${greetingIcon(m.greet)} ${greetingLabel(m.greet)}`;
    return `${who}: ${m.text ?? ''}`;
  }

  private statusText(id: string): string {
    const s = this.statusOf(id);
    return s === 'off' ? tr('offline') : STATUS_LABEL[s];
  }

  // ------------------------------------------------------------------ abas

  private renderTabs(): void {
    // a conversa aberta sempre tem aba
    const tabs = this.tabs.includes(this.conv) ? this.tabs : [this.conv, ...this.tabs].slice(0, TABS_MAX);
    this.tabs = tabs;
    save(K_TABS, tabs);
    this.tabsEl.replaceChildren(
      ...tabs.map((k) => {
        const on = k === this.conv;
        let lead: HTMLElement;
        let label: string;
        let unread = 0;
        if (k === 'here') {
          lead = this.convIcon(KV_ICONS.pin, 'is-here');
          label = tr('Aqui');
          unread = this.areaUnread;
        } else if (k.startsWith('room:')) {
          lead = this.convIcon(KV_ICONS.door, 'is-room');
          label = this.roomName(k.slice(5)) || tr('sala');
        } else {
          const id = k.slice(3);
          label = this.nameOf(id) || tr('Conversa');
          lead = kvAvatar({ id, name: label, look: this.lookOf(id) }, 'xs');
          unread = this.contact(id)?.unread ?? 0;
        }
        const close = h('span', { class: 'kv-cv__tab-x', role: 'button', attrs: { 'aria-label': tr('Fechar a aba {0}', [label]), tabindex: '-1' } });
        close.innerHTML = KV_ICONS.close;
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(k);
        });
        return h(
          'button',
          { class: `kv-cv__tab${on ? ' is-on' : ''}${unread && !on ? ' has-unread' : ''}`, type: 'button', role: 'tab', title: label, attrs: { 'aria-selected': String(on) }, on: { click: () => this.select(k) } },
          lead,
          h('span', { class: 'kv-cv__tab-name', text: label }),
          tabs.length > 1 ? close : null,
        );
      }),
    );
  }

  private closeTab(k: ConvKey): void {
    const i = this.tabs.indexOf(k);
    this.tabs = this.tabs.filter((x) => x !== k);
    if (this.conv === k) this.select(this.tabs[Math.max(0, i - 1)] ?? 'here');
    else this.renderTabs();
  }

  // ------------------------------------------------------------------ abrir uma conversa

  private select(conv: ConvKey, focus = true): void {
    const changed = conv !== this.conv;
    this.conv = conv;
    if (!this.tabs.includes(conv)) this.tabs = [conv, ...this.tabs].slice(0, TABS_MAX);
    this.el.classList.add('is-reading');
    this.msgs = [];
    this.more = false;
    this.list.replaceChildren(h('li', { class: 'kv-cv__loading', text: tr('Carregando…') }));
    if (changed) {
      this.input.value = '';
      this.autosize();
      this.setUrgent(false);
    }
    this.emojiPop.hidden = true;
    this.paintHead();
    this.renderTabs();
    this.renderConvs();
    const seq = ++this.loadSeq;
    if (conv === 'here') {
      this.areaUnread = 0;
      void this.loadArea(seq);
    } else if (conv.startsWith('room:')) {
      void this.loadRoom(conv.slice(5), seq);
    } else {
      const c = this.contact(conv.slice(3));
      if (c) c.unread = 0;
      void this.loadDirect(conv.slice(3), seq);
    }
    this.paintUnread();
    if (focus && this.open && window.innerWidth > 700) this.input.focus();
  }

  private paintHead(): void {
    const actions: HTMLElement[] = [];
    let lead: HTMLElement;
    let title: string;
    let sub: string;
    let badge: HTMLElement | null = null;
    const area = this.areaNow();
    this.readonlyBar.hidden = true;
    this.composer.hidden = false;
    this.greetBtn.hidden = true;
    this.urgentBtn.hidden = true;
    if (this.conv === 'here') {
      const name = area ? kvAreaLabel(area, this.store) : '';
      lead = this.convIcon(KV_ICONS.pin, 'is-here is-lg');
      title = name ? tr('Conversa · {0}', [name]) : tr('Conversa da área');
      const n = area ? (this.client.state?.people.filter((p) => p.id !== this.client.state?.me && p.pos) ?? []).length : 0;
      sub = !name
        ? tr('Entre no escritório (Andar) para conversar aqui.')
        : area!.startsWith('r:')
          ? tr('Todos nesta sala leem · fica guardada')
          : area!.startsWith('b:')
            ? tr('Conversa privada: só quem está na roda lê.')
            : tr('Por proximidade: só quem está perto lê · não fica guardada');
      if (name && n) sub += ` · ${tr('{0} no escritório', [n])}`;
      this.input.disabled = !name;
      this.greetBtn.hidden = !name;
      this.input.placeholder = name ? tr('Escreva para quem está aqui') : tr('Entre no escritório para conversar');
    } else if (this.conv.startsWith('room:')) {
      const roomArea = this.conv.slice(5);
      const name = this.roomName(roomArea);
      lead = this.convIcon(KV_ICONS.door, 'is-room is-lg');
      title = name || tr('Sala');
      sub = tr('Conversa da sala · fica guardada por 30 dias');
      const here = area === roomArea;
      this.composer.hidden = !here;
      this.input.disabled = !here;
      if (!here) {
        this.readonlyBar.hidden = false;
        this.readonlyBar.replaceChildren(
          h('span', { text: tr('Você não está nesta sala. Vá até lá para falar.') }),
          ...(kvPeople.inside ? [kvBtn(tr('Ir até a sala'), { size: 'sm', icon: KV_ICONS.walk, onClick: () => kvGoArea(roomArea) })] : []),
        );
      }
    } else {
      const id = this.conv.slice(3);
      const name = this.nameOf(id) || tr('Conversa');
      const role = this.online(id)?.role ?? this.contact(id)?.role;
      lead = kvAvatar({ id, name, look: this.lookOf(id) }, 'md', this.statusOf(id));
      title = name;
      badge = role ? kvRoleBadge(role) : null;
      sub = [this.statusText(id), tr('só vocês dois leem')].join(' · ');
      const p = this.online(id);
      if (kvPeople.inside && p?.pos && kvPeople.locate?.(id)) actions.push(kvBtn(tr('Ir até'), { size: 'sm', icon: KV_ICONS.walk, onClick: () => void kvPeople.goTo?.(id) }));
      this.input.disabled = false;
      this.urgentBtn.hidden = false;
      this.input.placeholder = tr('Mensagem para {0}', [name.split(' ')[0] ?? name]);
    }
    const back = kvIconBtn(KV_ICONS.back, tr('Conversas'), () => this.el.classList.remove('is-reading'), { cls: 'kv-cv__back' });
    const close = kvIconBtn(KV_ICONS.close, tr('Fechar'), () => this.toggle(false));
    this.head.replaceChildren(
      back,
      lead,
      h('div', { class: 'kv-cv__who' }, h('div', { class: 'kv-cv__title-row' }, h('strong', { class: 'kv-cv__title', text: title }), badge), h('span', { class: 'kv-cv__sub', text: sub })),
      h('div', { class: 'kv-cv__head-actions' }, ...actions, close),
    );
    this.paintFoot();
    this.paintTyping();
  }

  private paintUnread(): void {
    const rooms = this.rooms.reduce((n, r) => {
      const last = this.roomLast.get(r.area);
      return n + (last && r.area !== this.areaNow() && last.at > (this.roomSeen[r.area] ?? 0) && last.from.id !== this.client.state?.me ? 1 : 0);
    }, 0);
    const total = this.areaUnread + rooms + this.contacts.reduce((n, c) => n + c.unread, 0);
    this.bar.setUnread(total);
    const badge = this.topBtn?.querySelector<HTMLElement>('.kv-top-badge');
    if (badge) {
      badge.hidden = total <= 0;
      badge.textContent = total > 9 ? '9+' : String(total);
    }
  }

  /** A conversa aberta (e visível) foi vista: zera e avisa o servidor (1:1). */
  private markSeen(): void {
    if (!this.open) return;
    if (this.conv === 'here') this.areaUnread = 0;
    else if (this.conv.startsWith('room:')) {
      const area = this.conv.slice(5);
      this.roomSeen[area] = Date.now();
      save(K_SEEN, this.roomSeen);
    } else {
      const id = this.conv.slice(3);
      const c = this.contact(id);
      if (c) c.unread = 0;
      void this.client.directRead(id);
    }
    this.renderConvs();
    this.renderTabs();
  }

  // ------------------------------------------------------------------ carregar

  private async loadArea(seq: number): Promise<void> {
    const area = this.areaNow();
    if (!area) return this.showEmpty(kvEmpty(KV_ICONS.walk, tr('Você está fora do escritório'), tr('Entre no escritório (Andar, na lista de quem está online) para conversar com quem está perto.')));
    if (area.startsWith('b:')) return this.showEmpty(kvEmpty(KV_ICONS.lock, tr('Roda privada'), tr('Conversa privada: só quem está na roda lê.')));
    if (!area.startsWith('r:')) return this.showEmpty(kvEmpty(KV_ICONS.chat, tr('Conversa por proximidade'), tr('Aqui só quem está perto lê, e nada fica guardado. Diga oi!')));
    const msgs = await this.client.history(area);
    if (seq !== this.loadSeq || this.areaNow() !== area) return;
    this.setMsgs(msgs.map((m) => this.fromChat(m)), false);
    if (!msgs.length) this.showEmpty(kvEmpty(KV_ICONS.chat, tr('Ninguém falou nesta sala ainda'), tr('Todos nesta sala leem, e a conversa fica guardada.')));
    this.markSeen();
  }

  private async loadRoom(area: string, seq: number): Promise<void> {
    const msgs = await this.client.history(area);
    if (seq !== this.loadSeq) return;
    this.setMsgs(msgs.map((m) => this.fromChat(m)), false);
    const last = msgs[msgs.length - 1];
    this.roomLast.set(area, last ? this.fromChat(last) : null);
    if (!msgs.length) this.showEmpty(kvEmpty(KV_ICONS.door, tr('Nada nesta sala ainda'), tr('As conversas da sala ficam guardadas por 30 dias.')));
    this.markSeen();
  }

  private async loadDirect(id: string, seq: number): Promise<void> {
    const page = await getJson<{ messages?: KvDirectMessage[]; more?: boolean }>(`/api/kaviski/humanos/dm?with=${encodeURIComponent(id)}`);
    if (seq !== this.loadSeq) return;
    const msgs = page?.messages ?? [];
    this.setMsgs(msgs.map((m) => this.fromDirect(m)), !!page?.more);
    if (!msgs.length) {
      const name = this.nameOf(id);
      const empty = kvEmpty(KV_ICONS.chat, tr('Comece a conversa com {0}', [name]), tr('Só vocês dois leem. A conversa fica guardada, como no Teams.'));
      empty.prepend(kvAvatar({ id, name, look: this.lookOf(id) }, 'lg'));
      empty.querySelector('.kv-ui-ico')?.remove();
      this.showEmpty(empty);
    }
    // veio de uma busca: carrega para trás até achar a fala (até 10 páginas)
    for (let i = 0; this.highlight && i < 10 && !this.msgs.some((m) => m.id === this.highlight) && this.more; i++) await this.loadOlder();
    this.flashHighlight();
    this.markSeen();
  }

  private async loadOlder(): Promise<void> {
    if (!this.conv.startsWith('dm:') || !this.more || !this.msgs.length || this.list.dataset.loading) return;
    this.list.dataset.loading = '1';
    const seq = this.loadSeq;
    const id = this.conv.slice(3);
    const page = await getJson<{ messages?: KvDirectMessage[]; more?: boolean }>(`/api/kaviski/humanos/dm?with=${encodeURIComponent(id)}&before=${this.msgs[0]!.at}`);
    delete this.list.dataset.loading;
    if (seq !== this.loadSeq || !page) return;
    const before = this.list.scrollHeight - this.list.scrollTop;
    this.msgs = [...(page.messages ?? []).map((m) => this.fromDirect(m)), ...this.msgs];
    this.more = !!page.more;
    this.renderMsgs();
    this.list.scrollTop = this.list.scrollHeight - before;
  }

  private flashHighlight(): void {
    const id = this.highlight;
    this.highlight = null;
    if (!id) return;
    const el = this.list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.add('is-hit');
    el.scrollIntoView({ block: 'center' });
    setTimeout(() => el.classList.remove('is-hit'), 2600);
  }

  // ------------------------------------------------------------------ desenhar as falas

  private showEmpty(el: HTMLElement): void {
    this.list.replaceChildren(h('li', { class: 'kv-cv__empty' }, el));
  }

  private setMsgs(msgs: Msg[], more: boolean): void {
    this.msgs = msgs;
    this.more = more;
    this.renderMsgs();
    this.scrollEnd();
  }

  private renderMsgs(): void {
    const items: HTMLElement[] = [];
    if (this.more) items.push(h('li', { class: 'kv-cv__older' }, kvBtn(tr('Carregar anteriores'), { size: 'sm', onClick: () => void this.loadOlder() })));
    let prev: Msg | null = null;
    for (const m of this.msgs) {
      items.push(...this.msgEls(m, prev));
      prev = m;
    }
    this.list.replaceChildren(...items);
  }

  /** O separador de dia (se mudou) e a fala. */
  private msgEls(m: Msg, prev: Msg | null): HTMLElement[] {
    const out: HTMLElement[] = [];
    const day = kvDayLabel(m.at);
    if (!prev || kvDayLabel(prev.at) !== day) out.push(h('li', { class: 'kv-cv__day' }, h('span', { text: day })));
    const me = this.client.state?.me;
    const mine = m.from.id === me;
    if (m.greet) {
      const who = mine ? tr('Você') : m.from.name;
      out.push(
        h(
          'li',
          { class: 'kv-cv__greet', attrs: { 'data-id': m.id } },
          h('span', { text: `${greetingIcon(m.greet)} ${m.to ? tr('{0} → {1}: {2}', [who, m.to.name, greetingLabel(m.greet)]) : tr('{0}: {1}', [who, greetingLabel(m.greet)])}` }),
          h('time', { text: kvTime(m.at) }),
        ),
      );
      return out;
    }
    const cont = !!prev && !prev.greet && kvSameGroup({ from: prev.from.id, at: prev.at }, { from: m.from.id, at: m.at });
    const bubble = h('div', { class: 'kv-cv__bubble' });
    if (m.urgent) bubble.append(h('span', { class: 'kv-cv__urgent-tag', text: tr('Urgente') }));
    for (const part of kvLinkify(m.text ?? '')) {
      if (part.t === 'text') bubble.append(part.v);
      else bubble.append(h('a', { text: part.v, attrs: { href: part.href, target: '_blank', rel: 'noopener noreferrer nofollow' } }));
    }
    const time = h('time', { class: 'kv-cv__time', text: kvTime(m.at), title: new Date(m.at).toLocaleString(), attrs: { datetime: new Date(m.at).toISOString() } });
    const meta = cont ? null : h('div', { class: 'kv-cv__meta' }, mine ? null : h('strong', { text: m.from.name }), mine || this.conv.startsWith('dm:') ? null : kvRoleBadge(m.from.role), time);
    out.push(
      h(
        'li',
        { class: `kv-cv__msg${mine ? ' is-mine' : ''}${cont ? ' is-cont' : ''}${m.urgent ? ' is-urgent' : ''}`, attrs: { 'data-id': m.id } },
        mine ? null : cont ? h('span', { class: 'kv-cv__av is-empty' }) : h('span', { class: 'kv-cv__av' }, kvAvatar({ id: m.from.id, name: m.from.name, look: this.lookOf(m.from.id) }, 'sm')),
        h('div', { class: 'kv-cv__body' }, meta, h('div', { class: 'kv-cv__line' }, bubble, cont ? h('time', { class: 'kv-cv__time is-side', text: kvTime(m.at) }) : null)),
      ),
    );
    return out;
  }

  /** Uma fala nova na conversa aberta. */
  private push(m: Msg): void {
    if (this.msgs.some((x) => x.id === m.id)) return;
    const stick = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 40;
    this.list.querySelector('.kv-cv__empty, .kv-cv__loading')?.remove();
    const prev = this.msgs[this.msgs.length - 1] ?? null;
    this.msgs.push(m);
    for (const el of this.msgEls(m, prev)) this.list.append(el);
    if (stick || m.from.id === this.client.state?.me) this.scrollEnd();
  }

  private scrollEnd(): void {
    requestAnimationFrame(() => (this.list.scrollTop = this.list.scrollHeight));
  }

  // ------------------------------------------------------------------ mandar

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.input.disabled) return;
    let err: string | null;
    this.sendBtn.disabled = true;
    if (this.conv.startsWith('dm:')) err = await this.client.direct(this.conv.slice(3), text, this.urgent);
    else if (!kvPeople.area) err = tr('Entre no escritório (Andar) para conversar aqui.');
    else err = await this.client.say({ text });
    this.sendBtn.disabled = false;
    if (err) return this.showError(err === 'offline' ? tr('Sem conexão com o Habblaud.') : err);
    this.input.value = '';
    this.autosize();
    this.setUrgent(false);
    this.input.focus();
  }

  /** A roda de cumprimentos para `id` (ou a pessoa mais perto). */
  openWheel(id: string | null): void {
    if (!kvPeople.inside) return;
    const me = kvPeople.locate?.(null);
    if (!me) return;
    const around = kvPeople.around?.() ?? [];
    const target = id ?? pickGreetTarget({ x: me.x / TILE, y: me.y / TILE }, around.map((p) => ({ id: p.id, x: p.x / TILE, y: p.y / TILE })));
    if (!target) {
      this.bar.warn(tr('Ninguém perto para cumprimentar.'));
      return;
    }
    const person = this.online(target);
    if (!person) return;
    const them = kvPeople.locate?.(target) ?? null;
    this.wheel.show({ id: target, name: person.name }, { x: me.sx, y: me.sy - 40 }, them ? { x: them.sx, y: them.sy - 30 } : null, null, (greet) => {
      if (!this.greetGate.take(Date.now())) return this.bar.warn(tr('Devagar com os cumprimentos.'));
      void this.client.say({ greet, to: target }).then((err) => err && this.bar.warn(err));
    });
  }

  // ------------------------------------------------------------------ nova conversa

  private openPicker(): void {
    if (!this.picker) {
      const m = new KvModal({ title: tr('Nova conversa'), subtitle: tr('Escolha com quem falar.'), icon: KV_ICONS.chat, width: 440, cls: 'kv-cv-picker' });
      const search = kvInput({ placeholder: tr('Buscar pessoa'), icon: KV_ICONS.search, type: 'search' });
      const list = h('ul', { class: 'kv-cv-picker__list', role: 'listbox' });
      const render = () => {
        const q = search.input.value.trim().toLocaleLowerCase();
        const people = this.contacts.filter((c) => !q || c.name.toLocaleLowerCase().includes(q)).sort((a, b) => Number(!!this.online(b.id)) - Number(!!this.online(a.id)) || a.name.localeCompare(b.name));
        list.replaceChildren(
          ...people.map((c) =>
            h(
              'li',
              {},
              h(
                'button',
                {
                  class: 'kv-cv-picker__item',
                  type: 'button',
                  role: 'option',
                  on: {
                    click: () => {
                      m.close();
                      this.openDirect(c.id);
                    },
                  },
                },
                kvAvatar({ id: c.id, name: c.name, look: this.lookOf(c.id) }, 'sm', this.statusOf(c.id)),
                h('span', { class: 'kv-cv-picker__who' }, h('strong', { text: c.name }), h('span', { text: this.statusText(c.id) })),
                kvRoleBadge(c.role),
              ),
            ),
          ),
        );
        if (!people.length) list.append(h('li', {}, kvEmpty(KV_ICONS.users, tr('Ninguém encontrado'), this.contacts.length ? '' : tr('Ainda não há ninguém com quem você possa conversar.'))));
      };
      search.input.addEventListener('input', render);
      search.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') list.querySelector<HTMLButtonElement>('button')?.click();
        if (e.key === 'ArrowDown') list.querySelector<HTMLButtonElement>('button')?.focus();
      });
      list.addEventListener('keydown', (e) => {
        const t = e.target as HTMLElement;
        const li = t.closest('li');
        if (e.key === 'ArrowDown') (li?.nextElementSibling?.querySelector('button') as HTMLElement | null)?.focus();
        else if (e.key === 'ArrowUp') ((li?.previousElementSibling?.querySelector('button') as HTMLElement | null) ?? search.input).focus();
        else return;
        e.preventDefault();
      });
      m.body.append(search.el, list);
      this.picker = { modal: m, search: search.input, render };
    }
    const p = this.picker;
    p.search.value = '';
    p.render();
    p.modal.show();
    p.search.focus();
    void this.loadContacts().then(() => p.modal.open && p.render());
  }

  // ------------------------------------------------------------------ conversa da área

  /** Trocou de área: a conversa "Aqui" recomeça (e, numa sala de projeto, busca o histórico). */
  private watchArea(): void {
    const area = kvPeople.inside ? (kvPeople.callArea ?? kvPeople.area) : null; // W2: na roda privada, a fala dela
    if (area === this.area) return;
    if (this.area?.startsWith('r:')) {
      // saí de uma sala: ela vai para "Recentes" com a última fala que vi
      const last = this.conv === 'here' ? this.msgs[this.msgs.length - 1] : undefined;
      if (last) this.roomLast.set(this.area, last);
    }
    this.area = area;
    if (area?.startsWith('r:')) {
      this.rooms = kvRememberRoom(this.rooms, area, Date.now());
      save(K_ROOMS, this.rooms);
    }
    this.areaUnread = 0;
    if (this.conv === 'here') this.select('here', false);
    else {
      this.paintHead();
      this.renderConvs();
    }
  }

  private receive(m: KvChatMessage): void {
    const meId = this.client.state?.me ?? '';
    if (m.area !== this.areaNow()) return;
    const mine = kvPeople.locate?.(null);
    const them = m.from.id === meId ? mine : kvPeople.locate?.(m.from.id);
    const dist = mine && them ? Math.hypot(mine.x - them.x, mine.y - them.y) : null;
    if (!kvChatAudible(m, meId, dist)) return;
    const who = m.from.id === meId ? null : m.from.id;
    if (m.greet) kvPeople.say?.(who, greetingIcon(m.greet), m.to ? `${greetingLabel(m.greet)} → ${m.to.name}` : greetingLabel(m.greet), BALLOON_MS);
    else if (m.text) kvPeople.say?.(who, '💬', m.text, SAY_MS);
    if (m.area.startsWith('r:')) this.roomLast.set(m.area, this.fromChat(m));
    const reading = this.open && this.conv === 'here';
    if (this.conv === 'here') this.push(this.fromChat(m));
    if (reading) this.markSeen();
    else if (m.from.id !== meId && m.text) {
      this.areaUnread++;
      this.renderConvs();
      this.renderTabs();
    }
  }

  // ------------------------------------------------------------------ conversa 1:1

  private receiveDirect(m: KvDirectMessage): void {
    const meId = this.client.state?.me ?? '';
    const other = m.from.id === meId ? m.to.id : m.from.id;
    const viewing = this.conv === `dm:${other}`;
    const reading = this.open && viewing;
    this.typingFrom.delete(m.from.id);
    if (viewing) this.push(this.fromDirect(m));
    if (reading) {
      if (m.from.id !== meId) void this.client.directRead(other);
    } else if (m.from.id !== meId) {
      const c = this.contact(other);
      if (c) c.unread++;
      this.notify(m);
    }
    // ao lado da cabeça de quem mandou (só aqui, para quem recebe): o começo da mensagem; clique abre a conversa
    if (m.from.id !== meId) kvHeads.set(m.from.id, 'dm', kvMessageMini(m.text, tr('Mensagem de {0}', [m.from.name]), () => this.openDirect(m.from.id), m.urgent), { order: 20, ttlMs: m.urgent ? 60_000 : 12_000 });
    const c = this.contact(other);
    if (c) c.last = { text: m.text, at: m.at, mine: m.from.id === meId };
    this.contacts.sort((a, b) => b.unread - a.unread || (b.last?.at ?? 0) - (a.last?.at ?? 0));
    this.renderConvs();
    this.renderTabs();
    this.paintTyping();
    if (!c) this.scheduleContacts();
  }

  private notify(m: KvDirectMessage): void {
    kvToast(m.text, {
      key: `dm:${m.from.id}`,
      title: m.urgent ? tr('Urgente · {0}', [m.from.name]) : m.from.name,
      lead: kvAvatar({ id: m.from.id, name: m.from.name, look: this.lookOf(m.from.id) }, 'sm'),
      kind: m.urgent ? 'warn' : 'info',
      ms: m.urgent ? 0 : 6_000,
      onClick: () => this.openDirect(m.from.id),
    });
  }

  private receiveTyping(from: string): void {
    this.typingFrom.set(from, Date.now() + TYPING_MS);
    this.paintTyping();
    this.renderConvs();
  }

  private isTypingNow(id: string): boolean {
    return (this.typingFrom.get(id) ?? 0) > Date.now();
  }

  private expireTyping(): void {
    let changed = false;
    for (const [id, until] of this.typingFrom) {
      if (until <= Date.now()) {
        this.typingFrom.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.paintTyping();
      this.renderConvs();
    }
  }

  private paintTyping(): void {
    const id = this.conv.startsWith('dm:') ? this.conv.slice(3) : null;
    const on = !!id && this.isTypingNow(id);
    this.typingEl.hidden = !on;
    if (on) this.typingEl.replaceChildren(h('span', { class: 'kv-cv__dots', attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')), h('span', { text: tr('{0} está digitando…', [this.nameOf(id!).split(' ')[0] ?? '']) }));
  }
}
