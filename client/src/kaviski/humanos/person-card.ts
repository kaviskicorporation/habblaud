// Fork Kaviski (KAVISKI-HUMANOS.md): o cartão de uma pessoa, ao clicar no boneco dela no escritório ou na lista de
// quem está online — no tema do Habblaud (faixa na cor do crachá com textura em pixel, boneco grande, selo do papel).
// Mostra nome, papel, status (e o recado, se houver) e onde está; as ações registradas por qualquer módulo em
// person-actions.ts viram botões grandes de ícone (aqui: Mensagem, Cumprimentar, Ir até); embaixo, uma caixa de
// mensagem rápida: Enter manda a 1:1 e abre a conversa numa aba (chat.ts), como no cartão de contato do Teams.
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
import './person-card.css';

let card: KvPersonCard | null = null;

/** Ícone em pixel das ações conhecidas (as outras usam o emoji que trouxeram). */
const ACTION_ICON: Record<string, string> = {
  mensagem: KV_ICONS.chat,
  cumprimentar: KV_ICONS.wave,
  'ir-ate': KV_ICONS.walk,
};

/** Abre o cartão da pessoa perto de `at` (px da janela) ou no meio da tela. */
export function kvOpenPersonCard(id: string, at?: { x: number; y: number }): void {
  card?.open(id, at);
}

export class KvPersonCard {
  private readonly el: HTMLElement;
  private readonly quick: HTMLInputElement;
  private readonly quickNote: HTMLElement;
  private id: string | null = null;
  private at: { x: number; y: number } | undefined;
  private sig = '';

  constructor(
    private readonly client: KvPresenceClient,
    private readonly store: OfficeStore,
  ) {
    card = this;
    this.el = h('div', { class: 'kv-pc', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Pessoa') } });
    this.quick = h('input', {
      class: 'kv-pc__quick-input',
      type: 'text',
      attrs: { maxlength: String(KV_CHAT_MAX), autocomplete: 'off', 'aria-label': tr('Mensagem rápida') },
      on: { keydown: (e) => this.onQuickKey(e as KeyboardEvent) },
    });
    this.quickNote = h('p', { class: 'kv-pc__quick-note', attrs: { role: 'status' } });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
    client.on(() => this.render());
    kvOnPersonActions(() => this.render(true));
    kvOnOrg(() => this.render(true));
    kvPeople.onPersonClick = (id, at) => {
      const r = document.getElementById('world')?.getBoundingClientRect();
      this.open(id, { x: at.x + (r?.left ?? 0), y: at.y + (r?.top ?? 0) });
    };
  }

  open(id: string, at?: { x: number; y: number }): void {
    if (id === this.client.state?.me) return;
    const same = this.id === id && !this.el.hidden;
    this.id = id;
    this.at = at;
    this.el.hidden = false;
    if (!same) {
      this.quick.value = '';
      this.quickNote.textContent = '';
    }
    this.render(true);
    this.el.querySelector<HTMLButtonElement>('.kv-pc__action')?.focus();
  }

  close(): void {
    this.el.hidden = true;
    this.id = null;
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
    void this.client.direct(id, text).then((err) => {
      this.quick.disabled = false;
      if (err) {
        this.quickNote.textContent = err === 'offline' ? tr('Sem conexão com o Habblaud.') : err;
        return;
      }
      this.close();
      kvOpenDirect(id);
    });
  }

  /** Redesenha só quando algo que aparece mudou (o estado chega ~10 vezes por segundo). */
  private render(force = false): void {
    if (this.el.hidden || !this.id) return;
    const p = this.client.state?.people.find((x) => x.id === this.id);
    if (!p) {
      this.close();
      return;
    }
    const actions = kvPersonActions(p);
    const where = whereText(p, this.store.liveSnapshot ?? null);
    const org = kvOrgOf(p.id);
    const sig = [p.name, p.role, kvStatusLine(p), where, JSON.stringify(p.look), actions.map((a) => a.id).join(','), JSON.stringify(org)].join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    const color = p.look.color ?? kvHashColor(p.id);
    this.el.style.setProperty('--kv-badge', color);
    this.quick.placeholder = tr('Mensagem rápida para {0}…', [p.name.split(' ')[0] ?? p.name]);
    const close = kvIconBtn(KV_ICONS.close, tr('Fechar'), () => this.close(), { size: 'sm', cls: 'kv-pc__close' });
    this.el.replaceChildren(
      h('div', { class: 'kv-pc__banner' }, close),
      h(
        'div',
        { class: 'kv-pc__top' },
        kvAvatar({ id: p.id, name: p.name, look: p.look }, 'lg', p.status),
        h(
          'div',
          { class: 'kv-pc__who' },
          h('strong', { class: 'kv-pc__name', text: p.name }),
          org?.title ? h('span', { class: 'kv-pc__title', text: org.title }) : null,
          h('div', { class: 'kv-pc__tags' }, kvRoleBadge(p.role), kvDeptChip(org?.dept)),
        ),
      ),
      h(
        'dl',
        { class: 'kv-pc__facts' },
        h('div', { class: 'kv-pc__fact' }, h('dt', { class: `kv-pc__dot kv-ui-st--${p.status}`, attrs: { 'aria-label': tr('Status') } }), h('dd', { text: kvCap(kvStatusLine(p)) })),
        h('div', { class: 'kv-pc__fact' }, this.factIcon(KV_ICONS.pin), h('dd', { text: where })),
        org?.reportsTo && kvOrgName(org.reportsTo) ? h('div', { class: 'kv-pc__fact' }, this.factIcon(KV_ICONS.users), h('dd', { text: tr('Responde a {0}', [kvOrgName(org.reportsTo)!]) })) : null,
      ),
      ...(actions.length ? [h('div', { class: 'kv-pc__actions', role: 'group', attrs: { 'aria-label': tr('Ações') } }, ...actions.map((a, i) => this.actionBtn(a, p, i === 0)))] : []),
      h('div', { class: 'kv-pc__quick' }, this.quick, h('span', { class: 'kv-pc__quick-hint', text: 'Enter' })),
      this.quickNote,
    );
    // perto do clique (sem sair da tela); sem clique, no meio
    const w = 316;
    const hgt = this.el.offsetHeight || 300;
    const x = this.at ? Math.max(8, Math.min(window.innerWidth - w - 8, this.at.x - w / 2)) : (window.innerWidth - w) / 2;
    const y = this.at ? Math.max(70, Math.min(window.innerHeight - hgt - 8, this.at.y + 16)) : (window.innerHeight - hgt) / 2;
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }

  private factIcon(svg: string): HTMLElement {
    const el = h('dt', { class: 'kv-pc__fact-ico', attrs: { 'aria-hidden': 'true' } });
    el.innerHTML = svg;
    return el;
  }

  private actionBtn(a: KvPersonAction, p: KvPresencePerson, primary: boolean): HTMLElement {
    const icon = h('span', { class: 'kv-pc__action-ico', attrs: { 'aria-hidden': 'true' } });
    if (ACTION_ICON[a.id]) icon.innerHTML = ACTION_ICON[a.id]!;
    else icon.textContent = a.icon ?? '•';
    return h(
      'button',
      {
        class: `kv-pc__action${primary ? ' is-primary' : ''}`,
        type: 'button',
        title: a.label,
        on: {
          click: () => {
            this.close();
            a.run(p);
          },
        },
      },
      icon,
      h('span', { class: 'kv-pc__action-label', text: a.label }),
    );
  }
}

/** As ações deste módulo no registro comum (person-actions.ts): Mensagem, Cumprimentar, Ir até. */
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
}
