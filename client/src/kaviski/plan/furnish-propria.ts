// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): mobília padrão das salas próprias (W4) de qualquer tamanho, no
// espírito de humanos/rooms-layout.ts: reunião (mesa grande que cresce com a sala), descanso (sofá e TV, puffs),
// pessoal (mesa de trabalho, estante, cantinho de visitas) e outra (mesas face a face e mesa de reunião). Mais a
// decoração escolhida pelo dono (`kvOwn.decor`) onde couber. Os assentos são só "da sala" (nook, stool, desk): os agentes
// não vêm descansar aqui. Puro (sem DOM).
import { FURNITURE, type FurnitureKind } from '../../art/api';
import type { KvOwnRoomKind } from '../../../../shared/kaviski-rooms';
import { TILE } from '../../world/constants';
import { kvOwnMark } from '../humanos/rooms-layout';
import { kvRegisterFurnisher, type KvFurnishCtx } from './api';
import { BEANBAGS, KvPen, kvEdgeDecor, PLANTS_SMALL, POSTERS } from './furnish-util';

const DECOR_FURN: Record<string, FurnitureKind> = {
  planta: 'plant_small',
  planta_alta: 'plant_tall',
  luminaria: 'floor_lamp',
  estante: 'binder_shelf',
  arquivo: 'filing_cabinet',
  puff: 'beanbag',
  quadro: 'painting',
  poster: 'poster',
  relogio: 'clock',
};

function meetingTable(pen: KvPen): void {
  const { ctx, w, h } = pen;
  // mesas de reunião (3x2) lado a lado, quantas couberem, em uma ou mais fileiras
  const n = Math.max(1, Math.min(6, Math.floor((w - 6) / 3)));
  const x0 = Math.max(2, Math.floor((w - n * 3) / 2));
  for (let y = 4; y + 3 <= h - 3; y += 6) {
    if (!pen.ok(x0 - 1, y - 1, n * 3 + 2, 4)) continue;
    ctx.b.rug(x0 - 1.4, y - 1.4, n * 3 + 2.8, 4.8, ctx.theme.carpet, ctx.seed + y);
    for (let i = 0; i < n; i++) pen.furn('meeting_table', x0 + i * 3, y, undefined, { order: 0.4 + i * 0.01 });
    for (let i = 0; i < n * 3; i++) {
      pen.seat('stool', 'stool', x0 + i, y - 1, 'down', undefined, { order: 0.6 + i * 0.01 });
      pen.seat('stool', 'stool', x0 + i, y + 2, 'up', undefined, { order: 0.66 + i * 0.01 });
    }
    pen.seat('stool', 'stool', x0 - 1, y, 'right');
    pen.seat('stool', 'stool', x0 - 1, y + 1, 'right');
    pen.seat('stool', 'stool', x0 + n * 3, y, 'left');
    pen.seat('stool', 'stool', x0 + n * 3, y + 1, 'left');
    pen.reserve(x0 - 1, y - 1, n * 3 + 2, 4);
    if (h < 16) break;
  }
  pen.furn('water_cooler', w - 2, 4, undefined, { order: 0.3 });
  pen.furn('floor_lamp', w - 2, 6, undefined, { order: 0.3 });
}

function rest(pen: KvPen): void {
  const { ctx, w, h } = pen;
  // grupos de sofá de frente para a TV, um a cada ~9 tiles
  for (let gx = 1; gx + 4 <= w - 2; gx += 9) {
    const tv = pen.wallAt('tv', [gx + 2.5, gx + 3, gx + 2], undefined, { order: 0.6 });
    if (!tv && gx > 1) break;
    if (!pen.ok(gx, 4, 5, 3)) continue;
    ctx.b.rug(gx + 0.5, 3.2, 5, 4.2, ctx.theme.carpet, ctx.seed + gx);
    const sofa = pen.furn('sofa', gx, 6, 'up', { order: 0.5 });
    if (sofa) for (let i = 0; i < 3; i++) ctx.b.seat('nook', 'sofa', gx + i, 6, 'up', 'up', { noFurniture: true, furnitureId: sofa });
    pen.furn('coffee_table', gx, 4, undefined, { dx: TILE / 2, order: 0.45 });
    pen.reserve(gx, 4, 3, 1);
    pen.seat('nook', 'armchair', gx + 3, 4, 'left', 'left');
    pen.reserve(gx, 4, 5, 3);
  }
  // puffs em volta de uma mesinha
  const py = Math.min(h - 3, 8);
  for (let i = 0; i < Math.max(2, Math.floor((w - 6) / 4)); i++) pen.seat('nook', 'beanbag', 2 + i * 2, py, 'up', BEANBAGS[i % BEANBAGS.length], { order: 0.62 });
  pen.furn('cafe_table', Math.max(2, w - 5), 6, undefined, { order: 0.44 });
  pen.furn('binder_shelf', w - 2, 4, undefined, { order: 0.3 });
  pen.furn('floor_lamp', 1, h - 3, undefined, { order: 0.31 });
}

function personal(pen: KvPen): void {
  const { ctx, w, h } = pen;
  const dy = Math.min(6, h - 4);
  ctx.b.rug(1.6, dy - 1.4, 5, 3.6, ctx.theme.carpet, ctx.seed + 2);
  const desk = pen.furn('desk', 3, dy, ctx.theme.deskVariant, { order: 0.4, seat: 'S0' });
  if (desk) pen.seat('desk', 'office_chair', 3, dy + 1, 'up', ctx.theme.chairVariant, { dx: TILE / 2, deskId: desk });
  pen.reserve(3, dy, 2, 2);
  pen.furn('trash_bin', 5, dy, undefined, { order: 0.42 });
  pen.furn('bookshelf', 1, h - 3, undefined, { order: 0.25 });
  pen.furn('binder_shelf', w - 2, 4, undefined, { order: 0.3 });
  pen.furn('binder_shelf', w - 2, 5, undefined, { order: 0.31 });
  // visitas: mesinha com duas poltronas (do lado direito)
  const vx = Math.max(8, w - 6);
  ctx.b.rug(vx - 0.4, dy - 1.3, 4.8, 3.2, ctx.theme.carpet2, ctx.seed + 3);
  pen.furn('cafe_table', vx + 1, dy, undefined, { order: 0.45 });
  pen.seat('nook', 'armchair', vx, dy, 'right', 'right');
  pen.seat('nook', 'armchair', vx + 2, dy, 'left', 'left');
  pen.furn('floor_lamp', 1, dy, undefined, { order: 0.33 });
  pen.spot('stand', vx + 1, dy - 2, 'down');
}

function other(pen: KvPen): void {
  const { ctx, w } = pen;
  ctx.b.rug(1.5, 3.25, 5, 5.5, ctx.theme.carpet, ctx.seed + 2);
  const back = pen.furn('desk_back', 2, 5, ctx.theme.deskVariant, { order: 0.35, seat: 'N0' });
  const front = pen.furn('desk', 2, 6, ctx.theme.deskVariant, { order: 0.4, seat: 'S0' });
  if (back) pen.seat('desk', 'office_chair_front', 2, 4, 'down', ctx.theme.chairVariant, { dx: TILE / 2, deskId: back });
  if (front) pen.seat('desk', 'office_chair', 2, 7, 'up', ctx.theme.chairVariant, { dx: TILE / 2, deskId: front });
  pen.reserve(2, 4, 2, 4);
  const mx = Math.max(6, w - 6);
  if (pen.furn('meeting_table', mx, 5, undefined, { order: 0.45 })) {
    pen.seat('stool', 'stool', mx, 4, 'down');
    pen.seat('stool', 'stool', mx + 2, 4, 'down');
    pen.seat('stool', 'stool', mx, 7, 'up');
    pen.seat('stool', 'stool', mx + 2, 7, 'up');
  }
  pen.furn('printer', w - 2, 8, undefined, { order: 0.32 });
  pen.spot('stand', 5, 4, 'down');
}

export function kvFurnishOwn(ctx: KvFurnishCtx, kind: KvOwnRoomKind): void {
  const pen = new KvPen(ctx);
  const { w, h } = pen;
  // parede: quadro branco (ou TV no descanso) e o lugar do mural (pôster)
  if (kind !== 'descanso') {
    const board = pen.wallAt('whiteboard', pen.centers(2.5, 1.5), undefined, { order: 0.6 });
    if (board) pen.spot('whiteboard', Math.floor(board.lcx - 0.5), 2, 'up', { dx: 8, dy: 2 });
  }
  pen.wallAt('poster', pen.centers(w - 3.4, 0.5), pen.pick(POSTERS), { order: 0.5 });
  if (kind === 'reuniao') meetingTable(pen);
  else if (kind === 'descanso') rest(pen);
  else if (kind === 'pessoal') personal(pen);
  else other(pen);
  pen.plant(w - 2, h - 3, true);
  pen.plant(1, 2, false);

  // a decoração do dono (pensada para a sala 16x12): entra onde estiver livre
  const decor = kvOwnMark(ctx.info)?.decor ?? [];
  decor.forEach((d, i) => {
    if (d.kind === 'tapete') {
      if (d.w && d.h && d.color && d.x + d.w <= w && d.y + d.h <= h) ctx.b.rug(d.x, d.y, d.w, d.h, d.color, ctx.seed + 10 + i);
      return;
    }
    const fk = DECOR_FURN[d.kind];
    if (!fk) return;
    if (FURNITURE[fk].mount === 'wall') {
      ctx.wall(fk, d.x, d.variant, { order: 0.5 });
      return;
    }
    if (fk === 'beanbag') pen.seat('nook', 'beanbag', d.x, d.y, 'down', d.variant, { order: 0.6 });
    else pen.furn(fk, d.x, d.y, d.variant, { order: 0.5 });
  });
  if (w * h > 16 * 12 * 1.5) kvEdgeDecor(pen, h - 2, 2, w - 3, 4);
  else pen.furn('plant_small', 1, h - 2, PLANTS_SMALL[ctx.seed % 3], { order: 0.2 });
}

for (const k of ['pessoal', 'reuniao', 'descanso', 'outra'] as const) kvRegisterFurnisher(`propria:${k}`, (ctx) => kvFurnishOwn(ctx, k));
kvRegisterFurnisher('propria', (ctx) => kvFurnishOwn(ctx, kvOwnMark(ctx.info)?.kind ?? 'outra'));
