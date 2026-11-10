// Fork Kaviski (KAVISKI-HUMANOS.md → "Cartão da pessoa"): o cartão de uma pessoa, ao clicar no avatar dela no escritório
// ou na lista de quem está online — no tema do Habblaud (faixa na cor do crachá com textura em pixel, avatar grande,
// selo do papel).
// - Mostra nome, cargo/área, papel, status (com o recado e até quando), onde está, há quanto tempo está online e a
//   quem responde (organograma).
// - Ações do registro comum (person-actions.ts): as principais em botões grandes (Mensagem, Chamar, Cumprimentar, Ir
//   até) e as outras no grupo "Mais" (Seguir, Enviar arquivo, Marcar reunião, Ver no organograma...; recolhível).
// - Reação rápida (👋 👍 ❤️...) e caixa de mensagem rápida (com "urgente"): vão para a conversa 1:1 (chat.ts).
// - Arrastável pela faixa/topo (mouse ou toque), sem sair da tela; a posição fica lembrada neste navegador e, movido,
//   o cartão vira um painel fixo (não fecha ao clicar fora; o alfinete fixa/solta). Duplo clique na faixa volta ao
//   lugar padrão. X no canto (e Esc) fecha. No celular vira uma folha embaixo, sem arrastar.
// As partes puras (posição, memória, divisão das ações, "há X min", pasta compartilhada) ficam em person-card-model.ts.
import type { KvPresencePerson } from '../../../../shared/kaviski-presence';
import { KV_CHAT_MAX } from '../../../../shared/kaviski-presence';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { kvOnPersonActions, kvPersonActions, kvRegisterPersonAction, type KvPersonAction } from './person-actions';
import { kvPeople } from './world';
import { kvStatusLine } from './status';
import type { KvPresenceClient } from './presence';
import { whereText } from './online';
import { kvOpenDirect, type KvChatPanel } from './chat';
import { KV_ICONS, kvAvatar, kvCap, kvHashColor, kvIconBtn, kvRoleBadge } from './ui/kit';
import { kvOnOrg, kvOrgName, kvOrgOf } from './org-api';
import { kvDeptChip } from './org-people';
import { KV_CARD_ICONS } from './person-card-icons';
import {
  kvCardDefaultPos,
  kvCardIsSheet,
  kvClampCard,
  kvDragCard,
  kvFirstName,
  kvLoadCardMemory,
  kvSaveCardMemory,
  kvSinceText,
  kvSplitActions,
  type KvCardMemory,
  type KvXY,
} from './person-card-model';
import './person-card.css';

let card: KvPersonCard | null = null;

/** Ícone em pixel das ações conhecidas (as outras usam o `svg` ou o emoji que trouxeram). */
const ACTION_ICON: Record<string, string> = {
  mensagem: KV_ICONS.chat,
  cumprimentar: KV_ICONS.wave,
  'ir-ate': KV_ICONS.walk,
  chamar: KV_CARD_ICONS.bell,
  seguir: KV_CARD_ICONS.steps,
  teleportar: KV_CARD_ICONS.sparkle,
  'ir-mesa': KV_CARD_ICONS.chair,
  'conversa-privada': KV_CARD_ICONS.hush,
  'mensagem-urgente': KV_ICONS.alert,
};

/** Reações rápidas: vão como mensagem na conversa 1:1. */
const QUICK_REACTIONS = ['👋', '👍', '❤️', '😂', '🎉', '☕'];

const MORE_KEY = 'habblaud.kv.personCard.more';

/** Abre o cartão da pessoa perto de `at` (px da janela) ou no meio da tela (ou onde ficou lembrado). */
export function kvOpenPersonCard(id: string, at?: { x: number; y: number }): void {
  card?.open(id, at);
}

function moreOpen(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) !== '0';
  } catch {
    return true;
  }
}

export class KvPersonCard {
  private readonly el: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private readonly pinBtn: HTMLButtonElement;
  private readonly quick: HTMLInputElement;
  private readonly urgentBtn: HTMLButtonElement;
  private readonly quickNote: HTMLElement;
  private id: string | null = null;
  private at: { x: number; y: number } | undefined;
  private sig = '';
  private urgent = false;
  private showMore = moreOpen();
  private mem: KvCardMemory = kvLoadCardMemory();
  /** Onde o cartão está agora (null = ainda não posto). */
  private pos: KvXY | null = null;
  private drag: { id: number; from: KvXY; start: KvXY; moved: boolean } | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: KvPresenceClient,
    private readonly store: OfficeStore,
  ) {
    card = this;
    this.el = h('div', { class: 'kv-pc', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Pessoa') } });
    this.pinBtn = kvIconBtn(KV_CARD_ICONS.tack, tr('Fixar o cartão (não fecha ao clicar fora)'), () => this.setPinned(!this.mem.pinned), { size: 'sm', cls: 'kv-pc__tool kv-pc__pin' });
    const close = kvIconBtn(KV_ICONS.close, tr('Fechar'), () => this.close(), { size: 'sm', cls: 'kv-pc__tool kv-pc__close' });
    this.banner = h(
      'div',
      { class: 'kv-pc__banner', attrs: { title: tr('Arraste para mover · duplo clique volta ao lugar') }, on: { dblclick: (e) => this.onDouble(e as MouseEvent) } },
      h('span', { class: 'kv-pc__grip', attrs: { 'aria-hidden': 'true' } }),
      h('div', { class: 'kv-pc__tools' }, this.pinBtn, close),
    );
    this.head = h('div', { class: 'kv-pc__top', on: { dblclick: (e) => this.onDouble(e as MouseEvent) } });
    this.body = h('div', { class: 'kv-pc__body' });
    this.quick = h('input', {
      class: 'kv-pc__quick-input',
      type: 'text',
      attrs: { maxlength: String(KV_CHAT_MAX), autocomplete: 'off', 'aria-label': tr('Mensagem rápida') },
      on: { keydown: (e) => this.onQuickKey(e as KeyboardEvent) },
    });
    this.urgentBtn = kvIconBtn(KV_ICONS.alert, tr('Marcar como urgente'), () => (this.setUrgent(!this.urgent), this.quick.focus()), { size: 'sm', cls: 'kv-pc__urgent' });
    this.quickNote = h('p', { class: 'kv-pc__quick-note', attrs: { role: 'status' } });
    this.el.append(
      this.banner,
      this.head,
      this.body,
      h('div', { class: 'kv-pc__foot' }, h('div', { class: 'kv-pc__quick' }, this.urgentBtn, this.quick, h('span', { class: 'kv-pc__quick-hint', text: 'Enter' })), this.quickNote),
    );
    (document.querySelector('.ui-root') ?? document.body).append(this.el);

    // arrastar pela faixa e pelo topo (avatar e nome)
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointermove', (e) => this.onMove(e));
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('pointercancel', (e) => this.onUp(e));
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.pinned() && !this.el.contains(e.target as Node)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden && !document.querySelector('dialog[open]')) this.close();
    });
    window.addEventListener('resize', () => this.place(false));
    client.on(() => this.render());
    kvOnPersonActions(() => this.render());
    kvOnOrg(() => this.render(true));
    kvPeople.onPersonClick = (id, at) => {
      const r = document.getElementById('world')?.getBoundingClientRect();
      this.open(id, { x: at.x + (r?.left ?? 0), y: at.y + (r?.top ?? 0) });
    };
  }

  open(id: string, at?: { x: number; y: number }): void {
    if (id === this.client.state?.me) return;
    const same = this.id === id && !this.el.hidden;
    const wasOpen = !this.el.hidden;
    this.id = id;
    this.at = at;
    this.el.hidden = false;
    if (!same) {
      this.quick.value = '';
      this.setNote('');
      this.setUrgent(false);
    }
    this.render(true);
    // fixado e já aberto: troca a pessoa sem sair do lugar
    this.place(!(wasOpen && this.pinned()));
    this.el.querySelector<HTMLButtonElement>('.kv-pc__action')?.focus({ preventScroll: true });
  }

  close(): void {
    this.el.hidden = true;
    this.id = null;
    this.drag = null;
    this.el.classList.remove('is-dragging');
  }

  /** "Mensagem urgente": liga o urgente e põe o foco na caixa de mensagem. */
  startUrgent(): void {
    if (this.el.hidden) return;
    this.setUrgent(true);
    this.quick.focus();
  }

  // ------------------------------------------------------------------ posição e arraste

  private pinned(): boolean {
    return this.mem.pinned && !kvCardIsSheet(window.innerWidth);
  }

  private view(): { w: number; h: number } {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  /** Embaixo da barra do topo (ela fica por cima do cartão). */
  private top(): number {
    const b = document.querySelector('.ui-topbar')?.getBoundingClientRect().bottom ?? 0;
    return Math.round(b) + 6;
  }

  private size(): { w: number; h: number } {
    return { w: this.el.offsetWidth || 340, h: this.el.offsetHeight || 420 };
  }

  /** Põe o cartão no lugar: `fresh` = abrindo (lembrado ou perto do clique); senão só mantém dentro da tela. */
  private place(fresh: boolean): void {
    if (this.el.hidden) return;
    const sheet = kvCardIsSheet(window.innerWidth);
    this.el.classList.toggle('is-sheet', sheet);
    this.el.classList.toggle('is-pinned', this.pinned());
    if (sheet) {
      this.el.style.left = '';
      this.el.style.top = '';
      return;
    }
    const size = this.size();
    const view = this.view();
    if (fresh || !this.pos) this.pos = this.mem.pos ? kvClampCard(this.mem.pos, size, view, this.top()) : kvCardDefaultPos(this.at, size, view, this.top());
    else this.pos = kvClampCard(this.pos, size, view, this.top());
    this.apply();
  }

  private apply(): void {
    if (!this.pos) return;
    this.el.style.left = `${this.pos.x}px`;
    this.el.style.top = `${this.pos.y}px`;
  }

  private remember(m: KvCardMemory): void {
    this.mem = m;
    kvSaveCardMemory(m);
    this.syncPin();
  }

  private setPinned(on: boolean): void {
    this.remember({ ...(on && this.pos ? { pos: this.pos } : this.mem.pos ? { pos: this.mem.pos } : {}), pinned: on });
  }

  private syncPin(): void {
    const on = this.mem.pinned;
    this.pinBtn.setAttribute('aria-pressed', String(on));
    this.pinBtn.classList.toggle('is-on', on);
    const label = on ? tr('Soltar o cartão (volta a fechar ao clicar fora)') : tr('Fixar o cartão (não fecha ao clicar fora)');
    this.pinBtn.setAttribute('aria-label', label);
    this.pinBtn.title = label;
    this.el.classList.toggle('is-pinned', this.pinned());
  }

  private isHandle(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el?.closest?.('.kv-pc__banner, .kv-pc__top') && !el.closest('button, input, a, select, textarea');
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || kvCardIsSheet(window.innerWidth) || !this.isHandle(e.target) || !this.pos) return;
    // a captura do ponteiro só começa quando ele anda: um clique parado (e o duplo clique) chega à faixa normalmente
    this.drag = { id: e.pointerId, from: { x: e.clientX, y: e.clientY }, start: { ...this.pos }, moved: false };
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const now = { x: e.clientX, y: e.clientY };
    if (!d.moved && Math.hypot(now.x - d.from.x, now.y - d.from.y) < 4) return;
    if (!d.moved) {
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        // ponteiro que já sumiu
      }
    }
    d.moved = true;
    this.el.classList.add('is-dragging');
    this.pos = kvDragCard(d.start, d.from, now, this.size(), this.view(), this.top());
    this.apply();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    this.el.classList.remove('is-dragging');
    // movido: lembra o lugar e vira painel fixo
    if (d.moved && this.pos) this.remember({ pos: this.pos, pinned: true });
  }

  /** Duplo clique na faixa: volta ao lugar padrão (e solta). */
  private onDouble(e: MouseEvent): void {
    if (!this.isHandle(e.target)) return;
    this.remember({ pinned: false });
    this.place(true);
  }

  // ------------------------------------------------------------------ mensagem rápida

  private setUrgent(on: boolean): void {
    this.urgent = on;
    this.urgentBtn.classList.toggle('is-on', on);
    this.urgentBtn.setAttribute('aria-pressed', String(on));
    this.el.classList.toggle('is-urgent', on);
    this.updatePlaceholder();
  }

  private updatePlaceholder(): void {
    const p = this.person();
    const first = p ? kvFirstName(p.name) : '';
    this.quick.placeholder = this.urgent ? tr('Mensagem urgente para {0}…', [first]) : tr('Mensagem rápida para {0}…', [first]);
  }

  private setNote(text: string, ok = false): void {
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = null;
    this.quickNote.textContent = text;
    this.quickNote.classList.toggle('is-ok', ok);
    if (ok && text) this.noteTimer = setTimeout(() => this.setNote(''), 2_500);
  }

  private onQuickKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const text = this.quick.value.trim();
    const id = this.id;
    if (!text || !id) return;
    this.quick.disabled = true;
    void this.client.direct(id, text, this.urgent).then((err) => {
      this.quick.disabled = false;
      if (err) {
        this.setNote(err === 'offline' ? tr('Sem conexão com o Habblaud.') : err);
        return;
      }
      this.quick.value = '';
      // fixado: continua aberto; senão fecha e abre a conversa
      if (this.pinned()) {
        this.setUrgent(false);
        this.setNote(tr('Mensagem enviada.'), true);
        return;
      }
      this.close();
      kvOpenDirect(id);
    });
  }

  private react(p: KvPresencePerson, emoji: string): void {
    void this.client.direct(p.id, emoji).then((err) => {
      if (this.id !== p.id) return;
      if (err) this.setNote(err === 'offline' ? tr('Sem conexão com o Habblaud.') : err);
      else this.setNote(tr('{0} enviado para {1}.', [emoji, kvFirstName(p.name)]), true);
    });
  }

  // ------------------------------------------------------------------ desenho

  private person(): KvPresencePerson | undefined {
    return this.id ? this.client.state?.people.find((x) => x.id === this.id) : undefined;
  }

  /** Redesenha só quando algo que aparece mudou (o estado chega ~10 vezes por segundo). */
  private render(force = false): void {
    if (this.el.hidden || !this.id) return;
    const p = this.person();
    if (!p) {
      this.close();
      return;
    }
    const actions = kvPersonActions(p);
    const where = whereText(p, this.store.liveSnapshot ?? null);
    const org = kvOrgOf(p.id);
    const since = kvSinceText(p.since, Date.now());
    const sig = [p.name, p.role, kvStatusLine(p), where, since, JSON.stringify(p.look), actions.map((a) => `${a.id}:${a.label}`).join(','), JSON.stringify(org), this.showMore].join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    const color = p.look.color ?? kvHashColor(p.id);
    this.el.style.setProperty('--kv-badge', color);
    this.el.setAttribute('aria-label', tr('Cartão de {0}', [p.name]));
    this.updatePlaceholder();
    this.syncPin();
    // o foco num botão que vai ser trocado volta para o mesmo botão (pelo id da ação)
    const focused = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('[data-action]')?.dataset.action;

    this.head.replaceChildren(
      kvAvatar({ id: p.id, name: p.name, look: p.look }, 'lg', p.status),
      h(
        'div',
        { class: 'kv-pc__who' },
        h('strong', { class: 'kv-pc__name', text: p.name }),
        org?.title ? h('span', { class: 'kv-pc__title', text: org.title }) : null,
        h('div', { class: 'kv-pc__tags' }, kvRoleBadge(p.role), kvDeptChip(org?.dept)),
      ),
    );

    const manager = org?.reportsTo ? kvOrgName(org.reportsTo) : undefined;
    const facts = h(
      'dl',
      { class: 'kv-pc__facts' },
      h('div', { class: 'kv-pc__fact' }, h('dt', { class: `kv-pc__dot kv-ui-st--${p.status}`, attrs: { 'aria-label': tr('Status') } }), h('dd', { text: kvCap(kvStatusLine(p)), attrs: { title: kvCap(kvStatusLine(p)) } })),
      h('div', { class: 'kv-pc__fact' }, this.factIcon(KV_ICONS.pin, tr('Onde está')), h('dd', { text: where, attrs: { title: where } })),
      h('div', { class: 'kv-pc__fact' }, this.factIcon(KV_CARD_ICONS.clock, tr('Online')), h('dd', { text: tr('Online {0}', [since]) })),
      manager ? h('div', { class: 'kv-pc__fact' }, this.factIcon(KV_ICONS.users, tr('Gestor')), h('dd', { text: tr('Responde a {0}', [manager]) })) : null,
      p.role === 'visitante' ? h('div', { class: 'kv-pc__fact' }, this.factIcon(KV_CARD_ICONS.briefcase, tr('Convite')), h('dd', { text: tr('Visitante: entrou por um convite') })) : null,
    );

    const { main, more } = kvSplitActions(actions);
    const reactions = h(
      'div',
      { class: 'kv-pc__reacts', role: 'group', attrs: { 'aria-label': tr('Reação rápida (vai na conversa)') } },
      h('span', { class: 'kv-pc__reacts-label', text: tr('Reação rápida') }),
      ...QUICK_REACTIONS.map((emoji) => h('button', { class: 'kv-pc__react', type: 'button', text: emoji, attrs: { title: tr('Mandar {0} na conversa', [emoji]), 'aria-label': tr('Mandar {0} na conversa', [emoji]) }, on: { click: () => this.react(p, emoji) } })),
    );
    const moreList = more.length
      ? h(
          'div',
          { class: `kv-pc__more${this.showMore ? ' is-open' : ''}` },
          h(
            'button',
            {
              class: 'kv-pc__more-toggle',
              type: 'button',
              attrs: { 'aria-expanded': String(this.showMore) },
              on: { click: () => this.toggleMore() },
            },
            h('span', { text: tr('Mais ações') }),
            h('span', { class: 'kv-pc__more-count', text: String(more.length) }),
            this.chevron(),
          ),
          this.showMore ? h('div', { class: 'kv-pc__more-list', role: 'group', attrs: { 'aria-label': tr('Mais ações') } }, ...more.map((a) => this.moreBtn(a, p))) : null,
        )
      : null;

    this.body.replaceChildren(
      facts,
      ...(main.length ? [h('div', { class: 'kv-pc__actions', role: 'group', attrs: { 'aria-label': tr('Ações') } }, ...main.map((a, i) => this.actionBtn(a, p, i === 0)))] : []),
      reactions,
      ...(moreList ? [moreList] : []),
    );
    if (focused) this.el.querySelector<HTMLElement>(`[data-action="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    if (!this.drag) this.place(false);
  }

  private toggleMore(): void {
    this.showMore = !this.showMore;
    try {
      localStorage.setItem(MORE_KEY, this.showMore ? '1' : '0');
    } catch {
      // sem localStorage
    }
    this.render(true);
    this.el.querySelector<HTMLButtonElement>('.kv-pc__more-toggle')?.focus({ preventScroll: true });
  }

  private chevron(): HTMLElement {
    const el = h('span', { class: 'kv-pc__chev', attrs: { 'aria-hidden': 'true' } });
    el.innerHTML = KV_ICONS.chevron;
    return el;
  }

  private factIcon(svg: string, label: string): HTMLElement {
    const el = h('dt', { class: 'kv-pc__fact-ico', attrs: { 'aria-label': label } });
    el.innerHTML = svg;
    return el;
  }

  private icon(a: KvPersonAction, cls: string): HTMLElement {
    const icon = h('span', { class: cls, attrs: { 'aria-hidden': 'true' } });
    const svg = a.svg ?? ACTION_ICON[a.id];
    if (svg) icon.innerHTML = svg;
    else icon.textContent = a.icon ?? '•';
    return icon;
  }

  private run(a: KvPersonAction, p: KvPresencePerson): void {
    // fixado: o cartão fica (o painel continua à mão); senão fecha antes da ação, como antes
    if (!a.keepOpen && !this.pinned()) this.close();
    a.run(p);
  }

  private actionBtn(a: KvPersonAction, p: KvPresencePerson, primary: boolean): HTMLElement {
    return h(
      'button',
      { class: `kv-pc__action${primary ? ' is-primary' : ''}`, type: 'button', title: a.label, attrs: { 'data-action': a.id }, on: { click: () => this.run(a, p) } },
      this.icon(a, 'kv-pc__action-ico'),
      h('span', { class: 'kv-pc__action-label', text: a.label }),
    );
  }

  private moreBtn(a: KvPersonAction, p: KvPresencePerson): HTMLElement {
    return h(
      'button',
      { class: 'kv-pc__more-btn', type: 'button', title: a.label, attrs: { 'data-action': a.id }, on: { click: () => this.run(a, p) } },
      this.icon(a, 'kv-pc__more-ico'),
      h('span', { class: 'kv-pc__more-label', text: a.label }),
    );
  }
}

/** As ações deste módulo no registro comum (person-actions.ts): Mensagem, Cumprimentar, Ir até e Mensagem urgente. */
export function kvRegisterBasicActions(chat: KvChatPanel): void {
  kvRegisterPersonAction({ id: 'mensagem', label: tr('Mensagem'), icon: '💬', order: 10, run: (p: KvPresencePerson) => kvOpenDirect(p.id) });
  kvRegisterPersonAction({
    id: 'cumprimentar',
    label: tr('Cumprimentar'),
    icon: '👋',
    order: 20,
    when: (p) => kvPeople.inside && !!p.pos && !!kvPeople.locate?.(p.id),
    run: (p) => chat.openWheel(p.id),
  });
  kvRegisterPersonAction({
    id: 'ir-ate',
    label: tr('Ir até'),
    icon: '🚶',
    order: 30,
    when: (p) => kvPeople.inside && !!p.pos && !!kvPeople.locate?.(p.id),
    run: (p) => void kvPeople.goTo?.(p.id),
  });
  kvRegisterPersonAction({
    id: 'mensagem-urgente',
    label: tr('Mensagem urgente'),
    icon: '❗',
    order: 12,
    group: 'more',
    keepOpen: true,
    run: () => card?.startUrgent(),
  });
}
