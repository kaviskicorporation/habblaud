// Fork Kaviski (KAVISKI-HUMANOS.md): quem está online (fase 1b), com o kit de interface (ui/). O chip "Nome · papel" do
// topo vira um botão que abre a lista: eu (boneco, papel, status num select próprio), Andar no escritório (entrar/sair
// com o boneco), Meu avatar (editor de aparência salvo na conta) e as pessoas online — perto de mim, no escritório e
// fora dele —, com onde estão e atalhos (Mensagem, Ir até). Clicar em alguém abre o cartão da pessoa.
import type { KvLook, KvPresencePerson, KvPresenceState, KvStatus } from '../../../../shared/kaviski-presence';
import { KV_STATUSES } from '../../../../shared/kaviski-presence';
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { OfficeSnapshot } from '../../../../shared/types';
import { tr } from '../../../../shared/i18n';
import { appearanceFromSeed } from '../../art';
import type { OfficeStore } from '../../net/store';
import { AppearanceFields } from '../../ui/appearance-fields';
import { changedParts } from '../../ui/character-model';
import { h } from '../../ui/dom';
import { ROLE_LABEL } from './people';
import { kvPeople, kvRandomSeed, STATUS_LABEL } from './world';
import { kvOpenPersonCard } from './person-card';
import { kvOpenDirect } from './chat';
import { kvSetStatus, kvStatusLine } from './status';
import { kvOnClassic, kvSetClassic } from './classic'; // fork Kaviski W1: modo clássico no lugar de Andar/Sair
import { kvDeskSection } from './furniture';
import { KV_ICONS, kvAvatar, kvBtn, kvCap, kvEmpty, kvIconBtn, kvInput, kvRoleBadge, kvTitle } from './ui/kit';
import { KvSelect } from './ui/select';
import { KvModal } from './ui/modal';
import { kvToast } from './ui/toast';
import { kvDept, kvOnOrg, kvOrgOf } from './org-api';
import './online.css';

/** Onde a pessoa está, em palavras (a sala pelo nome do snapshot desta página). */
export function whereText(p: KvPresencePerson, snap: OfficeSnapshot | null): string {
  if (!p.pos) return tr('fora do escritório');
  if (p.pos.k === 'a') return tr('nas áreas comuns');
  const room = snap?.rooms.find((r) => r.id === p.pos!.r);
  if (!room) return tr('no escritório');
  return p.pos.k === 'r' ? room.name : tr('no corredor, perto de {0}', [room.name]);
}

/** Bolinha quadrada do status (para o select de status). */
function stDot(s: KvStatus): HTMLElement {
  return h('span', { class: `kv-ol__st kv-ui-st--${s}` });
}

export class KvOnline {
  readonly chip: HTMLButtonElement;
  private readonly pop: HTMLElement;
  private readonly meBox: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private readonly walkBtn: HTMLButtonElement;
  private readonly status: KvSelect<KvStatus>;
  private readonly search;
  private state: KvPresenceState | null = null;
  private sig = '';

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
    this.status = new KvSelect<KvStatus>({
      label: tr('Meu status'),
      value: 'disponivel',
      options: KV_STATUSES.map((s) => ({ value: s, label: kvCap(STATUS_LABEL[s]), icon: stDot(s) })),
      onChange: (s) => kvSetStatus({ status: s }),
    });
    this.walkBtn = kvBtn('', { size: 'sm', icon: KV_ICONS.walk, onClick: () => kvSetClassic(!kvPeople.resting) });
    const lookBtn = kvBtn(tr('Meu avatar'), { size: 'sm', icon: KV_ICONS.user, onClick: () => kvOpenProfile() });
    this.meBox = h('div', { class: 'kv-ol__me-who' });
    this.search = kvInput({ placeholder: tr('Buscar pessoa'), icon: KV_ICONS.search, type: 'search', onInput: () => this.render(true) });
    this.list = h('div', { class: 'kv-ol__list' });
    const close = kvIconBtn(KV_ICONS.close, tr('Fechar'), () => this.toggle(false), { size: 'sm' });
    this.pop = h(
      'div',
      { class: 'kv-ol', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Quem está online') } },
      h('div', { class: 'kv-ol__head' }, kvTitle('strong', tr('Quem está online'), 'kv-ol__title'), close),
      h('div', { class: 'kv-ol__me' }, this.meBox, h('div', { class: 'kv-ol__me-status' }, this.status.el)),
      // a nota do status (W2, status.ts KvStatusEditor) entra logo depois deste marcador
      h('div', { class: 'kv-online__status kv-ol__note-slot' }),
      h('div', { class: 'kv-ol__actions' }, this.walkBtn, lookBtn),
      h('p', { class: 'kv-ol__hint', text: tr('Andando: setas ou WASD (Shift corre) ou clique no chão.') }),
      h('div', { class: 'kv-ol__search' }, this.search.el),
      this.list,
    );
    (document.querySelector('.ui-root') ?? document.body).append(this.pop);
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!this.pop.hidden && !this.pop.contains(t) && !this.chip.contains(t) && !t.closest?.('.kv-ui-pop, .kv-pc, dialog')) this.toggle(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.pop.hidden && !(e.target as HTMLElement)?.closest?.('.kv-ui-pop')) this.toggle(false);
    });
    store.on('snapshot', () => this.render());
    kvOnOrg(() => this.render(true));
    kvOnClassic(() => this.render(true));
    this.render(true);
  }

  setState(s: KvPresenceState): void {
    this.state = s;
    this.render();
  }

  private toggle(open: boolean = !!this.pop.hidden): void {
    this.pop.hidden = !open;
    this.chip.setAttribute('aria-expanded', String(open));
    this.chip.classList.toggle('is-open', open);
    if (open) {
      const r = this.chip.getBoundingClientRect();
      this.pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 360))}px`;
      this.pop.style.top = `${r.bottom + 8}px`;
      this.search.input.value = '';
      this.render(true);
    }
  }

  private render(force = false): void {
    const s = this.state;
    const people = s?.people ?? [];
    const mine = people.find((p) => p.id === s?.me);
    this.count.textContent = people.length > 1 ? `· ${people.length}` : '';
    this.chip.dataset.status = mine?.status ?? 'disponivel';
    const inside = kvPeople.inside;
    const resting = kvPeople.resting;
    this.walkBtn.querySelector('.kv-ui-btn__label')?.remove();
    this.walkBtn.append(h('span', { class: 'kv-ui-btn__label', text: resting ? tr('Voltar ao escritório') : tr('Modo clássico') }));
    this.walkBtn.title = tr('Modo clássico: o Habblaud como o original e o seu avatar descansando no lounge');
    this.walkBtn.className = `kv-ui-btn kv-ui-btn--${resting ? 'primary' : 'secondary'} kv-ui-btn--sm`;
    this.walkBtn.hidden = !this.me.person;
    if (this.pop.hidden) return;
    const snap = this.store.liveSnapshot ?? null;
    const myArea = kvPeople.inside ? kvPeople.area : null;
    // a lista chega ~10 vezes por segundo: só redesenha se algo visível mudou
    const sig = [inside, resting, this.search.input.value, myArea, ...people.map((p) => `${p.id}|${p.name}|${kvStatusLine(p)}|${whereText(p, snap)}|${p.look.seed}|${p.look.color ?? ''}|${kvOrgOf(p.id)?.title ?? ''}|${kvOrgOf(p.id)?.dept ?? ''}`)].join('§');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    if (mine && this.status.value !== mine.status) this.status.value = mine.status;
    const meP = this.me.person;
    this.meBox.replaceChildren(
      kvAvatar({ id: meP?.id, name: meP?.name ?? tr('Este computador'), look: mine?.look }, 'md', mine?.status ?? null),
      h('div', { class: 'kv-ol__me-text' }, h('strong', { text: meP?.name ?? tr('Este computador') }), meP ? kvRoleBadge(meP.role) : null, meP ? orgLine(meP.id, true) : null),
    );
    const q = this.search.input.value.trim().toLocaleLowerCase();
    const others = people.filter((p) => p.id !== s?.me && (!q || p.name.toLocaleLowerCase().includes(q)));
    const near: KvPresencePerson[] = [];
    const office: KvPresencePerson[] = [];
    const away: KvPresencePerson[] = [];
    const myRoom = mine?.pos?.k === 'r' ? mine.pos.r : null;
    for (const p of others) {
      if (!p.pos) away.push(p);
      else if (myRoom && p.pos.k === 'r' && p.pos.r === myRoom) near.push(p);
      else if (!myRoom && mine?.pos && p.pos.k === mine.pos.k && (p.pos.k === 'a' || p.pos.r === mine.pos.r)) near.push(p);
      else office.push(p);
    }
    const sections: HTMLElement[] = [];
    const add = (title: string, list: KvPresencePerson[]) => {
      if (!list.length) return;
      sections.push(h('div', { class: 'kv-ol__section' }, h('span', { text: title }), h('span', { class: 'kv-ol__section-n', text: String(list.length) })));
      for (const p of list.sort((a, b) => a.name.localeCompare(b.name))) sections.push(this.row(p, snap));
    };
    add(tr('Perto de você'), near);
    add(tr('No escritório'), office);
    add(tr('Fora do escritório'), away);
    if (!sections.length) sections.push(kvEmpty(KV_ICONS.users, q ? tr('Ninguém com esse nome') : tr('Só você por aqui'), q ? '' : tr('Quando alguém entrar, aparece aqui.')));
    this.list.replaceChildren(...sections);
  }

  private row(p: KvPresencePerson, snap: OfficeSnapshot | null): HTMLElement {
    const open = (e: Event) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this.toggle(false);
      kvOpenPersonCard(p.id, { x: r.left + r.width / 2, y: r.top });
    };
    const msg = kvIconBtn(KV_ICONS.chat, tr('Mensagem para {0}', [p.name]), (e) => {
      e.stopPropagation();
      this.toggle(false);
      kvOpenDirect(p.id);
    }, { size: 'sm' });
    const go = kvPeople.inside && p.pos && kvPeople.locate?.(p.id)
      ? kvIconBtn(KV_ICONS.walk, tr('Ir até {0}', [p.name]), (e) => {
          e.stopPropagation();
          this.toggle(false);
          void kvPeople.goTo?.(p.id);
        }, { size: 'sm' })
      : null;
    return h(
      'div',
      { class: 'kv-ol__row', role: 'button', tabIndex: 0, title: tr('Abrir o cartão de {0}', [p.name]), on: { click: open, keydown: (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(e)) } },
      kvAvatar({ id: p.id, name: p.name, look: p.look }, 'sm', p.status),
      h('span', { class: 'kv-ol__who' }, h('span', { class: 'kv-ol__name' }, h('strong', { text: p.name }), kvRoleBadge(p.role)), orgLine(p.id), h('span', { class: 'kv-ol__where', text: `${kvCap(kvStatusLine(p))} · ${whereText(p, snap)}` })),
      h('span', { class: 'kv-ol__row-actions' }, msg, go),
    );
  }
}

/** "Dev sênior · Desenvolvimento" (cargo e área do organograma, na cor da área). */
function orgLine(id: string, mine = false): HTMLElement | null {
  const o = kvOrgOf(id);
  const dept = kvDept(o?.dept);
  if (!o?.title && !dept) return null;
  const text = [o?.title, dept?.name].filter(Boolean).join(' · ');
  const el = h('span', { class: 'kv-ol__org', text: mine ? tr('Meu cargo: {0}', [text]) : text });
  if (dept) el.style.setProperty('--c', dept.color);
  return el;
}

let profileDialog: ProfileDialog | null = null;

/** Abre o editor do meu boneco (botão Meu avatar e as boas-vindas do visitante). */
export function kvOpenProfile(): void {
  void (profileDialog ??= new ProfileDialog()).open();
}

/** Cores do crachá (a última é "outra cor", o seletor do navegador). */
const BADGE_COLORS = ['#7cc8ff', '#4fd18b', '#ffb547', '#ff6b6b', '#c46bff', '#ff8ad8', '#3cd8d2', '#fac665', '#9aa4b8', '#6aa8ff', '#ff9f43', '#a3e635'];

/** Editor do meu boneco: as mesmas peças do editor de personagem, salvo na conta (POST /api/kaviski/humanos/profile). */
class ProfileDialog {
  private readonly modal: KvModal;
  private readonly fields = new AppearanceFields();
  private readonly swatches: HTMLElement;
  private readonly custom: HTMLInputElement;
  private readonly error: HTMLElement;
  private seed = 0;
  private look: 'f' | 'm' = 'f';
  private color = '#7cc8ff';

  constructor() {
    this.modal = new KvModal({ title: tr('Meu avatar'), subtitle: tr('Como você aparece no escritório e nas conversas.'), icon: KV_ICONS.user, width: 780, cls: 'kv-pf' });
    const roll = kvBtn(tr('Sortear'), { icon: KV_ICONS.dice, onClick: () => this.roll() });
    this.custom = h('input', { class: 'kv-pf__custom-input', type: 'color', attrs: { 'aria-label': tr('Outra cor'), tabindex: '-1' } });
    this.custom.addEventListener('input', () => this.setColor(this.custom.value));
    this.swatches = h('div', { class: 'kv-pf__swatches', role: 'radiogroup', attrs: { 'aria-label': tr('Minha cor (crachá)') } });
    for (const c of BADGE_COLORS) {
      const b = h('button', { class: 'kv-pf__swatch', type: 'button', role: 'radio', title: c, attrs: { 'aria-label': c, 'data-color': c }, on: { click: () => this.setColor(c) } });
      b.style.setProperty('--sw', c);
      this.swatches.append(b);
    }
    const plus = h('span', { class: 'kv-ui-ico', attrs: { 'aria-hidden': 'true' } });
    plus.innerHTML = KV_ICONS.plus;
    const other = h('label', { class: 'kv-pf__swatch kv-pf__custom', title: tr('Outra cor') }, this.custom, plus);
    this.swatches.append(other);
    this.error = h('p', { class: 'kv-pp__error', attrs: { role: 'alert' }, hidden: true });
    this.modal.body.classList.add('ui-char', 'kv-pf__body');
    this.modal.body.append(
      h('div', { class: 'ui-char__top kv-pf__top' }, this.fields.preview, h('div', { class: 'kv-pf__side' }, roll, h('div', { class: 'kv-pf__color' }, h('span', { class: 'kv-ui-field__label', text: tr('Minha cor (crachá)') }), this.swatches))),
      this.fields.groups,
      h('div', { class: 'kv-pf__desk' }, kvDeskSection((t) => t && kvToast(t))),
      this.error,
    );
    this.modal.setFoot(kvBtn(tr('Cancelar'), { onClick: () => this.modal.close() }), kvBtn(tr('Salvar'), { variant: 'primary', icon: KV_ICONS.check, onClick: () => void this.save() }));
  }

  private setColor(c: string): void {
    this.color = c;
    for (const b of this.swatches.querySelectorAll<HTMLElement>('.kv-pf__swatch')) {
      const on = b.dataset.color === c || (b.classList.contains('kv-pf__custom') && !BADGE_COLORS.includes(c));
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
    const other = this.swatches.querySelector<HTMLElement>('.kv-pf__custom');
    other?.style.setProperty('--sw', BADGE_COLORS.includes(c) ? 'transparent' : c);
  }

  async open(): Promise<void> {
    this.error.hidden = true;
    const me = kvPeople.client?.me();
    const look = me?.look;
    this.seed = look?.seed ?? kvRandomSeed();
    this.look = look?.look ?? 'f';
    this.custom.value = look?.color ?? '#7cc8ff';
    this.setColor(look?.color ?? '#7cc8ff');
    this.fields.set({ ...appearanceFromSeed(this.seed, { look: this.look }), ...(look?.parts ?? {}) });
    this.modal.show();
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
    const look: KvLook = { seed: this.seed, look: this.look, ...(Object.keys(parts).length ? { parts } : {}), color: this.color };
    const fail = (msg: string) => {
      this.error.textContent = msg;
      this.error.hidden = false;
    };
    try {
      const res = await fetch('/api/kaviski/humanos/profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ look }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return fail(body.error ?? tr('Não deu para salvar.'));
      }
      this.modal.close();
      kvToast(tr('Avatar salvo.'), { kind: 'ok' });
    } catch {
      fail(tr('Sem conexão com o Habblaud.'));
    }
  }
}
