// Fork Kaviski (KAVISKI-HUMANOS.md): quem está online (fase 1b). O chip "Nome · papel" do topo vira um botão que abre
// a lista: o meu status (disponível, ocupado, ausente), Andar no escritório (entrar/sair com o boneco), Meu boneco
// (editor de aparência salvo na conta) e as pessoas online, com onde estão. Clicar em alguém leva a câmera até a pessoa.
import type { KvLook, KvPresencePerson, KvPresenceState, KvStatus } from '../../../../shared/kaviski-presence';
import { KV_STATUSES } from '../../../../shared/kaviski-presence';
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { OfficeSnapshot } from '../../../../shared/types';
import { tr } from '../../../../shared/i18n';
import { appearanceFromSeed } from '../../art';
import type { OfficeStore } from '../../net/store';
import { AppearanceFields } from '../../ui/appearance-fields';
import { createAvatar } from '../../ui/avatar';
import { changedParts } from '../../ui/character-model';
import { h, iconButton } from '../../ui/dom';
import { ICONS } from '../../ui/icons';
import { ROLE_LABEL } from './people';
import { kvPeople, kvRandomSeed, STATUS_LABEL } from './world';
import { kvOpenPersonCard } from './person-card';
import { kvOnClassic, kvSetClassic } from './classic'; // fork Kaviski W1: modo clássico no lugar de Andar/Sair
import { kvDeskSection } from './furniture';

function avatarOf(look: KvLook): HTMLElement {
  return createAvatar({ seed: look.seed, look: look.look, kind: 'main', parts: look.parts }, 'sm');
}

/** Onde a pessoa está, em palavras (a sala pelo nome do snapshot desta página). */
export function whereText(p: KvPresencePerson, snap: OfficeSnapshot | null): string {
  if (!p.pos) return tr('fora do escritório');
  if (p.pos.k === 'a') return tr('nas áreas comuns');
  const room = snap?.rooms.find((r) => r.id === p.pos!.r);
  if (!room) return tr('no escritório');
  return p.pos.k === 'r' ? room.name : tr('no corredor, perto de {0}', [room.name]);
}

export class KvOnline {
  readonly chip: HTMLButtonElement;
  private readonly pop: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private readonly walkBtn: HTMLButtonElement;
  private readonly statusBtns = new Map<KvStatus, HTMLButtonElement>();
  private state: KvPresenceState | null = null;

  constructor(
    private readonly me: KvMe,
    private readonly store: OfficeStore,
  ) {
    const p = me.person;
    const name = p?.name ?? tr('Este computador');
    this.count = h('span', { class: 'kv-me__count', text: '' });
    this.chip = h(
      'button',
      { class: `kv-me kv-role--${p?.role ?? 'admin'}`, type: 'button', title: tr('Quem está online'), attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, on: { click: () => this.toggle() } },
      h('span', { class: 'kv-me__dot' }),
      h('span', { class: 'kv-me__name', text: name }),
      p ? h('span', { class: 'kv-me__role', text: ROLE_LABEL[p.role] }) : null,
      this.count,
    );
    this.walkBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', on: { click: () => kvSetClassic(!kvPeople.resting) } });
    const status = h('div', { class: 'kv-online__status', role: 'group', attrs: { 'aria-label': tr('Meu status') } });
    for (const s of KV_STATUSES) {
      const b = h('button', { class: `ui-btn ui-btn--sm kv-st kv-st--${s}`, type: 'button', text: STATUS_LABEL[s], on: { click: () => kvPeople.client?.setStatus(s) } });
      this.statusBtns.set(s, b);
      status.append(b);
    }
    const lookBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Meu boneco'), on: { click: () => kvOpenProfile() } });
    this.list = h('ul', { class: 'kv-online__list' });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.toggle(false), 'ui-icon-btn--sm');
    this.pop = h(
      'div',
      { class: 'kv-online', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Quem está online') } },
      h('div', { class: 'kv-online__head' }, h('strong', { text: tr('Quem está online') }), close),
      status,
      h('div', { class: 'kv-online__actions' }, this.walkBtn, lookBtn),
      h('p', { class: 'kv-online__hint', text: tr('Andando: setas ou WASD (Shift corre) ou clique no chão.') }),
      this.list,
    );
    (document.querySelector('.ui-root') ?? document.body).append(this.pop);
    document.addEventListener('pointerdown', (e) => {
      if (!this.pop.hidden && !this.pop.contains(e.target as Node) && !this.chip.contains(e.target as Node)) this.toggle(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.pop.hidden) this.toggle(false);
    });
    store.on('snapshot', () => this.render());
    kvOnClassic(() => this.render());
    this.render();
  }

  setState(s: KvPresenceState): void {
    this.state = s;
    this.render();
  }

  private toggle(open = this.pop.hidden): void {
    this.pop.hidden = !open;
    this.chip.setAttribute('aria-expanded', String(open));
    if (open) {
      const r = this.chip.getBoundingClientRect();
      this.pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`;
      this.pop.style.top = `${r.bottom + 8}px`;
      this.render();
    }
  }

  private render(): void {
    const s = this.state;
    const people = s?.people ?? [];
    const mine = people.find((p) => p.id === s?.me);
    this.count.textContent = people.length > 1 ? `· ${people.length}` : '';
    this.chip.dataset.status = mine?.status ?? 'disponivel';
    for (const [st, b] of this.statusBtns) b.classList.toggle('is-on', mine?.status === st);
    this.walkBtn.textContent = kvPeople.resting ? tr('Voltar ao escritório') : tr('Modo clássico');
    this.walkBtn.title = tr('Modo clássico: o Habblaud como o original e o boneco descansando no lounge');
    this.walkBtn.classList.toggle('is-on', kvPeople.resting);
    this.walkBtn.hidden = !this.me.person;
    if (this.pop.hidden) return;
    const snap = this.store.liveSnapshot ?? null;
    this.list.replaceChildren(
      ...people.map((p) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: 'kv-online__item',
              type: 'button',
              attrs: p.id === s?.me ? { disabled: '' } : { title: tr('Abrir o cartão de {0}', [p.name]) },
              on: {
                click: (e: Event) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  this.toggle(false);
                  kvOpenPersonCard(p.id, { x: r.left + r.width / 2, y: r.top });
                },
              },
            },
            avatarOf(p.look),
            h(
              'span',
              { class: 'kv-online__who' },
              h('span', { class: 'kv-online__name' }, h('span', { class: `kv-online__dot kv-st--${p.status}`, title: STATUS_LABEL[p.status] }), h('strong', { text: p.id === s?.me ? tr('{0} (você)', [p.name]) : p.name })),
              h('span', { class: 'kv-online__where', text: `${ROLE_LABEL[p.role]} · ${STATUS_LABEL[p.status]} · ${whereText(p, snap)}` }),
            ),
          ),
        ),
      ),
    );
    if (!people.length) this.list.append(h('li', { class: 'kv-online__hint', text: tr('Ninguém online.') }));
  }
}

let profileDialog: ProfileDialog | null = null;

/** Abre o editor do meu boneco (botão Meu boneco e as boas-vindas do visitante). */
export function kvOpenProfile(): void {
  void (profileDialog ??= new ProfileDialog()).open();
}

/** Editor do meu boneco: as mesmas peças do editor de personagem, salvo na conta (POST /api/kaviski/humanos/profile). */
class ProfileDialog {
  readonly el: HTMLDialogElement;
  private readonly fields = new AppearanceFields();
  private readonly color: HTMLInputElement;
  private readonly error: HTMLElement;
  private seed = 0;
  private look: 'f' | 'm' = 'f';

  constructor() {
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    const roll = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Sortear'), on: { click: () => this.roll() } });
    this.color = h('input', { class: 'kv-profile__color', type: 'color', attrs: { 'aria-label': tr('Minha cor (crachá)') } });
    this.error = h('p', { class: 'kv-people__error', attrs: { role: 'alert' } });
    const save = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Salvar'), on: { click: () => void this.save() } });
    this.el = h(
      'dialog',
      { class: 'ui-dialog kv-profile', attrs: { 'aria-labelledby': 'kv-profile-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Meu boneco'), attrs: { id: 'kv-profile-title' } }), close),
      h(
        'div',
        { class: 'kv-profile__body ui-char' },
        h('div', { class: 'ui-char__top' }, this.fields.preview, h('div', { class: 'kv-profile__side' }, roll, h('label', { class: 'kv-people__label' }, tr('Minha cor (crachá)'), this.color))),
        this.fields.groups,
        kvDeskSection(),
        this.error,
        h('div', { class: 'kv-people__actions' }, save),
      ),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
  }

  async open(): Promise<void> {
    this.error.textContent = '';
    const me = kvPeople.client?.me();
    const look = me?.look;
    this.seed = look?.seed ?? kvRandomSeed();
    this.look = look?.look ?? 'f';
    this.color.value = look?.color ?? '#7cc8ff';
    this.fields.set({ ...appearanceFromSeed(this.seed, { look: this.look }), ...(look?.parts ?? {}) });
    if (!this.el.open) this.el.showModal();
  }

  private roll(): void {
    this.seed = kvRandomSeed();
    this.look = this.seed & 1 ? 'f' : 'm';
    this.fields.set(appearanceFromSeed(this.seed, { look: this.look }));
  }

  private async save(): Promise<void> {
    const draft = this.fields.value;
    if (!draft) return;
    const parts = changedParts(appearanceFromSeed(this.seed, { look: this.look }), draft);
    const look: KvLook = { seed: this.seed, look: this.look, ...(Object.keys(parts).length ? { parts } : {}), color: this.color.value };
    try {
      const res = await fetch('/api/kaviski/humanos/profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ look }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        this.error.textContent = body.error ?? tr('Não deu para salvar.');
        return;
      }
      this.el.close();
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    }
  }
}
