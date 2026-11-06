// Fork Kaviski (KAVISKI-HUMANOS.md): a tecla E — "interagir com o que está perto do meu boneco". Cada módulo registra
// um provedor (móveis: sentar, café, pia...; objetos: quadro branco, mural, link na parede; salas temáticas; portas)
// que devolve uma ou mais ações. A cada quadro juntamos todas, da mais perto para a mais longe, e sobre o boneco
// flutua a barra de ações: a principal grande (ícone colorido, nome, tecla E) e até duas alternativas menores.
// Tab troca qual vale para o E; clicar (ou tocar) em qualquer uma também usa. O botão de toque do celular chama
// `kvInteractNow()`.
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvMergeInteract, type KvInteractable, type KvInteractProvider } from './interact-model';
import { kvPeople } from './world';

export type { KvInteractable, KvInteractProvider, KvInteractTone } from './interact-model';

const providers = new Set<KvInteractProvider>();
let list: KvInteractable[] = [];
let best: KvInteractable | null = null;
/** A ação escolhida com Tab (vale enquanto continuar perto). */
let chosen: string | null = null;
let bar: HTMLElement | null = null;
let painted = '';
let started = false;

/** Registra um provedor; devolve a função que o remove. */
export function kvRegisterInteract(p: KvInteractProvider): () => void {
  providers.add(p);
  start();
  return () => providers.delete(p);
}

/** O que a tecla E faria agora (null: nada por perto). */
export function kvInteractTarget(): KvInteractable | null {
  return best;
}

/** Usa o que está perto (tecla E ou botão de toque). Devolve false se não havia nada. */
export function kvInteractNow(): boolean {
  if (!best) return false;
  fire(best);
  return true;
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.('[role="dialog"], dialog'));
}

/** Foco "no mundo" (nada de botão/campo focado): só aí o Tab é da barra, não da navegação da página. */
function worldFocused(): boolean {
  const a = document.activeElement;
  return !a || a === document.body || a.id === 'world' || a.closest?.('.kv-act') !== null;
}

function fire(c: KvInteractable): void {
  try {
    navigator.vibrate?.(8); // toque: um tique curto, como o do iPhone
  } catch {
    // sem vibração
  }
  if (bar) {
    bar.classList.remove('is-fired');
    void bar.offsetWidth; // reinicia a animação
    bar.classList.add('is-fired');
  }
  chosen = null;
  c.run();
}

function chip(c: KvInteractable, main: boolean): HTMLElement {
  const tone = c.tone ?? 'work';
  return h(
    'button',
    {
      class: `kv-act__chip kv-act--${tone}${main ? ' is-main' : ''}`,
      type: 'button',
      title: main ? tr('{0} (tecla E)', [c.label]) : tr('{0} (Tab escolhe, E usa)', [c.label]),
      attrs: { 'data-id': c.id, tabindex: '-1' },
      on: {
        pointerdown: (e) => e.stopPropagation(),
        click: (e) => {
          e.stopPropagation();
          const now = list.find((x) => x.id === c.id);
          if (now) fire(now);
        },
      },
    },
    h('span', { class: 'kv-act__ico', text: c.icon ?? '✋', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'kv-act__txt' }, h('span', { class: 'kv-act__label', text: c.label }), c.sub && main ? h('span', { class: 'kv-act__sub', text: c.sub }) : null),
    main ? h('kbd', { class: 'kv-act__key', text: 'E' }) : null,
  );
}

function paint(): void {
  if (!bar) return;
  const sig = list.map((c) => `${c.id}|${c.label}|${c.icon ?? ''}|${c.sub ?? ''}`).join('§') + `#${best?.id ?? ''}`;
  if (sig === painted) return;
  const changedMain = painted.split('#')[1] !== (best?.id ?? '');
  painted = sig;
  if (!best) {
    bar.hidden = true;
    return;
  }
  const others = list.filter((c) => c !== best);
  bar.replaceChildren(chip(best, true));
  if (others.length) bar.append(h('div', { class: 'kv-act__more' }, ...others.map((c) => chip(c, false)), h('span', { class: 'kv-act__tab', attrs: { 'aria-hidden': 'true' } }, h('kbd', { text: 'Tab' }))));
  bar.setAttribute('aria-label', tr('Ação perto do avatar: {0}', [best.label]));
  if (changedMain) {
    bar.classList.remove('is-new');
    void bar.offsetWidth;
    bar.classList.add('is-new');
  }
  bar.hidden = false;
}

function tick(): void {
  const now = Date.now();
  const me = kvPeople.inside ? kvPeople.locate?.(null) : null;
  const found: (KvInteractable | KvInteractable[] | null)[] = [];
  if (me) {
    for (const p of providers) {
      try {
        found.push(p({ x: me.x, y: me.y }, now));
      } catch {
        // um provedor com problema não derruba os outros
      }
    }
  }
  list = kvMergeInteract(found);
  best = list.find((c) => c.id === chosen) ?? list[0] ?? null;
  if (!best) chosen = null;
  if (!bar) {
    bar = h('div', { class: 'kv-act', hidden: true, attrs: { role: 'group', 'aria-live': 'polite' } });
    bar.addEventListener('animationend', () => bar?.classList.remove('is-fired', 'is-new'));
    document.body.append(bar);
  }
  paint();
  if (best && me) {
    const top = me.sy - 46 * me.zoom;
    // avatar fora da tela (câmera em outro lugar): a barra some em vez de grudar na borda
    const off = me.sx < 0 || me.sx > innerWidth || top < 40 || me.sy > innerHeight;
    bar.style.visibility = off ? 'hidden' : '';
    bar.style.left = `${Math.round(me.sx)}px`;
    bar.style.top = `${Math.round(top)}px`;
  }
  requestAnimationFrame(tick);
}

function start(): void {
  if (started) return;
  started = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === 'Tab' && list.length > 1 && best && worldFocused()) {
        // Tab / Shift+Tab: a próxima (ou a anterior) ação vira a do E
        const i = list.indexOf(best);
        const next = list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length];
        chosen = next.id;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if ((e.key !== 'e' && e.key !== 'E') || e.repeat || !best) return;
      e.preventDefault();
      e.stopPropagation();
      kvInteractNow();
    },
    true,
  );
  requestAnimationFrame(tick);
}
