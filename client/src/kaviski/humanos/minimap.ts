// Fork Kaviski (KAVISKI-HUMANOS.md): mini-mapa no canto — o prédio em miniatura (núcleo, corredor, salas acesas e
// apagadas), os agentes (pontinhos), as pessoas (na cor do crachá), eu (piscando) e o retângulo do que a câmera mostra.
// Clicar anda até lá (com o boneco no escritório) ou leva a câmera. Tecla N recolhe/abre (lembrado no navegador).
// Sala com reunião marcada (agenda) ganha um ponto vermelho.
import type { AreaKind } from '../../world/layout/types';
import { TILE } from '../../world/constants';
import { tr } from '../../../../shared/i18n';
import { h, iconButton } from '../../ui/dom';
import { modalOpen } from '../../world/input';
import { kvRoomMeeting } from './agenda';
import { kvAreaLabel } from './bar';
import { kvWalkTile } from './walk';
import { kvPeople } from './world';
import type { OfficeStore } from '../../net/store';

const KEY = 'habblaud.kv.minimapa';
const MAX_W = 260;
const MAX_H = 130;
const CORE_COLOR: Partial<Record<AreaKind, string>> = { reception: '#c9a24a', cafe: '#a0714f', restroom: '#5b8fb0', lounge: '#7d5fa8' };

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export class KvMinimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly toggleBtn: HTMLButtonElement;
  private open = true;
  private scale = 2;
  private origin = { x: 0, y: 0 };

  constructor(
    private readonly store: OfficeStore,
    onHelp: () => void,
  ) {
    try {
      this.open = localStorage.getItem(KEY) !== '0';
    } catch {
      // sem localStorage
    }
    this.canvas = h('canvas', { class: 'kv-map__canvas', attrs: { role: 'img', 'aria-label': tr('Mini-mapa do escritório') } });
    this.toggleBtn = h('button', { class: 'kv-map__title', type: 'button', on: { click: () => this.setOpen(!this.open) } });
    const help = iconButton('<span aria-hidden="true">?</span>', tr('Atalhos das pessoas no escritório'), onHelp, 'ui-icon-btn--sm kv-map__help');
    this.el = h('div', { class: 'kv-map' }, h('div', { class: 'kv-map__head' }, this.toggleBtn, help), this.canvas);
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
    this.canvas.addEventListener('click', (e) => this.click(e));
    this.canvas.addEventListener('mousemove', (e) => this.hover(e));
    document.addEventListener('keydown', (e) => {
      if ((e.key !== 'n' && e.key !== 'N') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (typing(e.target) || modalOpen(e.target as HTMLElement | null)) return;
      e.preventDefault();
      this.setOpen(!this.open);
    });
    this.setOpen(this.open);
    setInterval(() => this.draw(), 200);
  }

  setOpen(on: boolean): void {
    this.open = on;
    this.el.classList.toggle('is-closed', !on);
    this.canvas.hidden = !on;
    this.toggleBtn.textContent = on ? tr('Mapa ▾') : tr('Mapa ▸');
    this.toggleBtn.title = on ? tr('Recolher o mini-mapa (N)') : tr('Abrir o mini-mapa (N)');
    this.toggleBtn.setAttribute('aria-expanded', String(on));
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // sem localStorage
    }
    if (on) this.draw();
  }

  private tileAt(e: MouseEvent): { tx: number; ty: number } {
    const r = this.canvas.getBoundingClientRect();
    return { tx: Math.floor((e.clientX - r.left) / this.scale + this.origin.x), ty: Math.floor((e.clientY - r.top) / this.scale + this.origin.y) };
  }

  private click(e: MouseEvent): void {
    const { tx, ty } = this.tileAt(e);
    kvWalkTile(tx, ty);
  }

  private hover(e: MouseEvent): void {
    const sim = kvPeople.sim?.();
    if (!sim) return;
    const { tx, ty } = this.tileAt(e);
    const inRect = (r: { x: number; y: number; w: number; h: number }) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
    let label = '';
    for (const room of sim.rooms.values()) {
      if (!room.present || room.ghost || !inRect(room.layout.rect)) continue;
      const meeting = kvRoomMeeting(room.info.id);
      label = meeting ? `${room.info.name} · ${meeting}` : room.info.name;
    }
    if (!label) {
      const core = sim.building.core.find((a) => inRect(a.rect));
      label = core ? kvAreaLabel(`a:${core.id}`, this.store) : inRect(sim.building.corridor.rect) ? kvAreaLabel('c', this.store) : '';
    }
    const hint = kvPeople.inside ? tr('clique para andar até lá') : tr('clique para levar a câmera');
    this.canvas.title = label ? `${label} — ${hint}` : hint;
  }

  /** Fica no canto de baixo à direita da área livre (fora dos painéis: as margens da câmera). */
  private place(): void {
    const ins = kvPeople.camera?.insets;
    const right = `${Math.round((ins?.right ?? 0) + 12)}px`;
    const bottom = `${Math.round((ins?.bottom ?? 0) + 12)}px`;
    if (this.el.style.right !== right) this.el.style.right = right;
    if (this.el.style.bottom !== bottom) this.el.style.bottom = bottom;
  }

  private draw(): void {
    this.place();
    if (!this.open || document.hidden) return;
    const sim = kvPeople.sim?.();
    const ctx = this.canvas.getContext('2d');
    if (!sim || !ctx) return;
    const b = sim.building.rect;
    const scale = Math.max(0.5, Math.min(MAX_W / b.w, MAX_H / b.h, 4));
    this.scale = scale;
    this.origin = { x: b.x, y: b.y };
    const w = Math.ceil(b.w * scale);
    const hh = Math.ceil(b.h * scale);
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hh * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(hh * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${hh}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    const rect = (r: { x: number; y: number; w: number; h: number }, fill: string) => {
      ctx.fillStyle = fill;
      ctx.fillRect((r.x - b.x) * scale, (r.y - b.y) * scale, r.w * scale, r.h * scale);
    };
    rect(sim.building.corridor.rect, '#3a3f58');
    for (const a of sim.building.core) rect(a.rect, CORE_COLOR[a.kind] ?? '#555a72');
    const now = Date.now();
    for (const room of sim.rooms.values()) {
      if (!room.present || room.ghost) continue;
      ctx.globalAlpha = room.lightOn ? 0.95 : 0.4;
      rect(room.layout.rect, room.theme.carpet);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = room.theme.accent;
      ctx.lineWidth = 1;
      const r = room.layout.rect;
      ctx.strokeRect((r.x - b.x) * scale + 0.5, (r.y - b.y) * scale + 0.5, r.w * scale - 1, r.h * scale - 1);
      if (kvRoomMeeting(room.info.id, now)) {
        ctx.fillStyle = '#ff5a5a';
        ctx.beginPath();
        ctx.arc((r.x + r.w - b.x) * scale - 4, (r.y - b.y) * scale + 4, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const dot = (x: number, y: number, r: number, fill: string, stroke?: string) => {
      ctx.beginPath();
      ctx.arc((x / TILE - b.x) * scale, (y / TILE - b.y) * scale, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    };
    // agentes
    for (const ch of sim.chars.values()) if (!ch.gone && ch.alpha > 0.3) dot(ch.x, ch.y, 1.3, 'rgba(232,230,223,0.75)');
    // pessoas (cor do crachá)
    const state = kvPeople.client?.state;
    const colors = new Map(state?.people.map((p) => [p.id, p.look.color ?? '#7cc8ff']) ?? []);
    for (const p of kvPeople.around?.() ?? []) dot(p.x, p.y, 2.4, colors.get(p.id) ?? '#7cc8ff', '#14161f');
    // eu
    const me = kvPeople.inside ? kvPeople.locate?.(null) : null;
    if (me) {
      const mine = state?.people.find((p) => p.id === state.me)?.look.color ?? '#f4c95d';
      dot(me.x, me.y, now % 1000 < 600 ? 3.4 : 2.6, mine, '#ffffff');
    }
    // o que a câmera mostra
    const cam = kvPeople.camera;
    if (cam) {
      const vw = cam.viewW / cam.zoom / TILE;
      const vh = cam.viewH / cam.zoom / TILE;
      ctx.strokeStyle = 'rgba(244,201,93,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect((cam.x / TILE - vw / 2 - b.x) * scale + 0.5, (cam.y / TILE - vh / 2 - b.y) * scale + 0.5, vw * scale, vh * scale);
    }
  }
}
