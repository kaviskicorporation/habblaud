// Fork Kaviski (KAVISKI-HUMANOS.md): passar o mouse sobre uma sala (ou área comum) mostra quem está nela — pessoas e
// agentes — e a reunião marcada (agenda). Só ouve o mouse no canvas do escritório; nenhum gancho no original.
import type { OfficeStore } from '../../net/store';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { TILE } from '../../world/constants';
import { kvRoomMeeting } from './agenda';
import { kvAreaLabel } from './bar';
import { kvPeople } from './world';

const HOVER_MS = 450;

export function kvStartRoomHover(store: OfficeStore): void {
  const canvas = document.getElementById('world');
  if (!canvas) return;
  const tip = h('div', { class: 'kv-roomtip', hidden: true, attrs: { role: 'tooltip' } });
  document.body.append(tip);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let down = false;
  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    tip.hidden = true;
  };
  canvas.addEventListener('pointerdown', () => ((down = true), hide()));
  window.addEventListener('pointerup', () => (down = false));
  canvas.addEventListener('pointerleave', hide);
  canvas.addEventListener('wheel', hide, { passive: true });
  canvas.addEventListener('pointermove', (e) => {
    if (down || e.pointerType === 'touch') return hide();
    tip.hidden = true;
    if (timer) clearTimeout(timer);
    const x = e.clientX;
    const y = e.clientY;
    timer = setTimeout(() => show(x, y), HOVER_MS);
  });

  function show(cx: number, cy: number): void {
    const sim = kvPeople.sim?.();
    const cam = kvPeople.camera;
    if (!sim || !cam) return;
    const r = canvas!.getBoundingClientRect();
    const w = cam.screenToWorld(cx - r.left, cy - r.top);
    const tx = Math.floor(w.x / TILE);
    const ty = Math.floor(w.y / TILE);
    const inRect = (q: { x: number; y: number; w: number; h: number }) => tx >= q.x && tx < q.x + q.w && ty >= q.y && ty < q.y + q.h;
    let area: string | null = null;
    let name = '';
    let rect: { x: number; y: number; w: number; h: number } | null = null;
    for (const room of sim.rooms.values()) {
      if (!room.present || room.ghost || !inRect(room.layout.rect)) continue;
      area = `r:${room.info.id}`;
      name = room.info.name;
      rect = room.layout.rect;
    }
    if (!area) {
      const core = sim.building.core.find((a) => inRect(a.rect));
      if (core) {
        area = `a:${core.id}`;
        name = kvAreaLabel(area, store);
        rect = core.rect;
      }
    }
    if (!area || !rect) return;
    const box = rect;
    const inside = (x: number, y: number) => {
      const a = Math.floor(x / TILE);
      const b = Math.floor(y / TILE);
      return a >= box.x && a < box.x + box.w && b >= box.y && b < box.y + box.h;
    };
    // em cima de um personagem quem fala é a dica do próprio Habblaud
    for (const ch of sim.people()) if (!ch.gone && Math.hypot(ch.x - w.x, ch.y - TILE / 2 - w.y) < TILE) return;
    const state = kvPeople.client?.state;
    const names = new Map(state?.people.map((p) => [p.id, p.name]) ?? []);
    const people = (kvPeople.around?.() ?? []).filter((p) => inside(p.x, p.y)).map((p) => names.get(p.id) ?? '?');
    const me = kvPeople.inside ? kvPeople.locate?.(null) : null;
    if (me && inside(me.x, me.y)) people.unshift(tr('você'));
    let agents = 0;
    for (const ch of sim.chars.values()) if (!ch.gone && !ch.leaving && inside(ch.x, ch.y)) agents++;
    const meeting = area.startsWith('r:') ? kvRoomMeeting(area.slice(2)) : null;
    const lines = [
      people.length ? tr('Pessoas: {0}', [people.join(', ')]) : tr('Nenhuma pessoa aqui'),
      agents ? (agents === 1 ? tr('1 agente') : tr('{0} agentes', [agents])) : '',
      meeting ? `📅 ${meeting}` : '',
    ].filter(Boolean);
    tip.replaceChildren(h('strong', { text: name }), ...lines.map((l) => h('span', { text: l })));
    tip.style.left = `${Math.min(cx + 14, window.innerWidth - 240)}px`;
    tip.style.top = `${Math.min(cy + 16, window.innerHeight - 90)}px`;
    tip.hidden = false;
  }
}
