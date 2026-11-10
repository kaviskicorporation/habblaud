// Fork Kaviski (KAVISKI-HUMANOS.md → "Convites"): tela de convites por link (fase 4), para admin e equipe.
//
// - Criar: para quem, validade (1 h, 1 dia, 7 dias ou uma data exata), uma ou várias pessoas e o acesso.
// - Editar um convite (lápis no cartão): estender (+1 h, +1 dia, +7 dias) ou mudar a data de fim (até 30 dias), pessoas,
//   descrição e o acesso. Quem já entrou continua dentro e recebe o acesso novo na hora; Encerrar derruba.
// - Acesso (invites-access.ts): salas de projeto, salas de reunião (uma a uma ou todas), salas próprias, salas temáticas
//   (desmarcada = aparece fechada, "Acesso restrito"), voz/vídeo e chat da sala. Busca e marcar/desmarcar tudo.
// - Cada cartão mostra o estado, "termina em X" e os visitantes (online agora? onde está?).
// Fala com GET|POST /api/kaviski/humanos/invites e PATCH|DELETE /api/kaviski/humanos/invites/:id. Quem decide tudo é o
// servidor; esta tela só mostra e pede.
import { KV_INVITE_MAX_AHEAD_MS, KV_INVITE_MAX_USES, type KvInviteInfo, type KvInviteState, type KvInviteTtl, type KvInviteVisitor } from '../../../../shared/kaviski-invites';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { kvAreaLabel } from './bar';
import { KvInviteAccessPicker, type KvInviteOptions } from './invites-access';
import { KV_ICONS, kvBtn, kvEmpty, kvIconBtn, kvInput, kvTitle, type KvInput } from './ui/kit';
import { KvModal, kvConfirm } from './ui/modal';
import { kvSection, kvSeg, kvSplit, type KvSeg } from './ui/section';
import { kvToast } from './ui/toast';
import './invites.css';

const CLOCK_ICON = pixelIcon(['..####..', '.#....#.', '#..#...#', '#..#...#', '#..###.#', '#......#', '.#....#.', '..####..']);
const LINK_ICON = pixelIcon(['....####', '...#...#', '..#..#.#', '.#..#..#', '#..#..#.', '#.#..#..', '#...#...', '####....']);

const API = '/api/kaviski/humanos/invites';

const STATE_LABEL: Record<KvInviteState, string> = {
  ativo: tr('ativo'),
  vencido: tr('vencido'),
  revogado: tr('revogado'),
  esgotado: tr('já usado'),
};

const TTL_LABEL: Record<KvInviteTtl, string> = { '1h': tr('1 hora'), '1d': tr('1 dia'), '7d': tr('7 dias') };
const EXTEND_LABEL: Record<KvInviteTtl, string> = { '1h': tr('+1 hora'), '1d': tr('+1 dia'), '7d': tr('+7 dias') };

function when(t: number): string {
  return new Date(t).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** "faltam 3 h 20 min" / "venceu há 2 dias". */
export function kvInviteLeft(end: number, now = Date.now()): string {
  const ms = end - now;
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  const d = Math.floor(min / 1440);
  const hh = Math.floor((min % 1440) / 60);
  const mm = min % 60;
  const span = d ? (hh ? tr('{0} d {1} h', [d, hh]) : tr('{0} d', [d])) : hh ? (mm ? tr('{0} h {1} min', [hh, mm]) : tr('{0} h', [hh])) : tr('{0} min', [Math.max(1, mm)]);
  return ms > 0 ? tr('faltam {0}', [span]) : tr('venceu há {0}', [span]);
}

/** Valor de <input type="datetime-local"> para um instante (hora local). */
function localValue(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class InvitesDialog {
  private readonly modal: KvModal;
  /** As duas colunas (lista + formulário), também montadas na aba Convites da tela de Pessoas. */
  readonly content: HTMLElement;
  private readonly list: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly ttl: KvSeg<KvInviteTtl>;
  private readonly exact: HTMLInputElement;
  private readonly createWhen: HTMLElement;
  private readonly editWhen: HTMLElement;
  private readonly endsText: HTMLElement;
  private readonly editExact: HTMLInputElement;
  private readonly uses: KvSeg<'1' | 'n'>;
  private readonly count: KvInput;
  private readonly label: KvInput;
  private readonly access: KvInviteAccessPicker;
  private readonly error: HTMLElement;
  private readonly made: HTMLElement;
  private readonly save: HTMLButtonElement;
  private readonly cancelEdit: HTMLButtonElement;
  private readonly endNow: HTMLButtonElement;
  private invites: KvInviteInfo[] = [];
  private options: KvInviteOptions = { rooms: [], own: [], themes: [] };
  /** Convite em edição (null = criando um novo). */
  private editing: KvInviteInfo | null = null;
  private base = location.origin;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Listas de visitantes abertas/fechadas à mão (sobrevivem ao redesenho a cada 10 s). */
  private readonly opened = new Set<string>();
  private readonly shut = new Set<string>();

  constructor(private readonly store?: OfficeStore) {
    this.modal = new KvModal({
      title: tr('Convidar visitantes'),
      subtitle: tr('Um link para quem não tem conta entrar como visitante, por um tempo e só nos lugares que você liberar.'),
      icon: KV_ICONS.mail,
      width: 1080,
      cls: 'kv-inv2',
      onClose: () => this.stopTimer(),
    });
    this.list = h('ul', { class: 'kv-ui-cards' });
    this.heading = kvTitle('h3', tr('Novo convite'), 'kv-inv2__heading');
    this.label = kvInput({ placeholder: tr('ex.: Reunião com a Rarm'), maxlength: 60, icon: KV_ICONS.user, name: 'label' });
    this.ttl = kvSeg<KvInviteTtl>(
      (['1h', '1d', '7d'] as KvInviteTtl[]).map((t) => ({ value: t, label: TTL_LABEL[t], icon: CLOCK_ICON })),
      '1d',
      () => (this.exact.value = ''),
      tr('Vale por'),
    );
    this.exact = this.dateInput(tr('Ou até uma data exata'));
    this.createWhen = h('div', { class: 'kv-inv2__when' }, this.ttl.el, h('label', { class: 'kv-inv2__exact' }, h('span', { text: tr('ou até') }), this.exact));
    // edição: quando termina, atalhos para estender e a data exata
    this.endsText = h('p', { class: 'kv-inv2__ends' });
    this.editExact = this.dateInput(tr('Nova data de fim'));
    const extend = (['1h', '1d', '7d'] as KvInviteTtl[]).map((t) => kvBtn(EXTEND_LABEL[t], { variant: 'secondary', icon: CLOCK_ICON, onClick: () => void this.patchNow({ extend: t }, tr('Validade estendida.')) }));
    const applyDate = kvBtn(tr('Mudar a data'), {
      variant: 'secondary',
      onClick: () => {
        const t = this.editExact.value ? new Date(this.editExact.value).getTime() : NaN;
        if (!Number.isFinite(t)) return void (this.error.textContent = tr('Escolha a nova data e hora de fim.'));
        void this.patchNow({ expiresAt: t }, tr('Validade mudada.'));
      },
    });
    this.endNow = kvBtn(tr('Encerrar agora'), { variant: 'danger', icon: KV_ICONS.trash, onClick: () => this.editing && void this.askRevoke(this.editing) });
    this.editWhen = h(
      'div',
      { class: 'kv-inv2__when', hidden: true },
      this.endsText,
      h('div', { class: 'kv-inv2__extend', role: 'group', attrs: { 'aria-label': tr('Estender') } }, ...extend),
      h('div', { class: 'kv-inv2__extend' }, h('label', { class: 'kv-inv2__exact' }, h('span', { text: tr('terminar em') }), this.editExact), applyDate, this.endNow),
    );
    this.count = kvInput({ type: 'number', value: '10', name: 'count' });
    this.count.input.min = '2';
    this.count.input.max = String(KV_INVITE_MAX_USES);
    this.count.input.setAttribute('aria-label', tr('Quantas pessoas'));
    this.count.el.classList.add('kv-inv2__count');
    this.uses = kvSeg<'1' | 'n'>(
      [
        { value: '1', label: tr('Uma pessoa (uso único)'), icon: KV_ICONS.user },
        { value: 'n', label: tr('Várias pessoas'), icon: KV_ICONS.users },
      ],
      '1',
      (v) => (this.count.el.hidden = v !== 'n'),
      tr('Quantas pessoas'),
    );
    this.count.el.hidden = true;
    this.access = new KvInviteAccessPicker();
    this.error = h('p', { class: 'kv-ui-field__error kv-inv2__error', attrs: { role: 'alert' } });
    this.made = h('div', { class: 'kv-ui-made', hidden: true });
    this.save = kvBtn(tr('Gerar link'), { variant: 'primary', icon: KV_ICONS.mail, onClick: (e) => void this.submit(e) });
    this.cancelEdit = kvBtn(tr('Novo convite'), { variant: 'ghost', icon: KV_ICONS.plus, onClick: () => this.startNew() });
    this.cancelEdit.hidden = true;
    const main = h(
      'div',
      {},
      this.heading,
      this.made,
      kvSection(KV_ICONS.user, tr('Para quem'), tr('Opcional: um nome para você lembrar do convite.'), this.label.el),
      kvSection(CLOCK_ICON, tr('Validade e pessoas'), tr('No máximo 30 dias a partir de agora. Estender não tira ninguém do escritório.'), this.createWhen, this.editWhen, h('div', { class: 'kv-inv2__uses' }, this.uses.el, this.count.el)),
      kvSection(KV_ICONS.door, tr('Onde o visitante pode ir'), tr('Sem nada marcado: só a recepção e as áreas comuns. O que não estiver liberado aparece fechado, com "Acesso restrito". O visitante não aprova, não manda tarefa e não chama agentes.'), this.access.el),
    );
    const side = h('div', {}, kvTitle('h3', tr('Convites'), 'kv-agenda2__side-title'), this.list);
    this.content = kvSplit(side, main);
    this.modal.body.append(this.content);
    this.modal.setFoot(this.error, this.cancelEdit, this.save);
  }

  private dateInput(label: string): HTMLInputElement {
    const i = h('input', { class: 'kv-ui-input__control kv-inv2__date', type: 'datetime-local', attrs: { 'aria-label': label } }) as HTMLInputElement;
    const sync = () => {
      const now = Date.now();
      i.min = localValue(now);
      i.max = localValue(now + KV_INVITE_MAX_AHEAD_MS);
    };
    i.addEventListener('focus', sync);
    sync();
    return i;
  }

  /** O rodapé com o botão (para a aba Convites da tela de Pessoas, que não usa a janela própria). */
  get foot(): HTMLElement {
    return this.modal.foot;
  }

  async open(): Promise<void> {
    this.error.textContent = '';
    this.made.hidden = true;
    this.modal.show();
    this.startTimer();
    await this.reload();
  }

  /** Busca de novo os convites e as salas (usado também na aba Convites da tela de Pessoas). */
  refresh(): Promise<void> {
    this.startTimer();
    return this.reload();
  }

  /** Enquanto a tela está aberta: contagem e "online agora" atualizados. */
  private startTimer(): void {
    if (this.timer) return;
    let n = 0;
    this.timer = setInterval(() => {
      if (!this.content.isConnected) return this.stopTimer();
      if (++n % 3 === 0) void this.reload(true);
      else {
        this.renderList();
        this.renderEnds();
      }
    }, 10_000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async reload(quiet = false): Promise<void> {
    try {
      const res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { invites?: KvInviteInfo[]; base?: string; error?: string } & Partial<KvInviteOptions>;
      if (!res.ok) {
        if (!quiet) this.error.textContent = data.error ?? tr('Não deu para carregar os convites.');
        return;
      }
      this.options = { rooms: data.rooms ?? [], own: data.own ?? [], themes: data.themes ?? [] };
      this.base = data.base ?? location.origin;
      this.invites = data.invites ?? [];
      // o convite em edição pode ter mudado (outra pessoa, ou acabou de salvar): o formulário acompanha a validade
      if (this.editing) this.editing = this.invites.find((i) => i.id === this.editing!.id) ?? null;
      if (!quiet) this.access.setOptions(this.options);
      else this.access.setOptions(this.options, true);
      this.renderList();
      this.renderEnds();
    } catch {
      if (!quiet) this.error.textContent = tr('Sem conexão com o Habblaud.');
    }
  }

  private url(i: KvInviteInfo): string {
    return i.link ? `${this.base}${i.link}` : '';
  }

  /** Onde está um visitante online (nome da área). */
  private where(area: string | undefined): string {
    if (!area) return '';
    if (area.startsWith('r:')) {
      const id = area.slice(2);
      const own = this.options.own.find((r) => r.id === id);
      if (own) return own.name;
      const room = this.options.rooms.find((r) => r.id === id);
      if (room) return room.name;
    }
    return this.store ? kvAreaLabel(area, this.store) : kvAreaLabel(area, { liveSnapshot: { rooms: [] } } as unknown as OfficeStore);
  }

  private keepOpen(id: string, open: boolean): void {
    (open ? this.opened : this.shut).add(id);
    (open ? this.shut : this.opened).delete(id);
  }

  private visitorLine(v: KvInviteVisitor): HTMLElement {
    const where = v.online ? this.where(v.area) : '';
    return h(
      'li',
      { class: `kv-inv2__visitor${v.online ? ' is-on' : ''}`, title: tr('Entrou {0}', [when(v.joinedAt)]) },
      h('span', { class: 'kv-inv2__dot', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'kv-inv2__vname', text: v.name }),
      h('span', { class: 'kv-inv2__vwhere', text: v.online ? (where ? tr('online · em {0}', [where]) : tr('online')) : tr('fora') }),
    );
  }

  private renderList(): void {
    const invites = this.invites;
    const name = (p: string) => this.options.rooms.find((r) => r.path === p)?.name ?? p.split('/').filter(Boolean).slice(-1)[0] ?? p;
    const tone: Record<KvInviteState, string> = { ativo: 'ok', vencido: 'off', revogado: 'bad', esgotado: 'warn' };
    const color: Record<KvInviteState, string> = { ativo: '#2f9e5f', vencido: '#6b7280', revogado: '#b04444', esgotado: '#b8862e' };
    this.list.replaceChildren(
      ...invites.map((i) => {
        const copy = kvIconBtn(KV_ICONS.copy, tr('Copiar link'), () => void this.copy(i), { size: 'sm' });
        copy.hidden = !i.link;
        const edit = kvIconBtn(KV_ICONS.edit, tr('Editar o convite'), () => this.startEdit(i), { size: 'sm' });
        edit.hidden = i.state === 'revogado';
        const revoke = kvIconBtn(KV_ICONS.trash, tr('Encerrar'), () => void this.askRevoke(i), { size: 'sm' });
        revoke.hidden = i.state === 'revogado' || i.state === 'vencido';
        const uses = i.maxUses === 1 ? tr('uso único') : tr('{0} de {1} pessoas', [i.uses, i.maxUses]);
        const a = i.access;
        const own = (a?.own ?? []).map((id) => this.options.own.find((r) => r.id === id)?.name).filter(Boolean) as string[];
        const where = [
          ...i.rooms.map(name),
          ...(a?.meetings ? [tr('todas as salas de reunião')] : []),
          ...own,
        ];
        const extras = [a && !a.voice ? tr('sem voz') : '', a && !a.chat ? tr('sem chat') : '', a?.blocked.length ? tr('{0} temática(s) fechada(s)', [a.blocked.length]) : ''].filter(Boolean);
        const ico = h('span', { class: 'kv-ui-card__ico', style: `--a:${color[i.state]}`, attrs: { 'aria-hidden': 'true' } });
        ico.innerHTML = KV_ICONS.mail;
        const online = i.visitors.filter((v) => v.online).length;
        const live = i.state !== 'revogado' && i.state !== 'vencido';
        return h(
          'li',
          { class: `kv-ui-card kv-inv2__card${i.state === 'ativo' || i.state === 'esgotado' ? '' : ' is-dim'}${this.editing?.id === i.id ? ' is-live' : ''}` },
          ico,
          h(
            'span',
            { class: 'kv-ui-card__text' },
            h('span', { class: 'kv-ui-card__top' }, h('strong', { text: i.label ?? tr('Convite de {0}', [i.by.name]) }), h('span', { class: `kv-ui-state kv-ui-state--${tone[i.state]}`, text: STATE_LABEL[i.state] })),
            h('span', { class: 'kv-ui-card__meta', text: [uses, live ? tr('até {0} ({1})', [when(i.expiresAt), kvInviteLeft(i.expiresAt)]) : tr('até {0}', [when(i.expiresAt)])].join(' · ') }),
            h('span', { class: 'kv-ui-card__meta', text: [where.length ? where.join(', ') : tr('só áreas comuns'), ...extras].join(' · ') }),
            i.visitors.length
              ? h(
                  'details',
                  {
                    class: 'kv-inv2__visitors',
                    attrs: { open: this.shut.has(i.id) ? undefined : online > 0 || this.opened.has(i.id) },
                    on: { toggle: (ev) => this.keepOpen(i.id, (ev.currentTarget as HTMLDetailsElement).open) },
                  },
                  h('summary', { text: online ? tr('{0} visitante(s) · {1} online agora', [i.visitors.length, online]) : tr('{0} visitante(s)', [i.visitors.length]) }),
                  h('ul', {}, ...i.visitors.map((v) => this.visitorLine(v))),
                )
              : null,
          ),
          h('span', { class: 'kv-ui-card__actions' }, edit, copy, revoke),
        );
      }),
    );
    if (!invites.length) this.list.append(h('li', {}, kvEmpty(KV_ICONS.mail, tr('Nenhum convite ainda'), tr('Gere um link ao lado e mande para quem vai visitar.'))));
  }

  /** O "termina em" da edição. */
  private renderEnds(): void {
    const i = this.editing;
    if (!i) return;
    const live = i.state !== 'revogado' && i.state !== 'vencido';
    this.endsText.textContent = live ? tr('Termina em {0} ({1}).', [when(i.expiresAt), kvInviteLeft(i.expiresAt)]) : tr('Venceu em {0}. Estender abre o link de novo.', [when(i.expiresAt)]);
    this.endsText.classList.toggle('is-off', !live);
    this.endNow.hidden = !live;
  }

  private startNew(): void {
    this.editing = null;
    this.heading.textContent = tr('Novo convite');
    this.save.textContent = tr('Gerar link');
    this.cancelEdit.hidden = true;
    this.createWhen.hidden = false;
    this.editWhen.hidden = true;
    this.label.input.value = '';
    this.exact.value = '';
    this.uses.set('1');
    this.count.el.hidden = true;
    this.access.set(null);
    this.error.textContent = '';
    this.renderList();
  }

  private startEdit(i: KvInviteInfo): void {
    this.editing = i;
    this.made.hidden = true;
    this.heading.textContent = tr('Editar: {0}', [i.label ?? tr('Convite de {0}', [i.by.name])]);
    this.save.textContent = tr('Salvar alterações');
    this.cancelEdit.hidden = false;
    this.createWhen.hidden = true;
    this.editWhen.hidden = false;
    this.editExact.value = localValue(Math.max(i.expiresAt, Date.now() + 60 * 60_000));
    this.label.input.value = i.label ?? '';
    this.uses.set(i.maxUses === 1 ? '1' : 'n');
    this.count.el.hidden = i.maxUses === 1;
    if (i.maxUses > 1) this.count.input.value = String(i.maxUses);
    this.access.set({ rooms: i.rooms, ...i.access });
    this.error.textContent = '';
    this.renderEnds();
    this.renderList();
    this.label.input.focus();
  }

  private async askRevoke(i: KvInviteInfo): Promise<void> {
    const ok = await kvConfirm({ title: tr('Encerrar o convite?'), text: tr('O link para de funcionar e quem entrou por ele sai na hora.'), ok: tr('Encerrar'), danger: true });
    if (ok) await this.revoke(i);
  }

  private async copy(i: KvInviteInfo): Promise<void> {
    const url = this.url(i);
    try {
      await navigator.clipboard.writeText(url);
      kvToast(tr('Link copiado.'), { kind: 'ok' });
    } catch {
      // sem permissão para a área de transferência (http na rede local): mostra para copiar à mão
      window.prompt(tr('Copie o link do convite:'), url);
    }
  }

  private maxUses(): number {
    return this.uses.value === 'n' ? Math.round(Number(this.count.input.value) || 2) : 1;
  }

  /** PATCH do convite em edição (atalhos de validade): salva só aquilo, na hora. */
  private async patchNow(body: Record<string, unknown>, done: string): Promise<boolean> {
    const i = this.editing;
    if (!i) return false;
    this.error.textContent = '';
    try {
      const res = await fetch(`${API}/${encodeURIComponent(i.id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { invite?: KvInviteInfo; error?: string };
      if (!res.ok || !data.invite) {
        this.error.textContent = data.error ?? tr('Não deu para salvar o convite.');
        return false;
      }
      this.editing = data.invite;
      kvToast(`${done} ${tr('Termina em {0}.', [when(data.invite.expiresAt)])}`, { kind: 'ok' });
      await this.reload(true);
      return true;
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
      return false;
    }
  }

  private async submit(e?: Event): Promise<void> {
    e?.preventDefault();
    this.error.textContent = '';
    const acc = this.access.value();
    const label = this.label.input.value.trim();
    if (this.editing) {
      this.save.disabled = true;
      const ok = await this.patchNow({ label, maxUses: this.maxUses(), ...acc }, tr('Convite salvo.'));
      this.save.disabled = false;
      if (ok) this.startEdit(this.editing!);
      return;
    }
    let when: { ttl: KvInviteTtl } | { expiresAt: number } = { ttl: this.ttl.value };
    if (this.exact.value) {
      const t = new Date(this.exact.value).getTime();
      if (!Number.isFinite(t)) return void (this.error.textContent = tr('Data de fim inválida.'));
      when = { expiresAt: t };
    }
    const body = { ...when, maxUses: this.maxUses(), ...acc, ...(label ? { label } : {}) };
    this.save.disabled = true;
    try {
      const res = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { invite?: KvInviteInfo; error?: string };
      if (!res.ok || !data.invite) {
        this.error.textContent = data.error ?? tr('Não deu para criar o convite.');
        return;
      }
      this.label.input.value = '';
      this.exact.value = '';
      await this.reload();
      const url = this.url(data.invite);
      const field = kvInput({ value: url, mono: true, icon: LINK_ICON });
      field.input.readOnly = true;
      field.input.setAttribute('aria-label', tr('Link do convite'));
      const copy = kvBtn(tr('Copiar link'), { variant: 'primary', icon: KV_ICONS.copy, onClick: () => void this.copy(data.invite!) });
      this.made.replaceChildren(kvTitle('strong', tr('Link pronto! Mande para quem vai visitar:')), h('div', { class: 'kv-ui-made__row' }, field.el, copy));
      this.made.hidden = false;
      field.input.select();
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    } finally {
      this.save.disabled = false;
    }
  }

  private async revoke(i: KvInviteInfo): Promise<void> {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(i.id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) this.error.textContent = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? tr('Não deu para encerrar.');
      if (this.editing?.id === i.id) this.startNew();
      await this.reload();
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    }
  }
}

/** Fork Kaviski W6: os convites dentro de outra janela — a aba Convites da tela de Pessoas (people.ts). */
export function kvMountInvites(host: HTMLElement): void {
  const d = new InvitesDialog();
  host.classList.add('kv-inv2', 'kv-inv2--embed');
  host.append(d.content, d.foot);
  d.foot.hidden = false;
  void d.refresh();
}
