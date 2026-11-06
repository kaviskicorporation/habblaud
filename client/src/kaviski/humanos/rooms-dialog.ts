// Fork Kaviski (KAVISKI-HUMANOS.md): tela de Salas (botão no topo, para a equipe): criar, editar e apagar as salas
// próprias — a sala pessoal, salas de reunião, de descanso e outras (admin: qualquer; equipe: a própria sala pessoal e
// salas de reunião; cliente não cria). Quem vê, paleta, cor e uma decoração simples (pôr/tirar itens em lugares livres).
// Fala com GET|POST /api/kaviski/humanos/rooms e POST|DELETE /api/kaviski/humanos/rooms/:id; o servidor confere tudo.
import type { KvPerson } from '../../../../shared/kaviski-humanos';
import {
  KV_DECOR_FLOOR,
  KV_DECOR_MAX,
  KV_DECOR_VARIANTS,
  KV_DECOR_WALL,
  KV_ROOM_STYLES,
  type KvDecorItem,
  type KvDecorKind,
  type KvOwnRoomKind,
} from '../../../../shared/kaviski-rooms';
import { tr } from '../../../../shared/i18n';
import { roomTheme } from '../../art';
import { h, iconButton } from '../../ui/dom';
import { ICONS } from '../../ui/icons';
import { kvDecorFree } from './rooms-layout';
import { KIND_LABEL, kvReloadRooms, kvRoomsState, ROOMS_API, type KvOwnRoomView } from './rooms';
import { kvPeople } from './world';

const DECOR_LABEL: Record<KvDecorKind, string> = {
  planta: tr('Planta'),
  planta_alta: tr('Planta alta'),
  luminaria: tr('Luminária'),
  estante: tr('Estante'),
  arquivo: tr('Arquivo'),
  puff: tr('Puff'),
  quadro: tr('Quadro'),
  poster: tr('Pôster'),
  relogio: tr('Relógio'),
  tapete: tr('Tapete'),
};
/** Letra/ícone de cada item na grade da decoração. */
const DECOR_GLYPH: Record<KvDecorKind, string> = { planta: '🌿', planta_alta: '🌴', luminaria: '💡', estante: '📚', arquivo: '🗄', puff: '🟠', quadro: '🖼', poster: '📄', relogio: '🕒', tapete: '▦' };
const KIND_HINT: Record<KvOwnRoomKind, string> = {
  pessoal: tr('A sua sala (ou canto) fixa na empresa: mesa, estante e um cantinho para visitas.'),
  reuniao: tr('Mesa grande com banquetas e quadro branco.'),
  descanso: tr('Sofá e poltronas de frente para a TV, puffs.'),
  outra: tr('Duas mesas e uma mesa de reunião.'),
};
const RUG_SIZES: [number, number][] = [
  [2, 2],
  [3, 2],
  [4, 3],
];

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

export class KvRoomsDialog {
  readonly el: HTMLDialogElement;
  private readonly list: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly formTitle: HTMLElement;
  private readonly kind: HTMLSelectElement;
  private readonly kindHint: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly ownerBox: HTMLElement;
  private readonly owner: HTMLSelectElement;
  private readonly access: HTMLSelectElement;
  private readonly peopleBox: HTMLElement;
  private readonly peopleHint: HTMLElement;
  private readonly styles: HTMLElement;
  private readonly color: HTMLInputElement;
  private readonly noColor: HTMLInputElement;
  private readonly decorBox: HTMLElement;
  private readonly decorGrid: HTMLElement;
  private readonly decorWall: HTMLElement;
  private readonly decorKind: HTMLSelectElement;
  private readonly decorVariant: HTMLSelectElement;
  private readonly rugSize: HTMLSelectElement;
  private readonly rugColor: HTMLInputElement;
  private readonly decorCount: HTMLElement;
  private readonly error: HTMLElement;
  private readonly save: HTMLButtonElement;
  private readonly createBox: HTMLElement;
  private editing: KvOwnRoomView | null = null;
  private style = 0;
  private decor: KvDecorItem[] = [];
  private chosen = new Set<string>();

  constructor(private readonly me: KvPerson) {
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    this.list = h('ul', { class: 'kv-people__list' });
    this.formTitle = h('h3', { text: tr('Nova sala') });
    this.kind = h('select', { class: 'kv-people__input', attrs: { name: 'kind' } });
    this.kindHint = h('p', { class: 'kv-people__hint' });
    this.name = h('input', { class: 'kv-people__input', attrs: { name: 'name', maxlength: '40', autocomplete: 'off', placeholder: tr('ex.: Sala do Vitor') } });
    this.owner = h('select', { class: 'kv-people__input', attrs: { name: 'owner' } });
    this.ownerBox = h('div', {}, h('label', { class: 'kv-people__label', text: tr('Dono') }), this.owner);
    this.access = h('select', { class: 'kv-people__input', attrs: { name: 'access' } });
    this.access.append(h('option', { text: tr('A equipe toda (e os clientes marcados)'), attrs: { value: 'equipe' } }), h('option', { text: tr('Só as pessoas marcadas'), attrs: { value: 'escolhidos' } }));
    this.peopleBox = h('div', { class: 'kv-salas__people' });
    this.peopleHint = h('p', { class: 'kv-people__hint' });
    this.styles = h('div', { class: 'kv-salas__styles', role: 'radiogroup' });
    for (let i = 0; i < KV_ROOM_STYLES; i++) {
      const t = roomTheme(i);
      this.styles.append(
        h('button', {
          class: 'kv-salas__style',
          type: 'button',
          style: `--a:${t.accent};--c:${t.carpet};--w:${t.wall.base}`,
          title: tr('Paleta {0}', [i + 1]),
          attrs: { 'aria-label': tr('Paleta {0}', [i + 1]), 'data-style': String(i), role: 'radio' },
          on: { click: () => this.setStyle(i) },
        }),
      );
    }
    this.color = h('input', { class: 'kv-salas__color', type: 'color', attrs: { name: 'color', value: '#3f7fd8' } });
    this.noColor = h('input', { type: 'checkbox', attrs: { name: 'nocolor' } });
    this.decorKind = h('select', { class: 'kv-people__input', attrs: { 'aria-label': tr('Item') } });
    for (const k of [...KV_DECOR_FLOOR, ...KV_DECOR_WALL, 'tapete'] as KvDecorKind[]) this.decorKind.append(h('option', { text: `${DECOR_GLYPH[k]} ${DECOR_LABEL[k]}`, attrs: { value: k } }));
    this.decorVariant = h('select', { class: 'kv-people__input', attrs: { 'aria-label': tr('Variação') } });
    this.rugSize = h('select', { class: 'kv-people__input', attrs: { 'aria-label': tr('Tamanho do tapete') } });
    RUG_SIZES.forEach(([w, hh], i) => this.rugSize.append(h('option', { text: `${w}×${hh}`, attrs: { value: String(i) } })));
    this.rugColor = h('input', { class: 'kv-salas__color', type: 'color', attrs: { value: '#b65f3a', 'aria-label': tr('Cor do tapete') } });
    this.decorKind.addEventListener('change', () => this.syncDecorKind());
    this.decorWall = h('div', { class: 'kv-salas__wall' });
    this.decorGrid = h('div', { class: 'kv-salas__grid' });
    this.decorCount = h('span', { class: 'kv-people__hint' });
    this.decorBox = h(
      'div',
      { class: 'kv-salas__decor' },
      h('label', { class: 'kv-people__label', text: tr('Decoração: escolha o item e clique num lugar livre (clique num item para tirar)') }),
      h('div', { class: 'kv-salas__decor-tools' }, this.decorKind, this.decorVariant, this.rugSize, this.rugColor),
      this.decorWall,
      this.decorGrid,
      this.decorCount,
    );
    this.error = h('p', { class: 'kv-people__error', attrs: { role: 'alert' } });
    this.save = h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: tr('Criar') });
    const cancel = h('button', { class: 'ui-btn', type: 'button', text: tr('Limpar'), on: { click: () => this.edit(null) } });
    this.kind.addEventListener('change', () => this.syncKind());
    this.access.addEventListener('change', () => this.syncAccess());
    this.form = h(
      'form',
      { class: 'kv-people__form', on: { submit: (e: Event) => void this.submit(e) } },
      this.formTitle,
      h('label', { class: 'kv-people__label', text: tr('Tipo') }),
      this.kind,
      this.kindHint,
      h('label', { class: 'kv-people__label', text: tr('Nome') }),
      this.name,
      this.ownerBox,
      h('label', { class: 'kv-people__label', text: tr('Quem vê') }),
      this.access,
      this.peopleHint,
      this.peopleBox,
      h('label', { class: 'kv-people__label', text: tr('Paleta da sala') }),
      this.styles,
      h('label', { class: 'kv-people__check' }, this.color, h('span', { text: tr('Cor da placa') }), this.noColor, h('span', { text: tr('sem cor') })),
      this.decorBox,
      this.error,
      h('div', { class: 'kv-people__actions' }, cancel, this.save),
    );
    this.createBox = h('section', {}, this.form);
    this.el = h(
      'dialog',
      { class: 'ui-dialog kv-people kv-salas', attrs: { 'aria-labelledby': 'kv-salas-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Salas do escritório'), attrs: { id: 'kv-salas-title' } }), close),
      h('div', { class: 'ui-dialog__body kv-people__body' }, h('section', {}, h('h3', { text: tr('Salas próprias') }), h('p', { class: 'kv-people__hint', text: tr('Salas que não são projetos: ficam sempre no prédio, com conversa e voz da sala.') }), this.list), this.createBox),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
  }

  async open(): Promise<void> {
    if (!this.el.open) this.el.showModal();
    await kvReloadRooms();
    this.render();
    this.edit(null);
  }

  private render(): void {
    const s = kvRoomsState();
    const names = new Map((s.people ?? []).map((p) => [p.id, p.name]));
    this.list.replaceChildren(
      ...s.rooms.map((r) =>
        h(
          'li',
          { class: `kv-people__item${this.editing?.id === r.id ? ' is-on' : ''}` },
          h('div', { class: 'kv-people__who' }, h('span', { class: 'kv-salas__dot', style: `--a:${r.color ?? roomTheme(r.style).accent}` }), h('strong', { text: r.name }), h('span', { class: 'kv-people__tag', text: KIND_LABEL[r.kind] })),
          h('div', { class: 'kv-people__meta', text: [r.owner ? (names.get(r.owner) ?? '') : '', r.access === 'equipe' ? tr('a equipe toda') : tr('só as pessoas marcadas'), s.mine === r.id ? tr('a minha sala') : ''].filter(Boolean).join(' · ') }),
          h(
            'div',
            { class: 'kv-people__row-actions' },
            h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Ver'), on: { click: () => this.look(r.id) } }),
            r.canEdit ? h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Editar'), on: { click: () => this.edit(r) } }) : null,
            r.canEdit ? h('button', { class: 'ui-btn ui-btn--sm is-danger', type: 'button', text: tr('Apagar'), on: { click: () => void this.remove(r) } }) : null,
          ),
        ),
      ),
    );
    if (!s.rooms.length) this.list.append(h('li', { class: 'kv-people__hint', text: tr('Nenhuma sala própria ainda.') }));
  }

  /** Leva a câmera até a sala. */
  private look(id: string): void {
    if (!kvPeople.sim?.().rooms.get(id)) return;
    (window as { habblaud?: { world?: { focusRoom?: (id: string) => void } } }).habblaud?.world?.focusRoom?.(id);
    this.el.close();
  }

  private edit(r: KvOwnRoomView | null): void {
    const s = kvRoomsState();
    this.editing = r;
    this.error.textContent = '';
    this.formTitle.textContent = r ? tr('Editar {0}', [r.name]) : tr('Nova sala');
    this.save.textContent = r ? tr('Salvar') : tr('Criar');
    const kinds: KvOwnRoomKind[] = r ? [r.kind] : s.canCreate;
    this.kind.replaceChildren(...kinds.map((k) => h('option', { text: KIND_LABEL[k], attrs: { value: k } })));
    this.kind.disabled = !!r;
    this.createBox.hidden = !r && !s.canCreate.length;
    this.name.value = r?.name ?? '';
    const admin = this.me.role === 'admin';
    this.ownerBox.hidden = !admin;
    this.owner.replaceChildren(...(s.people ?? []).filter((p) => p.role !== 'cliente' && p.role !== 'visitante').map((p) => h('option', { text: p.name, attrs: { value: p.id } })));
    this.owner.value = r?.owner ?? this.me.id;
    this.access.value = r?.access ?? 'equipe';
    this.chosen = new Set(r?.people ?? []);
    this.style = r?.style ?? Math.floor(Math.random() * KV_ROOM_STYLES);
    this.setStyle(this.style);
    this.noColor.checked = !r?.color;
    this.color.value = r?.color ?? '#3f7fd8';
    this.decor = [...(r?.decor ?? [])];
    this.syncKind();
    this.syncAccess();
    this.syncDecorKind();
    this.render();
  }

  private syncKind(): void {
    const kind = this.kind.value as KvOwnRoomKind;
    this.kindHint.textContent = KIND_HINT[kind] ?? '';
    if (!this.editing && !this.name.value) this.name.placeholder = kind === 'pessoal' ? tr('Sala de {0}', [this.me.name]) : KIND_LABEL[kind] ?? '';
    this.renderDecor();
  }

  private syncAccess(): void {
    const s = kvRoomsState();
    const only = this.access.value === 'escolhidos';
    this.peopleHint.textContent = only ? tr('Marque quem vê esta sala (você e os admins veem sempre):') : tr('A equipe toda vê. Marque os clientes que também podem entrar:');
    const list = (s.people ?? []).filter((p) => p.id !== this.me.id && (only || p.role === 'cliente' || p.role === 'visitante'));
    this.peopleBox.replaceChildren(
      ...list.map((p) => {
        const box = h('input', { type: 'checkbox', attrs: { value: p.id } });
        box.checked = this.chosen.has(p.id);
        box.addEventListener('change', () => (box.checked ? this.chosen.add(p.id) : this.chosen.delete(p.id)));
        return h('label', { class: 'kv-people__check' }, box, h('span', { text: `${p.name} · ${p.role}` }));
      }),
    );
    if (!list.length) this.peopleBox.append(h('p', { class: 'kv-people__hint', text: only ? tr('Ninguém mais para marcar.') : tr('Nenhum cliente cadastrado.') }));
  }

  private setStyle(i: number): void {
    this.style = i;
    this.styles.querySelectorAll<HTMLElement>('[data-style]').forEach((b) => {
      const on = b.dataset.style === String(i);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    this.renderDecor();
  }

  private syncDecorKind(): void {
    const k = this.decorKind.value as KvDecorKind;
    const variants = KV_DECOR_VARIANTS[k] ?? [];
    this.decorVariant.replaceChildren(...variants.map((v) => h('option', { text: v, attrs: { value: v } })));
    this.decorVariant.hidden = !variants.length;
    this.rugSize.hidden = k !== 'tapete';
    this.rugColor.hidden = k !== 'tapete';
  }

  /** A grade da sala (14x9) e a faixa da parede (1..15), com o que já está ocupado pelo layout do tipo. */
  private renderDecor(): void {
    const kind = this.kind.value as KvOwnRoomKind;
    if (!kind) return;
    const free = kvDecorFree(kind, roomTheme(this.style));
    const at = (x: number, y: number) => this.decor.findIndex((d) => !KV_DECOR_WALL.includes(d.kind) && d.kind !== 'tapete' && d.x === x && d.y === y);
    const rugAt = (x: number, y: number) => this.decor.findIndex((d) => d.kind === 'tapete' && x >= d.x && x < d.x + (d.w ?? 0) && y >= d.y && y < d.y + (d.h ?? 0));
    const cells: HTMLElement[] = [];
    for (let y = 2; y <= 10; y++) {
      for (let x = 1; x <= 14; x++) {
        const i = at(x, y);
        const r = rugAt(x, y);
        const ok = free.floor.has(`${x},${y}`);
        const item = i >= 0 ? this.decor[i] : undefined;
        cells.push(
          h('button', {
            class: `kv-salas__cell${ok ? '' : ' is-busy'}${r >= 0 ? ' is-rug' : ''}`,
            type: 'button',
            text: item ? DECOR_GLYPH[item.kind] : '',
            style: r >= 0 ? `--rug:${this.decor[r]!.color}` : '',
            title: item ? tr('Tirar {0}', [DECOR_LABEL[item.kind]]) : ok ? tr('Pôr aqui') : tr('Ocupado'),
            attrs: { 'aria-label': `${x},${y}` },
            on: { click: () => this.cellClick(x, y, ok) },
          }),
        );
      }
    }
    this.decorGrid.replaceChildren(...cells);
    const wallCells: HTMLElement[] = [];
    for (let x = 1; x <= 14; x++) {
      const i = this.decor.findIndex((d) => KV_DECOR_WALL.includes(d.kind) && Math.floor(d.x - (d.kind === 'quadro' ? 1 : 0.5)) === x);
      const item = i >= 0 ? this.decor[i] : undefined;
      const busy = free.wall.some(([a, b]) => x + 0.5 > a && x + 0.5 < b);
      wallCells.push(
        h('button', {
          class: `kv-salas__cell kv-salas__cell--wall${busy ? ' is-busy' : ''}`,
          type: 'button',
          text: item ? DECOR_GLYPH[item.kind] : '',
          title: item ? tr('Tirar {0}', [DECOR_LABEL[item.kind]]) : busy ? tr('Ocupado') : tr('Pôr na parede'),
          attrs: { 'aria-label': tr('parede {0}', [x]) },
          on: { click: () => this.wallClick(x, i, free.wall) },
        }),
      );
    }
    this.decorWall.replaceChildren(...wallCells);
    this.decorCount.textContent = tr('{0} de {1} itens', [this.decor.length, KV_DECOR_MAX]);
  }

  private cellClick(x: number, y: number, ok: boolean): void {
    const i = this.decor.findIndex((d) => !KV_DECOR_WALL.includes(d.kind) && d.kind !== 'tapete' && d.x === x && d.y === y);
    const k = this.decorKind.value as KvDecorKind;
    if (i >= 0) this.decor.splice(i, 1);
    else if (k === 'tapete') {
      const r = this.decor.findIndex((d) => d.kind === 'tapete' && x >= d.x && x < d.x + (d.w ?? 0) && y >= d.y && y < d.y + (d.h ?? 0));
      if (r >= 0) this.decor.splice(r, 1);
      else if (this.decor.length < KV_DECOR_MAX) {
        const [w, hh] = RUG_SIZES[Number(this.rugSize.value)] ?? RUG_SIZES[0]!;
        this.decor.push({ kind: 'tapete', x, y, w: Math.min(w, 15 - x), h: Math.min(hh, 11 - y), color: this.rugColor.value });
      }
    } else if (ok && !KV_DECOR_WALL.includes(k) && this.decor.length < KV_DECOR_MAX) {
      this.decor.push({ kind: k, x, y, ...(this.decorVariant.value ? { variant: this.decorVariant.value } : {}) });
    }
    this.renderDecor();
  }

  private wallClick(x: number, i: number, busy: [number, number][]): void {
    const k = this.decorKind.value as KvDecorKind;
    if (i >= 0) this.decor.splice(i, 1);
    else if (KV_DECOR_WALL.includes(k) && this.decor.length < KV_DECOR_MAX) {
      const half = k === 'quadro' ? 1 : 0.5;
      const cx = x + half;
      const spans: [number, number][] = [
        ...busy,
        ...this.decor.filter((d) => KV_DECOR_WALL.includes(d.kind)).map((d) => [d.x - (d.kind === 'quadro' ? 1 : 0.5), d.x + (d.kind === 'quadro' ? 1 : 0.5)] as [number, number]),
      ];
      if (cx + half > 15.5 || spans.some(([a, b]) => cx - half < b && cx + half > a)) {
        this.error.textContent = tr('Não cabe aí: escolha um trecho livre da parede.');
        return;
      }
      this.error.textContent = '';
      this.decor.push({ kind: k, x: cx, y: 0, ...(this.decorVariant.value ? { variant: this.decorVariant.value } : {}) });
    }
    this.renderDecor();
  }

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.error.textContent = '';
    const body: Record<string, unknown> = {
      name: this.name.value.trim() || undefined,
      access: this.access.value,
      people: [...this.chosen],
      style: this.style,
      color: this.noColor.checked ? null : this.color.value,
      decor: this.decor,
    };
    if (this.me.role === 'admin' && this.owner.value) body.owner = this.owner.value;
    if (!this.editing) body.kind = this.kind.value;
    const r = await call('POST', this.editing ? `${ROOMS_API}/${encodeURIComponent(this.editing.id)}` : ROOMS_API, body).catch(() => ({ ok: false, data: { error: tr('Sem conexão com o servidor.') } as Record<string, unknown> }));
    if (!r.ok) {
      this.error.textContent = String(r.data.error ?? tr('Não deu para salvar.'));
      return;
    }
    await kvReloadRooms();
    const saved = (r.data.room as KvOwnRoomView | undefined)?.id;
    this.edit(kvRoomsState().rooms.find((x) => x.id === saved) ?? null);
  }

  private async remove(r: KvOwnRoomView): Promise<void> {
    if (!confirm(tr('Apagar a sala {0}? O quadro, o mural e os links dela também somem.', [r.name]))) return;
    const res = await call('DELETE', `${ROOMS_API}/${encodeURIComponent(r.id)}`).catch(() => ({ ok: false, data: { error: tr('Sem conexão com o servidor.') } as Record<string, unknown> }));
    if (!res.ok) this.error.textContent = String(res.data.error ?? '');
    await kvReloadRooms();
    this.edit(null);
  }
}
