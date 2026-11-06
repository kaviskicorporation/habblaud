// Fork Kaviski (KAVISKI-HUMANOS.md): desenho do quadro branco (traços e textos) — puro canvas, sem interface. Usado
// pela tela do quadro (whiteboard.ts) e pela miniatura na parede (wall-draw.ts).
import type { KvBoardEvent, KvBoardOp } from '../../../../shared/kaviski-rooms';

export const BOARD_API = '/api/kaviski/humanos/board';

/** Desenha os traços/textos no contexto (já escalado para as coordenadas do quadro). */
export function kvDrawBoardOps(ctx: CanvasRenderingContext2D, ops: readonly KvBoardOp[], from = 0): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = from; i < ops.length; i++) kvDrawBoardOp(ctx, ops[i]!);
}

export function kvDrawBoardOp(ctx: CanvasRenderingContext2D, op: KvBoardOp, start = 0): void {
  const p = op.pts ?? [];
  if (op.tool === 'text') {
    if (!op.text || p.length < 2) return;
    ctx.fillStyle = op.color;
    ctx.font = `600 ${op.size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(op.text, p[0]!, p[1]!);
    return;
  }
  if (p.length < 2) return;
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = Math.max(0, start - 2);
  if (p.length - s <= 2) {
    ctx.beginPath();
    ctx.arc(p[s]!, p[s + 1]!, op.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[s]!, p[s + 1]!);
  for (let i = s + 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  ctx.stroke();
}

/** Aplica um evento `board` à lista de traços (no lugar). Devolve 'redraw' quando é preciso redesenhar tudo. */
export function kvApplyBoardEvent(ops: KvBoardOp[], ev: KvBoardEvent): { redraw: boolean; op?: KvBoardOp; from?: number } {
  if (ev.kind === 'clear') {
    ops.length = 0;
    return { redraw: true };
  }
  if (ev.kind === 'remove') {
    const i = ops.findIndex((o) => o.id === ev.id);
    if (i >= 0) ops.splice(i, 1);
    return { redraw: i >= 0 };
  }
  if (ev.append) {
    const cur = ops.find((o) => o.id === ev.op.id);
    if (!cur) return { redraw: false };
    const from = cur.pts?.length ?? 0;
    cur.pts = [...(cur.pts ?? []), ...(ev.op.pts ?? [])];
    return { redraw: false, op: cur, from };
  }
  if (ops.some((o) => o.id === ev.op.id)) return { redraw: false };
  const op = { ...ev.op, pts: [...(ev.op.pts ?? [])] };
  ops.push(op);
  return { redraw: false, op, from: 0 };
}
