// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): a mobília das salas de reunião (sala própria
// `reuniao`) na planta livre, de 8x8 a 40x28, por layout (`meet.layout`, shared/kaviski-meetings.ts):
//   cabine      = cabines de chamada lado a lado (mesinha com monitor, duas poltronas, painéis acústicos), espera;
//   bate-papo   = mesa redonda com cadeiras, sofá de frente para a TV, aparador com café;
//   reuniao     = mesa grande (cresce com a sala) com banquetas, telão e quadro branco; mais mesas em sala grande;
//   conselho    = mesa longa de nogueira com cadeiras executivas, telão, aparador, estantes e plantas;
//   treinamento = fileiras de mesas de frente para a tela e o quadro, púlpito e mesa do instrutor na frente;
//   criativa    = roda de puffs, mesa alta com banquetas, sofá, flip charts, mural de post-its e tapetes coloridos.
// Toda sala de reunião tem o painel de reserva perto da porta (estilo Teams Rooms) marcado com a ação `reunioes` do
// "ir e fazer" (sem parede livre: um totem no chão). Tudo passa pelo KvPlacer (themes-place.ts): nada fecha o caminho
// da porta até os assentos e os itens. Os assentos são só "da sala" (nook, stool, desk): os agentes não vêm descansar
// aqui. Puro (sem DOM).
import { FURNITURE, type Dir, type FurnitureKind } from '../../art/api';
import { KV_MEET_LAYOUTS, type KvMeetLayout } from '../../../../shared/kaviski-meetings';
import { TILE } from '../../world/constants';
import type { SpotOpts } from '../../world/layout/builder';
import type { KvFurnishCtx } from './api';
import { BEANBAGS, kvShade, PLANTS_SMALL, PLANTS_TALL, POSTERS } from './furnish-util';
import { kvSpriteDims } from './themes-dims';
import { KvPlacer } from './themes-place';

/** A ação "ir e fazer" do painel de reservas da sala (registrada por outra frente). */
export const KV_MEET_ACTION = 'reunioes';

const RUGS = ['#f2c14e', '#e47aa8', '#36b0b0', '#8d66cf', '#4cae6a', '#ec8a3c'] as const;

function pick<T>(P: KvPlacer, arr: readonly T[]): T {
  return arr[Math.floor(P.ctx.rng() * arr.length) % arr.length]!;
}

function rug(P: KvPlacer, x: number, y: number, w: number, h: number, color: string): void {
  if (w >= 2 && h >= 1) P.ctx.b.rug(x, y, w, h, color, P.ctx.seed + Math.round(x * 7 + y));
}

/** Quanto do miolo está ocupado por móveis (0..1). */
function density(P: KvPlacer): number {
  let n = 0;
  for (const f of P.ctx.b.area.furniture) n += f.kind === 'meeting_table' ? 6 : f.kind === 'sofa' || f.kind === 'reception_desk' ? 3 : f.kind === 'desk' || f.kind === 'desk_back' || f.kind === 'coffee_table' || f.kind === 'bookshelf' || f.kind === 'bench' ? 2 : 1;
  return n / (P.iw * P.ih);
}

/** Centro local (tiles) de um item de parede. */
function wallCol(P: KvPlacer, id: string): number {
  const w = P.ctx.b.area.wallItems.find((x) => x.id === id);
  return w ? w.cx / TILE - P.ctx.rect.x : P.cx + 0.5;
}

/** Plantas nos cantos livres. */
function plants(P: KvPlacer, n = 4): void {
  let put = 0;
  for (const [x, y] of P.corners()) {
    if (put >= n) break;
    const tall = P.ctx.rng() < 0.6;
    if (P.putAt(tall ? 'plant_tall' : 'plant_small', x, y, tall ? pick(P, PLANTS_TALL) : pick(P, PLANTS_SMALL), { order: 0.2 })) put++;
  }
}

/** Enfeites de parede nas colunas que sobraram. */
function wallDecor(P: KvPlacer, kinds: WallDeco): void {
  for (const k of kinds) {
    const n = k === 'clock' ? 1 : 2;
    if (P.wallLeft() < n + 1) break;
    P.wall(k, n, undefined, { near: P.ctx.rng() * P.w, order: 0.5 });
  }
}

/**
 * Sala grande: grupos (de `gw` x `gh` tiles, com o canto em x, y) espalhados pelo miolo, cada um com um tile de folga
 * em volta e longe das paredes, até a densidade pedida. `group(x, y, i)` tenta montar o i-ésimo grupo.
 */
function groups(P: KvPlacer, gw: number, gh: number, group: (x: number, y: number, i: number) => boolean, target: number): void {
  if (P.iw < gw + 4 || P.ih < gh + 3) return;
  // ordem embaralhada (pela semente da sala): os grupos se espalham em vez de encher a parte de cima primeiro
  const cands: [number, number][] = [];
  for (let y = P.y0 + 1; y + gh <= P.y1; y++) for (let x = P.x0 + 1; x + gw <= P.x1; x++) cands.push([x, y]);
  for (let k = cands.length - 1; k > 0; k--) {
    const j = Math.floor(P.ctx.rng() * (k + 1));
    [cands[k], cands[j]] = [cands[j]!, cands[k]!];
  }
  let i = 0;
  for (const [x, y] of cands) {
    if (density(P) >= target) return;
    if (P.free(x - 1, y - 1, gw + 2, gh + 2) && group(x, y, i)) i++;
  }
}

/** O tile de dentro da porta principal (o primeiro da passagem). */
function doorTile(P: KvPlacer): { x: number; y: number } {
  return P.ctx.keepFree[0] ?? { x: P.cx, y: P.y1 };
}

// ------------------------------------------------------------------ peças comuns

type WallItem = readonly [kind: FurnitureKind, n: number, variant: string | undefined];

/** Telas grandes, da melhor para a que sempre cabe: tela de projeção (4), telão (3), TV (2). */
const BIG: readonly WallItem[] = [
  ['shelf_wall', 4, 'kv-screen'],
  ['tv', 3, 'kv-bigtv'],
  ['tv', 2, undefined],
];

/** A tela principal de cada layout (a primeira que couber), posta junto com o painel de reservas. */
const SCREENS: Record<KvMeetLayout, { items: readonly WallItem[]; near: (P: KvPlacer) => number }> = {
  cabine: { items: [], near: (P) => P.cx },
  'bate-papo': { items: [['tv', 2, undefined]], near: (P) => P.x1 - 1.5 },
  reuniao: { items: BIG, near: (P) => P.cx + 1 },
  conselho: { items: BIG, near: (P) => P.cx + 1 },
  treinamento: { items: BIG, near: (P) => P.cx + 1 },
  criativa: {
    items: [
      ['shelf_wall', 3, 'kv-postit-wall'],
      ['shelf_wall', 2, 'kv-postit-small'],
    ],
    near: (P) => P.cx + 1,
  },
};

/**
 * Trechos livres da face norte (tiles locais), menos `extra`: a parede inteira (0,5 a w-0,5) sem os itens já postos
 * (placa, interruptor, batente das portas do norte com folga, quadro...) e sem as pontas junto das portas laterais —
 * as mesmas regras do motor (engine-room.ts).
 */
function freeWall(P: KvPlacer, extra: readonly (readonly [number, number])[] = []): [number, number][] {
  const busy: [number, number][] = [...extra.map(([a, b]) => [a, b] as [number, number])];
  for (const w of P.ctx.b.area.wallItems) {
    if (w.on !== 'face') continue;
    const half = (kvSpriteDims(w.variant)?.w ?? FURNITURE[w.kind].footprint.w) / 2;
    const pad = w.kind === 'door_frame' ? 0.25 : 0;
    const cx = w.cx / TILE - P.ctx.rect.x;
    busy.push([cx - half - pad, cx + half + pad]);
  }
  for (const d of P.ctx.item.doors ?? []) {
    if (d.side === 'w' && d.at <= 3) busy.push([0, 1.5]);
    if (d.side === 'e' && d.at <= 3) busy.push([P.w - 1.5, P.w]);
  }
  let segs: [number, number][] = [[0.5, P.w - 0.5]];
  for (const [lo, hi] of busy) segs = segs.flatMap(([a, b]): [number, number][] => (hi <= a || lo >= b ? [[a, b]] : ([[a, lo], [hi, b]] as [number, number][]).filter(([x, y]) => y - x > 1e-6)));
  return segs;
}

/** O centro (de meio em meio tile) mais perto de `near` em que um item de `n` tiles cabe nos trechos livres. */
function fitWall(segs: readonly (readonly [number, number])[], n: number, near: number): number | null {
  let best: number | null = null;
  for (const [a, b] of segs) {
    for (let c = a + n / 2; c + n / 2 <= b + 1e-6; c += 0.5) if (best === null || Math.abs(c - near) < Math.abs(best - near)) best = c;
  }
  return best;
}

/**
 * Parede comum a todas: o quadro branco (com o lugar de usar, como nas salas próprias de sempre), a tela principal do
 * layout e o painel de reservas perto da porta (ação `reunioes`), escolhidos juntos para caber os três quando der
 * (sala estreita: a tela fica menor ou o painel vira um totem no chão, perto da porta).
 */
function walls(P: KvPlacer, spotExtra: { v?: SpotOpts }, layout: KvMeetLayout): string | null {
  // o quadro o mais à esquerda que couber (de meio em meio tile: o planejador só tenta colunas inteiras)
  let board: string | null = null;
  for (let c = 2; !board && c <= P.w - 2.5; c += 0.5) {
    board = P.ctx.wall('whiteboard', c, undefined, { order: 0.6 });
  }
  if (board) {
    spotExtra.v = { dx: 8, dy: 2 };
    const col = wallCol(P, board);
    for (const x of [Math.floor(col - 0.5), Math.floor(col - 0.5) + 1, Math.floor(col - 0.5) - 1]) if (P.spot('whiteboard', x, P.y0, 'up')) break;
    spotExtra.v = undefined;
  }
  // painel: de meio em meio tile, do mais perto da porta para longe, onde houver piso livre embaixo (lugar de uso)
  const d = doorTile(P);
  const near = (d.y === P.y0 ? d.x - 1 : d.x) + 0.5; // porta no norte: ao lado dela; nos outros lados: na direção da porta
  const segs = freeWall(P);
  const under = (c: number) => [Math.floor(c), Math.floor(c - 0.5)].filter((x) => P.inside(x, P.y0) && P.free(x, P.y0));
  const panelAt: number[] = [];
  for (const [a, b] of segs) for (let c = a + 0.5; c + 0.5 <= b + 1e-6; c += 0.5) if (under(c).length) panelAt.push(c);
  // colunas inteiras primeiro (o planejador reserva o lugar de uso sozinho), depois as de meio tile
  panelAt.sort((x, y) => Math.abs(x - near) - Math.abs(y - near) || (x % 1) - (y % 1) || x - y);
  const sc = SCREENS[layout];
  const want = sc.near(P);
  let plan: { item?: WallItem; lcx?: number; panel?: number } = { panel: panelAt[0] };
  done: for (const item of sc.items) {
    for (const p of panelAt) {
      const lcx = fitWall(freeWall(P, [[p - 0.5, p + 0.5]]), item[1], want);
      if (lcx !== null) {
        plan = { item, lcx, panel: p };
        break done;
      }
    }
  }
  if (!plan.item && plan.panel === undefined) {
    // nem o painel cabe na parede: a tela (a maior que couber) e o painel vira totem
    for (const item of sc.items) {
      const lcx = fitWall(segs, item[1], want);
      if (lcx !== null) {
        plan = { item, lcx };
        break;
      }
    }
  }
  let screen: string | null = null;
  if (plan.item && plan.lcx !== undefined) {
    screen = P.ctx.wall(plan.item[0], plan.lcx, plan.item[2], { order: 0.6 }) ?? P.wall(plan.item[0], plan.item[1], plan.item[2], { near: want, order: 0.6 });
  }
  let panel: string | null = null;
  if (plan.panel !== undefined) {
    const c = plan.panel;
    if (Number.isInteger(c - 0.5)) panel = P.wall('clock', 1, 'kv-room-panel', { near: c, use: KV_MEET_ACTION, order: 0.85 });
    else {
      // meio tile: o planejador não sabe pôr ali; o lugar de uso fica reservado com um ponto em pé
      const spot = under(c).find((x) => P.free(x, P.y0));
      if (spot !== undefined) {
        panel = P.ctx.wall('clock', c, 'kv-room-panel', { order: 0.85 });
        if (panel) {
          P.spot('stand', spot, P.y0, 'up');
          P.ctx.tag(panel, KV_MEET_ACTION);
        }
      }
    }
  }
  if (!panel) {
    const around = P.around(d.x, d.y, Math.max(P.iw, P.ih)).filter(([x, y]) => Math.abs(x - d.x) + Math.abs(y - d.y) >= 2);
    P.put('filing_cabinet', around, 'kv-room-totem', { use: KV_MEET_ACTION, order: 0.4 });
  }
  return screen;
}

/** O mural (pôster) da sala, depois das telas e quadros do layout. */
function mural(P: KvPlacer): void {
  P.wall('poster', 1, pick(P, POSTERS), { near: P.x1 - 2, order: 0.5 });
}

function seatOf(fk: FurnitureKind): 'stool' | 'nook' {
  return fk === 'armchair' || fk === 'beanbag' || fk === 'sofa' ? 'nook' : 'stool';
}

/**
 * Mesa feita de `n` peças 3x2 lado a lado em (x, y), com assentos em volta: em cima olhando para baixo, embaixo
 * olhando para cima e um em cada ponta. `every` = 1 (todo tile) ou 2 (um sim, um não: cadeiras mais largas).
 */
interface TableOpts {
  variant?: string;
  top: FurnitureKind;
  bottom: FurnitureKind;
  topV?: string;
  botV?: string;
  ends: FurnitureKind;
  every: 1 | 2;
  /** Dois assentos em cada ponta (senão um). */
  ends2?: boolean;
}

function table(P: KvPlacer, x: number, y: number, n: number, o: TableOpts, strict = true): number {
  if (strict ? !P.free(x - 1, y - 1, n * 3 + 2, 4) : !P.free(x, y, n * 3, 2)) return 0;
  let tables = 0;
  for (let i = 0; i < n; i++) if (P.putAt('meeting_table', x + i * 3, y, o.variant, { order: 0.4 + i * 0.01 })) tables++;
  if (!tables) return 0;
  const tw = n * 3;
  const cols: number[] = [];
  for (let i = 0; i < tw; i++) {
    if (o.every === 1) cols.push(i);
    else if (tw % 2 === 1 ? i % 2 === 0 : i < tw / 2 ? i % 2 === 0 : i % 2 === 1) cols.push(i);
  }
  for (const i of cols) {
    P.seat(seatOf(o.top), o.top, x + i, y - 1, 'down', o.topV, { order: 0.6 });
    P.seat(seatOf(o.bottom), o.bottom, x + i, y + 2, 'up', o.botV, { order: 0.62 });
  }
  const endRows = o.ends2 ? [y, y + 1] : [y];
  for (const yy of endRows) {
    P.seat(seatOf(o.ends), o.ends, x - 1, yy, 'right', o.ends === 'armchair' ? 'right' : undefined, { order: 0.6 });
    P.seat(seatOf(o.ends), o.ends, x + tw, yy, 'left', o.ends === 'armchair' ? 'left' : undefined, { order: 0.6 });
  }
  return tables;
}

/** A maior mesa de até `max` peças que couber perto de (cx, cy). Devolve o retângulo (com os assentos) ou null. */
function bestTable(P: KvPlacer, max: number, cy: number, o: TableOpts): { x: number; y: number; n: number } | null {
  for (let n = max; n >= 1; n--) {
    const tw = n * 3;
    const x0 = P.cx - Math.floor(tw / 2) + 1;
    for (const [x, y] of P.around(x0, cy, 3)) {
      if (x - 1 < P.x0 || x + tw > P.x1 || y - 1 < P.y0 || y + 2 > P.y1) continue;
      if (table(P, x, y, n, o)) return { x, y, n };
    }
  }
  // sala apertada (ou a porta no caminho): uma peça só, com os assentos que couberem
  for (const [x, y] of P.around(P.cx - 1, cy, Math.max(P.iw, P.ih))) if (table(P, x, y, 1, o, false)) return { x, y, n: 1 };
  return null;
}

/** Garante uns lugares mesmo na sala mais apertada: mesinha com duas banquetas onde der. */
function ensureSeats(P: KvPlacer, min = 2): void {
  const seated = () => P.ctx.b.area.spots.filter((s) => s.seated).length;
  if (seated() >= min) return;
  for (const [x, y] of P.around(P.cx, P.cy, Math.max(P.iw, P.ih))) {
    if (!P.free(x - 1, y, 3, 1)) continue;
    if (!P.putAt('cafe_table', x, y, undefined, { order: 0.45 })) continue;
    P.seat('stool', 'stool', x - 1, y, 'right', undefined, { order: 0.6 });
    P.seat('stool', 'stool', x + 1, y, 'left', undefined, { order: 0.6 });
    if (seated() >= min) return;
  }
  for (const [x, y] of P.around(P.cx, P.cy, Math.max(P.iw, P.ih))) {
    if (seated() >= min) return;
    P.seat('nook', 'armchair', x, y, 'up', 'up', { order: 0.6 });
  }
}

/** Duas poltronas de frente uma para a outra com a mesinha de centro. */
function nook(P: KvPlacer, x: number, y: number, color?: string): boolean {
  if (!P.free(x, y, 4, 1)) return false;
  if (!P.putAt('coffee_table', x + 1, y, undefined, { order: 0.45 })) return false;
  P.seat('nook', 'armchair', x, y, 'right', 'right', { order: 0.6 });
  P.seat('nook', 'armchair', x + 3, y, 'left', 'left', { order: 0.61 });
  if (color) rug(P, x - 0.25, y - 0.5, 4.5, 2, color);
  return true;
}

/** Sofá de frente para a parede norte (a TV), mesinha na frente e uma poltrona de cada lado (bloco 5x3). */
function sofaCorner(P: KvPlacer, x: number, y: number, color: string): boolean {
  if (!P.free(x, y, 5, 3)) return false;
  if (!P.putAt('coffee_table', x + 1, y, undefined, { dx: 8, order: 0.45 })) return false;
  rug(P, x - 0.4, y - 0.4, 5.8, 3.8, color);
  P.seat('nook', 'sofa', x + 1, y + 2, 'up', 'up', { dx: TILE, order: 0.55 });
  P.seat('nook', 'armchair', x, y, 'right', 'right', { order: 0.56 });
  P.seat('nook', 'armchair', x + 4, y, 'left', 'left', { order: 0.57 });
  return true;
}

// =================================================================== os layouts

type WallDeco = readonly ('window' | 'clock' | 'painting')[];

/** Cada layout mobilia a sala e devolve os enfeites de parede para o que sobrar (depois do mural). */
const LAYOUTS: Record<KvMeetLayout, (P: KvPlacer, screen: string | null) => WallDeco | void> = {
  // Cabine de chamada: fileiras de cabines (mesinha com monitor e câmera, duas poltronas, painéis acústicos entre
  // elas) encostadas no norte e no sul; o resto vira espera (poltronas, água) e, em sala grande, cantinhos.
  cabine(P) {
    P.ctx.b.floor('carpet', 0, 0, P.w, P.h, P.ctx.seed, kvShade('#b9c3d6', 0.1), '#b0bbd0');
    P.wall('shelf_wall', 2, 'kv-acoustic-wall', { near: P.x1 - 1, order: 0.5 });
    if (P.iw >= 12) P.wall('shelf_wall', 2, 'kv-acoustic-wall', { near: P.cx, order: 0.5 });
    const booth = (x: number, y: number): boolean => {
      if (!P.free(x + 1, y, 2, 2)) return false;
      if (!P.putAt('coffee_table', x + 1, y, 'kv-call-desk', { order: 0.4 })) return false;
      P.seat('nook', 'armchair', x + 1, y + 1, 'up', 'up', { order: 0.6 });
      P.seat('nook', 'armchair', x + 2, y + 1, 'up', 'up', { order: 0.61 });
      for (const [px, py] of [[x, y], [x, y + 1], [x + 3, y], [x + 3, y + 1]] as const) P.putAt('filing_cabinet', px, py, 'kv-acoustic', { order: 0.45 });
      return true;
    };
    const rowsY = [P.y0 + 1];
    if (P.ih >= 9) rowsY.push(P.y1 - 2);
    let booths = 0;
    for (const y of rowsY) {
      const cols = Math.min(6, Math.floor((P.iw - 1) / 3));
      const x0 = P.x0 + Math.floor((P.iw - (cols * 3 + 1)) / 2);
      for (let c = 0; c < cols; c++) if (booth(x0 + c * 3, y)) booths++;
    }
    if (!booths) for (const [x, y] of P.around(P.cx - 2, P.cy - 1, 4)) if (booth(x, y)) break;
    // espera
    P.put('water_cooler', P.east(1, 1, P.cy).concat(P.west(1, P.cy)), undefined, { order: 0.3 });
    if (P.ih >= 7) for (const [x, y] of P.around(P.cx - 1, P.cy, 3)) if (nook(P, x, y, kvShade(P.ctx.theme.carpet2, 0.2))) break;
    plants(P, 3);
    groups(P, 5, 3, (x, y, i) => (i % 3 === 2 ? sofaCorner(P, x, y, kvShade(P.ctx.theme.carpet2, 0.25)) : nook(P, x, y + 1, kvShade(P.ctx.theme.carpet2, 0.2))), 0.3);
    P.put('floor_lamp', P.corners(), undefined, { order: 0.3 });
  },

  // Bate-papo: mesa redonda com quatro cadeiras, sofá de frente para a TV, aparador com café; mais mesas em sala grande.
  'bate-papo'(P, tv) {
    P.ctx.b.floor('wood', 0, 0, P.w, P.h, P.ctx.seed);
    const round = (x: number, y: number, strict = true): boolean => {
      if (strict ? !P.free(x, y + 1, 5, 2) || !P.free(x + 2, y, 1, 4) : !P.free(x + 1, y + 1, 3, 2)) return false;
      if (!P.putAt('meeting_table', x + 1, y + 1, 'kv-round-table', { order: 0.4 })) return false;
      rug(P, x - 0.3, y - 0.3, 5.6, 4.6, kvShade(P.ctx.theme.carpet, 0.15));
      P.seat('stool', 'cafe_chair', x + 2, y, 'down', 'down', { order: 0.6 });
      P.seat('stool', 'cafe_chair', x + 2, y + 3, 'up', 'up', { order: 0.62 });
      P.seat('stool', 'cafe_chair', x, y + 1, 'right', 'right', { order: 0.6 });
      P.seat('stool', 'cafe_chair', x + 4, y + 1, 'left', 'left', { order: 0.6 });
      return true;
    };
    let main = false;
    for (const [x, y] of P.around(P.x0 + Math.max(0, Math.floor((P.iw - 10) / 2)), P.cy - 1, 5)) if (round(x, y)) {
      main = true;
      break;
    }
    if (!main) for (const [x, y] of P.around(P.cx - 2, P.cy - 1, 6)) if (round(x, y)) {
      main = true;
      break;
    }
    if (!main) for (const [x, y] of P.around(P.cx - 2, P.cy - 1, Math.max(P.iw, P.ih))) if (round(x, y, false)) break;
    const tvx = tv ? Math.round(wallCol(P, tv)) - 3 : P.x1 - 4;
    for (const [x, y] of P.around(tvx, P.y0 + 1, 4)) if (sofaCorner(P, x, y, kvShade(P.ctx.theme.carpet2, 0.1))) break;
    P.put('bookshelf', P.south(2, 1, P.x1 - 1).concat(P.west(1, P.y1)), 'kv-coffee-bar', { order: 0.3 });
    plants(P, 3);
    groups(P, 5, 4, (x, y, i) => (i % 3 === 2 ? nook(P, x, y + 1, kvShade(P.ctx.theme.carpet2, 0.2)) : round(x, y)), 0.2);
    P.put('floor_lamp', P.corners(), undefined, { order: 0.3 });
    return ['window', 'painting', 'clock'];
  },

  // Reunião: mesa grande (até 4 peças) com banquetas, telão; sala grande ganha outras mesas menores.
  reuniao(P) {
    const t = bestTable(P, Math.max(1, Math.min(4, Math.floor((P.iw - 4) / 3))), P.cy - (P.ih >= 7 ? 0 : 1), { top: 'stool', bottom: 'stool', ends: 'stool', every: 1, ends2: true });
    if (t) rug(P, t.x - 1.5, t.y - 1.5, t.n * 3 + 3, 5, P.ctx.theme.carpet);
    P.put('water_cooler', P.east(1, 1, P.y0).concat(P.west(1, P.y1)), undefined, { order: 0.3 });
    P.put('floor_lamp', P.east(1, 1, P.y1), undefined, { order: 0.3 });
    plants(P);
    groups(P, 5, 4, (x, y) => table(P, x + 1, y + 1, 1, { top: 'stool', bottom: 'stool', ends: 'stool', every: 1 }) > 0, 0.22);
    return ['window', 'clock'];
  },

  // Conselho: mesa longa de nogueira com cadeiras executivas (uma sim, uma não) e uma poltrona em cada ponta, telão,
  // aparador com café, estantes e plantas; em sala grande, cantinhos de poltronas.
  conselho(P) {
    P.ctx.b.floor('wood', 0, 0, P.w, P.h, P.ctx.seed, '#a98466', '#9c7a5e');
    const max = Math.max(1, Math.min(6, Math.floor((P.iw - 6) / 3)));
    const t = bestTable(P, max, P.cy - (P.ih >= 8 ? 0 : 1), { variant: 'kv-board-table', top: 'office_chair_front', bottom: 'office_chair', topV: 'black', botV: 'black', ends: 'armchair', every: 2 });
    if (t) rug(P, t.x - 2, t.y - 1.6, t.n * 3 + 4, 5.2, '#5e3b3b');
    P.put('bookshelf', P.east(2, 1, P.y1).concat(P.south(2, 1, P.x1 - 1)).concat(P.west(1, P.y1)), 'kv-coffee-bar', { order: 0.3 });
    for (const near of [P.x0, P.x1 - 1]) P.put('bookshelf', P.south(2, 1, near).slice(0, 3), undefined, { order: 0.3 });
    plants(P, 4);
    groups(P, 4, 1, (x, y) => nook(P, x, y, '#7a4b4b'), 0.1);
    P.put('floor_lamp', P.corners(), undefined, { order: 0.3 });
    return ['painting', 'window', 'painting', 'clock'];
  },

  // Treinamento: tela de projeção e quadro na parede norte, púlpito e mesa do instrutor na frente, fileiras de mesas
  // (dois lugares cada) de frente para a tela, com corredores; quanto maior a sala, mais fileiras e blocos.
  treinamento(P, scr) {
    P.ctx.b.floor('carpet', 0, 0, P.w, P.h, P.ctx.seed, kvShade(P.ctx.theme.carpet, 0.25), kvShade(P.ctx.theme.carpet2, 0.25));
    const sc = scr ? wallCol(P, scr) : P.cx;
    const front = P.ih >= 9 ? 3 : 1;
    // instrutor: púlpito ao lado da tela e a mesa dele (de frente para a turma) do outro lado
    P.put('filing_cabinet', P.north(1, Math.round(sc + 3)).concat(P.north(1, Math.round(sc - 4))), 'kv-podium', { order: 0.4 });
    if (front >= 3) {
      for (const x of [P.x1 - 2, P.x0 + 1, P.cx - 4, P.cx + 3]) {
        if (!P.free(x, P.y0, 2, 2)) continue;
        const desk = P.putAt('desk_back', x, P.y0 + 1, P.ctx.theme.deskVariant, { order: 0.4, seat: 'N0' });
        if (!desk) continue;
        P.seat('desk', 'office_chair_front', x, P.y0, 'down', P.ctx.theme.chairVariant, { dx: TILE / 2, deskId: desk, side: 'N', order: 0.38 });
        break;
      }
    }
    // blocos de mesas separados por corredores de 2; corredores de 1 nas paredes
    const span = P.iw - 2;
    let nb = Math.max(2, Math.ceil((span + 2) / 10));
    let bw = 0;
    for (; nb >= 1; nb--) {
      bw = Math.floor((span - 2 * (nb - 1)) / nb / 2) * 2;
      if (bw >= 2) break;
    }
    nb = Math.max(1, nb);
    const total = nb * bw + 2 * (nb - 1);
    const bx0 = P.x0 + 1 + Math.floor((span - total) / 2);
    // a primeira linha que der (a porta no norte pode tomar a frente da sala pequena)
    for (let off = 0, placed = 0; off < 3 && !placed; off++) {
      for (let y = P.y0 + front + off; y + 2 <= P.y1; y += 3) {
        let row = 0;
        for (let k = 0; k < nb; k++) {
          const bx = bx0 + k * (bw + 2);
          for (let j = 0; j + 2 <= bw; j += 2) {
            if (!P.free(bx + j, y, 2, 2)) continue;
            if (!P.putAt('coffee_table', bx + j, y, 'kv-train-desk', { order: 0.4 })) continue;
            P.seat('stool', 'stool', bx + j, y + 1, 'up', undefined, { order: 0.6 });
            P.seat('stool', 'stool', bx + j + 1, y + 1, 'up', undefined, { order: 0.61 });
            row++;
          }
        }
        if (row) rug(P, bx0 - 0.5, y - 0.3, total + 1, 2.6, kvShade(P.ctx.theme.carpet2, 0.1));
        placed += row;
      }
    }
    P.put('water_cooler', P.south(1, 1, P.x0).concat(P.south(1, 1, P.x1)), undefined, { order: 0.3 });
    plants(P, 2);
    return ['window', 'clock', 'window'];
  },

  // Criativa: roda de puffs num tapete colorido, mesa alta com banquetas, sofá, flip charts, mural de post-its e mais
  // quadro branco; sala grande repete os grupos.
  criativa(P) {
    P.ctx.b.floor('wood', 0, 0, P.w, P.h, P.ctx.seed, '#e6cfa8', '#dcc39a');
    if (P.iw >= 16) P.wall('whiteboard', 3, undefined, { near: P.x1 - 4, order: 0.6 });
    if (P.iw >= 20) P.wall('shelf_wall', 3, 'kv-postit-wall', { near: P.x1 - 2, order: 0.55 });
    const circle = (x: number, y: number, i: number): boolean => {
      if (!P.free(x, y, 4, 3)) return false;
      if (!P.putAt('coffee_table', x + 1, y + 1, undefined, { order: 0.45 })) return false;
      rug(P, x - 0.3, y - 0.3, 4.6, 3.6, RUGS[i % RUGS.length]!);
      P.seat('nook', 'beanbag', x + 1, y, 'down', BEANBAGS[i % 4], { order: 0.6 });
      P.seat('nook', 'beanbag', x + 2, y, 'down', BEANBAGS[(i + 1) % 4], { order: 0.6 });
      P.seat('nook', 'beanbag', x + 1, y + 2, 'up', BEANBAGS[(i + 2) % 4], { order: 0.62 });
      P.seat('nook', 'beanbag', x + 2, y + 2, 'up', BEANBAGS[(i + 3) % 4], { order: 0.62 });
      return true;
    };
    const high = (x: number, y: number, i: number): boolean => {
      if (!P.free(x + 1, y, 2, 3)) return false;
      if (!P.putAt('coffee_table', x + 1, y + 1, 'kv-high-table', { order: 0.45 })) return false;
      rug(P, x + 0.2, y - 0.2, 3.6, 3.4, RUGS[(i + 3) % RUGS.length]!);
      P.seat('stool', 'stool', x + 1, y, 'down', undefined, { order: 0.6 });
      P.seat('stool', 'stool', x + 2, y, 'down', undefined, { order: 0.6 });
      P.seat('stool', 'stool', x + 1, y + 2, 'up', undefined, { order: 0.62 });
      P.seat('stool', 'stool', x + 2, y + 2, 'up', undefined, { order: 0.62 });
      return true;
    };
    for (const [x, y] of P.around(P.x0 + 1, P.cy - 1, 4)) if (circle(x, y, 0)) break;
    for (const [x, y] of P.around(P.x1 - 3, P.cy - 1, 4)) if (high(x, y, 1)) break;
    // flip chart no meio (encostado no norte cobriria o quadro, o painel ou o mural da parede)
    P.put('filing_cabinet', P.around(P.cx, P.cy, 5).filter(([, y]) => y > P.y0), 'kv-flipchart', { order: 0.4 });
    P.put('filing_cabinet', P.east(1, 1, P.y1 - 1).concat(P.west(1, P.y1 - 1)), 'kv-flipchart', { order: 0.41 });
    // sofá encostado no sul, olhando para dentro da sala
    for (const [x, y] of P.south(3, 1, P.cx - 1).slice(0, 8)) if (P.seat('nook', 'sofa', x, y, 'up', 'up', { dx: TILE, order: 0.55 })) break;
    for (const [x, y] of P.corners()) if (P.seat('nook', 'beanbag', x, y, y === P.y0 ? 'down' : 'up', pick(P, BEANBAGS), { order: 0.6 })) break;
    plants(P, 3);
    groups(P, 4, 3, (x, y, i) => (i % 3 === 1 ? high(x, y, i) : i % 3 === 2 ? !!P.putAt('filing_cabinet', x + 1, y + 1, 'kv-flipchart', { order: 0.4 }) : circle(x, y, i + 1)), 0.17);
    P.put('floor_lamp', P.corners(), undefined, { order: 0.3 });
    return ['painting', 'window'];
  },
};

/**
 * Mobilia a sala de reunião `layout` (para o furnisher das salas próprias e para os testes). Devolve o planejador, para
 * quem chama pôr a decoração do dono sem fechar caminho.
 */
export function kvFurnishMeet(ctx: KvFurnishCtx, layout: KvMeetLayout): KvPlacer {
  // o lugar do quadro branco precisa do deslocamento de meio tile (como nas salas de sempre): o planejador só passa o
  // furnitureId, então o ctx dele completa o resto quando pedido
  const spotExtra: { v?: SpotOpts } = {};
  const c2: KvFurnishCtx = { ...ctx, spot: (kind, lx, ly, dir: Dir, o) => ctx.spot(kind, lx, ly, dir, { ...o, ...spotExtra.v }) };
  const P = new KvPlacer(c2);
  const L = KV_MEET_LAYOUTS.includes(layout) ? layout : 'reuniao';
  const screen = walls(P, spotExtra, L);
  const deco = LAYOUTS[L](P, screen);
  mural(P);
  if (deco) wallDecor(P, deco);
  ensureSeats(P);
  return P;
}

/** Quantos lugares sentados a sala tem (para os testes e a capacidade sugerida). */
export function kvMeetSeats(area: { spots: readonly { seated?: boolean }[] }): number {
  return area.spots.filter((s) => s.seated).length;
}

