// Fork Kaviski (KAVISKI.md): desenho dos andares.
// - Diretório do prédio: uma placa por andar do lado ESQUERDO, junto da coluna dos elevadores (como o painel do
//   lobby): número grande, nome do andar e um resumo vivo ("3 trabalhando · 1 precisa de você", em âmbar quando alguém
//   precisa de você). Clicar na placa (ou no cabeçalho do andar na lista lateral) enquadra o andar.
// - Salas `dim` (projeto parado): enquanto vazias e apagadas, um véu cinza com listras ("arquivo").
// - Elevadores dos andares ligados às portas animadas; o hall de cada andar com o número do andar na placa.
import type { KvRoomInfo } from '../../../shared/kaviski';
import { tr } from '../../../shared/i18n';
import type { Camera } from '../world/camera';
import { BUILDING_H, COL_W, ROOM_H, TILE } from '../world/constants';
import type { AreaVis, WallVis } from '../world/render/scene';
import type { Sim } from '../world/sim/sim';
import { kvFloorShort, kvFloorsOf, kvFloorsOn, kvFloorY, kvHeightOf, kvSlotFloor, ROOF_H } from './floors';
import { kvFloorTitle } from './floors-sim';
import { HALL_ID, kvSplitAreaId } from './floors-world';

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

/** Texto da placa do hall de um andar ("3º andar"); null nas outras áreas. */
export function kvHallText(id: string, sim: object): string | null {
  const { base, floor } = kvSplitAreaId(id);
  if (base !== HALL_ID || !floor) return null;
  return kvFloorTitle(sim, floor).ordinal;
}

/** Largura (tiles) reservada a oeste do prédio para o diretório. */
const DIR_MARGIN = 26;

/** Retângulo (px de mundo) que a câmera enquadra: telhado, prédio e o diretório a oeste. */
export function kvBuildingPx(b: { cols: number; kvFloors?: number }): { x: number; y: number; w: number; h: number } | null {
  if (!kvFloorsOn()) return null;
  return { x: -DIR_MARGIN * TILE, y: -ROOF_H * TILE, w: (b.cols * COL_W + DIR_MARGIN + 1) * TILE, h: (kvHeightOf(b) + ROOF_H) * TILE };
}

type Map2 = (v: number) => number;

/** Resumo vivo de cada andar (pelo andar da sala de cada agente). */
export interface KvFloorStats {
  working: number;
  waiting: number;
  idle: number;
  rooms: number;
  busyRooms: number;
}

export function kvFloorStats(sim: Sim): KvFloorStats[] {
  const n = kvFloorsOf(sim.building);
  const out: KvFloorStats[] = Array.from({ length: n }, () => ({ working: 0, waiting: 0, idle: 0, rooms: 0, busyRooms: 0 }));
  const floorOfRoom = new Map<string, number>();
  for (const r of sim.rooms.values()) {
    if (!r.present || r.ghost) continue;
    const f = Math.min(n - 1, kvSlotFloor(r.slot));
    floorOfRoom.set(r.id, f);
    out[f].rooms++;
  }
  const busy = new Set<string>();
  for (const c of sim.chars.values()) {
    if (c.gone || c.leaving) continue;
    const f = floorOfRoom.get(c.roomId);
    if (f === undefined) continue;
    busy.add(c.roomId);
    const st = c.info.status;
    if (st === 'waiting') out[f].waiting++;
    else if (st === 'working' || st === 'shell') out[f].working++;
    else out[f].idle++;
  }
  for (const id of busy) out[floorOfRoom.get(id)!].busyRooms++;
  return out;
}

/** Placas desenhadas no último frame (px CSS do canvas), para o clique. */
let hitRects: { f: number; x: number; y: number; w: number; h: number }[] = [];

/** Placas do diretório (lado esquerdo). `place` registra o retângulo para os balões desviarem. */
export function kvDrawDirectory(ctx: CanvasRenderingContext2D, sim: Sim, zoom: number, sx: Map2, sy: Map2, vw: number, vh: number, place: (x: number, y: number, w: number, h: number) => void): void {
  hitRects = [];
  if (!kvFloorsOn()) return;
  const n = kvFloorsOf(sim.building);
  const stats = kvFloorStats(sim);
  const right = Math.round(sx(-1.4 * TILE));
  const h = Math.round(Math.max(40, Math.min(70, ROOM_H * TILE * zoom * 0.62)));
  const numW = Math.round(h * 0.9);
  const big = Math.round(h * 0.56);
  const fsLabel = Math.max(11, Math.min(17, Math.round(h * 0.3)));
  const fsSum = Math.max(10, Math.min(14, Math.round(h * 0.24)));
  const maxText = Math.max(110, Math.min(260, right - 12 - numW - 20));
  ctx.save();
  ctx.textBaseline = 'middle';
  for (let f = 0; f < n; f++) {
    const cy = sy((kvFloorY(f) + BUILDING_H / 2) * TILE);
    if (cy < -h || cy > vh + h) continue;
    const st = stats[f];
    const { label } = kvFloorTitle(sim, f);
    const title = label || kvFloorTitle(sim, f).ordinal;
    // resumo: partes com cor
    const parts: { text: string; color: string }[] = [];
    if (st.waiting) parts.push({ text: st.waiting === 1 ? tr('1 precisa de você') : tr('{0} precisam de você', [st.waiting]), color: '#ffc14d' });
    if (st.working) parts.push({ text: tr('{0} trabalhando', [st.working]), color: '#7ee0a1' });
    if (!st.waiting && !st.working && st.idle) parts.push({ text: tr('{0} à toa', [st.idle]), color: '#c3c9d6' });
    if (!parts.length) parts.push({ text: st.rooms === 1 ? tr('1 sala, ninguém') : tr('{0} salas, ninguém', [st.rooms]), color: '#8d95a6' });
    const fontLabel = `700 ${fsLabel}px ${UI_FONT}`;
    const fontSum = `600 ${fsSum}px ${UI_FONT}`;
    ctx.font = fontLabel;
    const tLabel = fitText(ctx, title, maxText);
    let tw = ctx.measureText(tLabel).width;
    ctx.font = fontSum;
    const sep = ' · ';
    let sw = 0;
    for (let i = 0; i < parts.length; i++) sw += ctx.measureText(parts[i].text + (i < parts.length - 1 ? sep : '')).width;
    sw = Math.min(sw, maxText);
    tw = Math.max(tw, sw);
    const w = Math.round(numW + 14 + tw + 12);
    const x = right - w;
    const y = Math.round(cy - h / 2);
    if (x > vw || x + w < 0) continue;
    const alert = st.waiting > 0;
    // sombra + placa (latão escovado escuro, como o painel do lobby)
    ctx.fillStyle = 'rgba(8,12,20,0.4)';
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 3, w, h, 7);
    ctx.fill();
    ctx.fillStyle = '#18202f';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 7);
    ctx.fill();
    ctx.lineWidth = alert ? 2 : 1.25;
    ctx.strokeStyle = alert ? '#ffb02e' : 'rgba(214,180,98,0.85)';
    ctx.stroke();
    // número do andar
    ctx.fillStyle = alert ? '#ffb02e' : '#d9b25c';
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, numW - 4, h - 8, 5);
    ctx.fill();
    ctx.fillStyle = '#18202f';
    ctx.font = `800 ${big}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(kvFloorShort(f), x + 2 + numW / 2, y + h / 2 + 1);
    // nome do andar e resumo
    ctx.textAlign = 'left';
    const tx = x + numW + 10;
    ctx.font = fontLabel;
    ctx.fillStyle = '#f4efe2';
    ctx.fillText(tLabel, tx, y + h * 0.36);
    ctx.font = fontSum;
    let px = tx;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const room = tx + maxText - px;
      if (room <= 8) break;
      const t = fitText(ctx, p.text, room);
      ctx.fillStyle = p.color;
      ctx.fillText(t, px, y + h * 0.7);
      px += ctx.measureText(t).width;
      if (i < parts.length - 1) {
        ctx.fillStyle = '#6f7889';
        ctx.fillText(sep, px, y + h * 0.7);
        px += ctx.measureText(sep).width;
      }
    }
    place(x, y, w, h);
    hitRects.push({ f, x, y, w, h });
  }
  ctx.restore();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Evento (window) que a lista lateral dispara para enquadrar um andar. */
export const KV_FLOOR_EVENT = 'kv:andar';

/** Enquadra o andar f (prédio inteiro na largura, o andar na altura). */
export function kvFrameFloor(camera: Camera, sim: Sim, f: number): void {
  if (!kvFloorsOn()) return;
  const b = sim.building;
  const r = { x: -1.5 * TILE, y: (kvFloorY(f) - 1.5) * TILE, w: (b.cols * COL_W + 3) * TILE, h: (BUILDING_H + 2.5) * TILE };
  const z = Math.max(camera.minZoom, Math.min(4, camera.fitZoom(r, 20)));
  const c = camera.centerFor(r.x + r.w / 2, r.y + r.h / 2, z);
  camera.follow = null;
  camera.animateTo(c.x, c.y, z, Date.now(), 450);
}

/** Liga o clique nas placas do diretório e o evento da lista lateral. */
export function kvStartFloorDirectory(canvas: HTMLCanvasElement, camera: Camera, sim: () => Sim): void {
  const hit = (e: PointerEvent | MouseEvent) => {
    if (!hitRects.length) return null;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return hitRects.find((p) => x >= p.x && y >= p.y && x <= p.x + p.w && y <= p.y + p.h) ?? null;
  };
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      const p = hit(e);
      if (!p) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      kvFrameFloor(camera, sim(), p.f);
    },
    { capture: true },
  );
  canvas.addEventListener('pointermove', (e) => {
    if (hit(e)) canvas.style.cursor = 'pointer';
  });
  window.addEventListener(KV_FLOOR_EVENT, (e) => {
    const f = (e as CustomEvent<number>).detail;
    if (typeof f === 'number') kvFrameFloor(camera, sim(), f);
  });
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
    ctx.globalAlpha = 1 - light / 0.6;
    ctx.fillStyle = 'rgba(96,102,116,0.42)';
    ctx.fillRect(x, y, w, h);
    const p = stripes(ctx);
    if (p) {
      ctx.fillStyle = p;
      ctx.fillRect(x, y, w, h);
    }
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
