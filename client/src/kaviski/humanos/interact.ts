// Fork Kaviski (KAVISKI-HUMANOS.md): a tecla E — "interagir com o que está perto do meu boneco". Cada módulo registra
// um provedor (móveis: sentar; objetos: quadro branco, mural, link na parede...); a cada quadro vale o mais perto, e
// uma dica "E · Sentar" flutua sobre o boneco. O botão de toque do celular chama `kvInteractNow()`.
import { h } from '../../ui/dom';
import { kvPeople } from './world';

export interface KvInteractable {
  /** Estável enquanto for a mesma coisa (evita piscar a dica). */
  id: string;
  /** Texto da dica, já traduzido (ex.: tr('Sentar')). */
  label: string;
  /** Distância em pixels do mundo até o meu boneco (o menor vence). */
  dist: number;
  run(): void;
}

/** Recebe a posição do meu boneco (pixels do mundo) e devolve o que dá para usar ali, ou null. */
export type KvInteractProvider = (me: { x: number; y: number }, now: number) => KvInteractable | null;

const providers = new Set<KvInteractProvider>();
let best: KvInteractable | null = null;
let hint: HTMLElement | null = null;
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
  best.run();
  return true;
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.('[role="dialog"], dialog'));
}

function tick(): void {
  const now = Date.now();
  const me = kvPeople.inside ? kvPeople.locate?.(null) : null;
  let next: KvInteractable | null = null;
  if (me) {
    for (const p of providers) {
      let c: KvInteractable | null = null;
      try {
        c = p({ x: me.x, y: me.y }, now);
      } catch {
        c = null;
      }
      if (c && (!next || c.dist < next.dist)) next = c;
    }
  }
  best = next;
  if (!hint) {
    hint = h('div', { class: 'kv-interact-hint', hidden: true, attrs: { 'aria-live': 'polite' } });
    document.body.append(hint);
  }
  if (!next || !me) hint.hidden = true;
  else {
    const text = `E · ${next.label}`;
    if (hint.textContent !== text) hint.textContent = text;
    hint.style.left = `${Math.round(me.sx)}px`;
    hint.style.top = `${Math.round(me.sy - 46 * me.zoom)}px`;
    hint.hidden = false;
  }
  requestAnimationFrame(tick);
}

function start(): void {
  if (started) return;
  started = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.key !== 'e' && e.key !== 'E') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (typing(e.target) || !best) return;
      e.preventDefault();
      e.stopPropagation();
      kvInteractNow();
    },
    true,
  );
  requestAnimationFrame(tick);
}
