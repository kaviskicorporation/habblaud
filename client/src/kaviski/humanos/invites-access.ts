// Fork Kaviski (KAVISKI-HUMANOS.md → "Convites"): o "onde o visitante pode ir" da tela de convites (invites.ts).
// Lista agrupada — Projetos, Salas de reunião (com "todas as salas de reunião"), Salas próprias e Salas temáticas
// (desmarcada = fechada para ele) — com busca, marcar/desmarcar tudo por grupo e a contagem; e as permissões de voz/vídeo
// e do chat da sala. Só monta o pedido: quem decide é o servidor.
import { KV_INVITE_ACCESS_DEFAULT, type KvInviteAccess } from '../../../../shared/kaviski-invites';
import { KV_THEME_KEYS, type KvThemeKey } from '../../../../shared/kaviski-plan';
import type { KvOwnRoomKind } from '../../../../shared/kaviski-rooms';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvThemeInfo } from '../plan/themes-info';
import { KV_ICONS, kvBtn, kvInput, kvToggle, type KvToggle } from './ui/kit';
import { kvPick } from './ui/section';

/** O que dá para liberar (GET /invites). */
export interface KvInviteOptions {
  rooms: { id: string; path: string; name: string }[];
  own: { id: string; name: string; kind: KvOwnRoomKind }[];
  themes: { key: string; name?: string }[];
}

/** O acesso como vai no POST/PATCH. */
export type KvInviteAccessBody = KvInviteAccess & { rooms: string[] };

interface Item {
  key: string;
  label: string;
  title?: string;
  icon?: string;
}

interface Group {
  id: 'projetos' | 'reuniao' | 'proprias' | 'temas';
  title: string;
  hint: string;
  items: Item[];
  has(key: string): boolean;
  setOn(key: string, on: boolean): void;
  /** Linha extra no topo do grupo (ex.: "todas as salas de reunião"). */
  extra?: HTMLElement;
  /** Itens travados (marcados por uma regra maior). */
  locked?: () => boolean;
}

const isTheme = (k: string): k is KvThemeKey => (KV_THEME_KEYS as readonly string[]).includes(k);

export class KvInviteAccessPicker {
  readonly el: HTMLElement;
  private readonly search: ReturnType<typeof kvInput>;
  private readonly box: HTMLElement;
  private readonly voice: KvToggle;
  private readonly chat: KvToggle;
  private opts: KvInviteOptions = { rooms: [], own: [], themes: [] };
  private rooms = new Set<string>();
  private own = new Set<string>();
  private meetings = false;
  private blocked = new Set<string>();

  constructor() {
    this.search = kvInput({ placeholder: tr('Buscar sala…'), icon: KV_ICONS.search, name: 'busca-sala', onInput: () => this.render() });
    this.search.input.setAttribute('aria-label', tr('Buscar sala'));
    this.box = h('div', { class: 'kv-inv2__groups' });
    this.voice = kvToggle(tr('Voz e vídeo'), { checked: true, hint: tr('Entrar nas chamadas das salas liberadas.') });
    this.chat = kvToggle(tr('Escrever no chat da sala'), { checked: true, hint: tr('Desligado: só lê as mensagens.') });
    this.el = h('div', { class: 'kv-inv2__access' }, this.search.el, this.box, h('div', { class: 'kv-inv2__perms' }, this.voice.el, this.chat.el));
  }

  /** As salas que existem agora. `keep`: só redesenha se a lista mudou (atualização em segundo plano). */
  setOptions(o: KvInviteOptions, keep = false): void {
    const same = JSON.stringify(o) === JSON.stringify(this.opts);
    this.opts = o;
    if (!keep || !same) this.render();
  }

  /** Carrega um acesso (null = convite novo: nada liberado, temáticas abertas, voz e chat). */
  set(a: KvInviteAccessBody | null): void {
    const v = a ?? { rooms: [], ...KV_INVITE_ACCESS_DEFAULT };
    this.rooms = new Set(v.rooms);
    this.own = new Set(v.own);
    this.meetings = v.meetings;
    this.blocked = new Set(v.blocked);
    this.voice.checked = v.voice;
    this.chat.checked = v.chat;
    this.search.input.value = '';
    this.render();
  }

  value(): KvInviteAccessBody {
    return {
      rooms: [...this.rooms],
      own: [...this.own],
      meetings: this.meetings,
      blocked: [...this.blocked].filter(isTheme),
      voice: this.voice.checked,
      chat: this.chat.checked,
    };
  }

  private groups(): Group[] {
    const o = this.opts;
    // regras de projeto que não são uma sala aberta agora (ex.: a pasta do cliente inteira) também aparecem
    const projects: Item[] = o.rooms.map((r) => ({ key: r.path, label: r.name, title: r.path }));
    for (const p of this.rooms) if (!o.rooms.some((r) => r.path === p)) projects.push({ key: p, label: p.split('/').filter(Boolean).slice(-1)[0] ?? p, title: tr('{0} (tudo o que estiver dentro)', [p]) });
    const meetingAll = kvPick(tr('Todas as salas de reunião (as novas também)'), this.meetings, (on) => {
      this.meetings = on;
      this.render();
    });
    meetingAll.classList.add('kv-inv2__all');
    const themeKeys = [...new Set([...o.themes.map((t) => t.key), ...this.blocked])].filter(isTheme);
    return [
      {
        id: 'projetos',
        title: tr('Projetos'),
        hint: tr('Salas dos projetos (com os agentes).'),
        items: projects,
        has: (k) => this.rooms.has(k),
        setOn: (k, on) => void (on ? this.rooms.add(k) : this.rooms.delete(k)),
      },
      {
        id: 'reuniao',
        title: tr('Salas de reunião'),
        hint: tr('Para reuniões com o visitante.'),
        items: o.own.filter((r) => r.kind === 'reuniao').map((r) => ({ key: r.id, label: r.name })),
        has: (k) => this.meetings || this.own.has(k),
        setOn: (k, on) => void (on ? this.own.add(k) : this.own.delete(k)),
        extra: meetingAll,
        locked: () => this.meetings,
      },
      {
        id: 'proprias',
        title: tr('Salas próprias'),
        hint: tr('Salas pessoais, de descanso e outras.'),
        items: o.own.filter((r) => r.kind !== 'reuniao').map((r) => ({ key: r.id, label: r.name })),
        has: (k) => this.own.has(k),
        setOn: (k, on) => void (on ? this.own.add(k) : this.own.delete(k)),
      },
      {
        id: 'temas',
        title: tr('Salas temáticas'),
        hint: tr('Desmarcada: aparece fechada para o visitante, com "Acesso restrito".'),
        items: themeKeys.map((k) => {
          const info = kvThemeInfo(k);
          const named = o.themes.find((t) => t.key === k)?.name;
          return { key: k, label: named && named !== info.name ? `${named} (${info.name})` : info.name, title: info.desc, icon: info.icon };
        }),
        has: (k) => !this.blocked.has(k),
        setOn: (k, on) => void (on ? this.blocked.delete(k) : this.blocked.add(k)),
      },
    ];
  }

  private render(): void {
    const q = this.search.input.value.trim().toLowerCase();
    const match = (it: Item) => !q || it.label.toLowerCase().includes(q) || (it.title ?? '').toLowerCase().includes(q);
    const out: HTMLElement[] = [];
    for (const g of this.groups()) {
      const shown = g.items.filter(match);
      if (q && !shown.length) continue;
      const locked = g.locked?.() ?? false;
      const on = g.items.filter((it) => g.has(it.key)).length;
      const all = (v: boolean) => {
        for (const it of shown) g.setOn(it.key, v);
        this.render();
      };
      const markAll = kvBtn(tr('Marcar tudo'), { variant: 'ghost', size: 'sm', onClick: () => all(true) });
      const clearAll = kvBtn(tr('Desmarcar tudo'), { variant: 'ghost', size: 'sm', onClick: () => all(false) });
      markAll.disabled = locked || !shown.length || shown.every((it) => g.has(it.key));
      clearAll.disabled = locked || !shown.length || shown.every((it) => !g.has(it.key));
      const picks = shown.map((it) => {
        const extra = it.icon ? h('span', { class: 'kv-inv2__theme-ico', attrs: { 'aria-hidden': 'true' } }) : undefined;
        if (extra) extra.innerHTML = it.icon!;
        const b = kvPick(it.label, g.has(it.key), (v) => {
          g.setOn(it.key, v);
          this.render();
        }, { title: it.title, extra });
        if (locked) b.disabled = true;
        if (g.id === 'temas' && !g.has(it.key)) b.classList.add('is-shut');
        return b;
      });
      out.push(
        h(
          'div',
          { class: `kv-inv2__group kv-inv2__group--${g.id}` },
          h(
            'div',
            { class: 'kv-inv2__group-head' },
            h('strong', { text: g.title }),
            h('span', { class: 'kv-inv2__group-n', text: g.items.length ? tr('{0} de {1}', [on, g.items.length]) : '' }),
            h('span', { class: 'kv-inv2__group-hint', text: g.hint }),
            g.items.length ? h('span', { class: 'kv-inv2__group-btns' }, markAll, clearAll) : null,
          ),
          g.extra && !q ? g.extra : null,
          picks.length ? h('div', { class: 'kv-ui-picks' }, ...picks) : h('p', { class: 'kv-ui-sec__hint', text: g.id === 'temas' ? tr('nenhuma sala temática na planta') : tr('nenhuma sala') }),
        ),
      );
    }
    if (!out.length) out.push(h('p', { class: 'kv-ui-sec__hint', text: tr('Nada encontrado para “{0}”.', [this.search.input.value.trim()]) }));
    this.box.replaceChildren(...out);
  }
}
