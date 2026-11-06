// Fork Kaviski (KAVISKI-HUMANOS.md): tela de Pessoas (só admin), com o kit de interface (ui/): à esquerda as contas em
// cartões (boneco, papel, salas), com busca e filtro por papel; à direita o formulário (nome, usuário, papel com o que
// cada um pode, salas com busca e chips, senha com gerador), com validação em linha e confirmação ao apagar.
// Abas: Contas, Convites (convites por link, invites.ts) e Registro (quem aprovou, pediu ou mexeu no quê).
// Fala com GET|POST /api/kaviski/humanos/users e POST|DELETE /api/kaviski/humanos/users/:id.
import type { KvPerson, KvRole } from '../../../../shared/kaviski-humanos';
import { KV_PASSWORD_MIN, KV_PERSON_NAME_MAX, KV_USER_RE } from '../../../../shared/kaviski-humanos';
import type { KvContact, KvLook } from '../../../../shared/kaviski-presence';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { KV_ICONS, kvAvatar, kvBtn, kvCap, kvChip, kvEmpty, kvField, kvIconBtn, kvInput, kvPassword, kvRoleBadge, kvTabs, kvTitle, kvToggle, type KvField } from './ui/kit';
import { KvMultiSelect, KvSelect, type KvOption } from './ui/select';
import { KvModal, kvConfirm } from './ui/modal';
import { kvToast } from './ui/toast';
import { kvPeople } from './world';
import './people.css';

const API = '/api/kaviski/humanos/users';

export const ROLE_LABEL: Record<KvRole, string> = {
  admin: tr('admin'),
  equipe: tr('equipe'),
  cliente: tr('cliente'),
  visitante: tr('visitante'),
};

const ROLE_HINT: Record<KvRole, string> = {
  admin: tr('Tudo, inclusive esta tela de Pessoas.'),
  equipe: tr('Tudo que o acesso remoto libera (terminal, mensagens, aprovar), menos cuidar das pessoas.'),
  cliente: tr('Só vê as salas liberadas abaixo; não aprova, não manda mensagem, não abre terminal.'),
  visitante: tr('Entrou por um convite: como o cliente, e não chama agentes.'),
};

/** O que cada papel pode, em itens curtos (aparece embaixo do papel escolhido). */
const ROLE_CAN: Record<'admin' | 'equipe' | 'cliente', string[]> = {
  admin: [tr('Vê todas as salas e todos os agentes'), tr('Aprova pedidos, manda mensagens, abre o terminal'), tr('Cria e apaga contas, convites e vê o registro')],
  equipe: [tr('Vê todas as salas e todos os agentes'), tr('Aprova pedidos, manda mensagens, abre o terminal'), tr('Não mexe nas contas das pessoas')],
  cliente: [tr('Vê só as salas escolhidas abaixo'), tr('Conversa com a equipe e com quem é da mesma empresa'), tr('Não aprova nada nem abre o terminal')],
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

/** Nome curto de uma pasta de sala ("Clientes/12-Rarm"). */
export function kvRoomShort(path: string): string {
  return path.split('/').filter(Boolean).slice(-2).join('/') || path;
}

/** Problemas do formulário, campo a campo (vazio = tudo certo). Pura, para testar. */
export function kvValidatePerson(
  v: { user: string; name: string; password: string; role: KvRole },
  ctx: { editing: boolean; builtin: boolean; taken: (user: string) => boolean },
): Partial<Record<'user' | 'name' | 'password', string>> {
  const out: Partial<Record<'user' | 'name' | 'password', string>> = {};
  if (!ctx.editing) {
    const u = v.user.trim();
    if (!u) out.user = tr('Escolha um usuário para a pessoa entrar.');
    else if (!KV_USER_RE.test(u)) out.user = tr('Use de 2 a 32 letras minúsculas, números, ponto, hífen ou sublinhado (começando com letra ou número).');
    else if (ctx.taken(u)) out.user = tr('Esse usuário já existe.');
  }
  if (ctx.editing && !v.name.trim()) out.name = tr('O nome não pode ficar vazio.');
  if (!ctx.builtin) {
    if (!ctx.editing && !v.password) out.password = tr('Defina uma senha (ou gere uma no dado).');
    else if (v.password && v.password.length < KV_PASSWORD_MIN) out.password = tr('Mínimo de {0} caracteres.', [KV_PASSWORD_MIN]);
  }
  return out;
}

type Tab = 'contas' | 'convites' | 'registro';

export class PeopleDialog {
  private readonly modal: KvModal;
  private readonly tabs;
  private readonly panes: Record<Tab, HTMLElement>;
  // lista
  private readonly list: HTMLElement;
  private readonly search;
  private readonly roleFilter: KvSelect<'todos' | 'admin' | 'equipe' | 'cliente'>;
  // formulário
  private readonly editor: HTMLElement;
  private readonly formHead: HTMLElement;
  private readonly name;
  private readonly user;
  private readonly role: KvSelect<'admin' | 'equipe' | 'cliente'>;
  private readonly roleCan: HTMLElement;
  private readonly rooms: KvMultiSelect<string>;
  private readonly request;
  private readonly password;
  private readonly f: Record<'name' | 'user' | 'role' | 'rooms' | 'password', KvField>;
  private readonly clientBox: HTMLElement;
  private readonly formError: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly delBtn: HTMLButtonElement;
  private touched = false;
  // registro
  private readonly auditList: HTMLElement;
  private readonly auditSearch;
  private audit: AuditEntry[] = [];
  private invitesMounted = false;

  private editing: KvPerson | null = null;
  private people: KvPerson[] = [];
  private looks = new Map<string, KvLook>();
  private knownRooms: RoomRef[] = [];

  constructor() {
    this.modal = new KvModal({ title: tr('Pessoas no escritório'), subtitle: tr('Contas, papéis e salas de quem entra no escritório.'), icon: KV_ICONS.users, width: 1040, cls: 'kv-pp' });
    this.tabs = kvTabs(
      [
        { id: 'contas', label: tr('Contas'), icon: KV_ICONS.user },
        { id: 'convites', label: tr('Convites'), icon: KV_ICONS.mail },
        { id: 'registro', label: tr('Registro'), icon: KV_ICONS.log },
      ],
      (id) => this.show(id as Tab),
    );

    // ---- lista
    this.search = kvInput({ placeholder: tr('Buscar por nome ou usuário'), icon: KV_ICONS.search, type: 'search', onInput: () => this.renderList() });
    this.roleFilter = new KvSelect({
      label: tr('Papel'),
      value: 'todos',
      options: [
        { value: 'todos', label: tr('Todos os papéis') },
        { value: 'admin', label: kvCap(ROLE_LABEL.admin), icon: h('span', { class: 'kv-pp__role-dot kv-ui-role--admin' }) },
        { value: 'equipe', label: kvCap(ROLE_LABEL.equipe), icon: h('span', { class: 'kv-pp__role-dot kv-ui-role--equipe' }) },
        { value: 'cliente', label: kvCap(ROLE_LABEL.cliente), icon: h('span', { class: 'kv-pp__role-dot kv-ui-role--cliente' }) },
      ],
      onChange: () => this.renderList(),
    });
    this.list = h('ul', { class: 'kv-pp__list', attrs: { 'aria-label': tr('Contas') } });
    const newBtn = kvBtn(tr('Nova pessoa'), { variant: 'primary', icon: KV_ICONS.plus, onClick: () => this.edit(null, true) });
    const listPane = h('section', { class: 'kv-pp__side' }, h('div', { class: 'kv-pp__tools' }, this.search.el, newBtn), h('div', { class: 'kv-pp__filter' }, this.roleFilter.el), this.list);

    // ---- formulário
    this.formHead = h('div', { class: 'kv-pp__form-head' });
    this.name = kvInput({ placeholder: tr('ex.: Ana (Rarm)'), maxlength: KV_PERSON_NAME_MAX, onInput: () => this.validate() });
    this.user = kvInput({ placeholder: tr('ex.: ana.rarm'), maxlength: 32, mono: true, onInput: () => this.validate() });
    this.user.input.addEventListener('input', () => {
      const low = this.user.input.value.toLowerCase();
      if (low !== this.user.input.value) this.user.input.value = low;
    });
    this.role = new KvSelect<'admin' | 'equipe' | 'cliente'>({
      label: tr('Papel'),
      value: 'cliente',
      options: (['cliente', 'equipe', 'admin'] as const).map((r) => ({ value: r, label: kvCap(ROLE_LABEL[r]), hint: ROLE_HINT[r], icon: h('span', { class: `kv-pp__role-dot kv-ui-role--${r}` }) })),
      onChange: () => this.syncRole(),
    });
    this.roleCan = h('ul', { class: 'kv-pp__can' });
    this.rooms = new KvMultiSelect<string>({
      options: [],
      addLabel: tr('Adicionar sala'),
      emptyText: tr('Nenhuma sala: vê só a recepção e as áreas comuns.'),
      searchPlaceholder: tr('Buscar sala ou colar o caminho da pasta'),
      allowCustom: (q) => (q.startsWith('/') && q.length > 1 ? { value: q.replace(/\/+$/, ''), label: tr('Usar a pasta {0}', [q]), hint: tr('vale para ela e tudo dentro'), icon: KV_ICONS.door } : null),
      labelOf: (v) => ({ label: kvRoomShort(v), title: v }),
    });
    this.request = kvToggle(tr('Pode pedir tarefas aos agentes'), { hint: tr('Manda mensagem aos agentes das salas dele (o resto continua fechado).') });
    this.password = kvPassword({ generator: true, minlength: KV_PASSWORD_MIN, onGenerate: () => kvToast(tr('Senha gerada e copiada. Passe para a pessoa por um canal seguro.'), { kind: 'ok' }) });
    this.password.input.addEventListener('input', () => this.validate());
    this.f = {
      name: kvField(tr('Nome exibido'), this.name.el, { hint: tr('Aparece em cima do boneco e nas conversas.') }),
      user: kvField(tr('Usuário (para entrar)'), this.user.el),
      role: kvField(tr('Papel'), this.role.el),
      rooms: kvField(tr('Salas que vê'), this.rooms.el, { hint: tr('Cada pasta vale para ela e tudo dentro (ex.: a pasta do cliente cobre todos os projetos dele).') }),
      password: kvField(tr('Senha'), this.password.el),
    };
    this.f.role.el.append(this.roleCan);
    this.clientBox = h('div', { class: 'kv-pp__client' }, this.f.rooms.el, this.request.el);
    this.formError = h('p', { class: 'kv-pp__error', attrs: { role: 'alert' }, hidden: true });
    this.saveBtn = kvBtn(tr('Criar conta'), { variant: 'primary', type: 'submit', icon: KV_ICONS.check });
    this.delBtn = kvBtn(tr('Apagar'), { variant: 'ghost', icon: KV_ICONS.trash, cls: 'kv-pp__del', onClick: () => this.editing && void this.remove(this.editing) });
    const cancel = kvBtn(tr('Cancelar'), { onClick: () => this.edit(null) });
    const form = h(
      'form',
      { class: 'kv-pp__form', attrs: { novalidate: true }, on: { submit: (e: Event) => void this.submit(e) } },
      h('div', { class: 'kv-pp__row' }, this.f.name.el, this.f.user.el),
      this.f.role.el,
      this.clientBox,
      this.f.password.el,
      this.formError,
      h('div', { class: 'kv-pp__actions' }, this.delBtn, h('span', { class: 'kv-pp__spacer' }), cancel, this.saveBtn),
    );
    this.editor = h('section', { class: 'kv-pp__editor' }, this.formHead, form);

    // ---- registro
    this.auditSearch = kvInput({ placeholder: tr('Buscar no registro (pessoa, ação, agente)'), icon: KV_ICONS.search, type: 'search', onInput: () => this.renderAudit() });
    this.auditList = h('ol', { class: 'kv-pp__audit' });

    this.panes = {
      contas: h('div', { class: 'kv-pp__pane kv-pp__accounts' }, listPane, this.editor),
      convites: h('div', { class: 'kv-pp__pane kv-pp__invites' }),
      registro: h('div', { class: 'kv-pp__pane kv-pp__log' }, h('div', { class: 'kv-pp__tools' }, this.auditSearch.el, kvBtn(tr('Atualizar'), { size: 'md', onClick: () => void this.loadAudit() })), this.auditList),
    };
    this.modal.body.classList.add('kv-pp__body');
    this.modal.body.append(this.tabs.el, this.panes.contas, this.panes.convites, this.panes.registro);
    this.show('contas');
    this.edit(null);
  }

  /** Mantido para quem usava `dialog.el`. */
  get el(): HTMLDialogElement {
    return this.modal.el;
  }

  async open(): Promise<void> {
    this.modal.show();
    await this.reload();
  }

  private show(tab: Tab): void {
    this.tabs.set(tab);
    for (const [k, el] of Object.entries(this.panes)) el.hidden = k !== tab;
    if (tab === 'registro') void this.loadAudit();
    if (tab === 'convites' && !this.invitesMounted) {
      this.invitesMounted = true;
      void import('./invites').then((m) => m.kvMountInvites(this.panes.convites));
    }
  }

  // ------------------------------------------------------------------ dados

  private async reload(): Promise<void> {
    try {
      const [r, c] = await Promise.all([call('GET', API), call('GET', '/api/kaviski/humanos/contacts').catch(() => ({ ok: false, data: {} as Record<string, unknown> }))]);
      if (!r.ok) {
        this.showError(String(r.data.error ?? tr('Não deu para carregar as pessoas.')));
        return;
      }
      this.people = (r.data.people as KvPerson[]) ?? [];
      this.knownRooms = (r.data.rooms as RoomRef[]) ?? [];
      for (const ct of ((c.data.contacts as KvContact[]) ?? [])) this.looks.set(ct.id, ct.look);
      const me = kvPeople.client?.me();
      if (me) this.looks.set(me.id, me.look);
    } catch {
      this.showError(tr('Sem conexão com o Habblaud.'));
      return;
    }
    this.tabs.setBadge('contas', 0);
    this.rooms.setOptions(this.roomOptions());
    this.renderList();
    if (this.editing) {
      const fresh = this.people.find((p) => p.id === this.editing!.id);
      this.edit(fresh ?? null);
    }
  }

  private roomOptions(): KvOption<string>[] {
    const opts: KvOption<string>[] = this.knownRooms.map((r) => ({ value: r.path, label: r.name, hint: r.path, icon: KV_ICONS.door }));
    // salas que já estão nas contas, mesmo fechadas agora
    for (const p of this.people) for (const path of p.rooms) if (!opts.some((o) => o.value === path)) opts.push({ value: path, label: kvRoomShort(path), hint: path, icon: KV_ICONS.door });
    return opts;
  }

  // ------------------------------------------------------------------ lista

  private renderList(): void {
    const q = this.search.input.value.trim().toLocaleLowerCase();
    const role = this.roleFilter.value;
    const shown = this.people.filter((p) => (role === 'todos' || !role || p.role === role) && (!q || `${p.name} ${p.user}`.toLocaleLowerCase().includes(q)));
    const order: Record<string, number> = { admin: 0, equipe: 1, cliente: 2, visitante: 3 };
    shown.sort((a, b) => Number(!!b.builtin) - Number(!!a.builtin) || order[a.role]! - order[b.role]! || a.name.localeCompare(b.name));
    this.list.replaceChildren(...shown.map((p) => this.card(p)));
    if (!shown.length) {
      this.list.append(
        h(
          'li',
          {},
          this.people.length
            ? kvEmpty(KV_ICONS.search, tr('Ninguém encontrado'), tr('Tente outro nome ou tire o filtro de papel.'))
            : kvEmpty(KV_ICONS.users, tr('Nenhuma conta ainda'), tr('Crie a primeira: equipe ou cliente.'), kvBtn(tr('Nova pessoa'), { variant: 'primary', icon: KV_ICONS.plus, onClick: () => this.edit(null, true) })),
        ),
      );
    }
  }

  private card(p: KvPerson): HTMLElement {
    const rooms =
      p.role === 'cliente' || p.role === 'visitante'
        ? p.rooms.length
          ? h('span', { class: 'kv-pp__rooms' }, ...p.rooms.slice(0, 3).map((r) => kvChip(kvRoomShort(r), { title: r, icon: KV_ICONS.door })), p.rooms.length > 3 ? h('span', { class: 'kv-pp__more', text: `+${p.rooms.length - 3}` }) : null)
          : h('span', { class: 'kv-pp__muted', text: tr('nenhuma sala') })
        : h('span', { class: 'kv-pp__muted', text: tr('todas as salas') });
    const edit = kvIconBtn(KV_ICONS.edit, tr('Editar {0}', [p.name]), (e) => (e.stopPropagation(), this.edit(p, true)), { size: 'sm' });
    const del = p.builtin ? null : kvIconBtn(KV_ICONS.trash, tr('Apagar {0}', [p.name]), (e) => (e.stopPropagation(), void this.remove(p)), { size: 'sm', cls: 'kv-pp__card-del' });
    return h(
      'li',
      {},
      h(
        'div',
        {
          class: `kv-pp__card${this.editing?.id === p.id ? ' is-on' : ''}`,
          role: 'button',
          tabIndex: 0,
          attrs: { 'aria-label': tr('Editar {0}', [p.name]) },
          on: {
            click: () => this.edit(p, true),
            keydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.edit(p, true);
              }
            },
          },
        },
        kvAvatar({ id: p.id, name: p.name, look: this.looks.get(p.id) }, 'md'),
        h(
          'div',
          { class: 'kv-pp__card-main' },
          h('div', { class: 'kv-pp__card-top' }, h('strong', { class: 'kv-pp__name', text: p.name }), kvRoleBadge(p.role), p.builtin ? h('span', { class: 'kv-pp__tag', text: '.env', title: tr('Conta do HABBLAUD_REMOTE_USER: senha e papel vêm do .env') }) : null),
          h('div', { class: 'kv-pp__card-meta' }, h('span', { class: 'kv-pp__user', text: `@${p.user}` }), p.request ? h('span', { class: 'kv-pp__flag', text: tr('pede tarefas') }) : null),
          rooms,
        ),
        h('div', { class: 'kv-pp__card-actions' }, edit, del),
      ),
    );
  }

  // ------------------------------------------------------------------ formulário

  private edit(p: KvPerson | null, focus = false): void {
    this.editing = p;
    this.touched = false;
    this.showError('');
    const builtin = !!p?.builtin;
    const lead = p ? kvAvatar({ id: p.id, name: p.name, look: this.looks.get(p.id) }, 'md') : h('span', { class: 'kv-pp__new-ico', attrs: { 'aria-hidden': 'true' } });
    if (!p) lead.innerHTML = KV_ICONS.plus;
    this.formHead.replaceChildren(
      lead,
      h('div', {}, kvTitle('strong', p ? p.name : tr('Nova pessoa'), 'kv-pp__form-title'), h('span', { class: 'kv-pp__form-sub', text: p ? `@${p.user}${builtin ? ` · ${tr('conta do .env')}` : ''}` : tr('Preencha e clique em Criar conta.') })),
    );
    this.name.input.value = p?.name ?? '';
    this.user.input.value = p?.user ?? '';
    this.user.input.disabled = !!p;
    this.user.el.classList.toggle('is-disabled', !!p);
    this.f.user.setHint(p ? tr('O usuário não muda depois de criado.') : tr('Letras minúsculas, números, ponto, hífen ou sublinhado. É o que a pessoa digita para entrar.'));
    this.role.value = (p?.role === 'visitante' ? 'cliente' : p?.role) ?? 'cliente';
    this.role.disabled = builtin;
    this.rooms.value = p?.rooms ?? [];
    this.request.checked = !!p?.request;
    this.password.input.value = '';
    this.password.input.type = 'password';
    this.password.setDisabled(builtin);
    this.password.input.placeholder = p ? (builtin ? tr('a senha vem do .env') : tr('em branco: mantém a senha')) : tr('mínimo {0} caracteres', [KV_PASSWORD_MIN]);
    this.f.password.setHint(builtin ? tr('A senha desta conta fica no .env do servidor.') : p ? tr('Só preencha para trocar. Trocar a senha desconecta a pessoa.') : tr('Use o dado para gerar uma senha forte (ela já vai copiada).'));
    this.saveBtn.querySelector('.kv-ui-btn__label')!.textContent = p ? tr('Salvar') : tr('Criar conta');
    this.delBtn.hidden = !p || builtin;
    for (const f of Object.values(this.f)) f.setError('');
    this.syncRole();
    this.renderList();
    if (focus) {
      this.name.input.focus();
      if (window.innerWidth < 760) this.editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  private syncRole(): void {
    const r = (this.role.value ?? 'cliente') as 'admin' | 'equipe' | 'cliente';
    this.roleCan.replaceChildren(...ROLE_CAN[r].map((t) => h('li', { text: t })));
    this.roleCan.dataset.role = r;
    this.clientBox.hidden = r !== 'cliente';
  }

  private values() {
    return { user: this.user.input.value.trim(), name: this.name.input.value, password: this.password.input.value, role: (this.role.value ?? 'cliente') as KvRole };
  }

  /** Validação em linha: só mostra os erros depois do primeiro envio ou de mexer no campo. */
  private validate(force = false): boolean {
    const errs = kvValidatePerson(this.values(), {
      editing: !!this.editing,
      builtin: !!this.editing?.builtin,
      taken: (u) => this.people.some((p) => p.user === u),
    });
    if (force) this.touched = true;
    const show = (k: 'user' | 'name' | 'password', input: HTMLInputElement) => this.f[k].setError(this.touched || (input.value && k !== 'password') || (k === 'password' && input.value) ? (errs[k] ?? '') : '');
    show('user', this.user.input);
    show('name', this.name.input);
    show('password', this.password.input);
    return Object.keys(errs).length === 0;
  }

  private showError(msg: string): void {
    this.formError.textContent = msg;
    this.formError.hidden = !msg;
  }

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.showError('');
    if (!this.validate(true)) {
      this.modal.el.querySelector<HTMLInputElement>('.kv-ui-field.is-invalid input')?.focus();
      return;
    }
    const p = this.editing;
    const v = this.values();
    const body: Record<string, unknown> = { name: v.name };
    if (!p?.builtin) {
      body.role = v.role;
      body.rooms = v.role === 'cliente' ? this.rooms.value : [];
      body.request = v.role === 'cliente' && this.request.checked;
      if (v.password) body.password = v.password;
    }
    if (!p) body.user = v.user;
    this.saveBtn.disabled = true;
    try {
      const r = await call('POST', p ? `${API}/${encodeURIComponent(p.id)}` : API, body);
      if (!r.ok) {
        const msg = String(r.data.error ?? tr('Não deu para salvar.'));
        if (/usuário/i.test(msg)) this.f.user.setError(msg);
        else if (/senha/i.test(msg)) this.f.password.setError(msg);
        else this.showError(msg);
        return;
      }
      const saved = r.data.person as KvPerson | undefined;
      kvToast(p ? tr('Conta de {0} salva.', [saved?.name ?? v.name]) : tr('Conta criada: {0} (@{1}).', [saved?.name ?? v.name, saved?.user ?? v.user]), { kind: 'ok' });
      this.editing = saved ?? null;
      await this.reload();
      if (!p) this.edit(null);
    } catch {
      this.showError(tr('Sem conexão com o Habblaud.'));
    } finally {
      this.saveBtn.disabled = false;
    }
  }

  private async remove(p: KvPerson): Promise<void> {
    const ok = await kvConfirm({
      title: tr('Apagar a conta de {0}?', [p.name]),
      text: tr('{0} sai do escritório agora e não entra mais com o usuário @{1}. Não dá para desfazer.', [p.name, p.user]),
      ok: tr('Apagar conta'),
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await call('DELETE', `${API}/${encodeURIComponent(p.id)}`, {});
      if (!r.ok) {
        kvToast(String(r.data.error ?? tr('Não deu para apagar.')), { kind: 'error' });
        return;
      }
      kvToast(tr('Conta de {0} apagada.', [p.name]), { kind: 'ok' });
      if (this.editing?.id === p.id) this.edit(null);
      await this.reload();
    } catch {
      kvToast(tr('Sem conexão com o Habblaud.'), { kind: 'error' });
    }
  }

  // ------------------------------------------------------------------ registro

  private async loadAudit(): Promise<void> {
    this.auditList.replaceChildren(h('li', { class: 'kv-pp__muted kv-pp__loading', text: tr('Carregando…') }));
    try {
      const r = await call('GET', '/api/kaviski/humanos/audit');
      this.audit = (r.data.entries as AuditEntry[]) ?? [];
    } catch {
      this.audit = [];
    }
    this.renderAudit();
  }

  private renderAudit(): void {
    const q = this.auditSearch.input.value.trim().toLocaleLowerCase();
    const shown = this.audit.filter((e) => !q || `${e.who.name} ${e.action} ${e.agent?.name ?? ''} ${e.agent?.room ?? ''} ${e.detail ?? ''}`.toLocaleLowerCase().includes(q));
    let lastDay = '';
    const items: HTMLElement[] = [];
    for (const e of shown) {
      const d = new Date(e.at);
      const day = d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
      if (day !== lastDay) {
        lastDay = day;
        items.push(h('li', { class: 'kv-pp__audit-day', text: day }));
      }
      items.push(
        h(
          'li',
          { class: `kv-pp__audit-item${e.ok ? '' : ' is-fail'}` },
          h('time', { text: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), attrs: { datetime: d.toISOString() } }),
          kvAvatar({ id: e.who.id, name: e.who.name, look: this.looks.get(e.who.id) }, 'xs'),
          h(
            'div',
            { class: 'kv-pp__audit-main' },
            h('div', { class: 'kv-pp__audit-top' }, h('strong', { text: e.who.name }), kvRoleBadge(e.who.role), h('span', { class: 'kv-pp__audit-action', text: e.ok ? e.action : tr('{0} (recusado)', [e.action]) })),
            e.agent || e.detail ? h('div', { class: 'kv-pp__audit-sub', text: [[e.agent?.name, e.agent?.room].filter(Boolean).join(' · '), e.detail].filter(Boolean).join(' — ') }) : null,
          ),
        ),
      );
    }
    this.auditList.replaceChildren(...items);
    if (!shown.length) this.auditList.append(h('li', {}, kvEmpty(KV_ICONS.log, q ? tr('Nada encontrado') : tr('Nada registrado ainda.'), q ? '' : tr('Aprovar, pedir tarefas, abrir terminal e mexer nas contas aparecem aqui.'))));
  }
}
