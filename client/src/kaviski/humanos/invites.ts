// Fork Kaviski (KAVISKI-HUMANOS.md): tela de convites por link (fase 4), para admin e equipe. Cria (validade, uma ou
// várias pessoas, salas liberadas), lista com o estado, copia o link e revoga (quem entrou por ele sai na hora).
// Fala com GET|POST /api/kaviski/humanos/invites e DELETE /api/kaviski/humanos/invites/:id.
import { KV_INVITE_MAX_USES, type KvInviteInfo, type KvInviteState, type KvInviteTtl } from '../../../../shared/kaviski-invites';
import { tr } from '../../../../shared/i18n';
import { h, iconButton } from '../../ui/dom';
import { ICONS } from '../../ui/icons';

const API = '/api/kaviski/humanos/invites';

const STATE_LABEL: Record<KvInviteState, string> = {
  ativo: tr('ativo'),
  vencido: tr('vencido'),
  revogado: tr('revogado'),
  esgotado: tr('já usado'),
};

const TTL_LABEL: Record<KvInviteTtl, string> = { '1h': tr('1 hora'), '1d': tr('1 dia'), '7d': tr('7 dias') };

interface RoomRef {
  path: string;
  name: string;
}

function when(t: number): string {
  return new Date(t).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export class InvitesDialog {
  readonly el: HTMLDialogElement;
  private readonly list: HTMLElement;
  private readonly ttl: HTMLSelectElement;
  private readonly many: HTMLInputElement;
  private readonly count: HTMLInputElement;
  private readonly label: HTMLInputElement;
  private readonly roomsBox: HTMLElement;
  private readonly error: HTMLElement;
  private readonly made: HTMLElement;
  private readonly save: HTMLButtonElement;
  private rooms: RoomRef[] = [];
  private readonly chosen = new Set<string>();
  private base = location.origin;

  constructor() {
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    this.list = h('ul', { class: 'kv-people__list kv-inv__list' });
    this.ttl = h('select', { class: 'kv-people__input', attrs: { name: 'ttl' } });
    for (const t of ['1h', '1d', '7d'] as KvInviteTtl[]) this.ttl.append(h('option', { text: TTL_LABEL[t], attrs: { value: t } }));
    this.ttl.value = '1d';
    this.many = h('input', { type: 'checkbox', attrs: { name: 'many' } });
    this.count = h('input', { class: 'kv-people__input kv-inv__count', type: 'number', attrs: { min: '2', max: String(KV_INVITE_MAX_USES), value: '10', 'aria-label': tr('Quantas pessoas') } });
    this.many.addEventListener('change', () => (this.count.disabled = !this.many.checked));
    this.count.disabled = true;
    this.label = h('input', { class: 'kv-people__input', attrs: { name: 'label', maxlength: '60', autocomplete: 'off', placeholder: tr('ex.: Reunião com a Rarm') } });
    this.roomsBox = h('div', { class: 'kv-people__known' });
    this.error = h('p', { class: 'kv-people__error', attrs: { role: 'alert' } });
    this.made = h('div', { class: 'kv-inv__made', hidden: true });
    this.save = h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: tr('Gerar link') });
    const form = h(
      'form',
      { class: 'kv-people__form', on: { submit: (e: Event) => void this.submit(e) } },
      h('h3', { text: tr('Novo convite') }),
      h('label', { class: 'kv-people__label', text: tr('Para quem (opcional)') }),
      this.label,
      h('label', { class: 'kv-people__label', text: tr('Vale por') }),
      this.ttl,
      h('label', { class: 'kv-people__check' }, this.many, h('span', { text: tr('Várias pessoas (senão: uso único)') }), this.count),
      h('label', { class: 'kv-people__label', text: tr('Salas que o visitante vê') }),
      h('p', { class: 'kv-people__hint', text: tr('Sem nenhuma marcada: só a recepção e as áreas comuns. O visitante não aprova, não manda tarefa e não chama agentes.') }),
      this.roomsBox,
      this.error,
      h('div', { class: 'kv-people__actions' }, this.save),
      this.made,
    );
    this.el = h(
      'dialog',
      { class: 'ui-dialog kv-people kv-inv', attrs: { 'aria-labelledby': 'kv-inv-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Convidar visitantes'), attrs: { id: 'kv-inv-title' } }), close),
      h('div', { class: 'ui-dialog__body kv-people__body' }, h('section', {}, h('h3', { text: tr('Convites') }), this.list), h('section', {}, form)),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
  }

  async open(): Promise<void> {
    this.error.textContent = '';
    this.made.hidden = true;
    if (!this.el.open) this.el.showModal();
    await this.reload();
  }

  /** Busca de novo os convites e as salas (usado também na aba Convites da tela de Pessoas). */
  refresh(): Promise<void> {
    return this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { invites?: KvInviteInfo[]; rooms?: RoomRef[]; base?: string; error?: string };
      if (!res.ok) {
        this.error.textContent = data.error ?? tr('Não deu para carregar os convites.');
        return;
      }
      this.rooms = data.rooms ?? [];
      this.base = data.base ?? location.origin;
      this.renderRooms();
      this.renderList(data.invites ?? []);
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    }
  }

  private url(i: KvInviteInfo): string {
    return i.link ? `${this.base}${i.link}` : '';
  }

  private renderRooms(): void {
    this.roomsBox.replaceChildren(
      ...this.rooms.map((r) =>
        h('button', {
          class: `ui-btn ui-btn--sm kv-people__room${this.chosen.has(r.path) ? ' is-on' : ''}`,
          type: 'button',
          text: r.name,
          title: r.path,
          attrs: { 'aria-pressed': String(this.chosen.has(r.path)) },
          on: {
            click: () => {
              if (this.chosen.has(r.path)) this.chosen.delete(r.path);
              else this.chosen.add(r.path);
              this.renderRooms();
            },
          },
        }),
      ),
    );
    if (!this.rooms.length) this.roomsBox.append(h('span', { class: 'kv-people__hint', text: tr('nenhuma sala aberta') }));
  }

  private renderList(invites: KvInviteInfo[]): void {
    const name = (p: string) => this.rooms.find((r) => r.path === p)?.name ?? p.split('/').filter(Boolean).slice(-1)[0] ?? p;
    this.list.replaceChildren(
      ...invites.map((i) => {
        const copy = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Copiar link'), hidden: !i.link, on: { click: () => void this.copy(i, copy) } });
        const revoke = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Revogar'), hidden: i.state === 'revogado' || i.state === 'vencido' });
        let armed = false;
        revoke.addEventListener('click', () => {
          if (!armed) {
            armed = true;
            revoke.textContent = tr('Confirmar?');
            revoke.classList.add('is-danger');
            setTimeout(() => {
              armed = false;
              revoke.textContent = tr('Revogar');
              revoke.classList.remove('is-danger');
            }, 4000);
            return;
          }
          void this.revoke(i);
        });
        const uses = i.maxUses === 1 ? tr('uso único') : tr('{0} de {1} pessoas', [i.uses, i.maxUses]);
        const where = i.rooms.length ? i.rooms.map(name).join(', ') : tr('só áreas comuns');
        return h(
          'li',
          { class: `kv-people__item kv-inv__item is-${i.state}` },
          h('div', { class: 'kv-people__who' }, h('strong', { text: i.label ?? tr('Convite de {0}', [i.by.name]) }), h('span', { class: `kv-inv__state kv-inv__state--${i.state}`, text: STATE_LABEL[i.state] })),
          h('div', {
            class: 'kv-people__meta',
            text: [uses, tr('até {0}', [when(i.expiresAt)]), where, i.visitors.length ? tr('Entraram: {0}', [i.visitors.map((v) => v.name).join(', ')]) : ''].filter(Boolean).join(' · '),
            title: [...i.rooms, ...i.visitors.map((v) => `${v.name} · ${when(v.joinedAt)}`)].join('\n'),
          }),
          h('div', { class: 'kv-people__row-actions' }, copy, revoke),
        );
      }),
    );
    if (!invites.length) this.list.append(h('li', { class: 'kv-people__hint', text: tr('Nenhum convite ainda.') }));
  }

  private async copy(i: KvInviteInfo, btn: HTMLButtonElement): Promise<void> {
    const url = this.url(i);
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = tr('Copiado!');
    } catch {
      // sem permissão para a área de transferência (http na rede local): mostra para copiar à mão
      window.prompt(tr('Copie o link do convite:'), url);
    }
    setTimeout(() => (btn.textContent = tr('Copiar link')), 2000);
  }

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.error.textContent = '';
    const body = {
      ttl: this.ttl.value,
      maxUses: this.many.checked ? Math.round(Number(this.count.value) || 2) : 1,
      rooms: [...this.chosen],
      ...(this.label.value.trim() ? { label: this.label.value.trim() } : {}),
    };
    this.save.disabled = true;
    try {
      const res = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { invite?: KvInviteInfo; error?: string };
      if (!res.ok || !data.invite) {
        this.error.textContent = data.error ?? tr('Não deu para criar o convite.');
        return;
      }
      this.label.value = '';
      await this.reload();
      const url = this.url(data.invite);
      const input = h('input', { class: 'kv-people__input', attrs: { readonly: '', value: url, 'aria-label': tr('Link do convite') } });
      const copy = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Copiar link'), on: { click: () => void this.copy(data.invite!, copy) } });
      this.made.replaceChildren(h('p', { class: 'kv-people__hint', text: tr('Pronto! Mande este link para quem vai visitar:') }), input, copy);
      this.made.hidden = false;
      input.select();
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    } finally {
      this.save.disabled = false;
    }
  }

  private async revoke(i: KvInviteInfo): Promise<void> {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(i.id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) this.error.textContent = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? tr('Não deu para revogar.');
      await this.reload();
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    }
  }
}

/** Fork Kaviski W6: os convites dentro de outra janela — a aba Convites da tela de Pessoas (people.ts). */
export function kvMountInvites(host: HTMLElement): void {
  const d = new InvitesDialog();
  const body = d.el.querySelector('.ui-dialog__body');
  if (!body) return;
  host.classList.add('kv-people', 'kv-inv');
  host.append(body);
  d.el.remove();
  void d.refresh();
}
