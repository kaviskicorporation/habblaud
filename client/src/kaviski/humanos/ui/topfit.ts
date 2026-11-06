// Fork Kaviski (KAVISKI-HUMANOS.md): a barra do topo cabe na tela. Os botões das pessoas (kvTopButton, Pessoas) somam
// uns dez ícones; quando a barra não cabe numa linha (o grupo de ícones desce e empurra o logo para fora), os de menor
// prioridade (maior `order`) vão para um menu "Mais" no fim do grupo, com o nome de cada um. Os botões são os mesmos
// (só mudam de lugar): contadores e estados continuam neles. Ao alargar a janela, voltam ao topo.
import { tr } from '../../../../../shared/i18n';
import { h, iconButton } from '../../../ui/dom';
import { KV_ICONS } from './icons';

/** Os que ficam por último no menu (a conversa sempre à mão). */
const KEEP: Record<string, number> = { 'kv-btn-chat': 1000 };

let more: HTMLButtonElement | null = null;
let menu: HTMLElement | null = null;
const moved: { el: HTMLElement; mark: Comment }[] = [];
let watch: MutationObserver | null = null;

function group(): HTMLElement | null {
  return (document.querySelector('.ui-btn-feed')?.parentElement as HTMLElement | null) ?? null;
}

/** Botões das pessoas no grupo, na ordem em que saem primeiro. */
function candidates(g: HTMLElement): HTMLElement[] {
  return [...g.children]
    .filter((c): c is HTMLElement => c instanceof HTMLElement && c !== more && [...c.classList].some((k) => k.startsWith('kv-btn-')))
    .sort((a, b) => prio(b) - prio(a));
}

function prio(el: HTMLElement): number {
  for (const k of el.classList) if (KEEP[k] !== undefined) return -KEEP[k]!;
  return Number(el.dataset.kvOrder ?? 0);
}

/** A barra quebrou de linha? (o grupo da direita desceu em relação ao logo) */
function wrapped(): boolean {
  const left = document.querySelector('.ui-topbar__left')?.getBoundingClientRect();
  const right = document.querySelector('.ui-topbar__right')?.getBoundingClientRect();
  return !!left && !!right && right.width > 0 && right.top - left.top > 18;
}

function restore(): void {
  while (moved.length) {
    const m = moved.pop()!;
    m.mark.replaceWith(m.el);
  }
}

function fit(): void {
  const g = group();
  if (!g || !more) return;
  // as mudanças feitas aqui não contam como "botão novo"
  watch?.disconnect();
  try {
    place(g);
  } finally {
    watch?.observe(g, { childList: true });
  }
}

function place(g: HTMLElement): void {
  if (!more) return;
  closeMenu();
  restore();
  more.hidden = true;
  if (!wrapped()) return;
  more.hidden = false;
  for (const el of candidates(g)) {
    if (!wrapped()) break;
    const mark = document.createComment('kv-top');
    el.replaceWith(mark);
    moved.push({ el, mark });
  }
  more.querySelector('.kv-top-more__dot')?.toggleAttribute('hidden', !moved.some((m) => m.el.querySelector('.kv-dock__badge:not([hidden]), .kv-top-badge:not([hidden])')));
}

function closeMenu(): void {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  more?.setAttribute('aria-expanded', 'false');
}

function openMenu(): void {
  if (!menu || !more) return;
  menu.replaceChildren(
    ...moved
      .slice()
      .reverse()
      .map(({ el }) => {
        const label = el.getAttribute('aria-label') ?? el.title ?? '';
        const icon = h('span', { class: 'kv-top-more__ico', attrs: { 'aria-hidden': 'true' } });
        icon.innerHTML = el.querySelector('svg')?.outerHTML ?? '';
        const badge = el.querySelector<HTMLElement>('.kv-dock__badge:not([hidden]), .kv-top-badge:not([hidden])');
        return h(
          'button',
          {
            class: `kv-top-more__item${el.classList.contains('is-on') || el.getAttribute('aria-pressed') === 'true' ? ' is-on' : ''}`,
            type: 'button',
            role: 'menuitem',
            on: {
              click: (e: MouseEvent) => {
                closeMenu();
                // o botão original continua o mesmo: o clique dele abre a janela (perto do botão Mais)
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
              },
            },
          },
          icon,
          h('span', { class: 'kv-top-more__label', text: label }),
          badge ? h('span', { class: 'kv-ui-count', text: badge.textContent ?? '' }) : null,
        );
      }),
  );
  const r = more.getBoundingClientRect();
  menu.hidden = false;
  // alinhado pela direita do botão, sem sair da tela (no celular o botão fica no meio)
  const w = Math.min(menu.offsetWidth, window.innerWidth - 16);
  menu.style.maxWidth = `${window.innerWidth - 16}px`;
  menu.style.top = `${Math.round(r.bottom + 8)}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
  more.setAttribute('aria-expanded', 'true');
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}

/** Liga o encaixe (uma vez, depois que os botões das pessoas entraram no topo). */
export function kvTopFit(): void {
  const g = group();
  if (!g || more) return;
  more = iconButton(KV_ICONS.dots, tr('Mais (botões do escritório que não couberam)'), () => (menu && !menu.hidden ? closeMenu() : openMenu()), 'kv-top-more');
  more.setAttribute('aria-haspopup', 'menu');
  more.append(h('span', { class: 'kv-top-more__dot', hidden: true }));
  more.hidden = true;
  // no fim dos botões das pessoas (antes dos originais)
  const kv = [...g.children].filter((c) => [...c.classList].some((k) => k.startsWith('kv-btn-')));
  (kv[kv.length - 1] ?? g.firstElementChild)?.after(more);
  menu = h('div', { class: 'kv-top-more__menu', role: 'menu', hidden: true, attrs: { 'aria-label': tr('Mais') } });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu!.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Escape') {
      closeMenu();
      more?.focus();
    } else return;
    e.preventDefault();
  });
  (document.querySelector('.ui-root') ?? document.body).append(menu);
  document.addEventListener('pointerdown', (e) => {
    if (menu && !menu.hidden && !menu.contains(e.target as Node) && !more?.contains(e.target as Node)) closeMenu();
  });
  let raf = 0;
  const later = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fit);
  };
  window.addEventListener('resize', later);
  // botões que entram depois (agenda, foco, avisos...) e contadores que mudam
  watch = new MutationObserver(later);
  watch.observe(g, { childList: true });
  setInterval(() => {
    if ((moved.length || wrapped()) && menu?.hidden) fit();
  }, 3_000);
  later();
}
