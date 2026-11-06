// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): mobília padrão da sala de projeto de qualquer tamanho, no
// espírito de world/layout/room.ts: ilhas de mesas face a face (desk de costas para a câmera, desk_back de frente) que
// se repetem conforme a sala cresce, quadro kanban (o quadro de tarefas do Habblaud), canto de reunião, estante,
// coluna de apoio, plantas e cantinhos. As mesas mantêm `deskId`/`seat` (a tela segue quem senta) e o `rank` (a ordem
// em que os agentes escolhem). Estilos (`item.style`): 'ilhas' (padrão), 'aberto' (ilhas menores, mais sofá) e 'baias'
// (fileiras de mesas viradas para a parede norte). Puro (sem DOM).
import { mulberry32 } from '../../../../shared/hash';
import { TILE } from '../../world/constants';
import { kvRegisterFurnisher, type KvFurnishCtx } from './api';
import { BEANBAGS, KvPen, kvEdgeDecor, kvMeetingCorner, kvShade, kvSofaCorner, POSTERS } from './furnish-util';

type Meeting = 'table' | 'round' | 'lounge';

/** Uma ilha de `pairs` pares de mesas: 2*pairs x 4 tiles (cadeira N, desk_back, desk, cadeira S). */
function island(pen: KvPen, x0: number, y0: number, pairs: number, seq: { n: number; rank: number }): boolean {
  const { ctx } = pen;
  if (!pen.ok(x0, y0, 2 * pairs, 4)) return false;
  const deskV = ctx.theme.deskVariant;
  const chairV = ctx.theme.chairVariant;
  ctx.b.rug(x0 - 0.5, y0 + 0.25, 2 * pairs + 1, 3.5, ctx.theme.carpet, ctx.seed + seq.n);
  // o par do meio é o preferido (como no original: [2, 0, 4])
  const order = [...Array(pairs).keys()].sort((a, b) => Math.abs(a - (pairs - 1) / 2) - Math.abs(b - (pairs - 1) / 2) || a - b);
  const rankOf = new Map(order.map((p, i) => [p, i * 2]));
  for (let i = 0; i < pairs; i++) {
    const lx = x0 + 2 * i;
    const n = seq.n++;
    const r = seq.rank + (rankOf.get(i) ?? i * 2);
    const back = ctx.furn('desk_back', lx, y0 + 1, deskV, { order: 0.35 + i * 0.03, seat: `N${n}` });
    const front = ctx.furn('desk', lx, y0 + 2, deskV, { order: 0.4 + i * 0.03, seat: `S${n}` });
    if (back) ctx.seat('desk', 'office_chair_front', lx, y0, 'down', chairV, { dx: TILE / 2, deskId: back, rank: r + 1, side: 'N', order: 0.55 + i * 0.02 });
    if (front) ctx.seat('desk', 'office_chair', lx, y0 + 3, 'up', chairV, { dx: TILE / 2, deskId: front, rank: r, side: 'S', order: 0.6 + i * 0.02 });
  }
  seq.rank += pairs * 2;
  pen.reserve(x0, y0, 2 * pairs, 4);
  return true;
}

/** Uma fileira de baias: mesas viradas para cima (quem senta fica de costas para a câmera, a tela aparece). */
function bayRow(pen: KvPen, x0: number, x1: number, y: number, seq: { n: number; rank: number }): number {
  const { ctx } = pen;
  let made = 0;
  for (let x = x0; x + 1 <= x1; x += 3) {
    if (!pen.ok(x, y, 2, 2)) continue;
    const n = seq.n++;
    const desk = ctx.furn('desk', x, y, ctx.theme.deskVariant, { order: 0.4, seat: `S${n}` });
    if (!desk) continue;
    ctx.seat('desk', 'office_chair', x, y + 1, 'up', ctx.theme.chairVariant, { dx: TILE / 2, deskId: desk, rank: seq.rank++, side: 'S', order: 0.6 });
    pen.reserve(x, y, 2, 2);
    made++;
  }
  return made;
}

export function kvFurnishProject(ctx: KvFurnishCtx): void {
  const pen = new KvPen(ctx);
  const { w, h } = pen;
  const style = ctx.item.style ?? 'ilhas';
  const v = mulberry32((ctx.seed ^ 0x7a11) >>> 0);
  const meetings: Meeting[] = ['table', 'round', 'lounge'];
  const meeting = meetings[Math.floor(v() * 3) % 3];
  const seq = { n: 0, rank: 0 };

  // ---- parede norte: quadro kanban (com o lugar de quem olha o quadro), relógio, pôster, janelas
  const board = pen.wallAt('whiteboard', pen.centers(Math.min(4.5, w / 2), 1.5), undefined, { order: 0.6 });
  if (board) {
    const bx = Math.floor(board.lcx - 0.5);
    if (!pen.spot('whiteboard', bx, 2, 'up', { dx: 8, dy: 2 })) pen.spot('whiteboard', bx - 1, 2, 'up', { dx: 16 + 8, dy: 2 });
    pen.reserve(bx - 1, 2, 3, 1);
  }
  pen.wallAt('clock', pen.centers(w * 0.6, 0.5), undefined, { order: 0.7 });
  pen.wallAt('poster', pen.centers(w * 0.68, 0.5), pen.pick(POSTERS), { order: 0.5 });
  // janelas a cada ~7 tiles na metade direita (a sala grande fica clara)
  for (let cx = Math.max(w * 0.78, 8); cx <= w - 2.5; cx += 7) {
    const win = pen.wallAt('window', pen.centers(cx, 1).slice(0, 4), undefined, { order: 0.4 });
    if (win) pen.spot('window', Math.floor(win.lcx - 1), 2, 'up', { dx: 12, dy: 1 });
  }

  // ---- apoio: estante encostada na parede norte e planta alta no canto
  for (const x of [1, 3, 5]) if (pen.furn('bookshelf', x, 2, undefined, { order: 0.25 })) {
    pen.spot('shelf', x, 3, 'up', { dx: 8, dy: -2 });
    break;
  }
  pen.plant(w - 2, 2, true, 0.2);

  // ---- zonas: à direita o canto de reunião (salas largas), embaixo os cantinhos
  const big = w >= 14;
  const right = big ? w - 2 - 5 : w - 2; // última coluna das mesas
  let desks = 0;
  if (style === 'baias') {
    for (let y = 3; y + 1 <= h - 3; y += 3) desks += bayRow(pen, 2, right - 1, y, seq);
  } else {
    const maxPairs = style === 'aberto' ? 2 : 3;
    for (let y0 = 3; y0 + 3 <= h - 2; y0 += 5) {
      let x0 = 2;
      while (x0 + 1 <= right) {
        let placed = 0;
        for (let pairs = maxPairs; pairs >= 1 && !placed; pairs--) {
          if (x0 + 2 * pairs - 1 > right) continue;
          // a ilha pode escorregar um tile (porta, interruptor)
          for (const dx of [0, 1]) if (!placed && x0 + dx + 2 * pairs - 1 <= right && island(pen, x0 + dx, y0, pairs, seq)) placed = pairs;
        }
        if (!placed) {
          x0 += 1;
          continue;
        }
        desks += placed * 2;
        x0 += 2 * placed + 1 + (style === 'aberto' ? 1 : 0);
      }
      if (style === 'aberto' && y0 >= 8) break;
    }
  }
  if (!desks) {
    // sala mínima: uma mesa só
    for (let y = 3; y <= h - 3 && !desks; y++) for (let x = 2; x <= w - 4 && !desks; x++) desks += bayRow(pen, x, x + 1, y, seq);
  }
  pen.furn('trash_bin', Math.min(right + 1, w - 3), 6, undefined, { order: 0.7 });

  // ---- canto de reunião (assentos extras para subagentes)
  if (big) {
    const zx = w - 2 - 4;
    for (const y of [4, 3, 5, 6]) if (kvMeetingCorner(pen, zx, y, meeting)) break;
    // coluna de apoio junto à parede leste
    const col = Math.floor(v() * 3);
    const items = col === 0 ? (['binder_shelf', 'printer', 'floor_lamp'] as const) : col === 1 ? (['binder_shelf', 'binder_shelf', 'floor_lamp'] as const) : (['floor_lamp', 'filing_cabinet', 'plant_tall'] as const);
    items.forEach((k, i) => (k === 'plant_tall' ? pen.plant(w - 2, 9 + i, true, 0.34) : pen.furn(k, w - 2, 9 + i * 2, undefined, { order: 0.3 + i * 0.02 })));
  }
  // salas altas: um sofá para quem espera (e para a vida social da sala)
  if (h >= 16 || style === 'aberto') {
    const sy = h - 2 - 3;
    for (const sx of [w - 2 - 6, 2, Math.floor(w / 2) - 2]) if (sx >= 1 && kvSofaCorner(pen, sx, sy)) break;
  }

  // ---- rodapé: plantas, puffs, luminárias (a passagem das portas fica livre: ctx.keepFree)
  kvEdgeDecor(pen, h - 2, 1, w - 2, 3);
  pen.seat('nook', 'beanbag', 1, Math.floor(h / 2), 'right', pen.pick(BEANBAGS), { order: 0.6 });
  ctx.b.rug(Math.max(1, Math.floor(w / 2) - 2), h - 3.2, 4, 1.2, kvShade(ctx.theme.carpet2, -0.1), ctx.seed + 9);
  // pontos em pé (subagentes sem lugar sentado trabalham aqui; também servem de conversa)
  pen.stands(Math.max(2, Math.min(6, Math.round((w * h) / 70))), 'left');
}

kvRegisterFurnisher('projeto', kvFurnishProject);
