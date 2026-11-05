// Fork Kaviski (KAVISKI.md): desenho dos andares.
// - placa de cada andar (letreiro na faixa de grama acima do andar, em espaço de tela: legível na visão geral);
// - salas `dim` (projeto parado): enquanto estão vazias e apagadas, um véu cinza com listras ("arquivo");
// - elevadores dos outros andares ligados às portas animadas; o hall de cada andar com o nome do andar na placa.
import type { KvRoomInfo } from '../../../shared/kaviski';
import { tr } from '../../../shared/i18n';
import { COL_W, CORRIDOR_H, CORRIDOR_Y, TILE } from '../world/constants';
import type { AreaVis, WallVis } from '../world/render/scene';
import type { Sim } from '../world/sim/sim';
import { kvFloorsOf, kvFloorsOn, kvFloorY, kvHeightOf } from './floors';
import { kvFloorTitle } from './floors-sim';
import { kvSplitAreaId } from './floors-world';

const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

const baseKeys = new WeakMap<object, string>();

/** A camada base do renderer precisa ser refeita (andares ligados ou número de andares mudou). */
export function kvBaseStale(renderer: object, b: { cols: number; kvFloors?: number }): boolean {
  const key = `${kvFloorsOn() ? 1 : 0}|${kvFloorsOf(b)}`;
  const old = baseKeys.get(renderer);
  baseKeys.set(renderer, key);
  return old !== undefined && old !== key;
}

/**
 * Item de parede de cada elevador da simulação, na mesma ordem de `sim.elevators` (o renderer anima a porta i com o
 * elevador i). null sem andares (fica o original: os dois da recepção).
 */
export function kvElevatorVis(areas: ReadonlyMap<string, AreaVis>, sim: Pick<Sim, 'elevators' | 'spots'>): WallVis[] | null {
  if (!kvFloorsOn()) return null;
  const out: WallVis[] = [];
  for (const e of sim.elevators) {
    const spot = sim.spots.get(e.spotId);
    const vis = spot ? areas.get(spot.areaId) : undefined;
    if (!spot || !vis) {
      out.push(undefined as unknown as WallVis);
      continue;
    }
    const i = vis.layout.spots.filter((s) => s.kind === 'elevator').findIndex((s) => s.id === spot.id);
    out.push(vis.wallItems.filter((w) => w.kind === 'elevator')[i] ?? (undefined as unknown as WallVis));
  }
  return out;
}

/** Texto da placa do hall de um andar de cima ("3º andar"); null nas outras áreas. */
export function kvHallText(id: string, sim: object): string | null {
  const { base, floor } = kvSplitAreaId(id);
  if (base !== 'core:recepcao' || !floor) return null;
  const t = kvFloorTitle(sim, floor);
  return t.ordinal;
}

/** Nome da pílula das áreas do núcleo dos outros andares (null = não é cópia). */
export function kvCoreName(id: string, names: Record<string, string>): string | null {
  const { base, floor } = kvSplitAreaId(id);
  if (!floor) return null;
  if (base === 'core:recepcao') return tr('Hall');
  return names[base] ?? null;
}

/** Margem a leste (tiles) enquadrada junto do prédio: é onde ficam as placas dos andares. */
const SIGN_MARGIN = 18;

/** Retângulo (px de mundo) que a câmera enquadra: o prédio e, com andares, as placas a leste. */
export function kvBuildingPx(b: { cols: number; kvFloors?: number }): { x: number; y: number; w: number; h: number } | null {
  if (!kvFloorsOn()) return null;
  return { x: 0, y: 0, w: (b.cols * COL_W + SIGN_MARGIN) * TILE, h: kvHeightOf(b) * TILE };
}

type Map2 = (v: number) => number;

/**
 * Placas dos andares (letreiros) a leste do prédio, na altura do corredor de cada andar (a faixa entre andares é das
 * pílulas das salas). `place` registra o retângulo para os balões desviarem.
 */
export function kvDrawFloorSigns(ctx: CanvasRenderingContext2D, sim: Sim, zoom: number, sx: Map2, sy: Map2, vw: number, vh: number, place: (x: number, y: number, w: number, h: number) => void): void {
  if (!kvFloorsOn()) return;
  const b = sim.building;
  const floors = kvFloorsOf(b);
  const left = sx((b.cols * COL_W + 1.5) * TILE);
  const maxW = Math.max(160, vw - left - 12);
  const h = Math.round(Math.max(24, Math.min(40, 2.7 * TILE * zoom)));
  const fs = Math.max(10, Math.round(h * 0.5));
  const chipFs = Math.max(9, Math.round(h * 0.4));
  ctx.save();
  ctx.textBaseline = 'middle';
  for (let f = 0; f < floors; f++) {
    const cy = sy((kvFloorY(f) + CORRIDOR_Y + CORRIDOR_H / 2) * TILE);
    if (cy < -h || cy > vh + h) continue;
    const { ordinal, label } = kvFloorTitle(sim, f);
    const chipFont = `800 ${chipFs}px ${UI_FONT}`;
    const font = `700 ${fs}px ${UI_FONT}`;
    ctx.font = chipFont;
    const chipText = ordinal.toUpperCase();
    const chipW = Math.round(ctx.measureText(chipText).width + chipFs * 1.4);
    ctx.font = font;
    let text = label;
    const pad = Math.round(h * 0.45);
    const room = maxW - chipW - pad * 3;
    if (text && ctx.measureText(text).width > room) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1);
      text = `${text.trimEnd()}…`;
    }
    const tw = text ? Math.round(ctx.measureText(text).width) : 0;
    const w = chipW + (text ? pad * 2 + tw : 0) + Math.round(h * 0.2);
    const x = Math.round(left);
    const y = Math.round(cy - h / 2);
    if (x > vw || x + w < 0) continue;
    // sombra + placa escura com fio dourado (letreiro de prédio)
    ctx.fillStyle = 'rgba(10,14,24,0.35)';
    ctx.beginPath();
    ctx.roundRect(x, y + 2, w, h, h * 0.22);
    ctx.fill();
    ctx.fillStyle = '#1d2536';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h * 0.22);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#c9a24a';
    ctx.stroke();
    // número do andar num selo dourado
    const ci = Math.round(h * 0.14);
    ctx.fillStyle = '#e2b755';
    ctx.beginPath();
    ctx.roundRect(x + ci, y + ci, chipW - ci, h - ci * 2, (h - ci * 2) * 0.25);
    ctx.fill();
    ctx.font = chipFont;
    ctx.fillStyle = '#1d2536';
    ctx.textAlign = 'center';
    ctx.fillText(chipText, x + ci + (chipW - ci) / 2, y + h / 2 + 0.5);
    if (text) {
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f4efe2';
      ctx.fillText(text, x + chipW + pad, y + h / 2 + 0.5);
    }
    place(x, y, w, h);
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

let stripe: CanvasPattern | null | undefined;

function stripes(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (stripe !== undefined) return stripe;
  try {
    const c = document.createElement('canvas');
    c.width = 12;
    c.height = 12;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(235,238,245,0.16)';
    g.lineWidth = 3;
    g.beginPath();
    for (const o of [-12, 0, 12]) {
      g.moveTo(o, 12);
      g.lineTo(o + 12, 0);
    }
    g.stroke();
    stripe = ctx.createPattern(c, 'repeat');
  } catch {
    stripe = null;
  }
  return stripe;
}

/** Sala `dim` (projeto parado): enquanto vazia e apagada, véu cinza com listras sobre o piso. */
export function kvDrawDimRooms(ctx: CanvasRenderingContext2D, sim: Sim, now: number, sx: Map2, sy: Map2, vw: number, vh: number): void {
  let any = false;
  for (const room of sim.rooms.values()) {
    if (!(room.info as KvRoomInfo).kaviski?.dim || !room.present || room.ghost) continue;
    const light = room.light(now);
    if (light > 0.6) continue;
    const r = room.layout.rect;
    let inside = false;
    for (const c of sim.chars.values()) {
      if (!c.gone && !c.inside && c.tx >= r.x && c.ty >= r.y && c.tx < r.x + r.w && c.ty < r.y + r.h) {
        inside = true;
        break;
      }
    }
    if (inside) continue;
    const x = sx(r.x * TILE + 4);
    const y = sy((r.y + 2) * TILE);
    const w = sx((r.x + r.w) * TILE - 4) - x;
    const h = sy((r.y + r.h - 1) * TILE) - y;
    if (x > vw || y > vh || x + w < 0 || y + h < 0) continue;
    if (!any) {
      ctx.save();
      any = true;
    }
    const a = 1 - light / 0.6;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(96,102,116,0.42)';
    ctx.fillRect(x, y, w, h);
    const p = stripes(ctx);
    if (p) {
      ctx.fillStyle = p;
      ctx.fillRect(x, y, w, h);
    }
    // etiqueta "arquivo" no canto, quando dá para ler
    if (h > 40) {
      const fs = Math.max(9, Math.min(13, Math.round(h * 0.07)));
      ctx.font = `700 ${fs}px ${UI_FONT}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(240,242,248,0.75)';
      ctx.fillText(tr('arquivo'), x + w / 2, y + h - fs);
    }
  }
  if (any) {
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.restore();
  }
}
