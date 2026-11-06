// Fork Kaviski (KAVISKI-HUMANOS.md): conversa no escritório (fase 2), lado da página.
//
// - Painel "Conversa" embaixo da barra do topo (botão de balão ou Enter): as falas da área em que estou. Numa sala de
//   projeto, a sala toda (com o histórico curto do servidor); nas áreas abertas (núcleo, corredor), só quem está perto
//   (até CHAT_RANGE: a mesma distância em que a voz some).
// - Cada fala aparece também como balão em cima do boneco de quem falou (o balão do próprio Sim, showBubble).
// - Cumprimentos: a roda do Habblaud World (GreetingWheel, os mesmos 10 cumprimentos), importada sem copiar. Abre com G
//   (para a pessoa mais perto) ou clicando numa pessoa; 1–9/0 escolhem. Limite do lado de cá: o mesmo RateGate da cidade.
import type { KvChatMessage } from '../../../../shared/kaviski-presence';
import { KV_CHAT_MAX } from '../../../../shared/kaviski-presence';
import { greetingIcon, greetingLabel } from '../../../../shared/world/social-labels';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { TILE } from '../../world/constants';
import { modalOpen } from '../../world/input';
import { GreetingWheel, pickGreetTarget, RateGate, BALLOON_MS } from '../../world/city/greetings';
import '../../world/city/social.css';
import { kvAreaLabel, type KvBar } from './bar';
import type { KvPresenceClient } from './presence';
import { kvPeople } from './world';

/** Alcance da conversa nas áreas abertas (px de mundo): o mesmo em que a voz some. */
export const CHAT_RANGE = 11 * TILE;
const SAY_MS = 7_000;
const KEEP = 80;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}

/** A fala chega a mim? Sala de projeto: sempre; área aberta: só se quem falou está perto (ou fui eu). */
export function kvChatAudible(m: Pick<KvChatMessage, 'area' | 'from'>, me: string, dist: number | null): boolean {
  if (m.from.id === me || m.area.startsWith('r:')) return true;
  return dist !== null && dist <= CHAT_RANGE;
}

export class KvChatPanel {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly error: HTMLElement;
  private readonly wheel = new GreetingWheel();
  private readonly greetGate = new RateGate(20, 3_000);
  private area: string | null = null;
  private loadSeq = 0;
  private readonly seen = new Set<string>();

  constructor(
    private readonly client: KvPresenceClient,
    private readonly bar: KvBar,
    private readonly store: OfficeStore,
  ) {
    this.title = h('strong', { class: 'kv-chat__title' });
    this.list = h('ol', { class: 'kv-chat__list', attrs: { 'aria-live': 'polite' } });
    this.input = h('textarea', {
      class: 'kv-chat__input',
      attrs: { rows: '1', maxlength: String(KV_CHAT_MAX), placeholder: tr('Escreva e aperte Enter'), 'aria-label': tr('Mensagem') },
      on: { keydown: (e) => this.onInputKey(e as KeyboardEvent) },
    });
    this.error = h('p', { class: 'kv-chat__error', attrs: { role: 'alert' } });
    const greet = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: `👋 ${tr('Cumprimentar (G)')}`, on: { click: () => this.openWheel(null) } });
    const close = h('button', { class: 'ui-icon-btn ui-icon-btn--sm kv-chat__close', type: 'button', text: '×', title: tr('Fechar'), on: { click: () => this.toggle(false) } });
    this.el = h(
      'section',
      { class: 'kv-chat', hidden: true, attrs: { 'aria-label': tr('Conversa') } },
      h('div', { class: 'kv-chat__head' }, this.title, close),
      this.list,
      h('div', { class: 'kv-chat__compose' }, this.input, greet),
      this.error,
    );
    const root = document.querySelector('.ui-root') ?? document.body;
    root.append(this.el, this.wheel.el);
    client.onEvent<KvChatMessage>('chat', (m) => this.receive(m));
    kvPeople.onPersonClick = (id) => this.openWheel(id);
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    setInterval(() => this.watchArea(), 400);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.open): void {
    this.el.hidden = !open || !kvPeople.inside;
    this.bar.setChatOpen(!this.el.hidden);
    if (!this.el.hidden) {
      this.bar.setUnread(0);
      this.list.scrollTop = this.list.scrollHeight;
      this.input.focus();
    }
  }

  /** Teclas (captura): Enter abre a conversa, G a roda; com a roda aberta, ela fica com as teclas. */
  private onKey(e: KeyboardEvent): void {
    if (this.wheel.open) {
      if (this.wheel.key(e)) {
        e.preventDefault();
        e.stopPropagation();
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

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) return;
    this.error.textContent = '';
    if (!kvPeople.area) {
      this.error.textContent = tr('Espere o boneco entrar no escritório.');
      return;
    }
    const err = await this.client.say({ text });
    if (err) this.error.textContent = err;
    else this.input.value = '';
  }

  /** A roda de cumprimentos para `id` (ou a pessoa mais perto). */
  private openWheel(id: string | null): void {
    if (!kvPeople.inside) return;
    const me = kvPeople.locate?.(null);
    if (!me) return;
    const around = kvPeople.around?.() ?? [];
    const target = id ?? pickGreetTarget({ x: me.x / TILE, y: me.y / TILE }, around.map((p) => ({ id: p.id, x: p.x / TILE, y: p.y / TILE })));
    if (!target) {
      this.bar.warn(tr('Ninguém perto para cumprimentar.'));
      return;
    }
    const person = this.client.state?.people.find((p) => p.id === target);
    if (!person) return;
    const them = kvPeople.locate?.(target) ?? null;
    this.wheel.show({ id: target, name: person.name }, { x: me.sx, y: me.sy - 40 }, them ? { x: them.sx, y: them.sy - 30 } : null, null, (greet) => {
      if (!this.greetGate.take(Date.now())) return this.bar.warn(tr('Devagar com os cumprimentos.'));
      void this.client.say({ greet, to: target }).then((err) => err && this.bar.warn(err));
    });
  }

  /** Trocou de área: limpa a conversa e, numa sala de projeto, busca o histórico curto. */
  private watchArea(): void {
    const area = kvPeople.inside ? kvPeople.area : null;
    this.title.textContent = area ? tr('Conversa · {0}', [kvAreaLabel(area, this.store)]) : tr('Conversa');
    if (!kvPeople.inside && this.open) this.toggle(false);
    if (area === this.area) return;
    this.area = area;
    this.list.replaceChildren();
    this.seen.clear();
    this.bar.setUnread(0);
    if (!area) return;
    if (!area.startsWith('r:')) {
      this.list.append(h('li', { class: 'kv-chat__hint', text: tr('Aqui a conversa é por proximidade: só quem está perto lê.') }));
      return;
    }
    const seq = ++this.loadSeq;
    void this.client.history(area).then((msgs) => {
      if (seq !== this.loadSeq || this.area !== area) return;
      if (!msgs.length) this.list.append(h('li', { class: 'kv-chat__hint', text: tr('Ninguém falou nesta sala hoje.') }));
      for (const m of msgs) this.append(m, true);
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
    this.append(m, false);
    if (!this.open && m.from.id !== meId) this.bar.setUnread(this.bar.unreadCount + 1);
  }

  private append(m: KvChatMessage, old: boolean): void {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    this.list.querySelector('.kv-chat__hint')?.remove();
    const time = new Date(m.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const body = m.greet
      ? h('span', { class: 'kv-chat__greet', text: `${greetingIcon(m.greet)} ${greetingLabel(m.greet)}${m.to ? ` → ${m.to.name}` : ''}` })
      : h('span', { class: 'kv-chat__text', text: m.text ?? '' });
    const stick = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 24;
    this.list.append(
      h(
        'li',
        { class: `kv-chat__msg kv-role--${m.from.role}${old ? ' is-old' : ''}` },
        h('span', { class: 'kv-chat__meta' }, h('strong', { text: m.from.name }), h('time', { text: time, attrs: { datetime: new Date(m.at).toISOString() } })),
        body,
      ),
    );
    while (this.list.children.length > KEEP) this.list.firstElementChild?.remove();
    if (stick || old) this.list.scrollTop = this.list.scrollHeight;
  }
}
