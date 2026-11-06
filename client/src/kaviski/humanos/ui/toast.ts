// Fork Kaviski (KAVISKI-HUMANOS.md): avisos curtos do kit (toasts) embaixo da barra do topo, no meio: "Conta criada",
// "Mensagem de Ana: ...". Os avisos do Habblaud original continuam no canto de baixo (ui/toasts.ts); estes são das pessoas.
import { tr } from '../../../../../shared/i18n';
import { h } from '../../../ui/dom';
import { KV_ICONS } from './icons';

export type KvToastKind = 'info' | 'ok' | 'warn' | 'error';

export interface KvToastOpts {
  kind?: KvToastKind;
  title?: string;
  /** Avatar ou ícone à esquerda. */
  lead?: HTMLElement;
  /** Clique no aviso. */
  onClick?: () => void;
  action?: { label: string; run: () => void };
  /** Aviso com a mesma chave troca o anterior (ex.: várias mensagens da mesma pessoa viram um aviso só). */
  key?: string;
  /** Tempo na tela (ms); 0 = até fechar. */
  ms?: number;
}

const MAX = 4;
let stack: HTMLElement | null = null;

function host(): HTMLElement {
  if (!stack || !stack.isConnected) {
    stack = h('div', { class: 'kv-ui-toasts', attrs: { 'aria-live': 'polite' } });
    (document.querySelector('.ui-root') ?? document.body).append(stack);
  }
  // com um diálogo modal aberto, o aviso precisa ficar na camada do topo (dentro do diálogo)
  const dlg = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].pop();
  const parent = dlg ?? document.querySelector('.ui-root') ?? document.body;
  if (stack.parentElement !== parent) parent.append(stack);
  return stack;
}

const ICON: Record<KvToastKind, string> = { info: KV_ICONS.chat, ok: KV_ICONS.check, warn: KV_ICONS.alert, error: KV_ICONS.alert };

/** Mostra um aviso; devolve a função que o fecha. */
export function kvToast(text: string, o: KvToastOpts = {}): () => void {
  const kind = o.kind ?? 'info';
  const lead = o.lead ?? h('span', { class: 'kv-ui-ico kv-ui-toast__icon', attrs: { 'aria-hidden': 'true' } });
  if (!o.lead) lead.innerHTML = ICON[kind];
  const x = h('button', { class: 'kv-ui-toast__x', type: 'button', attrs: { 'aria-label': tr('Fechar') } });
  x.innerHTML = KV_ICONS.close;
  const el = h(
    'div',
    { class: `kv-ui-toast kv-ui-toast--${kind}${o.onClick ? ' is-clickable' : ''}`, role: kind === 'error' || kind === 'warn' ? 'alert' : 'status' },
    lead,
    h('div', { class: 'kv-ui-toast__text' }, o.title ? h('strong', { text: o.title }) : null, h('span', { text })),
    o.action ? h('button', { class: 'kv-ui-btn kv-ui-btn--secondary kv-ui-btn--sm', type: 'button', text: o.action.label, on: { click: (e) => (e.stopPropagation(), close(), o.action!.run()) } }) : null,
    x,
  );
  let timer: ReturnType<typeof setTimeout> | null = null;
  const close = () => {
    if (timer) clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  };
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  if (o.onClick) {
    el.addEventListener('click', () => {
      close();
      o.onClick!();
    });
  }
  const s = host();
  if (o.key) {
    el.dataset.key = o.key;
    for (const old of s.querySelectorAll<HTMLElement>('.kv-ui-toast')) if (old.dataset.key === o.key) old.remove();
  }
  s.append(el);
  while (s.childElementCount > MAX) s.firstElementChild?.remove();
  const ms = o.ms ?? (kind === 'error' ? 8000 : 5000);
  if (ms > 0) {
    timer = setTimeout(close, ms);
    el.addEventListener('pointerenter', () => timer && clearTimeout(timer));
    el.addEventListener('pointerleave', () => (timer = setTimeout(close, 2500)));
  }
  return close;
}
