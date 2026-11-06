// Fork Kaviski (KAVISKI-HUMANOS.md): tela de convites por link (fase 4), para admin e equipe. Cria (validade, uma ou
// várias pessoas, salas liberadas), lista com o estado, copia o link e revoga (quem entrou por ele sai na hora).
// Fala com GET|POST /api/kaviski/humanos/invites e DELETE /api/kaviski/humanos/invites/:id.
import { KV_INVITE_MAX_USES, type KvInviteInfo, type KvInviteState, type KvInviteTtl } from '../../../../shared/kaviski-invites';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { KV_ICONS, kvBtn, kvEmpty, kvIconBtn, kvInput, kvTitle, type KvInput } from './ui/kit';
import { KvModal, kvConfirm } from './ui/modal';
import { kvPick, kvSection, kvSeg, kvSplit, type KvSeg } from './ui/section';
import { kvToast } from './ui/toast';

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

interface RoomRef {
  path: string;
  name: string;
}

function when(t: number): string {
  return new Date(t).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export class InvitesDialog {
  private readonly modal: KvModal;
  /** As duas colunas (lista + formulário), também montadas na aba Convites da tela de Pessoas. */
  readonly content: HTMLElement;
  private readonly list: HTMLElement;
  private readonly ttl: KvSeg<KvInviteTtl>;
  private readonly uses: KvSeg<'1' | 'n'>;
  private readonly count: KvInput;
  private readonly label: KvInput;
  private readonly roomsBox: HTMLElement;
  private readonly error: HTMLElement;
  private readonly made: HTMLElement;
  private readonly save: HTMLButtonElement;
  private rooms: RoomRef[] = [];
  private readonly chosen = new Set<string>();
  private base = location.origin;

  constructor() {
    this.modal = new KvModal({
      title: tr('Convidar visitantes'),
      subtitle: tr('Um link para quem não tem conta entrar como visitante, por um tempo e só nas salas que você marcar.'),
      icon: KV_ICONS.mail,
      width: 1000,
      cls: 'kv-inv2',
    });
    this.list = h('ul', { class: 'kv-ui-cards' });
    this.label = kvInput({ placeholder: tr('ex.: Reunião com a Rarm'), maxlength: 60, icon: KV_ICONS.user, name: 'label' });
    this.ttl = kvSeg<KvInviteTtl>(
      (['1h', '1d', '7d'] as KvInviteTtl[]).map((t) => ({ value: t, label: TTL_LABEL[t], icon: CLOCK_ICON })),
      '1d',
      undefined,
      tr('Vale por'),
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
    this.roomsBox = h('div', { class: 'kv-ui-picks' });
    this.error = h('p', { class: 'kv-ui-field__error kv-inv2__error', attrs: { role: 'alert' } });
    this.made = h('div', { class: 'kv-ui-made', hidden: true });
    this.save = kvBtn(tr('Gerar link'), { variant: 'primary', icon: KV_ICONS.mail, onClick: (e) => void this.submit(e) });
    const main = h(
      'div',
      {},
      this.made,
      kvSection(KV_ICONS.user, tr('Para quem'), tr('Opcional: um nome para você lembrar do convite.'), this.label.el),
      kvSection(CLOCK_ICON, tr('Validade e pessoas'), null, this.ttl.el, h('div', { class: 'kv-inv2__uses' }, this.uses.el, this.count.el)),
      kvSection(KV_ICONS.door, tr('Salas que o visitante vê'), tr('Sem nenhuma marcada: só a recepção e as áreas comuns. O visitante não aprova, não manda tarefa e não chama agentes.'), this.roomsBox),
    );
    const side = h('div', {}, kvTitle('h3', tr('Convites'), 'kv-agenda2__side-title'), this.list);
    this.content = kvSplit(side, main);
    this.modal.body.append(this.content);
    this.modal.setFoot(this.error, this.save);
  }

  /** O rodapé com o botão (para a aba Convites da tela de Pessoas, que não usa a janela própria). */
  get foot(): HTMLElement {
    return this.modal.foot;
  }

  async open(): Promise<void> {
    this.error.textContent = '';
    this.made.hidden = true;
    this.modal.show();
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
        kvPick(r.name, this.chosen.has(r.path), (on) => (on ? this.chosen.add(r.path) : this.chosen.delete(r.path)), { title: r.path }),
      ),
    );
    if (!this.rooms.length) this.roomsBox.append(h('p', { class: 'kv-ui-sec__hint', text: tr('nenhuma sala aberta') }));
  }

  private renderList(invites: KvInviteInfo[]): void {
    const name = (p: string) => this.rooms.find((r) => r.path === p)?.name ?? p.split('/').filter(Boolean).slice(-1)[0] ?? p;
    const tone: Record<KvInviteState, string> = { ativo: 'ok', vencido: 'off', revogado: 'bad', esgotado: 'warn' };
    const color: Record<KvInviteState, string> = { ativo: '#2f9e5f', vencido: '#6b7280', revogado: '#b04444', esgotado: '#b8862e' };
    this.list.replaceChildren(
      ...invites.map((i) => {
        const copy = kvIconBtn(KV_ICONS.copy, tr('Copiar link'), () => void this.copy(i, copy), { size: 'sm' });
        copy.hidden = !i.link;
        const revoke = kvIconBtn(KV_ICONS.trash, tr('Revogar'), () => void this.askRevoke(i), { size: 'sm' });
        revoke.hidden = i.state === 'revogado' || i.state === 'vencido';
        const uses = i.maxUses === 1 ? tr('uso único') : tr('{0} de {1} pessoas', [i.uses, i.maxUses]);
        const where = i.rooms.length ? i.rooms.map(name).join(', ') : tr('só áreas comuns');
        const ico = h('span', { class: 'kv-ui-card__ico', style: `--a:${color[i.state]}`, attrs: { 'aria-hidden': 'true' } });
        ico.innerHTML = KV_ICONS.mail;
        return h(
          'li',
          { class: `kv-ui-card${i.state === 'ativo' ? '' : ' is-dim'}`, title: [...i.rooms, ...i.visitors.map((v) => `${v.name} · ${when(v.joinedAt)}`)].join('\n') },
          ico,
          h(
            'span',
            { class: 'kv-ui-card__text' },
            h('span', { class: 'kv-ui-card__top' }, h('strong', { text: i.label ?? tr('Convite de {0}', [i.by.name]) }), h('span', { class: `kv-ui-state kv-ui-state--${tone[i.state]}`, text: STATE_LABEL[i.state] })),
            h('span', { class: 'kv-ui-card__meta', text: [uses, tr('até {0}', [when(i.expiresAt)]), where].join(' · ') }),
            i.visitors.length ? h('span', { class: 'kv-ui-card__meta', text: tr('Entraram: {0}', [i.visitors.map((v) => v.name).join(', ')]) }) : null,
          ),
          h('span', { class: 'kv-ui-card__actions' }, copy, revoke),
        );
      }),
    );
    if (!invites.length) this.list.append(h('li', {}, kvEmpty(KV_ICONS.mail, tr('Nenhum convite ainda'), tr('Gere um link ao lado e mande para quem vai visitar.'))));
  }

  private async askRevoke(i: KvInviteInfo): Promise<void> {
    const ok = await kvConfirm({ title: tr('Revogar o convite?'), text: tr('O link para de funcionar e quem entrou por ele sai na hora.'), ok: tr('Revogar'), danger: true });
    if (ok) await this.revoke(i);
  }

  private async copy(i: KvInviteInfo, btn: HTMLButtonElement): Promise<void> {
    const url = this.url(i);
    try {
      await navigator.clipboard.writeText(url);
      kvToast(tr('Link copiado.'), { kind: 'ok' });
    } catch {
      // sem permissão para a área de transferência (http na rede local): mostra para copiar à mão
      window.prompt(tr('Copie o link do convite:'), url);
    }
    void btn;
  }

  private async submit(e?: Event): Promise<void> {
    e?.preventDefault();
    this.error.textContent = '';
    const body = {
      ttl: this.ttl.value,
      maxUses: this.uses.value === 'n' ? Math.round(Number(this.count.input.value) || 2) : 1,
      rooms: [...this.chosen],
      ...(this.label.input.value.trim() ? { label: this.label.input.value.trim() } : {}),
    };
    this.save.disabled = true;
    try {
      const res = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { invite?: KvInviteInfo; error?: string };
      if (!res.ok || !data.invite) {
        this.error.textContent = data.error ?? tr('Não deu para criar o convite.');
        return;
      }
      this.label.input.value = '';
      await this.reload();
      const url = this.url(data.invite);
      const field = kvInput({ value: url, mono: true, icon: LINK_ICON });
      field.input.readOnly = true;
      field.input.setAttribute('aria-label', tr('Link do convite'));
      const copy = kvBtn(tr('Copiar link'), { variant: 'primary', icon: KV_ICONS.copy, onClick: () => void this.copy(data.invite!, copy) });
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
  host.classList.add('kv-inv2', 'kv-inv2--embed');
  host.append(d.content, d.foot);
  d.foot.hidden = false;
  void d.refresh();
}
