// Fork Kaviski (KAVISKI-HUMANOS.md): kit de interface das telas das pessoas, no tema do Habblaud (painéis escuros,
// botões "3D" com borda e sombra embaixo, detalhes em pixel). Peças simples, sem estado escondido: cada função devolve o
// elemento (e, quando precisa, um jeito de ler e mudar o valor). O CSS fica em kit.css (classes `kv-ui-*`).
//
// Select, multisseleção, caixa de diálogo e avisos ficam em select.ts, modal.ts e toast.ts.
import type { KvRole } from '../../../../../shared/kaviski-humanos';
import type { KvLook, KvStatus } from '../../../../../shared/kaviski-presence';
import { tr } from '../../../../../shared/i18n';
import { createAvatar, type AvatarSize } from '../../../ui/avatar';
import { h } from '../../../ui/dom';
import { KV_ICONS } from './icons';
import './kit.css';

export type KvBtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface KvBtnOpts {
  variant?: KvBtnVariant;
  /** SVG de ícone (KV_ICONS ou pixelIcon). */
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  type?: 'button' | 'submit';
  cls?: string;
  onClick?: (e: MouseEvent) => void;
}

/** O texto pode usar a fonte em pixel? A Pixelify confunde "C" com "O" e os dígitos (regra do styles.css original). */
export function kvPxSafe(text: string): boolean {
  return !/[C0-9]/.test(text);
}

/** Título: em pixel quando a fonte deixa ler, senão em negrito normal. */
export function kvTitle(tag: 'h2' | 'h3' | 'strong' | 'span', text: string, cls = ''): HTMLElement {
  return h(tag, { class: `kv-ui-title${kvPxSafe(text) ? ' kv-ui-px' : ''} ${cls}`.trim(), text });
}

function iconSpan(svg: string): HTMLElement {
  const s = h('span', { class: 'kv-ui-ico', attrs: { 'aria-hidden': 'true' } });
  s.innerHTML = svg;
  return s;
}

/** Botão do kit: primário (azul), secundário, perigo (vermelho) ou fantasma (sem fundo). */
export function kvBtn(label: string, o: KvBtnOpts = {}): HTMLButtonElement {
  const b = h(
    'button',
    {
      class: `kv-ui-btn kv-ui-btn--${o.variant ?? 'secondary'} kv-ui-btn--${o.size ?? 'md'} ${o.cls ?? ''}`.trim(),
      type: o.type ?? 'button',
      ...(o.title ? { title: o.title } : {}),
      ...(o.onClick ? { on: { click: o.onClick } } : {}),
    },
    o.icon ? iconSpan(o.icon) : null,
    label ? h('span', { class: 'kv-ui-btn__label', text: label }) : null,
  );
  return b;
}

/** Botão só de ícone (com rótulo acessível e dica). */
export function kvIconBtn(icon: string, label: string, onClick: (e: MouseEvent) => void, o: Omit<KvBtnOpts, 'icon' | 'onClick' | 'title'> = {}): HTMLButtonElement {
  const b = kvBtn('', { ...o, icon, title: label, onClick, variant: o.variant ?? 'ghost', cls: `kv-ui-btn--icon ${o.cls ?? ''}` });
  b.setAttribute('aria-label', label);
  return b;
}

export interface KvField {
  el: HTMLElement;
  setError(msg: string): void;
  setHint(msg: string): void;
}

let fieldSeq = 0;

/** Rótulo + controle + dica + erro em linha. O `for` do rótulo aponta para o primeiro campo do controle. */
export function kvField(label: string, control: HTMLElement, opts: { hint?: string; optional?: boolean } = {}): KvField {
  const target = control.matches('input, textarea, button') ? control : control.querySelector<HTMLElement>('input, textarea, button');
  const id = target?.id || `kv-ui-f${++fieldSeq}`;
  if (target && !target.id) target.id = id;
  const hint = h('p', { class: 'kv-ui-field__hint', text: opts.hint ?? '', hidden: !opts.hint });
  const error = h('p', { class: 'kv-ui-field__error', attrs: { role: 'alert' }, hidden: true });
  const el = h(
    'div',
    { class: 'kv-ui-field' },
    h('label', { class: 'kv-ui-field__label', attrs: { for: id } }, label, opts.optional ? h('span', { class: 'kv-ui-field__opt', text: tr('opcional') }) : null),
    control,
    hint,
    error,
  );
  return {
    el,
    setError(msg) {
      error.textContent = msg;
      error.hidden = !msg;
      el.classList.toggle('is-invalid', !!msg);
      target?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    },
    setHint(msg) {
      hint.textContent = msg;
      hint.hidden = !msg;
    },
  };
}

export interface KvInput {
  el: HTMLElement;
  input: HTMLInputElement;
}

/** Campo de texto com ícone opcional à esquerda (busca, por exemplo). */
export function kvInput(o: { placeholder?: string; value?: string; type?: string; maxlength?: number; name?: string; autocomplete?: string; icon?: string; mono?: boolean; onInput?: (v: string) => void } = {}): KvInput {
  const input = h('input', {
    class: `kv-ui-input__field${o.mono ? ' is-mono' : ''}`,
    type: o.type ?? 'text',
    attrs: {
      placeholder: o.placeholder,
      maxlength: o.maxlength,
      name: o.name,
      autocomplete: o.autocomplete ?? 'off',
      spellcheck: 'false',
      autocapitalize: 'none',
    },
  });
  if (o.value) input.value = o.value;
  if (o.onInput) input.addEventListener('input', () => o.onInput!(input.value));
  const el = h('div', { class: `kv-ui-input${o.icon ? ' has-icon' : ''}` }, o.icon ? iconSpan(o.icon) : null, input);
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el) {
      e.preventDefault();
      input.focus();
    }
  });
  return { el, input };
}

/** Uma senha forte e fácil de ditar (sem 0/O, 1/l/I). */
export function kvGeneratePassword(len = 14): string {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => abc[n % abc.length]).join('');
}

/** Senha com mostrar/ocultar e, se pedido, gerador (gera, mostra e copia). */
export function kvPassword(o: { placeholder?: string; generator?: boolean; minlength?: number; onGenerate?: (pw: string) => void } = {}): KvInput & { setDisabled(v: boolean): void } {
  const base = kvInput({ type: 'password', placeholder: o.placeholder, autocomplete: 'new-password', mono: true });
  const { input } = base;
  if (o.minlength) input.minLength = o.minlength;
  const eye = kvIconBtn(KV_ICONS.eye, tr('Mostrar a senha'), () => setShown(input.type === 'password'), { size: 'sm' });
  const setShown = (on: boolean) => {
    input.type = on ? 'text' : 'password';
    eye.innerHTML = '';
    eye.append(iconSpan(on ? KV_ICONS.eyeOff : KV_ICONS.eye));
    const label = on ? tr('Ocultar a senha') : tr('Mostrar a senha');
    eye.title = label;
    eye.setAttribute('aria-label', label);
    eye.setAttribute('aria-pressed', String(on));
  };
  base.el.append(eye);
  let gen: HTMLButtonElement | null = null;
  if (o.generator) {
    gen = kvIconBtn(
      KV_ICONS.dice,
      tr('Gerar uma senha forte (e copiar)'),
      () => {
        const pw = kvGeneratePassword();
        input.value = pw;
        setShown(true);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        void navigator.clipboard?.writeText(pw).catch(() => {});
        o.onGenerate?.(pw);
      },
      { size: 'sm' },
    );
    base.el.append(gen);
  }
  base.el.classList.add('kv-ui-input--password');
  return {
    ...base,
    setDisabled(v) {
      input.disabled = v;
      eye.disabled = v;
      if (gen) gen.disabled = v;
      if (v) setShown(false);
      base.el.classList.toggle('is-disabled', v);
    },
  };
}

export interface KvToggle {
  el: HTMLElement;
  get checked(): boolean;
  set checked(v: boolean);
  setDisabled(v: boolean): void;
}

/** Interruptor (role=switch) com rótulo e dica, no desenho do interruptor do Habblaud. */
export function kvToggle(label: string, o: { checked?: boolean; hint?: string; onChange?: (v: boolean) => void } = {}): KvToggle {
  const sw = h('button', { class: 'ui-switch kv-ui-toggle__sw', type: 'button', role: 'switch', attrs: { 'aria-checked': String(!!o.checked) } }, h('span', { class: 'ui-switch__knob' }));
  const set = (v: boolean) => sw.setAttribute('aria-checked', String(v));
  const el = h(
    'label',
    { class: 'kv-ui-toggle' },
    sw,
    h('span', { class: 'kv-ui-toggle__text' }, h('span', { class: 'kv-ui-toggle__label', text: label }), o.hint ? h('span', { class: 'kv-ui-toggle__hint', text: o.hint }) : null),
  );
  sw.addEventListener('click', (e) => {
    e.preventDefault();
    const v = sw.getAttribute('aria-checked') !== 'true';
    set(v);
    o.onChange?.(v);
  });
  el.addEventListener('click', (e) => {
    if (e.target !== sw && !sw.contains(e.target as Node)) {
      e.preventDefault();
      sw.click();
    }
  });
  return {
    el,
    get checked() {
      return sw.getAttribute('aria-checked') === 'true';
    },
    set checked(v: boolean) {
      set(v);
    },
    setDisabled(v) {
      sw.disabled = v;
      el.classList.toggle('is-disabled', v);
    },
  };
}

export interface KvTabs {
  el: HTMLElement;
  value: string;
  set(id: string): void;
  setBadge(id: string, n: number): void;
  setHidden(id: string, hidden: boolean): void;
}

/** Abas (role=tablist), com setas do teclado e contador opcional. */
export function kvTabs(items: { id: string; label: string; icon?: string }[], onChange: (id: string) => void, initial = items[0]?.id ?? ''): KvTabs {
  const btns = new Map<string, HTMLButtonElement>();
  const el = h('div', { class: 'kv-ui-tabs', role: 'tablist' });
  const api: KvTabs = {
    el,
    value: initial,
    set(id) {
      api.value = id;
      for (const [k, b] of btns) {
        b.setAttribute('aria-selected', String(k === id));
        b.tabIndex = k === id ? 0 : -1;
      }
    },
    setBadge(id, n) {
      const b = btns.get(id)?.querySelector<HTMLElement>('.kv-ui-tabs__badge');
      if (!b) return;
      b.hidden = n <= 0;
      b.textContent = n > 99 ? '99+' : String(n);
    },
    setHidden(id, hidden) {
      const b = btns.get(id);
      if (b) b.hidden = hidden;
    },
  };
  for (const it of items) {
    const b = h(
      'button',
      { class: 'kv-ui-tabs__tab', type: 'button', role: 'tab', on: { click: () => (api.set(it.id), onChange(it.id)) } },
      it.icon ? iconSpan(it.icon) : null,
      h('span', { text: it.label }),
      h('span', { class: 'kv-ui-tabs__badge', hidden: true }),
    );
    btns.set(it.id, b);
    el.append(b);
  }
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const vis = [...btns.entries()].filter(([, b]) => !b.hidden);
    const i = vis.findIndex(([k]) => k === api.value);
    const next = vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length];
    if (!next) return;
    e.preventDefault();
    api.set(next[0]);
    next[1].focus();
    onChange(next[0]);
  });
  api.set(initial);
  return api;
}

/** Cor estável para quem não escolheu cor (pelo id ou nome). */
export function kvHashColor(key: string): string {
  let n = 0;
  for (let i = 0; i < key.length; i++) n = (n * 31 + key.charCodeAt(i)) >>> 0;
  const hues = [204, 152, 32, 280, 340, 48, 188, 12];
  return `hsl(${hues[n % hues.length]} 62% 58%)`;
}

/** Iniciais ("Ana Souza" → "AS"). */
export function kvInitials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2);
  return s.toLocaleUpperCase();
}

const AV_SIZE: Record<'xs' | 'sm' | 'md' | 'lg', AvatarSize> = { xs: 'xs', sm: 'sm', md: 'md', lg: 'lg' };

/** Avatar: o mini boneco (com a moldura na cor do crachá) ou as iniciais; bolinha de status opcional. */
export function kvAvatar(p: { id?: string; name: string; look?: KvLook }, size: 'xs' | 'sm' | 'md' | 'lg' = 'sm', status?: KvStatus | 'off' | null): HTMLElement {
  const color = p.look?.color ?? kvHashColor(p.id ?? p.name);
  const inner = p.look ? createAvatar({ seed: p.look.seed, look: p.look.look, kind: 'main', parts: p.look.parts }, AV_SIZE[size]) : h('span', { class: 'kv-ui-avatar__initials', text: kvInitials(p.name) });
  const el = h('span', { class: `kv-ui-avatar kv-ui-avatar--${size}${p.look ? '' : ' is-initials'}`, attrs: { 'aria-hidden': 'true' } }, inner);
  el.style.setProperty('--kv-badge', color);
  if (status) el.append(h('span', { class: `kv-ui-avatar__st kv-ui-st--${status}` }));
  return el;
}

const ROLE_TEXT: Record<KvRole, string> = {
  admin: tr('admin'),
  equipe: tr('equipe'),
  cliente: tr('cliente'),
  visitante: tr('visitante'),
};

/** Selo do papel (ADMIN, EQUIPE, CLIENTE, VISITANTE). */
export function kvRoleBadge(role: KvRole | string): HTMLElement {
  return h('span', { class: `kv-ui-role kv-ui-role--${role}`, text: ROLE_TEXT[role as KvRole] ?? role });
}

/** Estado vazio: ícone, título, texto e (opcional) um botão. */
export function kvEmpty(icon: string, title: string, text = '', action?: HTMLElement): HTMLElement {
  return h('div', { class: 'kv-ui-empty' }, iconSpan(icon), kvTitle('strong', title, 'kv-ui-empty__title'), text ? h('p', { class: 'kv-ui-empty__text', text }) : null, action ?? null);
}

/** Chip (etiqueta) com botão de remover opcional. */
export function kvChip(label: string, o: { title?: string; icon?: string; onRemove?: () => void } = {}): HTMLElement {
  const chip = h('span', { class: 'kv-ui-chip', ...(o.title ? { title: o.title } : {}) }, o.icon ? iconSpan(o.icon) : null, h('span', { class: 'kv-ui-chip__label', text: label }));
  if (o.onRemove) {
    const x = h('button', { class: 'kv-ui-chip__x', type: 'button', attrs: { 'aria-label': tr('Tirar {0}', [label]) }, on: { click: () => o.onRemove!() } });
    x.innerHTML = KV_ICONS.close;
    chip.append(x);
  }
  return chip;
}

/** Elemento-raiz onde pôr janelas e camadas: o diálogo aberto mais em cima (camada do topo) ou o .ui-root. */
export function kvLayerFor(anchor?: Element | null): HTMLElement {
  const dlg = anchor?.closest('dialog');
  if (dlg) return dlg as HTMLElement;
  return (document.querySelector('.ui-root') as HTMLElement | null) ?? document.body;
}

export { KV_ICONS };
