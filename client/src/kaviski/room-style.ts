// Fork Kaviski (KAVISKI.md): cor e grupo do cliente nas salas do escritório (canvas, espaço de tela).
// - placa legível (zoom perto): moldura na cor do cliente em volta da placa e um selo com o nome do grupo acima dela;
// - pílula flutuante (zoom longe): a faixa da esquerda usa a cor do cliente e o selo do grupo vai acima da pílula.
// Sem estilo na sala (RoomInfo.kaviski ausente) nada é desenhado e a cor de destaque é a do tema original.
import type { RoomInfo } from '../../../shared/types';
import { kvTextOn, type KvRoomInfo, type KvRoomStyle } from '../../../shared/kaviski';

const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const BADGE_FONT = `700 9px ${UI_FONT}`;
const BADGE_H = 13;
const BADGE_MAX_W = 160;

export function kvStyleOf(info: RoomInfo | undefined | null): KvRoomStyle | undefined {
  return (info as KvRoomInfo | undefined | null)?.kaviski;
}

/** Cor de destaque da sala: a do cliente, se houver; senão `fallback` (a do tema). */
export function kvAccent(info: RoomInfo | undefined | null, fallback: string): string {
  return kvStyleOf(info)?.color ?? fallback;
}

/** Texto cortado com reticências para caber em `max` px. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Selo do grupo centrado em `cx`, com a base em `bottom` (px de tela). */
function drawBadge(ctx: CanvasRenderingContext2D, style: KvRoomStyle, cx: number, bottom: number, maxW: number): void {
  if (!style.group) return;
  const color = style.color ?? '#5b6478';
  ctx.save();
  ctx.font = BADGE_FONT;
  const text = fit(ctx, style.group, Math.max(24, Math.min(BADGE_MAX_W, maxW) - 10));
  const w = Math.round(ctx.measureText(text).width + 10);
  const x = Math.round(cx - w / 2);
  const y = Math.round(bottom - BADGE_H);
  ctx.fillStyle = 'rgba(16,20,32,0.30)';
  ctx.beginPath();
  ctx.roundRect(x, y + 1.5, w, BADGE_H, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, BADGE_H, 4);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(16,20,32,0.45)';
  ctx.stroke();
  ctx.fillStyle = kvTextOn(color);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + BADGE_H / 2 + 0.5);
  ctx.restore();
}

/** Moldura colorida na placa (x, y, w, h em px de tela) e o selo do grupo acima dela. */
export function kvDrawSignStyle(ctx: CanvasRenderingContext2D, info: RoomInfo | undefined | null, x: number, y: number, w: number, h: number): void {
  const style = kvStyleOf(info);
  if (!style) return;
  if (style.color) {
    const lw = Math.max(1.5, Math.min(3, h * 0.12));
    ctx.save();
    ctx.lineWidth = lw;
    ctx.strokeStyle = style.color;
    ctx.beginPath();
    ctx.roundRect(x - lw / 2 - 1, y - lw / 2 - 1, w + lw + 2, h + lw + 2, 3);
    ctx.stroke();
    // contorno fino escuro por fora: a moldura não some em paredes da mesma cor
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(16,20,32,0.5)';
    ctx.beginPath();
    ctx.roundRect(x - lw - 1.5, y - lw - 1.5, w + lw * 2 + 3, h + lw * 2 + 3, 4);
    ctx.stroke();
    ctx.restore();
  }
  drawBadge(ctx, style, x + w / 2, y - 5, w + 40);
}

/** Selo do grupo acima da pílula flutuante (a pílula tem 22 px e a base em `cy - 4`). */
export function kvDrawPillBadge(ctx: CanvasRenderingContext2D, info: RoomInfo | undefined | null, cx: number, cy: number, maxW: number): void {
  const style = kvStyleOf(info);
  if (style) drawBadge(ctx, style, cx, cy - 22 - 4 - 3, maxW);
}
