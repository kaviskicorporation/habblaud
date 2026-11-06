// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): o motor do prédio — com a planta ligada (KvPlan.on), o prédio do
// mundo É a planta: liga os ganchos (plan/hooks.ts) no Sim, no render e na câmera, guarda o rascunho do editor
// (`kvPlanWorld.preview`), reacomoda quem estava sentado quando o prédio muda e expõe `kvPlanWorld` (planta em uso,
// itens interativos, item de um tile, avisos de mudança). Visita a outro prédio (Habblaud World) nunca usa a planta.
// Nada daqui entra no snapshot do Office que o Habblaud World recebe.
import { roomTheme } from '../../art';
import type { RoomTheme } from '../../art/api';
import { hash32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import { kvNormPlan, kvPlanRoomRef, type KvPlan, type KvPlanItem } from '../../../../shared/kaviski-plan';
import type { RoomInfo } from '../../../../shared/types';
import { TILE } from '../../world/constants';
import type { ExteriorLayout, SlotShell } from '../../world/layout/exterior';
import type { RoomInput } from '../../world/layout/room';
import type { AreaLayout, TileRect } from '../../world/layout/types';
import type { Sim } from '../../world/sim/sim';
import { kvLayoutRoom, kvLayoutRoomOriginal, kvOwnMark } from '../humanos/rooms-layout';
import { kvPlanWorld } from './api';
import { kvBridgeFloors, kvBuildFromStatics, kvOutsideSides, kvPlanStatics, kvStripItem, kvTranslateArea, type KvBuilding, type KvStatics } from './engine-build';
import { kvPlanExterior } from './engine-ext';
import { kvFixedSlot, kvIndexPlan, kvInRect, kvSlotPlace, kvStripCount, kvStripRect, type KvPlanIndex } from './engine-geom';
import { kvLayoutPlanRoom } from './engine-room';
import { kvPlanHooks, type KvPlanEngineHooks } from './hooks';
import { kvThemeColor, kvThemeInfo } from './themes-info';
import { kvComputeActionSpots } from './themes-spots';
import { kvPlanClassic, kvPlanExample } from './examples';
import './furnish-projeto';
import './furnish-propria';
import './furnish-tema';
import { KV_THEME_KEYS, type KvThemeKey } from '../../../../shared/kaviski-plan';

const VIGNETTE_ALPHA = 0.5;
const DEV_KEY = 'kv-plan-dev';

interface PlanState {
  /** A planta gravada (ligada) ou null. */
  saved: KvPlan | null;
  /** Rascunho do editor (undefined = sem rascunho; null = rascunho "desligado"). */
  draft: KvPlan | null | undefined;
  /** Sobe a cada troca: cada Sim reaplica uma vez. */
  gen: number;
  ix: KvPlanIndex | null;
  plan: KvPlan | null;
}
const st: PlanState = { saved: null, draft: undefined, gen: 1, ix: null, plan: null };
/** Geração aplicada em cada Sim e os Sims que já usaram uma planta (ao desligar, voltam ao original). */
const applied = new WeakMap<Sim, number>();
const planned = new WeakSet<Sim>();
/** Tags de cada layout de sala (furnishers) e cache das áreas fixas. */
const roomTags = new WeakMap<AreaLayout, Map<string, string[]>>();
let staticsCache: KvStatics | null = null;
const stripOf = new WeakMap<Sim, { plan: KvPlan; n: number }>();
let extCache: { key: number; ext: ExteriorLayout } | null = null;
const lastSims = new Set<WeakRef<Sim>>();

function current(): KvPlan | null {
  const p = st.draft !== undefined ? st.draft : st.saved;
  return p && p.on ? p : null;
}

function refresh(): void {
  const p = current();
  if (p === st.plan) return;
  st.plan = p;
  st.ix = p ? kvIndexPlan(p) : null;
  staticsCache = null;
  st.gen++;
  kvPlanWorld.plan = p;
  // os Sims vivos reaplicam já (o render também confere a cada quadro)
  for (const ref of [...lastSims]) {
    const sim = ref.deref();
    if (!sim) lastSims.delete(ref);
    else applyTo(sim);
  }
}

const usable = (sim: Sim | undefined | null): sim is Sim => !!sim && !sim.visit;

function themeFor(seed: number, palette?: number): RoomTheme {
  try {
    return roomTheme(palette ?? seed);
  } catch {
    return { carpet: '#7a8fb0', carpet2: '#9aaccc', wall: { base: '#e8e4dc', trim: '#a39a8a', pattern: 'plain' }, accent: '#4a6fa5', deskVariant: 'wood', chairVariant: 'black' };
  }
}

function staticsFor(sim: Sim): KvStatics | null {
  const plan = st.plan;
  const ix = st.ix;
  if (!plan || !ix) return null;
  const slots: number[] = [];
  for (const r of sim.rooms.values()) if (r.present) slots.push(r.slot);
  let n = kvStripCount(ix, slots);
  // a faixa só encolhe quando ninguém está no pedaço que vai sumir (como o prédio original); senão espera o próximo relayout
  const was = stripOf.get(sim);
  if (was && was.plan === plan && n < was.n) {
    const gone = kvStripRect(plan.auto, was.n);
    const keep = kvStripRect(plan.auto, n);
    const inTail = (x: number, y: number) => !!gone && kvInRect(gone, x, y) && !(keep && kvInRect(keep, x, y));
    for (const ch of sim.people()) if (!ch.gone && inTail(Math.floor(ch.x / TILE), Math.floor(ch.y / TILE))) n = was.n;
  }
  stripOf.set(sim, { plan, n });
  if (!staticsCache || staticsCache.plan !== plan || staticsCache.stripN !== n) staticsCache = kvPlanStatics(plan, n, themeFor, ix);
  return staticsCache;
}

/** Reaplica a planta num Sim: novas vagas, layouts, prédio; quem estava sentado vai para o lugar equivalente. */
function applyTo(sim: Sim): void {
  if (!usable(sim)) return;
  if (applied.get(sim) === st.gen) return;
  applied.set(sim, st.gen);
  const ix = st.ix;
  // nunca usou planta e continua sem: nada a fazer (o prédio original fica como está)
  if (!ix && !planned.has(sim)) return;
  if (ix) planned.add(sim);
  else planned.delete(sim);
  // endereços antigos de mudanças: somem já (o prédio vai ser outro)
  for (const [id, r] of sim.rooms) if (r.ghost) sim.rooms.delete(id);
  const rooms = [...sim.rooms.values()].sort((a, b) => a.slot - b.slot);
  let next = 0;
  for (const r of rooms) {
    const fixed = ix ? kvFixedSlot(ix, r.info.id) : undefined;
    r.slot = fixed ?? next++;
  }
  // quem estava sentado: lembra onde, para reacomodar depois
  const seated = new Map<string, { kind: string; x: number; y: number }>();
  for (const ch of sim.people()) {
    const s = ch.atSpot ? sim.spots.get(ch.atSpot) : undefined;
    if (s) seated.set(ch.id, { kind: s.kind, x: s.x, y: s.y });
  }
  if (ix) staticsFor(sim); // as salas olham a planta já montada (lados que dão para a grama)
  for (const r of rooms) {
    r.layout = kvLayoutRoom({ id: r.info.id, slot: r.slot, seed: r.seed }, r.theme, r.info, sim);
    r.version++;
  }
  sim.relayout(true);
  // lugar com o mesmo id mudou de posição: o personagem vai junto (sem teleporte para a grama)
  for (const ch of sim.people()) {
    const was = seated.get(ch.id);
    const s = ch.atSpot ? sim.spots.get(ch.atSpot) : undefined;
    if (!was || !s) continue;
    if (Math.abs(s.x - was.x) > 1 || Math.abs(s.y - was.y) > 1) {
      ch.x = s.x;
      ch.y = s.y;
      ch.tx = s.tx;
      ch.ty = s.ty;
      ch.sortY = s.sortY ?? null;
    }
  }
  const grid = sim.building.grid;
  for (const ch of sim.people()) {
    if (ch.atSpot || ch.inside || grid.walkable(ch.tx, ch.ty)) continue;
    const n = grid.nearestWalkable(ch.tx, ch.ty, 40);
    if (n) {
      ch.tx = n.x;
      ch.ty = n.y;
      ch.x = n.x * TILE + TILE / 2;
      ch.y = n.y * TILE + 11;
    }
  }
  fireChange();
}

let changePending = false;
function fireChange(): void {
  for (const cb of kvPlanWorld.onChange) {
    try {
      cb();
    } catch {
      // quem ouve com problema não derruba o prédio
    }
  }
}

function track(sim: Sim): void {
  for (const ref of lastSims) if (ref.deref() === sim) return;
  if (typeof WeakRef !== 'undefined') lastSims.add(new WeakRef(sim));
}

/** O layout de uma sala com a planta ligada. */
function layoutRoom(room: RoomInput, theme: RoomTheme, info: RoomInfo | null | undefined, sim: Sim | undefined): AreaLayout | null {
  const plan = st.plan;
  const ix = st.ix;
  if (!plan || !ix || !usable(sim)) return null;
  const place = kvSlotPlace(ix, room.slot);
  const own = kvOwnMark(info);
  // sala 16x12 com a porta no lugar do original (faixa automática para leste, vaga igual): o layout do original,
  // transladado — o "Clássico" fica idêntico ao prédio de sempre
  const classic = classicSide(place);
  if (classic && !place.item?.style && place.item?.palette === undefined) {
    const a = kvLayoutRoomOriginal({ id: room.id, slot: classic === 'north' ? 0 : 1, seed: room.seed }, theme, info);
    return kvTranslateArea(a, place.rect.x - 32, place.rect.y - (classic === 'north' ? 0 : 17));
  }
  const item = place.item && (place.item.kind === 'projeto' || place.item.kind === 'propria' || place.item.kind === 'vaga') ? place.item : kvStripItem(place.rect, place.doors);
  const st0 = staticsCache;
  const outside = st0 ? kvOutsideSides(st0.covered, st0.W, st0.H, place.rect) : undefined;
  const style = item.style;
  const furnisher = own ? `propria:${own.kind}` : style ? `projeto:${style}` : 'projeto';
  const tags = new Map<string, string[]>();
  const layout = kvLayoutPlanRoom({
    id: room.id,
    rect: place.rect,
    doors: place.doors,
    theme: item.palette !== undefined ? themeFor(0, item.palette) : theme,
    seed: room.seed,
    item,
    side: place.side,
    outside,
    furnisher,
    tags,
    info,
  });
  if (tags.size) roomTags.set(layout, tags);
  return layout;
}

/** A posição é igual a uma vaga do original (16x12, uma porta no meio da parede do corredor)? */
function classicSide(place: ReturnType<typeof kvSlotPlace>): 'north' | 'south' | null {
  const { rect, doors } = place;
  if (rect.w !== 16 || rect.h !== 12 || doors.length !== 1 || doors[0].at !== 7 || (doors[0].w ?? 2) !== 2) return null;
  return doors[0].side === 's' ? 'north' : doors[0].side === 'n' ? 'south' : null;
}

function building(sim: Sim): KvBuilding | null {
  const b = sim.building as KvBuilding;
  return b.kv ? b : null;
}

/** Nome de uma área da planta (`kv:<item>`, núcleo transladado). */
export function kvPlanAreaName(areaId: string): string | null {
  const item = staticsCache?.itemOf.get(areaId);
  if (!item) return null;
  if (item.name) return item.name;
  if (item.kind === 'tema' && item.ref && (KV_THEME_KEYS as readonly string[]).includes(item.ref)) return kvThemeInfo(item.ref as KvThemeKey).name;
  if (item.kind === 'corredor') return tr('corredor');
  if (item.kind === 'jardim') return tr('jardim');
  return null;
}

const impl: KvPlanEngineHooks = {
  assemble(sim, rooms, version) {
    if (!usable(sim) || !st.plan) return null;
    track(sim);
    const s = staticsFor(sim);
    if (!s) return null;
    // quem ouve o prédio (editor, salas temáticas) fica sabendo depois que o Sim trocar o prédio
    if (!changePending) {
      changePending = true;
      queueMicrotask(() => {
        changePending = false;
        fireChange();
      });
    }
    return kvBuildFromStatics(s, rooms, version);
  },
  slot(sim, info) {
    if (!usable(sim) || !st.ix) return undefined;
    return kvFixedSlot(st.ix, info.id);
  },
  layoutRoom,
  canCompact(sim, slot) {
    if (!usable(sim) || !st.ix) return true;
    return slot >= st.ix.vagas.length;
  },
  baseKey(sim) {
    if (!usable(sim)) return null;
    track(sim);
    if (applied.get(sim) !== st.gen) applyTo(sim);
    return building(sim)?.kv.baseKey ?? null;
  },
  exterior(sim) {
    const b = building(sim);
    if (!b) return null;
    const s = b.kv.statics;
    const bridges = new Set(b.kv.bridges.flatMap((r) => [...Array(r.w).keys()].map((i) => r.y * s.W + r.x + i)));
    const key = b.kv.baseKey;
    if (extCache?.key === key) return extCache.ext;
    const gap = (x: number, y: number) => x >= 0 && y >= 0 && x < s.W && y < s.H && s.ground[y * s.W + x] === 1;
    const keep = (x: number, y: number) => bridges.has(y * s.W + x);
    const ext = kvPlanExterior(s.contentW, s.contentH, gap, keep, hash32(s.plan.name ?? ''), s.entrance);
    extCache = { key, ext };
    return ext;
  },
  shells(sim) {
    const b = building(sim);
    return b ? b.kv.shells : null;
  },
  finishBase(sim, ctx, ext) {
    const b = building(sim);
    if (!b) return false;
    const s = b.kv.statics;
    // caminhos de pedra pela grama
    for (const f of kvBridgeFloors(b.kv.bridges)) {
      ctx.fillStyle = '#b9b2a4';
      ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.fillStyle = '#cfc8ba';
      for (let x = f.x + 2; x < f.x + f.w - 2; x += 8) ctx.fillRect(x, f.y + 3, 5, f.h - 6);
    }
    // capacho diante da fachada de vidro da entrada
    const en = s.entrance;
    if (en) {
      const mx = (en.side === 'w' ? en.x - 1.75 : en.x + 1.25) * TILE;
      const my = (en.y + 1.25) * TILE;
      ctx.fillStyle = '#3f4652';
      ctx.fillRect(mx, my, 1.5 * TILE, 2.5 * TILE);
      ctx.fillStyle = '#596170';
      ctx.fillRect(mx + 2, my + 2, 1.5 * TILE - 4, 2.5 * TILE - 4);
      ctx.fillStyle = '#4b525f';
      for (let y = my + 4; y < my + 2.5 * TILE - 4; y += 3) ctx.fillRect(mx + 3, y, 1.5 * TILE - 6, 1);
    }
    // vinheta: escurece com a distância à planta (como a do original)
    const bd = ext.bounds;
    const CW = s.contentW;
    const CH = s.contentH;
    const smooth = (a: number, z: number, v: number) => {
      const t = Math.max(0, Math.min(1, (v - a) / Math.max(1e-6, z - a)));
      return t * t * (3 - 2 * t);
    };
    try {
      const m = document.createElement('canvas');
      m.width = bd.w;
      m.height = bd.h;
      const mctx = m.getContext('2d')!;
      const img = mctx.createImageData(bd.w, bd.h);
      for (let ty = 0; ty < bd.h; ty++) {
        for (let tx = 0; tx < bd.w; tx++) {
          const wx = bd.x + tx + 0.5;
          const wy = bd.y + ty + 0.5;
          const fx = wx < 0 ? smooth(6, -bd.x, -wx) : wx > CW ? smooth(6, bd.x + bd.w - CW, wx - CW) : 0;
          const fy = wy < 0 ? smooth(5, -bd.y, -wy) : wy > CH ? smooth(12, bd.y + bd.h - CH, wy - CH) : 0;
          const i = (ty * bd.w + tx) * 4;
          img.data[i] = 18;
          img.data[i + 1] = 40;
          img.data[i + 2] = 26;
          img.data[i + 3] = Math.round(Math.max(fx, fy) * VIGNETTE_ALPHA * 255);
        }
      }
      mctx.putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(m, bd.x * TILE, bd.y * TILE, bd.w * TILE, bd.h * TILE);
      ctx.restore();
    } catch {
      // sem vinheta
    }
    return true;
  },
  rectPx(sim) {
    const b = building(sim);
    if (!b) return null;
    // o que tem coisa (itens + faixa), não a folga da grade
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (r: TileRect) => {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    };
    for (const it of b.kv.statics.items) add(it);
    for (const a of [...b.kv.statics.areas, ...b.rooms]) add(a.rect);
    if (!Number.isFinite(x0)) return null;
    return { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0) * TILE, h: (y1 - y0) * TILE };
  },
  windowSpill(sim, lit, k, halo, warm) {
    const b = building(sim);
    if (!b) return false;
    const s = b.kv.statics;
    const out = (x: number, y: number) => x < 0 || y < 0 || x >= s.W || y >= s.H || !s.covered[y * s.W + x];
    for (const [vis, l] of lit) {
      if (l < 0.3) continue;
      const r = vis.layout.rect;
      if (vis.layout.kind === 'corridor') continue;
      // janelas na face norte que dá para a grama -> luz no gramado ao norte
      if (out(r.x + Math.floor(r.w / 2), r.y - 1)) for (const w of vis.wallItems) if (w.kind === 'window') halo(warm, w.cx, r.y * TILE - 12, 58, 30, 0.55 * k * l);
      // parede sul para fora: brilho suave na grama
      if (out(r.x + Math.floor(r.w / 2), r.y + r.h)) for (const fx of [0.25, 0.75]) halo(warm, (r.x + r.w * fx) * TILE, (r.y + r.h) * TILE + 16, 96, 30, 0.35 * k * l);
    }
    // janelas dos fechamentos e das vagas vazias
    for (const sh of b.kv.shells) for (const w of sh.windows) halo(warm, w.cx, w.baseY - 2 * TILE - 14, 52, 28, 0.45 * k);
    return true;
  },
  signText(areaId) {
    const item = staticsCache?.itemOf.get(areaId);
    if (!item || item.kind === 'nucleo') return null;
    if ((item.kind === 'corredor' || item.kind === 'jardim') && !item.name) return null;
    return kvPlanAreaName(areaId);
  },
  geom(sim) {
    const b = building(sim);
    if (!b) return null;
    const c = b.corridor.id === 'kv:auto' ? b.corridor.rect : null;
    return { strip: c, vertical: b.kv.statics.plan.auto.dir === 's' };
  },
  areaName: (id) => kvPlanAreaName(id),
  areaColor(id) {
    const item = staticsCache?.itemOf.get(id);
    if (!item) return null;
    if (item.kind === 'corredor') return '#3a3f58';
    if (item.kind === 'jardim') return '#4f8a4f';
    if (item.kind === 'tema' && item.ref && (KV_THEME_KEYS as readonly string[]).includes(item.ref)) return item.color ?? kvThemeColor(item.ref as KvThemeKey);
    return null;
  },
  areaOfTile(sim, tx, ty) {
    const b = building(sim);
    if (!b) return null;
    for (const r of b.rooms) if (kvInRect(r.rect, tx, ty)) return `r:${r.id}`;
    for (const a of b.kv.statics.areas) if (kvInRect(a.rect, tx, ty)) return a.id;
    return 'c';
  },
};

// ------------------------------------------------------------------ kvPlanWorld (contrato com o editor e as salas)

let spotsCache: { b: unknown; list: ReturnType<typeof kvComputeActionSpots> } | null = null;

function mainSim(): Sim | null {
  for (const ref of lastSims) {
    const s = ref.deref();
    if (s) return s;
  }
  return null;
}

/** Liga o motor (uma vez). `simOf` = o Sim que está na tela (o timelapse troca). */
export function kvStartPlanEngine(simOf?: () => Sim | null | undefined): void {
  if (kvPlanHooks.impl) return;
  kvPlanHooks.impl = impl;
  const sim = () => {
    const s = simOf?.() ?? mainSim();
    return usable(s) ? s : null;
  };
  kvPlanWorld.preview = (draft) => {
    st.draft = draft === null ? undefined : draft;
    refresh();
  };
  kvPlanWorld.actionSpots = () => {
    const s = sim();
    const b = s ? building(s) : null;
    if (!s || !b) return [];
    if (spotsCache?.b === b) return spotsCache.list;
    const tags = new Map<string, string[]>(b.kv.statics.tags);
    for (const r of b.rooms) for (const [id, v] of roomTags.get(r) ?? []) tags.set(id, v);
    const list = kvComputeActionSpots([...b.kv.statics.areas, ...b.rooms], tags, (x, y) => b.grid.walkable(x, y));
    spotsCache = { b, list };
    return list;
  };
  kvPlanWorld.itemAt = (tx, ty) => {
    const p = st.plan;
    if (!p) return null;
    return p.items.find((it) => kvInRect(it, tx, ty)) ?? null;
  };
  kvPlanWorld.areaRect = (areaId) => {
    const s = sim();
    const b = s ? building(s) : null;
    if (!b) return null;
    return [...b.kv.statics.areas, ...b.rooms].find((a) => a.id === areaId)?.rect ?? null;
  };
  // console / testes: window.habblaud.kvPlan.preview(plano) · .classic() · .example() · .off()
  const dev = {
    preview: (p: unknown) => {
      const { plan } = kvNormPlan(p);
      kvPlanWorld.preview?.(plan);
      return plan;
    },
    classic: (vagas = 0) => dev.preview(kvPlanClassic({ vagas })),
    example: () => dev.preview(kvPlanExample()),
    off: () => kvPlanWorld.preview?.(null),
    keep: (p: unknown) => {
      try {
        localStorage.setItem(DEV_KEY, JSON.stringify(p));
      } catch {
        // sem localStorage
      }
    },
    forget: () => {
      try {
        localStorage.removeItem(DEV_KEY);
      } catch {
        // sem localStorage
      }
    },
    get plan() {
      return st.plan;
    },
  };
  const w = window as unknown as { habblaud?: Record<string, unknown> };
  w.habblaud = { ...(w.habblaud ?? {}), kvPlan: dev };
  // planta de teste guardada no navegador (só para desenvolver): vira rascunho ao abrir
  try {
    const raw = localStorage.getItem(DEV_KEY);
    if (raw) dev.preview(raw === 'classic' ? kvPlanClassic() : raw === 'example' ? kvPlanExample() : JSON.parse(raw));
  } catch {
    // planta de teste com problema: ignora
  }
}

/** A planta gravada mudou (store.ts da frente do editor). */
export function kvSetSavedPlan(plan: KvPlan | null): void {
  st.saved = plan;
  refresh();
}

/** O item da planta de uma sala (projeto/própria) ou da área (`kv:<item>`). */
export function kvPlanItemOf(id: string): KvPlanItem | null {
  const ix = st.ix;
  if (!ix) return null;
  const i = ix.byRef.get(id) ?? ix.byRef.get(kvPlanRoomRef(id));
  if (i !== undefined) return ix.plan.items[i] ?? null;
  return staticsCache?.itemOf.get(id) ?? null;
}

export type { SlotShell };
