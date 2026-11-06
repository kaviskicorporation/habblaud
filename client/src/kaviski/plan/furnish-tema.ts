// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): sala temática genérica, para chave sem mobília registrada pela
// frente das salas temáticas (que registra `tema:<chave>`). Um ambiente agradável de qualquer tamanho: quadro, estante,
// recanto com sofá, plantas. Puro (sem DOM).
import { kvRegisterFurnisher, type KvFurnishCtx } from './api';
import { KvPen, kvEdgeDecor, kvMeetingCorner, kvSofaCorner } from './furnish-util';

export function kvFurnishThemeGeneric(ctx: KvFurnishCtx): void {
  const pen = new KvPen(ctx);
  const { w, h } = pen;
  const board = pen.wallAt('whiteboard', pen.centers(3.5, 1.5), undefined, { order: 0.6 });
  if (board) pen.spot('whiteboard', Math.floor(board.lcx - 0.5), 2, 'up', { dx: 8, dy: 2 });
  pen.wallAt('painting', pen.centers(w * 0.65, 1), undefined, { order: 0.5 });
  pen.wallAt('clock', pen.centers(w * 0.8, 0.5), undefined, { order: 0.5 });
  for (const x of [w - 4, 1]) if (pen.furn('bookshelf', x, 2, undefined, { order: 0.25 })) break;
  kvSofaCorner(pen, 2, 4) || kvSofaCorner(pen, 2, 5);
  if (w >= 12) kvMeetingCorner(pen, w - 6, 4, 'round') || kvMeetingCorner(pen, w - 6, 5, 'lounge');
  pen.plant(1, 2, true);
  pen.plant(w - 2, 2, true);
  kvEdgeDecor(pen, h - 2, 1, w - 2, 3);
  pen.stands(2);
}

kvRegisterFurnisher('tema', kvFurnishThemeGeneric);
