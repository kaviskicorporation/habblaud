// Fork Kaviski (KAVISKI-HUMANOS.md): o cartão de uma pessoa, ao clicar no boneco dela no escritório ou na lista de
// quem está online. Mostra o boneco, o nome, o papel, o status e onde está, e os botões de tudo que dá para fazer com
// ela: as ações registradas por qualquer módulo em person-actions.ts (aqui: Mensagem, Cumprimentar, Ir até).
import type { KvPresencePerson } from '../../../../shared/kaviski-presence';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { createAvatar } from '../../ui/avatar';
import { h } from '../../ui/dom';
import { kvOnPersonActions, kvPersonActions, kvRegisterPersonAction } from './person-actions';
import { ROLE_LABEL } from './people';
import { kvPeople } from './world';
import { kvStatusLine } from './status';
import type { KvPresenceClient } from './presence';
import { whereText } from './online';
import { kvOpenDirect, type KvChatPanel } from './chat';

let card: KvPersonCard | null = null;

/** Abre o cartão da pessoa perto de `at` (px da janela) ou no meio da tela. */
export function kvOpenPersonCard(id: string, at?: { x: number; y: number }): void {
  card?.open(id, at);
}

export class KvPersonCard {
  private readonly el: HTMLElement;
  private id: string | null = null;
  private at: { x: number; y: number } | undefined;

  constructor(
    private readonly client: KvPresenceClient,
    private readonly store: OfficeStore,
  ) {
    card = this;
    this.el = h('div', { class: 'kv-person-card', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Pessoa') } });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
    client.on(() => this.render());
    kvOnPersonActions(() => this.render());
    kvPeople.onPersonClick = (id, at) => {
      const r = document.getElementById('world')?.getBoundingClientRect();
      this.open(id, { x: at.x + (r?.left ?? 0), y: at.y + (r?.top ?? 0) });
    };
  }

  open(id: string, at?: { x: number; y: number }): void {
    if (id === this.client.state?.me) return;
    this.id = id;
    this.at = at;
    this.el.hidden = false;
    this.render();
    this.el.querySelector<HTMLButtonElement>('.kv-person-card__actions button')?.focus();
  }

  close(): void {
    this.el.hidden = true;
    this.id = null;
  }

  private render(): void {
    if (this.el.hidden || !this.id) return;
    const p = this.client.state?.people.find((x) => x.id === this.id);
    if (!p) {
      this.close();
      return;
    }
    const actions = kvPersonActions(p);
    this.el.replaceChildren(
      h(
        'div',
        { class: 'kv-person-card__top' },
        h('span', { class: 'kv-person-card__avatar' }, createAvatar({ seed: p.look.seed, look: p.look.look, kind: 'main', parts: p.look.parts }, 'lg')),
        h(
          'div',
          { class: 'kv-person-card__who' },
          h('strong', { class: 'kv-person-card__name', text: p.name }),
          h('span', { class: `kv-role kv-role--${p.role}`, text: ROLE_LABEL[p.role] }),
          h('span', { class: 'kv-person-card__status' }, h('span', { class: `kv-online__dot kv-st--${p.status}` }), h('span', { text: kvStatusLine(p) })),
          h('span', { class: 'kv-person-card__where', text: whereText(p, this.store.liveSnapshot ?? null) }),
        ),
      ),
      h(
        'div',
        { class: 'kv-person-card__actions' },
        ...actions.map((a) =>
          h(
            'button',
            {
              class: 'ui-btn kv-person-card__action',
              type: 'button',
              on: {
                click: () => {
                  this.close();
                  a.run(p);
                },
              },
            },
            a.icon ? h('span', { class: 'kv-person-card__icon', text: a.icon, attrs: { 'aria-hidden': 'true' } }) : null,
            h('span', { text: a.label }),
          ),
        ),
      ),
    );
    // perto do clique (sem sair da tela); sem clique, no meio
    const w = 300;
    const hgt = this.el.offsetHeight || 220;
    const x = this.at ? Math.max(8, Math.min(window.innerWidth - w - 8, this.at.x - w / 2)) : (window.innerWidth - w) / 2;
    const y = this.at ? Math.max(70, Math.min(window.innerHeight - hgt - 8, this.at.y + 16)) : (window.innerHeight - hgt) / 2;
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
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
