// Fork Kaviski (KAVISKI-HUMANOS.md): tela de Pessoas (só admin): criar, editar e apagar contas, papel e salas.
// Fala com GET|POST /api/kaviski/humanos/users e POST|DELETE /api/kaviski/humanos/users/:id.
import type { KvPerson, KvRole } from '../../../../shared/kaviski-humanos';
import { KV_PASSWORD_MIN } from '../../../../shared/kaviski-humanos';
import { tr } from '../../../../shared/i18n';
import { h, iconButton } from '../../ui/dom';
import { ICONS } from '../../ui/icons';

const API = '/api/kaviski/humanos/users';

export const ROLE_LABEL: Record<KvRole, string> = {
  admin: tr('admin'),
  equipe: tr('equipe'),
  cliente: tr('cliente'),
};

const ROLE_HINT: Record<KvRole, string> = {
  admin: tr('Tudo, inclusive esta tela de Pessoas.'),
  equipe: tr('Tudo que o acesso remoto libera (terminal, mensagens, aprovar), menos cuidar das pessoas.'),
  cliente: tr('Só vê as salas liberadas abaixo; não aprova, não manda mensagem, não abre terminal.'),
};

interface AuditEntry {
  at: number;
  who: { id: string; name: string; role: string };
  action: string;
  agent?: { id: string; name?: string; room?: string };
  detail?: string;
  ok: boolean;
}

interface RoomRef {
  path: string;
  name: string;
}

async function call(method: string, url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

export class PeopleDialog {
  readonly el: HTMLDialogElement;
  private readonly list: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly formTitle: HTMLElement;
  private readonly user: HTMLInputElement;
  private readonly name: HTMLInputElement;
  private readonly role: HTMLSelectElement;
  private readonly roleHint: HTMLElement;
  private readonly password: HTMLInputElement;
  private readonly roomsBox: HTMLElement;
  private readonly rooms: HTMLTextAreaElement;
  private readonly known: HTMLElement;
  private readonly request: HTMLInputElement;
  private readonly body: HTMLElement;
  private readonly auditBox: HTMLElement;
  private readonly auditList: HTMLElement;
  private readonly auditBtn: HTMLButtonElement;
  private readonly error: HTMLElement;
  private readonly save: HTMLButtonElement;
  private editing: KvPerson | null = null;
  private people: KvPerson[] = [];
  private knownRooms: RoomRef[] = [];

  constructor() {
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    this.list = h('ul', { class: 'kv-people__list' });
    this.formTitle = h('h3', { text: tr('Nova pessoa') });
    this.user = h('input', { class: 'kv-people__input', attrs: { name: 'user', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', required: 'true', maxlength: '32', placeholder: tr('ex.: ana.rarm') } });
    this.name = h('input', { class: 'kv-people__input', attrs: { name: 'name', autocomplete: 'off', maxlength: '40', placeholder: tr('ex.: Ana (Rarm)') } });
    this.role = h('select', { class: 'kv-people__input', attrs: { name: 'role' } });
    for (const r of ['cliente', 'equipe', 'admin'] as KvRole[]) this.role.append(h('option', { text: ROLE_LABEL[r], attrs: { value: r } }));
    this.roleHint = h('p', { class: 'kv-people__hint' });
    this.password = h('input', { class: 'kv-people__input', attrs: { name: 'password', type: 'password', autocomplete: 'new-password', minlength: String(KV_PASSWORD_MIN) } });
    this.rooms = h('textarea', { class: 'kv-people__input kv-people__rooms', attrs: { name: 'rooms', rows: '4', spellcheck: 'false', placeholder: '/home/hostadmin/projetos/Clientes/12-Rarm' } });
    this.known = h('div', { class: 'kv-people__known' });
    this.roomsBox = h(
      'div',
      {},
      h('label', { class: 'kv-people__label', text: tr('Salas que vê (uma pasta por linha; vale para tudo dentro dela)') }),
      this.rooms,
      h('p', { class: 'kv-people__hint', text: tr('Salas abertas agora (clique para pôr na lista):') }),
      this.known,
      h('label', { class: 'kv-people__check' }, (this.request = h('input', { type: 'checkbox', attrs: { name: 'request' } })), h('span', { text: tr('Pode pedir tarefas (mandar mensagem) aos agentes das salas dele') })),
    );
    this.error = h('p', { class: 'kv-people__error', attrs: { role: 'alert' } });
    this.save = h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: tr('Criar') });
    const cancel = h('button', { class: 'ui-btn', type: 'button', text: tr('Limpar'), on: { click: () => this.edit(null) } });
    this.form = h(
      'form',
      { class: 'kv-people__form', on: { submit: (e: Event) => void this.submit(e) } },
      this.formTitle,
      h('label', { class: 'kv-people__label', text: tr('Usuário (para entrar)') }),
      this.user,
      h('label', { class: 'kv-people__label', text: tr('Nome exibido') }),
      this.name,
      h('label', { class: 'kv-people__label', text: tr('Papel') }),
      this.role,
      this.roleHint,
      h('label', { class: 'kv-people__label', text: tr('Senha') }),
      this.password,
      this.roomsBox,
      this.error,
      h('div', { class: 'kv-people__actions' }, cancel, this.save),
    );
    this.role.addEventListener('change', () => this.syncRole());
    this.auditList = h('ol', { class: 'kv-audit__list' });
    this.auditBox = h('section', { class: 'kv-audit', hidden: true }, h('h3', { text: tr('Registro: quem aprovou, pediu ou mexeu no quê') }), this.auditList);
    this.auditBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Registro'), on: { click: () => void this.toggleAudit() } });
    this.body = h(
      'div',
      { class: 'ui-dialog__body kv-people__body' },
      h('section', {}, h('h3', { text: tr('Contas') }), this.list),
      h('section', {}, this.form),
    );
    this.el = h(
      'dialog',
      { class: 'ui-dialog kv-people', attrs: { 'aria-labelledby': 'kv-people-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Pessoas no escritório'), attrs: { id: 'kv-people-title' } }), h('div', { class: 'kv-people__head-actions' }, this.auditBtn, close)),
      this.body,
      this.auditBox,
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
    this.edit(null);
  }

  async open(): Promise<void> {
    if (!this.el.open) this.el.showModal();
    await this.reload();
  }

  /** Alterna entre as contas e o registro de ações. */
  private async toggleAudit(): Promise<void> {
    const show = this.auditBox.hidden === true;
    this.auditBox.hidden = !show;
    this.body.hidden = show;
    this.auditBtn.classList.toggle('is-on', show);
    this.auditBtn.textContent = show ? tr('Contas') : tr('Registro');
    if (!show) return;
    this.auditList.replaceChildren(h('li', { class: 'kv-people__hint', text: tr('Carregando…') }));
    let entries: AuditEntry[] = [];
    try {
      const r = await call('GET', '/api/kaviski/humanos/audit');
      entries = (r.data.entries as AuditEntry[]) ?? [];
    } catch {
      // vazio
    }
    this.auditList.replaceChildren(
      ...entries.map((e) =>
        h(
          'li',
          { class: `kv-audit__item${e.ok ? '' : ' is-fail'}` },
          h('time', { text: new Date(e.at).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }),
          h('strong', { text: e.who.name }),
          h('span', { class: `kv-role kv-role--${e.who.role}`, text: ROLE_LABEL[e.who.role as KvRole] ?? e.who.role }),
          h('span', { class: 'kv-audit__action', text: e.ok ? e.action : tr('{0} (recusado)', [e.action]) }),
          e.agent ? h('span', { class: 'kv-audit__agent', text: [e.agent.name, e.agent.room].filter(Boolean).join(' · ') }) : null,
          e.detail ? h('span', { class: 'kv-audit__detail', text: e.detail }) : null,
        ),
      ),
    );
    if (!entries.length) this.auditList.append(h('li', { class: 'kv-people__hint', text: tr('Nada registrado ainda.') }));
  }

  private async reload(): Promise<void> {
    try {
      const r = await call('GET', API);
      if (!r.ok) {
        this.error.textContent = String(r.data.error ?? tr('Não deu para carregar as pessoas.'));
        return;
      }
      this.people = (r.data.people as KvPerson[]) ?? [];
      this.knownRooms = (r.data.rooms as RoomRef[]) ?? [];
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
      return;
    }
    this.renderList();
    this.renderKnown();
  }

  private renderList(): void {
    this.list.replaceChildren(
      ...this.people.map((p) => {
        const del = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Apagar'), hidden: !!p.builtin });
        let armed = false;
        del.addEventListener('click', () => {
          if (!armed) {
            armed = true;
            del.textContent = tr('Confirmar?');
            del.classList.add('is-danger');
            setTimeout(() => {
              armed = false;
              del.textContent = tr('Apagar');
              del.classList.remove('is-danger');
            }, 4000);
            return;
          }
          void this.remove(p);
        });
        const rooms =
          p.role === 'cliente'
            ? (p.rooms.length ? p.rooms.map((r) => r.split('/').filter(Boolean).slice(-2).join('/')).join(', ') : tr('nenhuma sala')) + (p.request ? ` · ${tr('pede tarefas')}` : '')
            : tr('todas as salas');
        return h(
          'li',
          { class: `kv-people__item${this.editing?.id === p.id ? ' is-on' : ''}` },
          h(
            'div',
            { class: 'kv-people__who' },
            h('strong', { text: p.name }),
            h('span', { class: `kv-role kv-role--${p.role}`, text: ROLE_LABEL[p.role] }),
            p.builtin ? h('span', { class: 'kv-people__tag', text: '.env', title: tr('Conta do HABBLAUD_REMOTE_USER: senha e papel vêm do .env') }) : null,
          ),
          h('div', { class: 'kv-people__meta', text: `${p.user} · ${rooms}`, title: p.rooms.join('\n') }),
          h('div', { class: 'kv-people__row-actions' }, h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Editar'), on: { click: () => this.edit(p) } }), del),
        );
      }),
    );
  }

  private renderKnown(): void {
    const have = new Set(this.rooms.value.split('\n').map((l) => l.trim().toLowerCase()));
    this.known.replaceChildren(
      ...this.knownRooms.map((r) =>
        h('button', {
          class: `ui-btn ui-btn--sm kv-people__room${have.has(r.path.toLowerCase()) ? ' is-on' : ''}`,
          type: 'button',
          text: r.name,
          title: r.path,
          on: {
            click: () => {
              const lines = this.rooms.value.split('\n').map((l) => l.trim()).filter(Boolean);
              if (!lines.some((l) => l.toLowerCase() === r.path.toLowerCase())) lines.push(r.path);
              this.rooms.value = lines.join('\n');
              this.renderKnown();
            },
          },
        }),
      ),
    );
    if (!this.knownRooms.length) this.known.append(h('span', { class: 'kv-people__hint', text: tr('nenhuma sala aberta') }));
  }

  private syncRole(): void {
    const role = this.role.value as KvRole;
    this.roleHint.textContent = ROLE_HINT[role];
    this.roomsBox.hidden = role !== 'cliente';
  }

  private edit(p: KvPerson | null): void {
    this.editing = p;
    this.error.textContent = '';
    this.formTitle.textContent = p ? tr('Editar {0}', [p.name]) : tr('Nova pessoa');
    this.user.value = p?.user ?? '';
    this.user.disabled = !!p;
    this.name.value = p?.name ?? '';
    this.role.value = p?.role ?? 'cliente';
    this.role.disabled = !!p?.builtin;
    this.password.value = '';
    this.password.disabled = !!p?.builtin;
    this.password.placeholder = p ? (p.builtin ? tr('a senha vem do .env') : tr('em branco: mantém a senha')) : tr('mínimo {0} caracteres', [KV_PASSWORD_MIN]);
    this.password.required = !p;
    this.rooms.value = (p?.rooms ?? []).join('\n');
    this.request.checked = !!p?.request;
    this.save.textContent = p ? tr('Salvar') : tr('Criar');
    this.syncRole();
    this.renderList();
    this.renderKnown();
  }

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.error.textContent = '';
    const rooms = this.rooms.value.split('\n').map((l) => l.trim()).filter(Boolean);
    const p = this.editing;
    const body: Record<string, unknown> = { name: this.name.value };
    if (!p?.builtin) {
      body.role = this.role.value;
      body.rooms = this.role.value === 'cliente' ? rooms : [];
      body.request = this.role.value === 'cliente' && this.request.checked;
      if (this.password.value) body.password = this.password.value;
    }
    if (!p) body.user = this.user.value;
    this.save.disabled = true;
    try {
      const r = await call('POST', p ? `${API}/${encodeURIComponent(p.id)}` : API, body);
      if (!r.ok) {
        this.error.textContent = String(r.data.error ?? tr('Não deu para salvar.'));
        return;
      }
      await this.reload();
      this.edit(null);
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    } finally {
      this.save.disabled = false;
    }
  }

  private async remove(p: KvPerson): Promise<void> {
    try {
      const r = await call('DELETE', `${API}/${encodeURIComponent(p.id)}`, {});
      if (!r.ok) this.error.textContent = String(r.data.error ?? tr('Não deu para apagar.'));
      if (this.editing?.id === p.id) this.edit(null);
      await this.reload();
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    }
  }
}
