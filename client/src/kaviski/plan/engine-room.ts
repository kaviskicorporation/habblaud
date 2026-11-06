// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): a casca paramétrica de uma sala de qualquer tamanho (piso, face
// da parede norte, parede sul, laterais, portas nos 4 lados, batente, placa, interruptor, sombra da luz apagada,
// caminhabilidade) e o contexto que o furnisher recebe (KvFurnishCtx, plan/api.ts). Puro (sem DOM).
//
//   linhas 0–1     face da parede norte (portas 'n' abrem um vão nela, com batente)
//   linhas 2..h-2  piso (miolo: colunas 1..w-2)
//   linha h-1      parede sul (portas 's')
//   colunas 0/w-1  paredes laterais de 0,5 tile (portas 'e'/'w' abrem um vão)
import { FURNITURE, type Dir, type FloorKind, type FurnitureKind, type RoomTheme, type WallStyle } from '../../art/api';
import { mulberry32 } from '../../../../shared/hash';
import type { KvPlanDoor, KvPlanItem } from '../../../../shared/kaviski-plan';
import type { RoomInfo } from '../../../../shared/types';
import { TILE } from '../../world/constants';
import { AreaBuilder, type SpotOpts } from '../../world/layout/builder';
import type { AreaKind, AreaLayout, SpotDef, SpotKind, TileRect } from '../../world/layout/types';
import { kvFurnisher, type KvFurnishCtx, type KvFurnisher } from './api';
import { kvDoorTiles } from './engine-geom';
import { kvSpriteDims } from './themes-dims';

export interface KvRoomShellInput {
  /** Id da área (id da sala no Sim, ou `kv:<item>` das salas temáticas). */
  id: string;
  kind?: AreaKind;
  rect: TileRect;
  doors: readonly KvPlanDoor[];
  theme: RoomTheme;
  seed: number;
  /** O item da planta (as salas da faixa automática ganham um item de mentira). */
  item: KvPlanItem;
  /** Lado do corredor (só a faixa automática: as pessoas espelham a posição como no original). */
  side?: 'north' | 'south';
  /** Lados que dão para fora (grama): parede externa. */
  outside?: Partial<Record<'n' | 's' | 'e' | 'w', boolean>>;
  /** Piso (padrão: porcelanato claro, como as salas de projeto). */
  floor?: FloorKind;
  /** Chave do furnisher (ex.: 'projeto', 'propria:reuniao', 'tema:rh'); cai no padrão do tipo. */
  furnisher?: string;
  /** Recebe os `tag` do furnisher (id do móvel/spot -> ação). */
  tags?: Map<string, string[]>;
  /** A sala do snapshot (projeto/sala própria). */
  info?: RoomInfo | null;
}

/** Furnisher da chave, ou o padrão do tipo (`tema:rh` -> `tema`; `projeto:ilhas` -> `projeto`). */
export function kvPickFurnisher(key: string | undefined): KvFurnisher | undefined {
  if (!key) return undefined;
  return kvFurnisher(key) ?? kvFurnisher(key.split(':')[0]);
}

/** Monta a sala: casca + mobília do furnisher. */
export function kvLayoutPlanRoom(inp: KvRoomShellInput): AreaLayout {
  const { rect, theme } = inp;
  const w = rect.w;
  const h = rect.h;
  const b = new AreaBuilder(inp.id, inp.kind ?? 'room', rect);
  const area = b.area;
  if (inp.side) area.side = inp.side;
  const wall: WallStyle = theme.wall;
  const doors = inp.doors.length ? inp.doors : [{ side: 's' as const, at: Math.max(1, Math.floor(w / 2) - 1) }];
  const dw = (d: KvPlanDoor) => d.w ?? 2;
  const span = (side: KvPlanDoor['side']) => doors.filter((d) => d.side === side).map((d) => ({ lx: d.at, w: dw(d) }));

  // ---- piso
  b.floor(inp.floor ?? 'marble', 0, 0, w, h, inp.seed);
  area.floorTint = theme.carpet;

  // ---- paredes
  b.face(0.5, w - 1, wall, span('n'));
  b.south(0.5, w - 1, h - 1, inp.outside?.s ? { ...wall, exterior: true } : wall, span('s'));
  for (const [side, lx] of [
    ['w', 0],
    ['e', w - 0.5],
  ] as const) {
    // a lateral é cortada nas portas 'e'/'w'
    const cuts = doors.filter((d) => d.side === side).sort((a, c) => a.at - c.at);
    let y0 = 0;
    for (const d of cuts) {
      if (d.at > y0) b.cap(lx, y0, 0.5, d.at - y0, wall);
      y0 = d.at + dw(d);
    }
    if (y0 < h) b.cap(lx, y0, 0.5, h - y0, wall);
  }
  for (const d of doors) if (d.side === 'n') b.wall('door_frame', d.at + dw(d) / 2, undefined, { order: 0.05 });

  // ---- caminhabilidade (miolo + vãos das portas)
  b.walk(1, 2, w - 2, h - 3);
  for (const d of doors) {
    const t = kvDoorTiles(w, h, d);
    b.walk(t.x, t.y, t.w, t.h);
  }
  const main = doors[0];
  const mt = kvDoorTiles(w, h, main);
  area.door = { x: rect.x + mt.x, y: rect.y + mt.y, w: mt.w, h: mt.h };

  // ---- ocupação local (furnisher não passa por cima da casca)
  const occ = new Uint8Array(w * h); // 0 livre, 1 móvel que bloqueia, 2 assento/lugar, 3 manter livre
  const keepFree: { x: number; y: number }[] = [];
  const keep = (x: number, y: number) => {
    if (x < 1 || y < 2 || x > w - 2 || y > h - 2) return;
    if (occ[y * w + x] !== 3) {
      occ[y * w + x] = 3;
      keepFree.push({ x, y });
    }
  };
  for (const d of doors) {
    // a passagem na frente da porta (2 tiles para dentro) fica livre
    for (let i = 0; i < dw(d); i++) {
      if (d.side === 'n') for (const y of [2, 3]) keep(d.at + i, y);
      else if (d.side === 's') for (const y of [h - 2, h - 3]) keep(d.at + i, y);
      else if (d.side === 'w') for (const x of [1, 2]) keep(x, d.at + i);
      else for (const x of [w - 2, w - 3]) keep(x, d.at + i);
    }
  }

  // ---- paredes: faixas ocupadas (tiles locais, [início, fim))
  const wallBusy: Record<'face' | 'south', [number, number][]> = { face: [], south: [] };
  for (const d of doors) {
    if (d.side === 'n') wallBusy.face.push([d.at - 0.25, d.at + dw(d) + 0.25]);
    if (d.side === 's') wallBusy.south.push([d.at - 0.25, d.at + dw(d) + 0.25]);
  }
  // portas laterais: a ponta da face junto delas fica sem item
  if (doors.some((d) => d.side === 'w' && d.at <= 3)) wallBusy.face.push([0, 1.5]);
  if (doors.some((d) => d.side === 'e' && d.at <= 3)) wallBusy.face.push([w - 1.5, w]);
  const wallFree = (on: 'face' | 'south', lo: number, hi: number) => lo >= 0.5 && hi <= w - 0.5 && !wallBusy[on].some(([a, c]) => lo < c && hi > a);
  const placeWall = (kind: FurnitureKind, lcx: number, variant: string | undefined, o: { ly?: number; on?: 'face' | 'south'; order?: number } = {}): string | null => {
    const on = o.on ?? 'face';
    const half = (kvSpriteDims(variant)?.w ?? FURNITURE[kind].footprint.w) / 2; // itens das salas temáticas podem ser mais largos que o suporte
    if (!wallFree(on, lcx - half, lcx + half)) return null;
    wallBusy[on].push([lcx - half, lcx + half]);
    return b.wall(kind, lcx, variant, { ...o, on, ly: o.ly ?? (on === 'south' ? h : 2) });
  };

  // ---- interruptor ao lado da porta principal, por dentro
  const sw = switchPlace(w, h, main);
  if (sw.on === 'south') {
    placeWall('light_switch', sw.lcx, 'on', { on: 'south', order: 0.8 });
    b.spot('switch', sw.tx, sw.ty, 'down', { dy: -1 });
  } else {
    placeWall('light_switch', sw.lcx, 'on', { order: 0.8 });
    b.spot('switch', sw.tx, sw.ty, 'up', { dy: -3 });
  }
  if (occ[sw.ty * w + sw.tx] !== 3) {
    occ[sw.ty * w + sw.tx] = 3;
    keepFree.push({ x: sw.tx, y: sw.ty });
  }

  // ---- placa com o nome: na face, o mais perto do centro (ou da porta norte) que couber
  const signCx = signPlace(w, wallFree, main.side === 'n' ? main.at + dw(main) + 2 : w / 2);
  if (signCx !== null) area.signId = placeWall('sign', signCx, undefined, { order: 0.95 }) ?? undefined;

  // ---- contexto do furnisher
  const rng = mulberry32((inp.seed ^ 0x5eed) >>> 0);
  const inner: TileRect = { x: 1, y: 2, w: w - 2, h: h - 3 };
  const inInner = (x: number, y: number) => x >= 1 && y >= 2 && x <= w - 2 && y <= h - 2;
  const free = (lx: number, ly: number, fw = 1, fh = 1) => {
    for (let y = ly; y < ly + fh; y++) for (let x = lx; x < lx + fw; x++) if (!inInner(x, y) || occ[y * w + x] !== 0) return false;
    return true;
  };
  const mark = (lx: number, ly: number, fw: number, fh: number, v: number) => {
    for (let y = ly; y < ly + fh; y++) for (let x = lx; x < lx + fw; x++) if (inInner(x, y)) occ[y * w + x] = v;
  };
  const tags = inp.tags;
  const wallSlots: KvFurnishCtx['wallSlots'] = [];
  for (let cx = 1.5; cx <= w - 1.5; cx += 1) if (wallFree('face', cx - 0.5, cx + 0.5)) wallSlots.push({ on: 'face', lcx: cx });
  for (let cx = 1.5; cx <= w - 1.5; cx += 1) if (wallFree('south', cx - 0.5, cx + 0.5)) wallSlots.push({ on: 'south', lcx: cx, ly: h });

  const ctx: KvFurnishCtx = {
    item: inp.item,
    rect,
    inner,
    keepFree,
    wallSlots,
    theme,
    seed: inp.seed,
    rng,
    b,
    info: inp.info,
    outside: inp.outside,
    furn(kind, lx, ly, variant, o = {}) {
      const def = FURNITURE[kind];
      if (def.mount !== 'floor') return null;
      const { w: fw, h: fh } = def.footprint;
      if (!free(lx, ly, fw, fh)) return null;
      mark(lx, ly, fw, fh, def.blocks ? 1 : 2);
      return b.furn(kind, lx, ly, variant, o);
    },
    seat(kind, fk, lx, ly, dir, variant, o = {}) {
      const def = FURNITURE[fk];
      if (!free(lx, ly, def.footprint.w, def.footprint.h)) return null;
      mark(lx, ly, def.footprint.w, def.footprint.h, 2);
      return b.seat(kind, fk, lx, ly, dir, variant, o);
    },
    spot(kind, lx, ly, dir, o = {}) {
      if (!free(lx, ly)) return null;
      mark(lx, ly, 1, 1, 2);
      return b.spot(kind, lx, ly, dir, o);
    },
    wall(kind, lcx, variant, o = {}) {
      return placeWall(kind, lcx, variant, o);
    },
    free,
    tag(id, action) {
      if (!tags) return;
      const list = tags.get(id);
      if (!list) tags.set(id, [action]);
      else if (!list.includes(action)) list.push(action);
    },
  };
  const f = kvPickFurnisher(inp.furnisher);
  if (f) {
    try {
      f(ctx);
    } catch {
      // furnisher com problema: a sala fica só com a casca
    }
  }

  // ---- sombra da luz apagada (a parede sul que dá para um corredor fica clara, como no original)
  const p = { x: rect.x * TILE, y: rect.y * TILE, w: w * TILE, h: h * TILE };
  area.shade = inp.outside?.s ? p : { x: p.x, y: p.y, w: p.w, h: p.h - TILE };
  return b.build();
}

/** Onde fica o interruptor: ao lado da porta principal, por dentro. */
export function switchPlace(w: number, h: number, d: KvPlanDoor): { on: 'face' | 'south'; lcx: number; tx: number; ty: number } {
  const dw = d.w ?? 2;
  if (d.side === 's' || d.side === 'n') {
    // à esquerda da porta; sem espaço, à direita
    const left = d.at - 1 >= 1;
    const tx = left ? d.at - 1 : Math.min(w - 2, d.at + dw);
    const lcx = left ? d.at - 0.5 : d.at + dw + 0.5;
    return d.side === 's' ? { on: 'south', lcx, tx, ty: h - 2 } : { on: 'face', lcx, tx, ty: 2 };
  }
  // porta lateral: na face, na ponta do lado da porta
  return d.side === 'w' ? { on: 'face', lcx: 2.5, tx: 2, ty: 2 } : { on: 'face', lcx: w - 2.5, tx: w - 3, ty: 2 };
}

/** Centro da placa na face: o mais perto de `want`, deixando (se der) 3 tiles livres para o quadro da sala. */
function signPlace(w: number, wallFree: (on: 'face' | 'south', lo: number, hi: number) => boolean, want: number): number | null {
  const c = Math.max(2, Math.min(w - 2, want));
  const cands: number[] = [];
  for (let d = 0; d < w; d += 0.5) for (const cx of d ? [c + d, c - d] : [c]) if (wallFree('face', cx - 1.5, cx + 1.5)) cands.push(cx);
  const roomFor3 = (cx: number) => {
    for (let lo = 0.5; lo + 3 <= w - 0.5; lo += 0.5) if (wallFree('face', lo, lo + 3) && (lo + 3 <= cx - 1.5 || lo >= cx + 1.5)) return true;
    return false;
  };
  return cands.find(roomFor3) ?? cands[0] ?? null;
}

/** Um assento qualquer de furnisher padrão, com a mesma conversão de `kind` das salas próprias. */
export function kvSeatKind(fk: FurnitureKind): SpotKind {
  return fk === 'office_chair' || fk === 'office_chair_front' ? 'desk' : fk === 'stool' ? 'stool' : 'nook';
}

export type { Dir, SpotDef, SpotOpts };
