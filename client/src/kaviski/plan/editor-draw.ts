// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): o desenho do editor da empresa por cima do mundo — a planta em
// "blueprint" (grade de tiles, cada item com a cor do tipo, paredes, portas, nome e ícone, selos de sala fixa, travada e
// aviso), a seleção com as alças, o fantasma do arrasto (vermelho quando não cabe) e o marcador da faixa automática.
// Também a miniatura das plantas (assistente de modelos e versões).
import { tr } from '../../../../shared/i18n';
import type { KvPlan, KvPlanItem } from '../../../../shared/kaviski-plan';
import { kvPlanWalled } from '../../../../shared/kaviski-plan';
import { KV_HANDLES, kvDoorsOf, kvPlanOpen, type KvHandle, type KvRect } from './editor-model';
import { kvIcon, kvItemIcon, kvKindColor, kvSvgImage } from './editor-kinds';

/** Tile → tela: tela = o + t·s (CSS px). */
export interface KvView {
  s: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export type KvViewMode = 'planta' | 'misto' | 'mundo';

export interface KvDrawState {
  plan: KvPlan;
  mode: KvViewMode;
  sel: string | null;
  hover: string | null;
  /** Item em arrasto: onde está agora e se cabe. */
  ghost?: { item: KvPlanItem; rect: KvRect; ok: boolean } | null;
  /** Porta que o ponteiro está apontando (para pôr ou tirar). */
  doorHint?: { id: string; side: 'n' | 's' | 'e' | 'w'; at: number; w: number; remove: boolean } | null;
  warned: ReadonlySet<string>;
  name: (it: KvPlanItem) => string;
  now: number;
  autoHover?: boolean;
}

const FONT = '"Pixelify Sans", "Press Start 2P", system-ui, sans-serif';

function rgba(hex: string, a: number): string {
  const c = hex.replace('#', '');
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const n = parseInt(f, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function lighten(hex: string, k: number): string {
  const c = hex.replace('#', '');
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const n = parseInt(f, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

export function kvRectToScreen(v: KvView, r: KvRect): KvRect {
  return { x: v.ox + r.x * v.s, y: v.oy + r.y * v.s, w: r.w * v.s, h: r.h * v.s };
}

/** Pontos das alças (tela) do retângulo. */
export function kvHandlePoints(v: KvView, r: KvRect): { h: KvHandle; x: number; y: number }[] {
  const s = kvRectToScreen(v, r);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const pos: Record<KvHandle, [number, number]> = {
    nw: [s.x, s.y],
    n: [cx, s.y],
    ne: [s.x + s.w, s.y],
    e: [s.x + s.w, cy],
    se: [s.x + s.w, s.y + s.h],
    s: [cx, s.y + s.h],
    sw: [s.x, s.y + s.h],
    w: [s.x, cy],
  };
  return KV_HANDLES.map((h) => ({ h, x: pos[h][0], y: pos[h][1] }));
}

/** Desenha a planta inteira. */
export function kvDrawPlan(ctx: CanvasRenderingContext2D, v: KvView, st: KvDrawState): void {
  const { plan, mode } = st;
  ctx.clearRect(0, 0, v.w, v.h);
  const dim = mode === 'planta' ? 0.62 : mode === 'misto' ? 0.32 : 0.12;
  ctx.fillStyle = `rgba(6, 12, 28, ${dim})`;
  ctx.fillRect(0, 0, v.w, v.h);
  // a área da planta: azul de blueprint e a grade
  const pr = kvRectToScreen(v, { x: 0, y: 0, w: plan.w, h: plan.h });
  if (mode !== 'mundo') {
    ctx.fillStyle = mode === 'planta' ? 'rgba(22, 58, 112, 0.78)' : 'rgba(22, 58, 112, 0.25)';
    ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
  }
  drawGrid(ctx, v, pr, plan, mode);
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(159, 208, 255, 0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(pr.x) + 0.5, Math.round(pr.y) + 0.5, Math.round(pr.w), Math.round(pr.h));
  ctx.restore();
  // faixa automática (onde nascem as salas novas sem lugar)
  drawAuto(ctx, v, plan, !!st.autoHover);
  const ghostId = st.ghost?.item.id;
  for (const it of plan.items) {
    if (it.id === ghostId) continue;
    drawItem(ctx, v, it, st, it, 'normal');
  }
  if (st.ghost) drawItem(ctx, v, st.ghost.item, st, st.ghost.rect, st.ghost.ok ? 'ghost' : 'bad');
  if (st.doorHint) drawDoorHint(ctx, v, plan, st.doorHint);
  // seleção por cima de tudo
  const sel = st.sel ? (st.ghost?.item.id === st.sel ? st.ghost.rect : plan.items.find((i) => i.id === st.sel)) : null;
  const selItem = st.sel ? plan.items.find((i) => i.id === st.sel) : null;
  if (sel && selItem) {
    const s = kvRectToScreen(v, sel);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.lineDashOffset = -(st.now / 60) % 8;
    ctx.strokeRect(Math.round(s.x) - 1.5, Math.round(s.y) - 1.5, Math.round(s.w) + 3, Math.round(s.h) + 3);
    ctx.restore();
    const fixedSize = selItem.kind === 'nucleo' || selItem.kind === 'vaga';
    if (!selItem.locked && !fixedSize) {
      for (const p of kvHandlePoints(v, sel)) {
        ctx.fillStyle = '#0d1424';
        ctx.fillRect(Math.round(p.x) - 5, Math.round(p.y) - 5, 10, 10);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 8, 8);
        ctx.fillStyle = '#3d93ea';
        ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
      }
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, v: KvView, pr: KvRect, plan: KvPlan, mode: KvViewMode): void {
  if (v.s < 3) return;
  const x0 = Math.max(0, Math.floor(-v.ox / v.s));
  const x1 = Math.min(plan.w, Math.ceil((v.w - v.ox) / v.s));
  const y0 = Math.max(0, Math.floor(-v.oy / v.s));
  const y1 = Math.min(plan.h, Math.ceil((v.h - v.oy) / v.s));
  const fine = v.s >= 9;
  const a = mode === 'planta' ? 1 : 0.6;
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x++) {
    const major = x % 4 === 0;
    if (!major && !fine) continue;
    ctx.strokeStyle = major ? `rgba(159, 208, 255, ${0.2 * a})` : `rgba(159, 208, 255, ${0.08 * a})`;
    const sx = Math.round(v.ox + x * v.s) + 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, Math.max(pr.y, 0));
    ctx.lineTo(sx, Math.min(pr.y + pr.h, v.h));
    ctx.stroke();
  }
  for (let y = y0; y <= y1; y++) {
    const major = y % 4 === 0;
    if (!major && !fine) continue;
    ctx.strokeStyle = major ? `rgba(159, 208, 255, ${0.2 * a})` : `rgba(159, 208, 255, ${0.08 * a})`;
    const sy = Math.round(v.oy + y * v.s) + 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.max(pr.x, 0), sy);
    ctx.lineTo(Math.min(pr.x + pr.w, v.w), sy);
    ctx.stroke();
  }
}

type Look = 'normal' | 'ghost' | 'bad';

function drawItem(ctx: CanvasRenderingContext2D, v: KvView, it: KvPlanItem, st: KvDrawState, r: KvRect, look: Look): void {
  const s = kvRectToScreen(v, r);
  const x = Math.round(s.x);
  const y = Math.round(s.y);
  const w = Math.round(s.x + s.w) - x;
  const h = Math.round(s.y + s.h) - y;
  if (x > v.w || y > v.h || x + w < 0 || y + h < 0) return;
  const color = look === 'bad' ? '#e05555' : it.color && it.kind !== 'corredor' && it.kind !== 'jardim' ? it.color : kvKindColor(it.kind, it.ref);
  const mode = st.mode;
  const fillA = look === 'bad' ? 0.45 : mode === 'planta' ? 0.62 : mode === 'misto' ? 0.24 : 0.06;
  const hovered = st.hover === it.id;
  ctx.save();
  if (look !== 'normal') ctx.globalAlpha = 0.9;
  // piso
  if (it.kind === 'jardim') {
    ctx.fillStyle = rgba('#4cae6a', fillA + 0.06);
    ctx.fillRect(x, y, w, h);
    if (mode !== 'mundo' && v.s >= 4) {
      // tufos de grama em pixel
      ctx.fillStyle = rgba('#8fdc7a', mode === 'planta' ? 0.55 : 0.3);
      const step = Math.max(2, Math.round(v.s * 1.5));
      for (let gy = y + step / 2; gy < y + h - 2; gy += step) for (let gx = x + ((gy / step) % 2 ? step / 2 : 0) + 2; gx < x + w - 2; gx += step) ctx.fillRect(Math.round(gx), Math.round(gy), 2, 2);
    }
  } else if (it.kind === 'corredor') {
    ctx.fillStyle = rgba('#c9d3e3', mode === 'planta' ? 0.42 : mode === 'misto' ? 0.16 : 0.04);
    ctx.fillRect(x, y, w, h);
  } else if (it.kind === 'vaga') {
    ctx.fillStyle = rgba('#9aa6b8', mode === 'planta' ? 0.22 : 0.1);
    ctx.fillRect(x, y, w, h);
  } else {
    ctx.fillStyle = rgba(color, fillA);
    ctx.fillRect(x, y, w, h);
    // a face da parede norte (2 linhas) mais escura: dá a cara da sala do Habblaud
    if (kvPlanWalled(it.kind) && mode !== 'mundo') {
      ctx.fillStyle = rgba('#0b1222', mode === 'planta' ? 0.35 : 0.18);
      ctx.fillRect(x, y, w, Math.round(2 * v.s));
    }
  }
  // contorno: paredes cheias, áreas abertas tracejadas
  const line = look === 'bad' ? '#ff8a8a' : look === 'ghost' ? '#a8f0b0' : hovered ? lighten(color, 0.55) : lighten(color, 0.25);
  ctx.strokeStyle = line;
  if (kvPlanOpen(it.kind) || it.kind === 'vaga' || look === 'ghost') {
    ctx.setLineDash([Math.max(3, v.s / 2), Math.max(2, v.s / 3)]);
    ctx.lineWidth = hovered ? 2 : 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    ctx.setLineDash([]);
  } else {
    const lw = Math.max(2, Math.min(5, v.s * 0.5));
    ctx.lineWidth = lw;
    ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
    // portas: buracos claros na parede
    for (const d of kvDoorsOf(it)) {
      const dw = (d.w ?? 2) * v.s;
      ctx.fillStyle = it.kind === 'nucleo' ? 'rgba(255, 211, 77, 0.55)' : '#ffd34d';
      if (d.side === 'n' || d.side === 's') {
        const dx = x + d.at * v.s;
        const dy = d.side === 'n' ? y - 1 : y + h - lw - 1;
        ctx.fillRect(Math.round(dx), Math.round(dy), Math.round(dw), Math.round(lw + 2));
      } else {
        const dy = y + d.at * v.s;
        const dx = d.side === 'w' ? x - 1 : x + w - lw - 1;
        ctx.fillRect(Math.round(dx), Math.round(dy), Math.round(lw + 2), Math.round(dw));
      }
    }
  }
  // nome e ícone
  const label = st.name(it);
  const pad = Math.max(3, Math.min(8, v.s * 0.5));
  const iconPx = v.s >= 10 ? 20 : v.s >= 6 ? 16 : 0;
  const fontPx = Math.round(Math.max(9, Math.min(15, v.s * 0.85)));
  const top = y + (kvPlanWalled(it.kind) ? Math.round(2 * v.s) + pad : pad);
  // corredor e jardim: nome só ao passar o mouse ou escolhido (são muitos pedaços)
  const quiet = kvPlanOpen(it.kind) && !hovered && st.sel !== it.id && look === 'normal';
  if (!quiet && w > 26 && h > 18) {
    let tx = x + pad + 2;
    if (iconPx && w > iconPx + 10 && h > iconPx + 8) {
      const img = kvSvgImage(kvItemIcon(it));
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, tx, top, iconPx, (iconPx * img.naturalHeight) / img.naturalWidth);
      }
      tx += iconPx + 5;
    }
    if (w - (tx - x) > 24 && h > fontPx + 6) {
      ctx.font = `600 ${fontPx}px ${FONT}`;
      ctx.textBaseline = 'top';
      const max = x + w - pad - tx;
      const text = fit(ctx, label, max);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillText(text, tx + 1, top + 2);
      ctx.fillStyle = mode === 'mundo' ? '#ffffff' : '#f4f8ff';
      ctx.fillText(text, tx, top + 1);
      if (v.s >= 8 && h > 2 * v.s + fontPx * 2 + 16) {
        ctx.font = `500 ${Math.max(9, fontPx - 3)}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(223, 230, 242, 0.75)';
        ctx.fillText(`${r.w}×${r.h}`, tx, top + fontPx + 4);
      }
    }
  }
  // selos no canto: aviso, fixa, travada
  const badges: string[] = [];
  if (st.warned.has(it.id) && look === 'normal') badges.push(kvIcon('aviso'));
  if (it.fixed) badges.push(kvIcon('fixa'));
  if (it.locked) badges.push(kvIcon('trava'));
  let bx = x + w - 4;
  const bs = v.s >= 8 ? 18 : 14;
  for (const b of badges) {
    const img = kvSvgImage(b);
    if (!img || w < bs * 2 || h < bs + 4) break;
    bx -= bs;
    const blink = b === kvIcon('aviso') ? 0.7 + 0.3 * Math.sin(st.now / 220) : 1;
    ctx.globalAlpha = blink;
    ctx.fillStyle = 'rgba(8, 12, 24, 0.75)';
    ctx.fillRect(bx - 2, y + 4, bs + 4, bs + 4);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, bx, y + 6, bs, bs);
    ctx.globalAlpha = 1;
    bx -= 6;
  }
  ctx.restore();
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function drawDoorHint(ctx: CanvasRenderingContext2D, v: KvView, plan: KvPlan, d: NonNullable<KvDrawState['doorHint']>): void {
  const it = plan.items.find((i) => i.id === d.id);
  if (!it) return;
  const s = kvRectToScreen(v, it);
  const lw = Math.max(4, v.s * 0.6);
  ctx.save();
  ctx.fillStyle = d.remove ? 'rgba(224, 85, 85, 0.85)' : 'rgba(126, 231, 135, 0.85)';
  const len = d.w * v.s;
  if (d.side === 'n' || d.side === 's') ctx.fillRect(s.x + d.at * v.s, d.side === 'n' ? s.y - lw / 2 : s.y + s.h - lw / 2, len, lw);
  else ctx.fillRect(d.side === 'w' ? s.x - lw / 2 : s.x + s.w - lw / 2, s.y + d.at * v.s, lw, len);
  ctx.restore();
}

/** O marcador da faixa automática e o desenho da faixa (duas fileiras e o corredor). */
export function kvAutoRect(plan: KvPlan): KvRect {
  return plan.auto.dir === 'e' ? { x: plan.auto.x, y: plan.auto.y, w: 48, h: 29 } : { x: plan.auto.x, y: plan.auto.y, w: 37, h: 36 };
}

/** Onde fica o marcador da faixa (retângulo em tiles, para o clique). */
export function kvAutoFlag(plan: KvPlan): KvRect {
  return { x: plan.auto.x, y: plan.auto.y - 3, w: 7, h: 3 };
}

function drawAuto(ctx: CanvasRenderingContext2D, v: KvView, plan: KvPlan, hover: boolean): void {
  const r = kvRectToScreen(v, kvAutoRect(plan));
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = hover ? 'rgba(168, 240, 176, 0.95)' : 'rgba(168, 240, 176, 0.55)';
  ctx.lineWidth = 1.5;
  const e = plan.auto.dir === 'e';
  // fileiras
  if (e) {
    for (let c = 0; c < 3; c++) {
      ctx.strokeRect(r.x + c * 16 * v.s + 2, r.y + 2, 16 * v.s - 4, 12 * v.s - 4);
      ctx.strokeRect(r.x + c * 16 * v.s + 2, r.y + 17 * v.s + 2, 16 * v.s - 4, 12 * v.s - 4);
    }
    ctx.fillStyle = 'rgba(168, 240, 176, 0.12)';
    ctx.fillRect(r.x, r.y + 12 * v.s, r.w, 5 * v.s);
  } else {
    for (let c = 0; c < 3; c++) {
      ctx.strokeRect(r.x + 2, r.y + c * 12 * v.s + 2, 16 * v.s - 4, 12 * v.s - 4);
      ctx.strokeRect(r.x + 21 * v.s + 2, r.y + c * 12 * v.s + 2, 16 * v.s - 4, 12 * v.s - 4);
    }
    ctx.fillStyle = 'rgba(168, 240, 176, 0.12)';
    ctx.fillRect(r.x + 16 * v.s, r.y, 5 * v.s, r.h);
  }
  ctx.setLineDash([]);
  // bandeirinha arrastável
  const f = kvRectToScreen(v, kvAutoFlag(plan));
  const fh = Math.max(18, f.h);
  const fy = r.y - fh - 2;
  ctx.fillStyle = hover ? '#7ee787' : '#4cae6a';
  ctx.fillRect(r.x, fy, 3, fh + 6);
  ctx.beginPath();
  ctx.moveTo(r.x + 3, fy);
  ctx.lineTo(r.x + 3 + Math.max(90, f.w), fy);
  ctx.lineTo(r.x + 3 + Math.max(90, f.w) - 8, fy + fh / 2);
  ctx.lineTo(r.x + 3 + Math.max(90, f.w), fy + fh);
  ctx.lineTo(r.x + 3, fy + fh);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0d1f12';
  ctx.font = `600 11px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${tr('salas novas')}  ${e ? '▶' : '▼'}`, r.x + 9, fy + fh / 2 + 1);
  ctx.restore();
}

/** Retângulo (tela) da bandeirinha, para o clique. */
export function kvAutoFlagScreen(v: KvView, plan: KvPlan): KvRect {
  const r = kvRectToScreen(v, kvAutoRect(plan));
  const f = kvRectToScreen(v, kvAutoFlag(plan));
  const fh = Math.max(18, f.h);
  return { x: r.x, y: r.y - fh - 2, w: Math.max(90, f.w) + 3, h: fh + 6 };
}

/** Miniatura de uma planta num canvas (modelos, versões). */
export function kvDrawThumb(canvas: HTMLCanvasElement, plan: KvPlan, o: { bg?: string; pad?: number } = {}): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = typeof devicePixelRatio === 'number' ? Math.min(2, devicePixelRatio) : 1;
  const cw = canvas.clientWidth || canvas.width;
  const ch = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = o.bg ?? '#163a70';
  ctx.fillRect(0, 0, cw, ch);
  let x1 = 1;
  let y1 = 1;
  for (const it of plan.items) {
    x1 = Math.max(x1, it.x + it.w);
    y1 = Math.max(y1, it.y + it.h);
  }
  const pad = o.pad ?? 8;
  const s = Math.min((cw - pad * 2) / x1, (ch - pad * 2) / y1);
  const ox = Math.round((cw - x1 * s) / 2);
  const oy = Math.round((ch - y1 * s) / 2);
  // grama em volta
  ctx.fillStyle = 'rgba(76, 174, 106, 0.18)';
  ctx.fillRect(ox - 3, oy - 3, x1 * s + 6, y1 * s + 6);
  const order = [...plan.items].sort((a, b) => Number(kvPlanWalled(a.kind)) - Number(kvPlanWalled(b.kind)));
  for (const it of order) {
    const x = ox + it.x * s;
    const y = oy + it.y * s;
    const w = it.w * s;
    const h = it.h * s;
    const c = it.kind === 'corredor' ? '#c9d3e3' : it.kind === 'jardim' ? '#4cae6a' : kvKindColor(it.kind, it.ref);
    ctx.fillStyle = it.kind === 'vaga' ? 'rgba(154, 166, 184, 0.35)' : it.kind === 'corredor' ? 'rgba(201, 211, 227, 0.55)' : c;
    ctx.fillRect(x, y, w, h);
    if (kvPlanWalled(it.kind)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(x, y, w, Math.max(1, 2 * s));
      ctx.strokeStyle = 'rgba(10, 16, 30, 0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = '#ffd34d';
      for (const d of kvDoorsOf(it)) {
        const dw = (d.w ?? 2) * s;
        if (d.side === 'n' || d.side === 's') ctx.fillRect(x + d.at * s, d.side === 'n' ? y : y + h - 1.5, dw, 1.5);
        else ctx.fillRect(d.side === 'w' ? x : x + w - 1.5, y + d.at * s, 1.5, dw);
      }
    } else if (it.kind === 'jardim' && s >= 2) {
      ctx.fillStyle = 'rgba(143, 220, 122, 0.7)';
      for (let gy = y + 2; gy < y + h - 1; gy += 4) for (let gx = x + 2; gx < x + w - 1; gx += 5) ctx.fillRect(gx, gy, 1, 1);
    }
  }
}
