// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): a mobília das salas temáticas, de qualquer tamanho a
// partir de 8x8. Cada sala tem identidade (piso, tapete, cores, plantas) e os itens interativos marcados com a ação
// "ir e fazer" (`ctx.tag`). Puro (sem DOM). O motor do prédio (frente A) monta a casca (piso, paredes, portas, placa,
// interruptor) e chama `kvFurnisher('tema:<chave>')`; importar este arquivo registra as 12.
//
// Ordem em cada sala: primeiro os itens de parede com ação, depois os móveis com ação (o planejador reserva o tile de
// uso de cada um e recusa móvel que feche o caminho da porta), por fim os assentos e a decoração (o que couber).
import { FURNITURE, type Dir, type FurnitureKind } from '../../art/api';
import { TILE } from '../../world/constants';
import type { SpotKind } from '../../world/layout/types';
import { KV_THEME_KEYS, type KvThemeKey } from '../../../../shared/kaviski-plan';
import { kvRegisterFurnisher, type KvFurnishCtx } from './api';
import { KvPlacer, type Cand } from './themes-place';

const PLANTS_TALL = ['palm', 'ficus', 'monstera', 'bonsai'] as const;
const PLANTS_SMALL = ['fern', 'succulent', 'flower'] as const;

function pick<T>(ctx: KvFurnishCtx, arr: readonly T[]): T {
  return arr[Math.floor(ctx.rng() * arr.length) % arr.length]!;
}

/** Piso da sala inteira (por cima do piso da casca) e um tapete. */
function floor(P: KvPlacer, kind: 'carpet' | 'wood' | 'marble' | 'tile_check' | 'tile_white' | 'concrete', tint?: string, tint2?: string): void {
  P.ctx.b.floor(kind, 0, 0, P.w, P.h, P.ctx.seed, tint, tint2);
}

function rug(P: KvPlacer, x: number, y: number, w: number, h: number, color: string): void {
  if (w >= 2 && h >= 1) P.ctx.b.rug(x, y, w, h, color, P.ctx.seed + 7);
}

/** Plantas nos cantos livres e, em sala grande, mais algumas encostadas nas paredes. */
function plants(P: KvPlacer, n = 4): void {
  const { ctx } = P;
  let put = 0;
  for (const c of P.corners()) {
    if (put >= n) break;
    const tall = ctx.rng() < 0.6;
    if (P.putAt(tall ? 'plant_tall' : 'plant_small', c[0], c[1], tall ? pick(ctx, PLANTS_TALL) : pick(ctx, PLANTS_SMALL), { order: 0.2 })) put++;
  }
}

/** Mesa de trabalho com cadeira (o monitor mostra o que faz quem senta). */
function deskWithChair(P: KvPlacer, x: number, y: number, variant = 'white', chair = 'gray'): boolean {
  if (!P.free(x, y, 2, 1) || !P.free(x, y + 1)) return false;
  const desk = P.putAt('desk', x, y, variant, { order: 0.4, seat: `S${x}` });
  if (!desk) return false;
  P.seat('desk', 'office_chair', x, y + 1, 'up', chair, { dx: TILE / 2, deskId: desk, side: 'S', order: 0.6 });
  return true;
}

/** Duas poltronas de frente uma para a outra com a mesinha de centro (cantinho de espera/conversa). */
function nook(P: KvPlacer, near: Cand, color?: string): boolean {
  for (const [x, y] of P.around(near[0], near[1], 6)) {
    if (!P.free(x, y, 4, 1)) continue;
    if (!P.putAt('coffee_table', x + 1, y, undefined, { order: 0.45 })) continue;
    P.seat('nook', 'armchair', x, y, 'right', 'right', { order: 0.6 });
    P.seat('nook', 'armchair', x + 3, y, 'left', 'left', { order: 0.61 });
    if (color) rug(P, x - 0.25, y - 0.5, 4.5, 2, color);
    return true;
  }
  return false;
}

/** Fileira de assentos de frente para a parede norte (auditório, espera), com um corredor no meio. */
function rows(P: KvPlacer, y0: number, y1: number, aisle: number[], kind: 'stool' | 'armchair' = 'stool'): void {
  for (let y = y0; y <= y1; y += 2) {
    for (let x = P.x0 + 1; x <= P.x1 - 1; x++) {
      if (aisle.includes(x)) continue;
      if (kind === 'stool') P.seat('stool', 'stool', x, y, 'up', undefined, { order: 0.6 });
      else P.seat('nook', 'armchair', x, y, 'up', 'up', { order: 0.6 });
    }
  }
}

/** Item de parede com ação; sem lugar na parede, o cavalete de chão faz o papel dele. */
function wallOr(P: KvPlacer, tries: [kind: 'shelf_wall' | 'tv' | 'clock' | 'mirror', n: number, variant: string | undefined][], use: string, easel: string, near?: number): void {
  for (const [kind, n, variant] of tries) if (P.wall(kind, n, variant, { near, use })) return;
  P.put('filing_cabinet', P.north(1, near !== undefined ? Math.floor(near) : P.x0).concat(P.around(P.cx, P.cy, 6)), easel, { use, order: 0.35 });
}

interface Filler {
  kind: FurnitureKind;
  variant?: string;
  /** Assento (tipo de lugar e para onde olha). */
  seat?: { spot: SpotKind; dir?: Dir };
  use?: string;
}

/** Quanto do miolo está ocupado por móveis (0..1). */
function density(P: KvPlacer): number {
  let n = 0;
  for (const f of P.ctx.b.area.furniture) {
    const d = FURNITURE[f.kind].footprint;
    n += d.w * d.h;
  }
  return n / (P.iw * P.ih);
}

/**
 * Enche as paredes (norte, sul, oeste, leste) com móveis do tema, espaçados, até a densidade pedida — salas grandes
 * ficam cheias de vida e as pequenas não ficam entupidas. Cada móvel passa pelo planejador (caminho livre).
 */
function fill(P: KvPlacer, items: readonly Filler[], target = 0.17): void {
  if (!items.length) return;
  const cands: Cand[] = [];
  for (let x = P.x0 + 1; x <= P.x1 - 1; x += 4) cands.push([x, P.y0], [x + 2, P.y1]);
  for (let y = P.y0 + 2; y <= P.y1 - 2; y += 4) cands.push([P.x0, y], [P.x1, y + 1]);
  cands.forEach((c, k) => {
    // espalha: a ordem das tentativas pula pela sala (não enche uma parede inteira primeiro)
    const j = Math.floor(P.ctx.rng() * (k + 1));
    [cands[k], cands[j]] = [cands[j]!, c];
  });
  let i = 0;
  for (const [x, y] of cands) {
    if (density(P) >= target) break;
    const it = items[i++ % items.length]!;
    const d = FURNITURE[it.kind].footprint;
    const fx = Math.min(x, P.x1 - d.w + 1);
    const fy = Math.min(y, P.y1 - d.h + 1);
    if (it.seat) {
      const dir: Dir = it.seat.dir ?? (fx === P.x0 ? 'right' : fx + d.w - 1 === P.x1 ? 'left' : fy === P.y0 ? 'down' : 'up');
      const variant = it.variant ?? (it.kind === 'armchair' || it.kind === 'cafe_chair' ? dir : it.kind === 'sofa' ? (dir === 'up' ? 'up' : 'down') : undefined);
      P.seat(it.seat.spot, it.kind, fx, fy, dir, variant, { order: 0.6 });
    } else P.putAt(it.kind, fx, fy, it.variant, { use: it.use, order: 0.3 });
  }
}

/**
 * Sala grande: grupos (ilha de mesas, cantinho de poltronas, mesa de reunião...) numa grade pelo miolo, longe das
 * paredes, até a densidade pedida. `group(x, y)` tenta montar um grupo com o canto em (x, y).
 */
function groups(P: KvPlacer, cellW: number, cellH: number, group: (x: number, y: number) => boolean, target = 0.2): void {
  if (P.iw < cellW + 4 || P.ih < cellH + 3) return;
  for (let y = P.y0 + 2; y + cellH - 1 <= P.y1 - 1; y += cellH) {
    for (let x = P.x0 + 2; x + cellW - 1 <= P.x1 - 1; x += cellW) {
      if (density(P) >= target) return;
      if (P.free(x, y, cellW - 1, cellH - 1)) group(x, y);
    }
  }
}

/** Mesa de reunião com banquetas em volta (3x2 + uma volta). */
function meetingGroup(P: KvPlacer, x: number, y: number): boolean {
  if (!P.putAt('meeting_table', x + 1, y + 1, undefined, { order: 0.4 })) return false;
  for (let i = 0; i < 3; i++) {
    P.seat('stool', 'stool', x + 1 + i, y, 'down', undefined, { order: 0.6 });
    P.seat('stool', 'stool', x + 1 + i, y + 3, 'up', undefined, { order: 0.62 });
  }
  return true;
}

/** Duas mesas lado a lado com as cadeiras (ilha de trabalho). */
function deskPair(P: KvPlacer, x: number, y: number, variant = 'white', chair = 'gray'): boolean {
  const a = deskWithChair(P, x, y, variant, chair);
  const b = deskWithChair(P, x + 2, y, variant, chair);
  return a || b;
}

/** Itens de parede de enfeite nas colunas que sobraram. */
function wallDecor(P: KvPlacer, kinds: ('window' | 'clock' | 'painting' | 'shelf_wall')[]): void {
  for (const k of kinds) {
    const n = k === 'clock' ? 1 : 2;
    if (P.wallLeft() < n + 1) break;
    P.wall(k, n, undefined, { near: P.ctx.rng() * P.w, order: 0.5 });
  }
}

// =================================================================== as salas

const ROOMS: Record<KvThemeKey, (P: KvPlacer) => void> = {
  // RH: balcão com a ficha (Pessoas), organograma na parede, arquivo (Registro), mesa de convites, cadeiras de espera.
  rh(P) {
    floor(P, 'carpet', '#f2cdb0', '#ebc1a1');
    wallOr(P, [['shelf_wall', 3, 'kv-orgchart'], ['shelf_wall', 2, 'kv-orgchart-small']], 'organograma', 'kv-easel-org', P.x0 + 2.5);
    const desk = P.put('reception_desk', P.north(3, P.cx - 1, P.y0 + 1).concat(P.around(P.cx - 1, P.cy, 4)), 'kv-hr-desk', { use: 'pessoas', order: 0.4 });
    if (desk) {
      // atrás do balcão, a cadeira de quem atende (só se sobrar a linha de trás)
      const f = P.ctx.b.area.furniture.find((x) => x.id === desk);
      if (f) P.seat('stool', 'office_chair_front', f.tx - P.ctx.rect.x + 1, f.ty - P.ctx.rect.y - 1, 'down', 'red', { order: 0.38 });
    }
    P.put('filing_cabinet', P.north(1, P.x1).concat(P.east(1, 1, P.y0)), 'kv-archive', { use: 'registro', order: 0.3 });
    P.put('coffee_table', P.west(1, P.cy).concat(P.east(2, 1, P.cy)).concat(P.south(2, 1, P.x0)), 'kv-invite-desk', { use: 'convites', order: 0.45 });
    // espera: poltronas na parede leste olhando para o balcão
    for (let y = P.cy; y <= P.y1; y++) P.seat('nook', 'armchair', P.x1, y, 'left', 'left', { order: 0.62 });
    P.put('water_cooler', P.south(1, 1, P.x0 + 1), undefined, { order: 0.3 });
    rug(P, P.cx - 2, P.cy, 5, 2, '#f08a3c');
    plants(P);
    groups(P, 7, 4, (x, y) => nook(P, [x, y], '#f7ad6b'), 0.16);
    fill(P, [{ kind: 'binder_shelf' }, { kind: 'plant_small', variant: 'flower' }, { kind: 'armchair', seat: { spot: 'nook' } }, { kind: 'floor_lamp' }, { kind: 'filing_cabinet' }]);
    wallDecor(P, ['clock', 'painting', 'window']);
  },

  // Diretoria: organograma grande, mesa da diretoria, a luneta (visão geral), estante e o canto das poltronas.
  diretoria(P) {
    floor(P, 'wood');
    wallOr(P, [['shelf_wall', 4, 'kv-orgchart-big'], ['shelf_wall', 3, 'kv-orgchart'], ['shelf_wall', 2, 'kv-orgchart-small']], 'organograma', 'kv-easel-org');
    P.put('filing_cabinet', P.corners().slice(1, 2).concat(P.east(1, 1, P.y0)).concat(P.corners()), 'kv-telescope', { use: 'visao', order: 0.3 });
    rug(P, P.cx - 3, P.cy - 1, 7, 4, '#5e467f');
    for (const [x, y] of P.around(P.cx - 1, P.cy, 3)) if (deskWithChair(P, x, y, 'dark', 'black')) break;
    P.put('bookshelf', P.north(2, P.x0), undefined, { order: 0.3 });
    nook(P, [P.x0, P.y1 - 1], '#8d66cf');
    plants(P);
    groups(P, 7, 4, (x, y) => nook(P, [x, y], '#8d66cf'), 0.15);
    fill(P, [{ kind: 'bookshelf' }, { kind: 'floor_lamp' }, { kind: 'plant_tall', variant: 'ficus' }, { kind: 'armchair', seat: { spot: 'nook' } }]);
    wallDecor(P, ['window', 'painting', 'window', 'clock']);
  },

  // Reunião: telão e o calendário (agenda) na parede, mesa grande com banquetas em volta.
  reuniao(P) {
    floor(P, 'carpet', '#c9daf2', '#bccfee');
    wallOr(P, [['shelf_wall', 2, 'kv-calendar']], 'agenda', 'kv-easel-cal', P.x0 + 1.5);
    P.wall('tv', 3, 'kv-bigtv', { near: P.w / 2 + 1 });
    const n = Math.max(1, Math.min(3, Math.floor((P.iw - 4) / 3)));
    const tw = n * 3;
    const tx = P.cx - Math.floor(tw / 2) + 1;
    const ty = P.cy - (P.ih >= 7 ? 0 : 1);
    rug(P, tx - 1.5, ty - 1.5, tw + 3, 5, '#3f7fd8');
    let tables = 0;
    for (let i = 0; i < n; i++) if (P.putAt('meeting_table', tx + i * 3, ty, undefined, { order: 0.4 + i * 0.01 })) tables++;
    if (tables) {
      for (let x = tx; x < tx + tw; x++) {
        P.seat('stool', 'stool', x, ty - 1, 'down', undefined, { order: 0.6 });
        P.seat('stool', 'stool', x, ty + 2, 'up', undefined, { order: 0.62 });
      }
      for (const y of [ty, ty + 1]) {
        P.seat('stool', 'stool', tx - 1, y, 'right', undefined, { order: 0.6 });
        P.seat('stool', 'stool', tx + tw, y, 'left', undefined, { order: 0.6 });
      }
    }
    P.put('water_cooler', P.east(1, 1, P.y0), undefined, { order: 0.3 });
    plants(P);
    groups(P, 7, 6, (x, y) => meetingGroup(P, x, y), 0.25);
    fill(P, [{ kind: 'plant_tall', variant: 'monstera' }, { kind: 'floor_lamp' }, { kind: 'water_cooler' }], 0.27);
    wallDecor(P, ['window', 'clock']);
  },

  // Recepção: balcão de convites, quadro de presença, mapa do prédio, totem de informações e a espera.
  recepcao(P) {
    floor(P, 'marble');
    P.wall('shelf_wall', 3, 'kv-map', { near: P.x0 + 2.5, use: 'mapa' });
    P.wall('shelf_wall', 2, 'kv-presence', { near: P.x1 - 1, use: 'presenca' });
    P.put('reception_desk', P.north(3, P.cx - 1, P.y0 + 1).concat(P.around(P.cx - 1, P.cy, 4)), undefined, { use: 'convites', order: 0.4 });
    P.put('filing_cabinet', P.east(1, 1, P.cy).concat(P.west(1, P.cy)).concat(P.around(P.cx, P.y1, 4)), 'kv-info', { use: 'ajuda', order: 0.35 });
    nook(P, [P.x0, P.y1 - 1], '#e0b030');
    for (let x = P.x1 - 1; x >= P.cx + 2; x -= 3) if (P.seat('bench', 'bench', x - 1, P.y1, 'down', undefined, { order: 0.6 })) break;
    rug(P, P.cx - 2, P.cy + 1, 5, 2, '#c9922e');
    plants(P);
    groups(P, 7, 4, (x, y) => nook(P, [x, y], '#e0b030'), 0.15);
    fill(P, [{ kind: 'bench', seat: { spot: 'bench', dir: 'down' } }, { kind: 'plant_tall', variant: 'palm' }, { kind: 'floor_lamp' }, { kind: 'water_cooler' }]);
    wallDecor(P, ['clock', 'window', 'painting']);
  },

  // Provador: espelhos de camarim (Meu avatar), espelho de corpo inteiro, arara de roupas e um puff.
  provador(P) {
    floor(P, 'carpet', '#f5cde0', '#efc0d6');
    P.wall('mirror', 1, 'kv-vanity', { near: P.cx, use: 'boneco' });
    P.wall('mirror', 1, 'kv-vanity', { near: P.cx - 3, use: 'boneco' });
    if (P.iw >= 10) P.wall('mirror', 1, 'kv-vanity', { near: P.cx + 3, use: 'boneco' });
    P.put('filing_cabinet', P.east(1, 1, P.cy).concat(P.west(1, P.cy)), 'kv-stand-mirror', { use: 'boneco', order: 0.35 });
    P.put('bookshelf', P.south(2, 1, P.x0).concat(P.west(1, P.y1)), 'kv-clothes', { order: 0.3 });
    P.seat('nook', 'beanbag', P.x1 - 1, P.y1, 'up', 'red', { order: 0.6 }) ?? P.seat('nook', 'beanbag', P.x1, P.y1 - 1, 'up', 'red');
    rug(P, P.cx - 2, P.cy, 5, 2, '#e47aa8');
    plants(P, 2);
    groups(P, 7, 4, (x, y) => nook(P, [x, y], '#f2a3c4'), 0.12);
    fill(P, [{ kind: 'bookshelf', variant: 'kv-clothes' }, { kind: 'beanbag', variant: 'red', seat: { spot: 'nook', dir: 'up' } }, { kind: 'filing_cabinet', variant: 'kv-stand-mirror', use: 'boneco' }, { kind: 'plant_small', variant: 'flower' }, { kind: 'floor_lamp' }], 0.15);
    wallDecor(P, ['painting', 'clock']);
  },

  // Foco: o relógio do pomodoro e cabines de mesa separadas por vidro.
  foco(P) {
    floor(P, 'carpet', '#cde8c9', '#c0e0bb');
    P.put('filing_cabinet', P.around(P.cx, P.y1 - 1, 5), 'kv-timer', { use: 'foco', order: 0.35 });
    const cab = (y: number) => {
      for (let x = P.x0; x + 1 <= P.x1; x += 3) {
        if (!deskWithChair(P, x, y)) continue;
        if (x + 2 <= P.x1) {
          P.putAt('glass_partition', x + 2, y, 'v', { order: 0.45 });
          P.putAt('glass_partition', x + 2, y + 1, 'v', { order: 0.46 });
        }
      }
    };
    cab(P.y0);
    if (P.ih >= 8) cab(P.y1 - 2);
    P.put('floor_lamp', P.corners(), undefined, { order: 0.2 });
    plants(P, 3);
    groups(P, 6, 4, (x, y) => deskPair(P, x, y) && !!P.putAt('glass_partition', x + 4, y, 'v', { order: 0.45 }), 0.3);
    fill(P, [{ kind: 'plant_small', variant: 'fern' }, { kind: 'binder_shelf' }, { kind: 'floor_lamp' }]);
    wallDecor(P, ['window', 'clock', 'window']);
  },

  // Auditório: palco com o púlpito (palco/megafone), telão atrás e fileiras de banquetas com corredor.
  auditorio(P) {
    floor(P, 'wood');
    const stageH = Math.min(3, Math.max(2, Math.floor(P.ih / 3)));
    rug(P, P.x0, P.y0, P.iw, stageH, '#8e3a3a');
    P.wall('tv', 3, 'kv-bigtv');
    P.put('filing_cabinet', [[P.cx, P.y0 + 1], [P.cx, P.y0], ...P.around(P.cx, P.y0 + 1, 3)], 'kv-podium', { use: 'palco', order: 0.4 });
    P.putAt('plant_tall', P.x0, P.y0, pick(P.ctx, PLANTS_TALL), { order: 0.2 });
    P.putAt('plant_tall', P.x1, P.y0, pick(P.ctx, PLANTS_TALL), { order: 0.21 });
    rows(P, P.y0 + stageH + 1, P.y1 - 1, [P.cx, P.cx + 1]);
    rug(P, P.cx, P.y0 + stageH, 2, P.y1 - P.y0 - stageH + 1, '#c94b4b');
    P.put('floor_lamp', P.corners().slice(2), undefined, { order: 0.2 });
    fill(P, [{ kind: 'plant_tall', variant: 'ficus' }, { kind: 'floor_lamp' }], 0.25);
    wallDecor(P, ['window', 'window']);
  },

  // Central dos agentes: terminal (novo agente), TV do timelapse, painel do meu dia, estante do histórico, impressora
  // do feed e mesas.
  agentes(P) {
    floor(P, 'carpet', '#c4e6e5', '#b5dedd');
    P.wall('tv', 3, 'kv-bigtv', { near: P.w / 2 + 2, use: 'timelapse' });
    wallOr(P, [['shelf_wall', 3, 'kv-chart']], 'meu-dia', 'kv-easel-chart', P.x0 + 2);
    P.put('filing_cabinet', P.around(P.cx, P.cy, 5), 'kv-terminal', { use: 'novo-agente', order: 0.4 });
    if (P.iw >= 12) P.put('filing_cabinet', P.around(P.cx + 3, P.cy, 4), 'kv-terminal', { use: 'novo-agente', order: 0.41 });
    P.put('bookshelf', P.north(2, P.x1 - 1).concat(P.west(1, P.y0)), undefined, { use: 'historico', order: 0.3 });
    P.put('printer', P.east(1, 1, P.y1).concat(P.west(1, P.y1)), undefined, { use: 'feed', order: 0.3 });
    for (let x = P.x0; x + 1 <= P.x1 - 1; x += 4) deskWithChair(P, x, P.y1 - 1, 'white', 'blue');
    rug(P, P.cx - 2, P.cy - 1, 5, 3, '#2fb3b0');
    plants(P);
    groups(P, 6, 4, (x, y) => deskPair(P, x, y, 'white', 'blue'), 0.24);
    fill(P, [{ kind: 'binder_shelf' }, { kind: 'plant_small' }, { kind: 'printer' }, { kind: 'plant_tall', variant: 'monstera' }]);
  },

  // TI: sino dos avisos, pôster das teclas (atalhos), engrenagem ("ir andando até o lugar"), bancada de voz e vídeo e o
  // rack das configurações.
  ti(P) {
    floor(P, 'carpet', '#d0d6e4', '#c4cbdd');
    P.wall('clock', 1, 'kv-bell', { near: P.x0 + 1, use: 'avisos' });
    P.wall('shelf_wall', 2, 'kv-keys', { near: P.cx, use: 'atalhos' });
    P.wall('clock', 1, 'kv-gear', { near: P.x1 - 1, use: 'ir-andando' });
    P.put('coffee_table', P.south(2, 1, P.cx - 1).concat(P.around(P.cx - 1, P.cy + 1, 5)), 'kv-av-desk', { use: 'voz', order: 0.4 });
    P.put('filing_cabinet', P.east(1, 1, P.cy).concat(P.north(1, P.x1)), 'kv-rack', { use: 'config', order: 0.3 });
    P.put('filing_cabinet', P.east(1, 1, P.cy + 1).concat(P.east(1, 1, P.cy - 1)), 'kv-rack', { order: 0.31 });
    P.put('printer', P.west(1, P.y1), undefined, { order: 0.3 });
    deskWithChair(P, P.x0, P.y1 - 1, 'dark', 'black');
    P.wall('shelf_wall', 2, 'kv-av-panel', { near: P.cx - 3 });
    plants(P, 2);
    groups(P, 6, 4, (x, y) => deskPair(P, x, y, 'dark', 'black'), 0.2);
    fill(P, [{ kind: 'filing_cabinet', variant: 'kv-rack' }, { kind: 'binder_shelf' }, { kind: 'printer' }, { kind: 'plant_small', variant: 'succulent' }], 0.24);
  },

  // Arquitetura: a maquete da empresa (editar a planta), a prancheta (salas), a planta emoldurada e estantes.
  arquitetura(P) {
    floor(P, 'carpet', '#cfe3f5', '#c2daf1');
    P.wall('shelf_wall', 2, 'kv-blueprint', { near: P.cx, use: 'planta' });
    P.put('meeting_table', P.around(P.cx - 1, P.cy, 4), 'kv-model', { use: 'planta', order: 0.4 });
    P.put('coffee_table', P.west(1, P.cy).concat(P.east(2, 1, P.cy)).concat(P.around(P.x0 + 1, P.y1, 4)), 'kv-drafting', { use: 'salas', order: 0.4 });
    P.put('binder_shelf', P.north(1, P.x1), undefined, { order: 0.3 });
    P.put('binder_shelf', P.north(1, P.x1 - 1), undefined, { order: 0.31 });
    for (const [x, y] of P.around(P.cx + 2, P.y1, 3)) if (P.seat('stool', 'stool', x, y, 'up', undefined, { order: 0.6 })) break;
    rug(P, P.cx - 3, P.cy - 1, 6, 4, '#5aa9e6');
    plants(P, 3);
    groups(P, 5, 4, (x, y) => !!P.putAt('coffee_table', x, y, 'kv-drafting', { use: 'salas', order: 0.4 }) && !!P.seat('stool', 'stool', x + 1, y + 1, 'up'), 0.16);
    fill(P, [{ kind: 'binder_shelf' }, { kind: 'plant_tall', variant: 'bonsai' }, { kind: 'bookshelf' }, { kind: 'floor_lamp' }]);
    wallDecor(P, ['window', 'clock']);
  },

  // Correio: caixa de correio e telefone (conversas), escaninho das entregas e um banco.
  correio(P) {
    floor(P, 'carpet', '#f0d2c0', '#e8c5b0');
    P.put('bookshelf', P.north(2, P.cx - 1), 'kv-cubbies', { use: 'entregas', order: 0.3 });
    P.put('filing_cabinet', P.around(P.cx - 2, P.cy + 1, 4), 'kv-mailbox', { use: 'conversas', order: 0.4 });
    P.put('filing_cabinet', P.east(1, 1, P.cy).concat(P.west(1, P.cy)), 'kv-phone', { use: 'conversas', order: 0.35 });
    P.seat('bench', 'bench', P.x0, P.y1, 'down', undefined, { order: 0.6 });
    rug(P, P.cx - 2, P.cy, 5, 2, '#c0603a');
    plants(P, 3);
    groups(P, 6, 4, (x, y) => !!P.putAt('filing_cabinet', x + 1, y, 'kv-mailbox', { use: 'conversas', order: 0.4 }) && !!P.putAt('filing_cabinet', x + 3, y, 'kv-phone', { use: 'conversas', order: 0.41 }), 0.07);
    fill(P, [{ kind: 'bookshelf', variant: 'kv-cubbies', use: 'entregas' }, { kind: 'counter', variant: 'drawers' }, { kind: 'plant_small' }, { kind: 'bench', seat: { spot: 'bench', dir: 'down' } }], 0.2);
    wallDecor(P, ['clock', 'painting', 'window']);
  },

  // Descanso: a rede (modo clássico), fliperama (E: jogar), TV com sofá e poltronas, puffs e a máquina de lanches.
  descanso(P) {
    floor(P, 'wood');
    P.wall('tv', 2, undefined, { near: P.cx + 1 });
    P.put('reception_desk', P.south(3, 1, P.x0).concat(P.around(P.x0 + 1, P.y1 - 1, 4)), 'kv-hammock', { use: 'classico', order: 0.4 });
    const arcade = P.put('arcade', P.north(1, P.x0).concat(P.north(1, P.x1)), undefined, { order: 0.3 });
    if (arcade) {
      const f = P.ctx.b.area.furniture.find((x) => x.id === arcade);
      if (f) P.spot('arcade', f.tx - P.ctx.rect.x, f.ty - P.ctx.rect.y + 1, 'up', { furnitureId: arcade });
    }
    const sx = P.cx;
    const sy = Math.min(P.y1 - 1, P.y0 + 3);
    rug(P, sx - 2, sy - 1, 7, 3, '#7fae2c');
    P.seat('sofa', 'sofa', sx, sy, 'up', 'up', { dx: TILE, order: 0.55 });
    P.seat('armchair', 'armchair', sx - 2, sy - 1, 'right', 'right', { order: 0.56 });
    P.seat('armchair', 'armchair', sx + 4, sy - 1, 'left', 'left', { order: 0.57 });
    for (const [x, y] of [[P.x1, P.y1], [P.x1 - 1, P.y1]] as Cand[]) P.seat('beanbag', 'beanbag', x, y, 'up', pick(P.ctx, ['yellow', 'blue', 'green'] as const), { order: 0.6 });
    P.put('vending_machine', P.north(1, P.x1 - 1), undefined, { order: 0.3 });
    plants(P, 3);
    groups(P, 7, 4, (x, y) => nook(P, [x, y], '#9bc23c'), 0.15);
    fill(P, [{ kind: 'beanbag', seat: { spot: 'beanbag', dir: 'up' } }, { kind: 'plant_tall', variant: 'palm' }, { kind: 'floor_lamp' }, { kind: 'armchair', seat: { spot: 'armchair' } }, { kind: 'bookshelf' }]);
    wallDecor(P, ['window', 'painting']);
  },
};

/** Mobilia a sala temática `key` (para o motor e para os testes). */
export function kvFurnishTheme(key: KvThemeKey, ctx: KvFurnishCtx): KvPlacer {
  const P = new KvPlacer(ctx);
  ROOMS[key](P);
  return P;
}

for (const key of KV_THEME_KEYS) kvRegisterFurnisher(`tema:${key}`, (ctx) => void kvFurnishTheme(key, ctx));

