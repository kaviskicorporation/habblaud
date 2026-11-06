// Fork Kaviski (KAVISKI-HUMANOS.md): "mesa de Fulano" — o nome perto da cadeira da mesa fixa enquanto ela está vazia
// (o world.ts manda a lista a cada quadro). Etiquetas de página (DOM), sem clique, só com zoom de perto.
import { tr } from '../../../../shared/i18n';
import type { SpotDef } from '../../world/layout/types';
import { h } from '../../ui/dom';

/** Abaixo deste zoom (px de tela por px de mundo) as etiquetas somem: viram ruído na visão geral. */
const MIN_ZOOM = 1.4;

let root: HTMLElement | null = null;
const els = new Map<string, HTMLElement>();

export function kvDeskLabels(list: readonly { id: string; name: string; spot: SpotDef; mine: boolean }[], zoom: number, toScreen: (x: number, y: number) => { sx: number; sy: number }): void {
  if (!root) {
    root = h('div', { class: 'kv-desk-labels', attrs: { 'aria-hidden': 'true' } });
    (document.querySelector('.ui-root') ?? document.body).append(root);
  }
  const seen = new Set<string>();
  if (zoom >= MIN_ZOOM) {
    for (const d of list) {
      const p = toScreen(d.spot.x, d.spot.y);
      if (p.sx < -80 || p.sy < -40 || p.sx > window.innerWidth + 80 || p.sy > window.innerHeight + 40) continue;
      seen.add(d.id);
      let el = els.get(d.id);
      if (!el) {
        el = h('span', { class: 'kv-desk-label' });
        els.set(d.id, el);
        root.append(el);
      }
      const text = d.mine ? tr('minha mesa') : tr('mesa de {0}', [d.name]);
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('is-mine', d.mine);
      el.style.transform = `translate(${Math.round(p.sx)}px, ${Math.round(p.sy + 4 * zoom)}px) translate(-50%, 0)`;
    }
  }
  for (const [id, el] of els) {
    if (seen.has(id)) continue;
    el.remove();
    els.delete(id);
  }
}
