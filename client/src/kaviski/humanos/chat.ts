// Fork Kaviski (KAVISKI-HUMANOS.md): conversas do escritório (fases 2 e 1:1), no jeito do Teams, com a cara do Habblaud.
//
// Uma janela de duas colunas embaixo da barra do topo (botão de balão no topo, na barra do boneco ou Enter):
// - à esquerda, as conversas: "Aqui" (a área em que o meu boneco está) e cada pessoa com quem posso falar (online ou
//   não), com bolinha de status, a última fala e quantas não li; busca por nome;
// - à direita, a conversa aberta e a caixa de escrever (Enter manda, Shift+Enter quebra a linha).
// Conversa da área (fase 2): numa sala de projeto, a sala toda lê (com histórico curto); nas áreas abertas, só quem está
// perto (até CHAT_RANGE); cada fala vira balão em cima do boneco. Conversa 1:1: privada (só as duas pessoas), guardada
// no servidor, com "lido até aqui" (server/kaviski/humanos/direct.ts, evento `dm`). Mensagem nova com a janela fechada (ou
// em outra conversa): contador no botão e um aviso pequeno embaixo da barra (clique abre a conversa).
// Cumprimentos: a roda do Habblaud World (GreetingWheel), com G ou pelo cartão da pessoa.
// `kvOpenDirect(id)` (também em kvPeople.openDirect) abre a conversa 1:1 com a pessoa.
import type { KvChatMessage, KvContact, KvDirectMessage } from '../../../../shared/kaviski-presence';
import { KV_CHAT_MAX } from '../../../../shared/kaviski-presence';
import { greetingIcon, greetingLabel } from '../../../../shared/world/social-labels';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { createAvatar } from '../../ui/avatar';
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

/** Alcance da conversa nas áreas abertas (px de mundo): o mesmo em que a voz some. */
export const CHAT_RANGE = 11 * TILE;
const SAY_MS = 7_000;
const KEEP = 120;
const TOAST_MS = 6_000;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}

/** A fala da área chega a mim? Sala de projeto: sempre; área aberta: só se quem falou está perto (ou fui eu). */
export function kvChatAudible(m: Pick<KvChatMessage, 'area' | 'from'>, me: string, dist: number | null): boolean {
  if (m.from.id === me || m.area.startsWith('r:') || m.area.startsWith('b:')) return true; // W2: b: = roda privada
  return dist !== null && dist <= CHAT_RANGE;
}

/** "agora", "14:05" ou "ontem"/"03/11" para a lista de conversas. */
export function kvWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  if (now - at < 60_000) return tr('agora');
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}

type Conv = { kind: 'area' } | { kind: 'dm'; id: string };

let instance: KvChatPanel | null = null;

/** Abre a conversa 1:1 com a pessoa (o cartão da pessoa, os avisos, a lista de online). */
export function kvOpenDirect(personId: string): void {
  instance?.openDirect(personId);
}

export class KvChatPanel {
  private readonly el: HTMLElement;
  private readonly convs: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly headIcon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly list: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly greetBtn: HTMLButtonElement;
  private readonly error: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly wheel = new GreetingWheel();
  private readonly greetGate = new RateGate(20, 3_000);
  private conv: Conv = { kind: 'area' };
  private area: string | null = null;
  private areaUnread = 0;
  private contacts: KvContact[] = [];
  private loadSeq = 0;
  private readonly seen = new Set<string>();
  private contactsTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Botão de conversas no topo (sempre à mão, mesmo sem o boneco no escritório). */
  private topBtn: HTMLButtonElement | null = null;

  constructor(
    private readonly client: KvPresenceClient,
    private readonly bar: KvBar,
    private readonly store: OfficeStore,
  ) {
    instance = this;
    this.search = h('input', { class: 'kv-chat__search', type: 'search', attrs: { placeholder: tr('Buscar pessoa'), 'aria-label': tr('Buscar pessoa') }, on: { input: () => this.renderConvs() } });
    this.convs = h('ul', { class: 'kv-chat__convs', attrs: { role: 'list' } });
    this.headIcon = h('span', { class: 'kv-chat__head-icon' });
    this.title = h('strong', { class: 'kv-chat__title' });
    this.subtitle = h('span', { class: 'kv-chat__subtitle' });
    this.list = h('ol', { class: 'kv-chat__list', attrs: { 'aria-live': 'polite' } });
    this.input = h('textarea', {
      class: 'kv-chat__input',
      attrs: { rows: '1', maxlength: String(KV_CHAT_MAX), placeholder: tr('Escreva e aperte Enter'), 'aria-label': tr('Mensagem') },
      on: { keydown: (e) => this.onInputKey(e as KeyboardEvent) },
    });
    const send = h('button', { class: 'ui-btn ui-btn--primary kv-chat__send', type: 'button', text: tr('Enviar'), on: { click: () => void this.send() } });
    this.greetBtn = h('button', { class: 'ui-btn kv-chat__greet-btn', type: 'button', text: '👋', title: tr('Cumprimentar (G)'), attrs: { 'aria-label': tr('Cumprimentar (G)') }, on: { click: () => this.openWheel(null) } });
    this.error = h('p', { class: 'kv-chat__error', attrs: { role: 'alert' } });
    const back = h('button', { class: 'ui-icon-btn ui-icon-btn--sm kv-chat__back', type: 'button', text: '‹', title: tr('Conversas'), on: { click: () => this.el.classList.remove('is-reading') } });
    const close = h('button', { class: 'ui-icon-btn ui-icon-btn--sm kv-chat__close', type: 'button', text: '×', title: tr('Fechar'), on: { click: () => this.toggle(false) } });
    this.el = h(
      'section',
      { class: 'kv-chat', hidden: true, attrs: { 'aria-label': tr('Conversas') } },
      h('aside', { class: 'kv-chat__side' }, h('div', { class: 'kv-chat__side-head' }, h('strong', { text: tr('Conversas') })), this.search, this.convs),
      h(
        'div',
        { class: 'kv-chat__main' },
        h('div', { class: 'kv-chat__head' }, back, this.headIcon, h('div', { class: 'kv-chat__who' }, this.title, this.subtitle), close),
        this.list,
        h('div', { class: 'kv-chat__compose' }, this.greetBtn, this.input, send),
        this.error,
      ),
    );
    this.toast = h('button', { class: 'kv-chat-toast', type: 'button', hidden: true });
    const root = document.querySelector('.ui-root') ?? document.body;
    root.append(this.el, this.wheel.el, this.toast);
    client.onEvent<KvChatMessage>('chat', (m) => this.receive(m));
    client.onEvent<KvDirectMessage>('dm', (m) => this.receiveDirect(m));
    client.on(() => this.renderConvs());
    kvPeople.openDirect = (id) => this.openDirect(id);
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (this.open && !this.el.contains(t) && !this.bar.el.contains(t) && !this.topBtn?.contains(t) && !this.toast.contains(t) && !(t as HTMLElement).closest?.('.kv-person-card, .ui-city-wheel')) this.toggle(false);
    });
    setInterval(() => this.watchArea(), 400);
    this.select({ kind: 'area' });
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
    if (open) {
      this.hideToast();
      void this.loadContacts();
      this.markSeen();
      this.list.scrollTop = this.list.scrollHeight;
      if (!this.el.classList.contains('is-reading') || window.innerWidth > 700) this.input.focus();
    }
  }

  openDirect(id: string): void {
    kvHeads.drop(id, 'dm');
    this.toggle(true);
    this.select({ kind: 'dm', id });
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
    if (e.key === 'Escape' && this.open && !isTyping(e.target)) {
      e.preventDefault();
      this.toggle(false);
      return;
    }
    if (!kvPeople.inside || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || modalOpen(e.target as HTMLElement | null)) return;
    // Só com o foco no escritório (página ou canvas): Enter num botão continua apertando o botão.
    const t = e.target as HTMLElement | null;
    if (t && t !== document.body && t !== document.documentElement && t.tagName !== 'CANVAS') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.toggle(true);
      this.select({ kind: 'area' });
    } else if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      this.openWheel(null);
    }
  }

  private onInputKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.send();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.input.blur();
      if (!this.input.value) this.toggle(false);
    }
  }

  // ------------------------------------------------------------------ conversas

  private async loadContacts(): Promise<void> {
    try {
      const res = await fetch('/api/kaviski/humanos/contacts', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      this.contacts = ((await res.json()) as { contacts?: KvContact[] }).contacts ?? [];
    } catch {
      return;
    }
    // a conversa aberta conta como lida
    if (this.open && this.conv.kind === 'dm') {
      const c = this.contacts.find((x) => x.id === (this.conv as { id: string }).id);
      if (c) c.unread = 0;
    }
    this.renderConvs();
    this.paintHead();
  }

  private scheduleContacts(): void {
    if (this.contactsTimer) return;
    this.contactsTimer = setTimeout(() => {
      this.contactsTimer = null;
      void this.loadContacts();
    }, 600);
  }

  private online(id: string) {
    return this.client.state?.people.find((p) => p.id === id);
  }

  private renderConvs(): void {
    const q = this.search.value.trim().toLocaleLowerCase();
    const areaName = kvPeople.inside && this.area ? kvAreaLabel(this.area, this.store) : '';
    const items: HTMLElement[] = [];
    if (!q) {
      items.push(
        this.convItem(
          this.conv.kind === 'area',
          h('span', { class: 'kv-chat__conv-icon', text: '📍' }),
          tr('Aqui'),
          areaName || tr('fora do escritório'),
          this.areaUnread,
          () => this.select({ kind: 'area' }),
        ),
      );
    }
    for (const c of this.contacts) {
      if (q && !c.name.toLocaleLowerCase().includes(q)) continue;
      const live = this.online(c.id);
      const status = live?.status ?? (c.online ? c.status : undefined);
      const avatar = h('span', { class: 'kv-chat__avatar' }, createAvatar({ seed: c.look.seed, look: c.look.look, kind: 'main', parts: c.look.parts }, 'sm'), h('span', { class: `kv-chat__presence${status ? ` kv-st--${status}` : ' is-off'}` }));
      const preview = c.last ? `${c.last.mine ? `${tr('Você')}: ` : ''}${c.last.text}` : `${ROLE_LABEL[c.role]} · ${status ? STATUS_LABEL[status] : tr('offline')}`;
      items.push(this.convItem(this.conv.kind === 'dm' && this.conv.id === c.id, avatar, c.name, preview, c.unread, () => this.select({ kind: 'dm', id: c.id }), c.last ? kvWhen(c.last.at) : ''));
    }
    if (!items.length) items.push(h('li', { class: 'kv-chat__hint', text: tr('Ninguém com esse nome.') }));
    this.convs.replaceChildren(...items);
    this.paintUnread();
  }

  private convItem(on: boolean, icon: HTMLElement, name: string, preview: string, unread: number, open: () => void, when = ''): HTMLElement {
    return h(
      'li',
      {},
      h(
        'button',
        { class: `kv-chat__conv${on ? ' is-on' : ''}${unread ? ' has-unread' : ''}`, type: 'button', on: { click: open } },
        icon,
        h('span', { class: 'kv-chat__conv-text' }, h('span', { class: 'kv-chat__conv-top' }, h('strong', { text: name }), when ? h('time', { text: when }) : null), h('span', { class: 'kv-chat__conv-preview', text: preview })),
        unread ? h('span', { class: 'kv-chat__unread', text: unread > 9 ? '9+' : String(unread) }) : null,
      ),
    );
  }

  private select(conv: Conv): void {
    this.conv = conv;
    this.el.classList.add('is-reading');
    this.error.textContent = '';
    this.list.replaceChildren();
    this.seen.clear();
    this.paintHead();
    this.renderConvs();
    const seq = ++this.loadSeq;
    if (conv.kind === 'area') {
      this.areaUnread = 0;
      this.loadArea(seq);
    } else {
      const c = this.contacts.find((x) => x.id === conv.id);
      if (c) c.unread = 0;
      void this.client.directHistory(conv.id).then((msgs) => {
        if (seq !== this.loadSeq) return;
        if (!msgs.length) this.list.append(h('li', { class: 'kv-chat__hint', text: tr('Comece a conversa: só vocês dois leem.') }));
        for (const m of msgs) this.appendDirect(m, true);
        this.markSeen();
      });
    }
    this.paintUnread();
    if (this.open) this.input.focus();
  }

  private paintHead(): void {
    if (this.conv.kind === 'area') {
      const name = kvPeople.inside && this.area ? kvAreaLabel(this.area, this.store) : '';
      this.headIcon.replaceChildren(h('span', { class: 'kv-chat__conv-icon', text: '📍' }));
      this.title.textContent = name ? tr('Conversa · {0}', [name]) : tr('Conversa da área');
      this.subtitle.textContent = !name
        ? tr('Entre no escritório (Andar) para conversar aqui.')
        : this.area?.startsWith('r:')
          ? tr('Todos nesta sala leem.')
          : this.area?.startsWith('b:')
            ? tr('Conversa privada: só quem está na roda lê.')
            : tr('Por proximidade: só quem está perto lê.');
      this.greetBtn.hidden = false;
      this.input.disabled = !name;
      return;
    }
    const id = this.conv.id;
    const c = this.contacts.find((x) => x.id === id);
    const live = this.online(id);
    const look = live?.look ?? c?.look;
    this.headIcon.replaceChildren(look ? createAvatar({ seed: look.seed, look: look.look, kind: 'main', parts: look.parts }, 'sm') : h('span'));
    this.title.textContent = live?.name ?? c?.name ?? '';
    const role = live?.role ?? c?.role;
    this.subtitle.textContent = [role ? ROLE_LABEL[role] : '', live ? STATUS_LABEL[live.status] : tr('offline')].filter(Boolean).join(' · ');
    this.greetBtn.hidden = true;
    this.input.disabled = false;
  }

  private paintUnread(): void {
    const total = this.areaUnread + this.contacts.reduce((n, c) => n + c.unread, 0);
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
    if (this.conv.kind === 'area') this.areaUnread = 0;
    else {
      const id = this.conv.id;
      const c = this.contacts.find((x) => x.id === id);
      if (c) c.unread = 0;
      void this.client.directRead(id);
    }
    this.renderConvs();
  }

  // ------------------------------------------------------------------ mandar

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) return;
    this.error.textContent = '';
    let err: string | null;
    if (this.conv.kind === 'dm') err = await this.client.direct(this.conv.id, text);
    else if (!kvPeople.area) err = tr('Entre no escritório (Andar) para conversar aqui.');
    else err = await this.client.say({ text });
    if (err) this.error.textContent = err;
    else this.input.value = '';
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

  // ------------------------------------------------------------------ conversa da área

  /** Trocou de área: a conversa "Aqui" recomeça (e, numa sala de projeto, busca o histórico curto). */
  private watchArea(): void {
    const area = kvPeople.inside ? (kvPeople.callArea ?? kvPeople.area) : null; // W2: na roda privada, a fala dela
    if (area === this.area) return;
    this.area = area;
    this.areaUnread = 0;
    if (this.conv.kind === 'area') {
      this.list.replaceChildren();
      this.seen.clear();
      this.loadArea(++this.loadSeq);
    }
    this.paintHead();
    this.renderConvs();
  }

  private loadArea(seq: number): void {
    const area = this.area;
    this.paintHead();
    if (!area) {
      this.list.append(h('li', { class: 'kv-chat__hint', text: tr('Entre no escritório (Andar) para conversar aqui.') }));
      return;
    }
    if (!area.startsWith('r:')) {
      this.list.append(h('li', { class: 'kv-chat__hint', text: area.startsWith('b:') ? tr('Conversa privada: só quem está na roda lê.') : tr('Aqui a conversa é por proximidade: só quem está perto lê.') }));
      return;
    }
    void this.client.history(area).then((msgs) => {
      if (seq !== this.loadSeq || this.area !== area) return;
      if (!msgs.length) this.list.append(h('li', { class: 'kv-chat__hint', text: tr('Ninguém falou nesta sala hoje.') }));
      for (const m of msgs) this.appendArea(m, true);
    });
  }

  private receive(m: KvChatMessage): void {
    const meId = this.client.state?.me ?? '';
    if (m.area !== this.area) return;
    const mine = kvPeople.locate?.(null);
    const them = m.from.id === meId ? mine : kvPeople.locate?.(m.from.id);
    const dist = mine && them ? Math.hypot(mine.x - them.x, mine.y - them.y) : null;
    if (!kvChatAudible(m, meId, dist)) return;
    const who = m.from.id === meId ? null : m.from.id;
    if (m.greet) kvPeople.say?.(who, greetingIcon(m.greet), m.to ? `${greetingLabel(m.greet)} → ${m.to.name}` : greetingLabel(m.greet), BALLOON_MS);
    else if (m.text) kvPeople.say?.(who, '💬', m.text, SAY_MS);
    const reading = this.open && this.conv.kind === 'area';
    if (reading) this.appendArea(m, false);
    else if (m.from.id !== meId && m.text) {
      this.areaUnread++;
      this.renderConvs();
    }
  }

  private appendArea(m: KvChatMessage, old: boolean): void {
    const body = m.greet ? `${greetingIcon(m.greet)} ${greetingLabel(m.greet)}${m.to ? ` → ${m.to.name}` : ''}` : (m.text ?? '');
    this.append(m.id, m.from.id, m.from.name, m.from.role, m.at, body, !!m.greet, old);
  }

  // ------------------------------------------------------------------ conversa 1:1

  private receiveDirect(m: KvDirectMessage): void {
    const meId = this.client.state?.me ?? '';
    const other = m.from.id === meId ? m.to.id : m.from.id;
    const reading = this.open && this.conv.kind === 'dm' && this.conv.id === other;
    if (reading) {
      this.appendDirect(m, false);
      if (m.from.id !== meId) void this.client.directRead(other);
    } else if (m.from.id !== meId) {
      const c = this.contacts.find((x) => x.id === other);
      if (c) c.unread++;
      this.showToast(m);
    }
    // ao lado da cabeça de quem mandou (só aqui, para quem recebe): o começo da mensagem; clique abre a conversa
    if (m.from.id !== meId) kvHeads.set(m.from.id, 'dm', kvMessageMini(m.text, tr('Mensagem de {0}', [m.from.name]), () => this.openDirect(m.from.id), m.urgent), { order: 20, ttlMs: m.urgent ? 60_000 : 12_000 });
    const c = this.contacts.find((x) => x.id === other);
    if (c) c.last = { text: m.text, at: m.at, mine: m.from.id === meId };
    this.contacts.sort((a, b) => b.unread - a.unread || (b.last?.at ?? 0) - (a.last?.at ?? 0));
    this.renderConvs();
    if (!c) this.scheduleContacts();
  }

  private appendDirect(m: KvDirectMessage, old: boolean): void {
    this.append(m.id, m.from.id, m.from.name, m.from.role, m.at, m.text, false, old, m.urgent);
  }

  private append(id: string, fromId: string, name: string, role: string, at: number, text: string, greet: boolean, old: boolean, urgent = false): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.list.querySelector('.kv-chat__hint')?.remove();
    const mine = fromId === this.client.state?.me;
    const time = new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const stick = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 24;
    // falas seguidas da mesma pessoa em até 3 min ficam juntas (o nome só na primeira)
    const prev = this.list.lastElementChild as HTMLElement | null;
    const grouped = !!prev && prev.dataset.from === fromId && at - Number(prev.dataset.at) < 180_000;
    const li = h(
      'li',
      { class: `kv-chat__msg kv-role--${role}${mine ? ' is-mine' : ''}${old ? ' is-old' : ''}${grouped ? ' is-grouped' : ''}${urgent ? ' is-urgent' : ''}` },
      grouped ? null : h('span', { class: 'kv-chat__meta' }, h('strong', { text: mine ? tr('Você') : name }), h('time', { text: time, attrs: { datetime: new Date(at).toISOString() } })),
      h('span', { class: greet ? 'kv-chat__greet' : 'kv-chat__text', text: urgent ? `❗ ${text}` : text }),
    );
    li.dataset.from = fromId;
    li.dataset.at = String(at);
    this.list.append(li);
    while (this.list.children.length > KEEP) this.list.firstElementChild?.remove();
    if (stick || old || mine) this.list.scrollTop = this.list.scrollHeight;
  }

  // ------------------------------------------------------------------ aviso de mensagem nova

  private showToast(m: KvDirectMessage): void {
    const live = this.online(m.from.id);
    const look = live?.look ?? this.contacts.find((c) => c.id === m.from.id)?.look;
    this.toast.replaceChildren(
      look ? createAvatar({ seed: look.seed, look: look.look, kind: 'main', parts: look.parts }, 'sm') : h('span'),
      h('span', { class: 'kv-chat-toast__text' }, h('strong', { text: m.urgent ? `❗ ${m.from.name}` : m.from.name }), h('span', { text: m.text })),
    );
    this.toast.classList.toggle('is-urgent', !!m.urgent);
    this.toast.onclick = () => this.openDirect(m.from.id);
    this.toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    // urgente fica até alguém clicar
    if (!m.urgent) this.toastTimer = setTimeout(() => this.hideToast(), TOAST_MS);
  }

  private hideToast(): void {
    this.toast.hidden = true;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
  }
}
