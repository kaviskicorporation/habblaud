// Fork Kaviski (KAVISKI-HUMANOS.md): peças de layout do kit para as janelas das pessoas (Agenda, Convites e outras),
// no mesmo desenho da tela de Salas: seção em cartão com ícone e título, duas colunas (lista à esquerda, formulário à
// direita), botões de escolha "3D" (um entre vários) e marcadores (vários), com o visto em pixel. CSS em section.css.
import { h } from '../../../ui/dom';
import { KV_ICONS } from './icons';
import { kvTitle } from './kit';
import './section.css';

function ico(svg: string, cls: string): HTMLElement {
  const s = h('span', { class: cls, attrs: { 'aria-hidden': 'true' } });
  s.innerHTML = svg;
  return s;
}

/** Seção em cartão: ícone + título (+ dica) e o conteúdo. */
export function kvSection(icon: string, title: string, hint: string | null, ...content: (HTMLElement | null | false)[]): HTMLElement {
  return h(
    'section',
    { class: 'kv-ui-sec' },
    h('header', { class: 'kv-ui-sec__head' }, ico(icon, 'kv-ui-sec__ico'), h('div', {}, kvTitle('h3', title, 'kv-ui-sec__title'), hint ? h('p', { class: 'kv-ui-sec__hint', text: hint }) : null)),
    ...content.filter((c): c is HTMLElement => !!c),
  );
}

/** Duas colunas: a lista (estreita, com fundo) e o principal (rola). No celular, uma embaixo da outra. */
export function kvSplit(side: HTMLElement, main: HTMLElement): HTMLElement {
  side.classList.add('kv-ui-split__side');
  main.classList.add('kv-ui-split__main');
  return h('div', { class: 'kv-ui-split' }, side, main);
}

export interface KvSeg<T extends string> {
  el: HTMLElement;
  value: T;
  set(v: T): void;
}

/** Botões de escolha (um entre vários), em blocos 3D com ícone opcional. */
export function kvSeg<T extends string>(items: { value: T; label: string; icon?: string }[], value: T, onChange?: (v: T) => void, label?: string): KvSeg<T> {
  const el = h('div', { class: 'kv-ui-seg', role: 'radiogroup', ...(label ? { attrs: { 'aria-label': label } } : {}) });
  const api: KvSeg<T> = {
    el,
    value,
    set(v) {
      api.value = v;
      el.querySelectorAll<HTMLElement>('[data-v]').forEach((b) => {
        const on = b.dataset.v === v;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
    },
  };
  for (const it of items) {
    el.append(
      h(
        'button',
        {
          class: 'kv-ui-seg__btn',
          type: 'button',
          role: 'radio',
          attrs: { 'data-v': it.value },
          on: {
            click: () => {
              api.set(it.value);
              onChange?.(it.value);
            },
          },
        },
        it.icon ? ico(it.icon, 'kv-ui-ico') : null,
        h('span', { text: it.label }),
      ),
    );
  }
  api.set(value);
  return api;
}

/** Marcador (liga/desliga) em forma de pílula 3D, com a caixinha do visto em pixel. */
export function kvPick(label: string, on: boolean, onToggle: (on: boolean) => void, o: { title?: string; extra?: HTMLElement } = {}): HTMLButtonElement {
  const b = h(
    'button',
    { class: `kv-ui-pick${on ? ' is-on' : ''}`, type: 'button', ...(o.title ? { title: o.title } : {}), attrs: { 'aria-pressed': String(on) } },
    ico(KV_ICONS.check, 'kv-ui-pick__box'),
    h('span', { class: 'kv-ui-pick__label', text: label }),
    o.extra ?? null,
  );
  b.addEventListener('click', () => {
    const now = b.getAttribute('aria-pressed') !== 'true';
    b.classList.toggle('is-on', now);
    b.setAttribute('aria-pressed', String(now));
    onToggle(now);
  });
  return b;
}

/** Linha de "como fazer": ícone/selo à esquerda e o texto. */
export function kvTip(tag: string, text: string): HTMLElement {
  return h('li', { class: 'kv-ui-tip' }, h('span', { class: 'kv-ui-tip__tag', text: tag }), h('span', { class: 'kv-ui-tip__text', text }));
}
