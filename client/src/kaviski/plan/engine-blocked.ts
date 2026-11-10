// Fork Kaviski (KAVISKI-HUMANOS.md → "Convites" e "Planta livre"): o lugar sem acesso. Para cliente e visitante, o
// servidor troca cada sala que ele não pode ver (projeto de outro cliente, sala própria fechada, sala temática
// bloqueada no convite) por um item anônimo `blocked` (server/kaviski/humanos/plan.ts). Aqui ele vira uma sala FECHADA
// na camada base: paredes escuras com o vão das portas, chão escurecido com névoa, fita zebrada amarela e preta nas
// portas, cadeado e a placa "ACESSO RESTRITO". Nenhum tile é caminhável (o avatar para na porta; humanos/blocked.ts
// avisa "Você não tem acesso a esta sala"). Puro, menos o desenho (`kvDrawBlocked`, canvas da camada base).
import { mulberry32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import type { KvPlanDoor, KvPlanItem } from '../../../../shared/kaviski-plan';
import type { WallStyle } from '../../art/api';
import { TILE } from '../../world/constants';
import type { SlotShell } from '../../world/layout/exterior';
import type { TileRect, WallSegment } from '../../world/layout/types';
import { kvDoorFront, kvDoorTiles } from './engine-geom';

const px = (t: number) => t * TILE;
/** Parede da sala fechada: cinza-grafite, sem padrão (não lembra nenhuma sala de verdade). */
const WALL: WallStyle = { base: '#565b6e', trim: '#2f3240', pattern: 'plain' };

/** Os itens fechados da planta. */
export function kvBlockedItems(items: readonly KvPlanItem[]): KvPlanItem[] {
  return items.filter((it) => it.blocked);
}

/** Tiles (absolutos) das portas de um item fechado e a frente de cada uma (lado de fora). */
export function kvBlockedDoors(it: KvPlanItem): { door: TileRect; front: TileRect; side: KvPlanDoor['side'] }[] {
  const doors = it.doors?.length ? it.doors : [{ side: 's' as const, at: Math.max(1, Math.floor(it.w / 2) - 1) }];
  return doors.map((d) => {
    const t = kvDoorTiles(it.w, it.h, d);
    return { door: { x: it.x + t.x, y: it.y + t.y, w: t.w, h: t.h }, front: kvDoorFront(it, d), side: d.side };
  });
}

/** A casca (camada base) de uma sala fechada: piso escuro e paredes com os vãos das portas. */
export function kvBlockedShell(slot: number, it: KvPlanItem): SlotShell {
  const { x, y, w, h } = it;
  const doors = it.doors?.length ? it.doors : [{ side: 's' as const, at: Math.max(1, Math.floor(w / 2) - 1) }];
  const gaps = (side: KvPlanDoor['side']) => doors.filter((d) => d.side === side).map((d) => ({ x: px(x + d.at), w: px(d.w ?? 2) }));
  const walls: WallSegment[] = [];
  const n = gaps('n');
  const s = gaps('s');
  walls.push({ kind: 'face', x: px(x + 0.5), y: px(y), w: px(w - 1), style: WALL, ...(n.length ? { doorways: n } : {}) });
  walls.push({ kind: 'south', x: px(x + 0.5), y: px(y + h - 1), w: px(w - 1), style: WALL, ...(s.length ? { doorways: s } : {}) });
  for (const [side, lx] of [
    ['w', 0],
    ['e', w - 0.5],
  ] as const) {
    let y0 = 0;
    for (const d of doors.filter((q) => q.side === side).sort((a, b) => a.at - b.at)) {
      if (d.at > y0) walls.push({ kind: 'cap', x: px(x + lx), y: px(y + y0), w: TILE / 2, h: px(d.at - y0), style: WALL });
      y0 = d.at + (d.w ?? 2);
    }
    if (y0 < h) walls.push({ kind: 'cap', x: px(x + lx), y: px(y + y0), w: TILE / 2, h: px(h - y0), style: WALL });
  }
  return {
    slot,
    rect: { x, y, w, h: 0 },
    walls,
    windows: [],
    floors: [{ kind: 'concrete', x: px(x), y: px(y), w: px(w), h: px(h), seed: 4242 + slot, tint: '#2b2f3d' }],
    props: [],
  };
}

/** Fita zebrada (amarelo/preto, faixas a 45°) num retângulo em px. */
function zebra(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#1d1d22';
  const step = 8;
  for (let k = -h; k < w + h; k += step) {
    ctx.beginPath();
    ctx.moveTo(x + k, y + h);
    ctx.lineTo(x + k + 4, y + h);
    ctx.lineTo(x + k + 4 + h, y);
    ctx.lineTo(x + k + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Cadeado em pixel art (centro cx, cy; k = tamanho do "pixel"). */
function padlock(ctx: CanvasRenderingContext2D, cx: number, cy: number, k: number): void {
  const rows = ['..kkkk..', '.k....k.', '.k....k.', 'kkkkkkkk', 'kyyyyyyk', 'kyyddyyk', 'kyyddyyk', 'kyyydyyk', 'kyyyyyyk', 'kkkkkkkk'];
  const pal: Record<string, string> = { k: '#16171d', y: '#e8b923', d: '#4a3b10' };
  const x0 = Math.round(cx - (rows[0].length * k) / 2);
  const y0 = Math.round(cy - (rows.length * k) / 2);
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = pal[row[i]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x0 + i * k, y0 + j * k, k, k);
    }
  });
  // arco do cadeado (metal)
  ctx.fillStyle = '#b8bcc8';
  ctx.fillRect(x0 + 2 * k, y0, 4 * k, k);
  ctx.fillRect(x0 + k, y0 + k, k, 2 * k);
  ctx.fillRect(x0 + 6 * k, y0 + k, k, 2 * k);
}

/**
 * Desenha (na camada base, depois do resto) o que faz da sala fechada um lugar proibido: névoa escura no chão, a fita
 * zebrada nas portas, o cadeado e a placa "ACESSO RESTRITO".
 */
export function kvDrawBlocked(ctx: CanvasRenderingContext2D, items: readonly KvPlanItem[]): void {
  for (const it of kvBlockedItems(items)) {
    const x0 = px(it.x);
    const y0 = px(it.y);
    const W = px(it.w);
    const H = px(it.h);
    // névoa: escurece o chão (mais nas bordas) e manchas suaves
    const inner = { x: x0 + TILE / 2, y: y0 + px(2), w: W - TILE, h: H - px(3) };
    if (inner.w <= 0 || inner.h <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x, inner.y, inner.w, inner.h);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,10,22,0.55)';
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    const g = ctx.createRadialGradient(inner.x + inner.w / 2, inner.y + inner.h / 2, Math.min(inner.w, inner.h) * 0.15, inner.x + inner.w / 2, inner.y + inner.h / 2, Math.max(inner.w, inner.h) * 0.7);
    g.addColorStop(0, 'rgba(150,160,190,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    const rng = mulberry32(0xb10c + it.x * 31 + it.y * 7);
    for (let i = 0; i < Math.max(3, Math.round((it.w * it.h) / 20)); i++) {
      const fx = inner.x + rng() * inner.w;
      const fy = inner.y + rng() * inner.h;
      const r = TILE * (1 + rng() * 2.5);
      const m = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
      m.addColorStop(0, 'rgba(190,200,225,0.10)');
      m.addColorStop(1, 'rgba(190,200,225,0)');
      ctx.fillStyle = m;
      ctx.fillRect(fx - r, fy - r, 2 * r, 2 * r);
    }
    ctx.restore();
    // fita zebrada nas portas (atravessada no vão)
    for (const d of kvBlockedDoors(it)) {
      const r = d.door;
      if (d.side === 'n') zebra(ctx, px(r.x), px(r.y + 1) + 2, px(r.w), 10);
      else if (d.side === 's') zebra(ctx, px(r.x), px(r.y) + 3, px(r.w), 10);
      else zebra(ctx, px(r.x) + (d.side === 'w' ? 1 : TILE - 11), px(r.y), 10, px(r.h));
    }
    // cadeado e placa no meio
    const cx = x0 + W / 2;
    const cy = inner.y + inner.h / 2;
    const k = it.w >= 12 && it.h >= 10 ? 3 : 2;
    padlock(ctx, cx, cy - 8, k);
    const label = tr('ACESSO RESTRITO');
    ctx.font = 'bold 8px ui-monospace, Menlo, monospace';
    const tw = Math.ceil(ctx.measureText(label).width);
    const pw = Math.min(inner.w - 4, tw + 12);
    const ph = 17;
    const sx = Math.round(cx - pw / 2);
    const sy = Math.round(cy + 8 + k * 2);
    ctx.fillStyle = '#16171d';
    ctx.fillRect(sx - 1, sy - 1, pw + 2, ph + 2);
    zebra(ctx, sx, sy, pw, 3);
    zebra(ctx, sx, sy + ph - 3, pw, 3);
    ctx.fillStyle = '#26272f';
    ctx.fillRect(sx, sy + 3, pw, ph - 6);
    ctx.fillStyle = '#f2c230';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, sy + ph / 2 + 0.5, pw - 4);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}
