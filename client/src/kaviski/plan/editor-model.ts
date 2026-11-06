// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): a parte pura do editor da empresa — mover com encaixe e ímã,
// redimensionar dentro dos limites, portas nas paredes, achar lugar livre, avisos ao vivo (sala sem porta, sem caminho
// até a recepção, fora da planta) e o desfazer/refazer. Sem DOM: testado em editor-model.test.ts.
import {
  KV_PLAN_MAX_H,
  KV_PLAN_MAX_W,
  KV_PLAN_SIZE,
  kvDefaultDoor,
  kvNormDoors,
  kvPlanNewId,
  kvPlanWalled,
  kvRectsOverlap,
  kvWallLen,
  type KvDoorSide,
  type KvPlan,
  type KvPlanDoor,
  type KvPlanItem,
  type KvPlanKind,
} from '../../../../shared/kaviski-plan';

export interface KvRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Alças de redimensionar: lados e cantos. */
export type KvHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const KV_HANDLES: readonly KvHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Tipos abertos (piso sem paredes): o caminho entre as salas. */
export function kvPlanOpen(kind: KvPlanKind): boolean {
  return kind === 'corredor' || kind === 'jardim';
}

export function kvCloneItem(it: KvPlanItem): KvPlanItem {
  return { ...it, ...(it.doors ? { doors: it.doors.map((d) => ({ ...d })) } : {}) };
}

export function kvClonePlan(p: KvPlan): KvPlan {
  return { ...p, items: p.items.map(kvCloneItem), auto: { ...p.auto }, ...(p.agents ? { agents: p.agents.map((a) => ({ ...a, ...(a.seat ? { seat: { ...a.seat } } : {}) })) } : {}) };
}

/** O primeiro item (fora `ignore`) que sobrepõe o retângulo. */
export function kvHit(plan: Pick<KvPlan, 'items'>, r: KvRect, ignore?: string | ReadonlySet<string>): KvPlanItem | null {
  for (const it of plan.items) {
    if (ignore && (typeof ignore === 'string' ? it.id === ignore : ignore.has(it.id))) continue;
    if (kvRectsOverlap(it, r)) return it;
  }
  return null;
}

/** O item no tile (o de cima primeiro: o último da lista). */
export function kvItemAt(plan: Pick<KvPlan, 'items'>, tx: number, ty: number): KvPlanItem | null {
  for (let i = plan.items.length - 1; i >= 0; i--) {
    const it = plan.items[i];
    if (tx >= it.x && ty >= it.y && tx < it.x + it.w && ty < it.y + it.h) return it;
  }
  return null;
}

/** Cabe dentro da planta? */
export function kvInsidePlan(plan: Pick<KvPlan, 'w' | 'h'>, r: KvRect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= plan.w && r.y + r.h <= plan.h;
}

/** Retângulo preso ao limite geral (nunca negativo; o editor cresce a planta para a direita e para baixo). */
export function kvClampRect(r: KvRect): KvRect {
  return { x: Math.max(0, Math.min(KV_PLAN_MAX_W - r.w, Math.round(r.x))), y: Math.max(0, Math.min(KV_PLAN_MAX_H - r.h, Math.round(r.y))), w: r.w, h: r.h };
}

/**
 * Ímã: a até `reach` tiles de encostar numa borda de outro item (com as faces de frente uma para a outra), encosta.
 * Também alinha as bordas paralelas (topo com topo, esquerda com esquerda) quando estão perto. Devolve a posição nova.
 */
export function kvMagnet(plan: Pick<KvPlan, 'items'>, r: KvRect, ignore?: string | ReadonlySet<string>, reach = 1): KvRect {
  let bestX: { d: number; x: number } | null = null;
  let bestY: { d: number; y: number } | null = null;
  const skip = (id: string) => !!ignore && (typeof ignore === 'string' ? id === ignore : ignore.has(id));
  for (const o of plan.items) {
    if (skip(o.id)) continue;
    const vOverlap = r.y < o.y + o.h + reach && o.y < r.y + r.h + reach;
    const hOverlap = r.x < o.x + o.w + reach && o.x < r.x + r.w + reach;
    if (vOverlap) {
      // encostar lado a lado (minha esquerda na direita dele, minha direita na esquerda dele) e alinhar as esquerdas/direitas
      for (const x of [o.x + o.w, o.x - r.w, o.x, o.x + o.w - r.w]) {
        const d = Math.abs(x - r.x);
        if (d > 0 && d <= reach && (!bestX || d < bestX.d)) bestX = { d, x };
      }
    }
    if (hOverlap) {
      for (const y of [o.y + o.h, o.y - r.h, o.y, o.y + o.h - r.h]) {
        const d = Math.abs(y - r.y);
        if (d > 0 && d <= reach && (!bestY || d < bestY.d)) bestY = { d, y };
      }
    }
  }
  const out = { ...r, x: bestX ? bestX.x : r.x, y: bestY ? bestY.y : r.y };
  // o ímã nunca leva para cima de outro item: se levar, fica onde estava
  if (kvHit(plan, out, ignore) && !kvHit(plan, r, ignore)) return r;
  return out;
}

/** Limites de tamanho de um tipo (o núcleo e a vaga têm tamanho fixo). */
export function kvSizeLimits(kind: KvPlanKind): { minW: number; minH: number; maxW: number; maxH: number } {
  return KV_PLAN_SIZE[kind];
}

/** Redimensiona pela alça (`dx`, `dy` em tiles desde o começo do arrasto), dentro dos limites do tipo. */
export function kvResize(start: KvRect, kind: KvPlanKind, handle: KvHandle, dx: number, dy: number): KvRect {
  const lim = kvSizeLimits(kind);
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  if (handle.includes('e')) w = clamp(start.w + dx, lim.minW, lim.maxW);
  if (handle.includes('s')) h = clamp(start.h + dy, lim.minH, lim.maxH);
  if (handle.includes('w')) {
    w = clamp(start.w - dx, lim.minW, Math.min(lim.maxW, right));
    x = right - w;
  }
  if (handle.includes('n')) {
    h = clamp(start.h - dy, lim.minH, Math.min(lim.maxH, bottom));
    y = bottom - h;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Portas válidas depois de mover/redimensionar: as que não cabem mais saem; sala sem porta ganha a padrão. */
export function kvFixDoors(it: KvPlanItem): KvPlanItem {
  if (!kvPlanWalled(it.kind) || it.kind === 'nucleo') return it;
  const doors = kvNormDoors(it, it.doors ?? []);
  return { ...it, doors: doors.length ? doors : [kvDefaultDoor(it)] };
}

/** Faixa onde a porta pode ficar numa parede: `[lo, hi]` para o `at` de uma porta de largura `w`. */
export function kvDoorRange(it: Pick<KvPlanItem, 'w' | 'h'>, side: KvDoorSide, w = 2): { lo: number; hi: number } {
  const len = kvWallLen(it, side);
  const lo = side === 'e' || side === 'w' ? 2 : 1;
  return { lo, hi: Math.max(lo, len - 1 - w) };
}

/**
 * Qual parede (e em que ponto dela) está perto de (fx, fy), em tiles com fração. `reach` = quanto fora/dentro da borda
 * ainda conta. null = longe das paredes ou num canto.
 */
export function kvWallAt(it: KvRect, fx: number, fy: number, reach = 0.75): { side: KvDoorSide; pos: number } | null {
  const inX = fx >= it.x && fx <= it.x + it.w;
  const inY = fy >= it.y && fy <= it.y + it.h;
  const cands: { side: KvDoorSide; d: number; pos: number }[] = [];
  // a parede norte é a face (2 linhas): conta até 2 tiles para dentro
  if (inX && fy >= it.y - reach && fy <= it.y + 2) cands.push({ side: 'n', d: Math.abs(fy - it.y), pos: fx - it.x });
  if (inX && fy >= it.y + it.h - 1 && fy <= it.y + it.h + reach) cands.push({ side: 's', d: Math.abs(fy - (it.y + it.h)), pos: fx - it.x });
  if (inY && fx >= it.x - reach && fx <= it.x + reach) cands.push({ side: 'w', d: Math.abs(fx - it.x), pos: fy - it.y });
  if (inY && fx >= it.x + it.w - reach && fx <= it.x + it.w + reach) cands.push({ side: 'e', d: Math.abs(fx - (it.x + it.w)), pos: fy - it.y });
  cands.sort((a, b) => a.d - b.d);
  const c = cands[0];
  if (!c) return null;
  const len = c.side === 'n' || c.side === 's' ? it.w : it.h;
  if (c.pos < 0.5 || c.pos > len - 0.5) return null;
  return { side: c.side, pos: c.pos };
}

/** A porta (índice) que cobre o ponto `pos` da parede `side`, se houver. */
export function kvDoorIndexAt(it: KvPlanItem, side: KvDoorSide, pos: number): number {
  return (it.doors ?? []).findIndex((d) => d.side === side && pos >= d.at - 0.25 && pos <= d.at + (d.w ?? 2) + 0.25);
}

/** Põe uma porta centrada em `pos` (ajustada para caber) ou tira a que já está ali. Devolve o item novo. */
export function kvToggleDoor(it: KvPlanItem, side: KvDoorSide, pos: number): KvPlanItem {
  const doors = (it.doors ?? []).map((d) => ({ ...d }));
  const i = kvDoorIndexAt(it, side, pos);
  if (i >= 0) {
    doors.splice(i, 1);
    return { ...it, doors };
  }
  const { lo, hi } = kvDoorRange(it, side);
  const at = clamp(Math.round(pos - 1), lo, hi);
  const next = [...doors, { side, at }];
  const ok = kvNormDoors(it, next);
  return { ...it, doors: ok.length > doors.length ? ok : doors };
}

/** Move a porta `i` para o ponto `pos` da mesma parede (ou de outra, quando o ponteiro troca de parede). */
export function kvMoveDoor(it: KvPlanItem, i: number, side: KvDoorSide, pos: number): KvPlanItem {
  const doors = (it.doors ?? []).map((d) => ({ ...d }));
  const d = doors[i];
  if (!d) return it;
  const w = d.w ?? 2;
  const { lo, hi } = kvDoorRange(it, side, w);
  const moved: KvPlanDoor = { ...d, side, at: clamp(Math.round(pos - w / 2), lo, hi) };
  const others = doors.filter((_, j) => j !== i);
  if (others.some((o) => o.side === side && moved.at < o.at + (o.w ?? 2) && o.at < moved.at + w)) return it;
  return { ...it, doors: [...others.slice(0, i), moved, ...others.slice(i)] };
}

/** Os tiles do lado de fora de uma porta (por onde se entra). */
export function kvDoorOutside(it: KvRect, d: KvPlanDoor): { x: number; y: number }[] {
  const w = d.w ?? 2;
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < w; k++) {
    if (d.side === 'n') out.push({ x: it.x + d.at + k, y: it.y - 1 });
    else if (d.side === 's') out.push({ x: it.x + d.at + k, y: it.y + it.h });
    else if (d.side === 'w') out.push({ x: it.x - 1, y: it.y + d.at + k });
    else out.push({ x: it.x + it.w, y: it.y + d.at + k });
  }
  return out;
}

/** As portas do núcleo (fixas, como no original): as de cima para baixo, as de baixo para cima. */
export function kvCoreDoors(it: KvPlanItem): KvPlanDoor[] {
  const up = it.ref === 'banheiros' || it.ref === 'lounge';
  return [{ side: up ? 'n' : 's', at: 7, w: it.ref === 'lounge' ? 3 : 2 }];
}

/** As portas que valem para o caminho (as do núcleo são as do original). */
export function kvDoorsOf(it: KvPlanItem): KvPlanDoor[] {
  if (it.kind === 'nucleo') return kvCoreDoors(it);
  return kvPlanWalled(it.kind) ? (it.doors ?? []) : [];
}

/** Os dois retângulos se encostam por uma borda com pelo menos `min` tiles em comum? */
export function kvTouch(a: KvRect, b: KvRect, min = 2): boolean {
  if (a.x + a.w === b.x || b.x + b.w === a.x) return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) >= min;
  if (a.y + a.h === b.y || b.y + b.h === a.y) return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) >= min;
  return false;
}

export type KvWarnKind = 'porta' | 'caminho' | 'fora' | 'recepcao';
export interface KvPlanWarn {
  id?: string;
  kind: KvWarnKind;
}

/** Em que área aberta (ou núcleo) cai cada porta da sala. */
function doorTargets(plan: Pick<KvPlan, 'items'>, it: KvPlanItem): KvPlanItem[] {
  const out = new Set<KvPlanItem>();
  for (const d of kvDoorsOf(it)) {
    for (const t of kvDoorOutside(it, d)) {
      const o = kvItemAt(plan, t.x, t.y);
      if (o && o !== it && (kvPlanOpen(o.kind) || (o.kind === 'nucleo' && it.kind !== 'nucleo'))) out.add(o);
    }
  }
  return [...out];
}

/**
 * Avisos ao vivo: sala (ou área do núcleo) cuja porta não dá em corredor/área aberta; sala sem caminho até a recepção
 * (os elevadores); item fora da planta; planta sem recepção.
 */
export function kvPlanWarnings(plan: Pick<KvPlan, 'items' | 'w' | 'h'>): KvPlanWarn[] {
  const out: KvPlanWarn[] = [];
  const items = plan.items;
  for (const it of items) if (!kvInsidePlan(plan, it)) out.push({ id: it.id, kind: 'fora' });
  const rec = items.find((i) => i.kind === 'nucleo' && i.ref === 'recepcao');
  if (!rec) out.push({ kind: 'recepcao' });
  // grafo: áreas abertas que se encostam + núcleo/salas pelas portas
  const open = items.filter((i) => kvPlanOpen(i.kind));
  const targets = new Map<KvPlanItem, KvPlanItem[]>();
  for (const it of items) if (kvPlanWalled(it.kind)) targets.set(it, doorTargets(plan, it));
  const reach = new Set<KvPlanItem>();
  if (rec) {
    const queue: KvPlanItem[] = [rec];
    reach.add(rec);
    while (queue.length) {
      const cur = queue.shift()!;
      const next: KvPlanItem[] = [];
      if (kvPlanOpen(cur.kind)) {
        for (const o of open) if (o !== cur && kvTouch(cur, o)) next.push(o);
        // salas cujas portas dão aqui
        for (const [room, ts] of targets) if (ts.includes(cur)) next.push(room);
      } else {
        next.push(...(targets.get(cur) ?? []));
        // portas de outras salas que dão nesta área do núcleo (ex.: sala com porta para o lounge)
        if (cur.kind === 'nucleo') for (const [room, ts] of targets) if (ts.includes(cur)) next.push(room);
      }
      for (const n of next) {
        if (reach.has(n)) continue;
        reach.add(n);
        // sala comum é ponta: não se atravessa uma sala para chegar a outra
        if (kvPlanOpen(n.kind) || n.kind === 'nucleo') queue.push(n);
      }
    }
  }
  for (const [it, ts] of targets) {
    if (!ts.length) out.push({ id: it.id, kind: 'porta' });
    else if (rec && !reach.has(it)) out.push({ id: it.id, kind: 'caminho' });
  }
  return out;
}

/** Porta automática ("Corrigir"): na parede encostada num corredor/área aberta, no meio do trecho em comum. */
export function kvAutoDoor(plan: Pick<KvPlan, 'items'>, it: KvPlanItem): KvPlanItem | null {
  if (!kvPlanWalled(it.kind) || it.kind === 'nucleo') return null;
  for (const side of ['s', 'n', 'e', 'w'] as KvDoorSide[]) {
    const len = kvWallLen(it, side);
    const { lo, hi } = kvDoorRange(it, side);
    // os pontos da parede que dão em área aberta
    const good: number[] = [];
    for (let at = lo; at <= hi; at++) {
      const outs = kvDoorOutside(it, { side, at });
      if (outs.every((t) => {
        const o = kvItemAt(plan, t.x, t.y);
        return !!o && (kvPlanOpen(o.kind) || o.kind === 'nucleo');
      })) good.push(at);
    }
    if (!good.length || len < 4) continue;
    const at = good[Math.floor(good.length / 2)];
    const doors = [...(it.doors ?? []), { side, at }];
    const ok = kvNormDoors(it, doors);
    if (ok.some((d) => d.side === side && d.at === at)) return { ...it, doors: ok };
  }
  return null;
}

/** Um lugar livre para um retângulo w×h, o mais perto possível de (cx, cy), dentro do limite geral. */
export function kvFindFree(plan: Pick<KvPlan, 'items'>, w: number, h: number, cx: number, cy: number, maxR = 120): { x: number; y: number } | null {
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  for (let r = 0; r <= maxR; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = kvClampRect({ x: x0 + dx, y: y0 + dy, w, h });
        if (kvHit(plan, c)) continue;
        const d = Math.hypot(c.x - x0, c.y - y0);
        if (!best || d < best.d) best = { x: c.x, y: c.y, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return null;
}

/** A planta cresce para caber todos os itens (e a faixa automática) com uma margem; nunca encolhe abaixo disso. */
export function kvFitPlan(plan: KvPlan, margin = 8): KvPlan {
  let w = 16;
  let h = 12;
  for (const it of plan.items) {
    w = Math.max(w, it.x + it.w);
    h = Math.max(h, it.y + it.h);
  }
  w = Math.min(KV_PLAN_MAX_W, Math.max(plan.w, w + margin));
  h = Math.min(KV_PLAN_MAX_H, Math.max(plan.h, h + margin));
  return w === plan.w && h === plan.h ? plan : { ...plan, w, h };
}

/** Encolhe a planta ao que os itens ocupam (+ margem). */
export function kvTrimPlan(plan: KvPlan, margin = 8): KvPlan {
  let w = 16;
  let h = 12;
  for (const it of plan.items) {
    w = Math.max(w, it.x + it.w);
    h = Math.max(h, it.y + it.h);
  }
  return { ...plan, w: Math.min(KV_PLAN_MAX_W, w + margin), h: Math.min(KV_PLAN_MAX_H, h + margin) };
}

/** Novo item do tipo, com tamanho padrão e porta padrão. */
export function kvNewItem(kind: KvPlanKind, o: { ref?: string; name?: string; w?: number; h?: number; x?: number; y?: number; rand?: () => number } = {}): KvPlanItem {
  const lim = KV_PLAN_SIZE[kind];
  const defW = kind === 'corredor' ? 16 : kind === 'jardim' ? 8 : kind === 'nucleo' || kind === 'vaga' || kind === 'projeto' ? 16 : 12;
  const defH = kind === 'corredor' ? 5 : kind === 'jardim' ? 8 : kind === 'nucleo' || kind === 'vaga' || kind === 'projeto' ? 12 : 10;
  const w = clamp(o.w ?? defW, lim.minW, lim.maxW);
  const h = clamp(o.h ?? defH, lim.minH, lim.maxH);
  const it: KvPlanItem = { id: kvPlanNewId(o.rand), kind, x: o.x ?? 0, y: o.y ?? 0, w, h };
  if (o.ref) it.ref = o.ref;
  if (o.name) it.name = o.name;
  return kvFixDoors(it);
}

/** Duplica um item ao lado (lugar livre mais perto). */
export function kvDuplicate(plan: KvPlan, id: string, rand?: () => number): { plan: KvPlan; id: string } | null {
  const src = plan.items.find((i) => i.id === id);
  if (!src || src.kind === 'nucleo' || src.kind === 'projeto' || src.kind === 'propria') return null;
  const spot = kvFindFree(plan, src.w, src.h, src.x + src.w * 1.5, src.y + src.h / 2);
  if (!spot) return null;
  const copy: KvPlanItem = { ...kvCloneItem(src), id: kvPlanNewId(rand), x: spot.x, y: spot.y };
  delete copy.locked;
  return { plan: kvFitPlan({ ...plan, items: [...plan.items, copy] }), id: copy.id };
}

/** Desfazer/refazer por fotos da planta (até `max`). */
export class KvUndo {
  private past: string[] = [];
  private future: string[] = [];
  constructor(private readonly max = 100) {}

  /** Guarda o estado de ANTES de uma mudança. */
  push(plan: KvPlan): void {
    const s = JSON.stringify(plan);
    if (this.past[this.past.length - 1] === s) return;
    this.past.push(s);
    if (this.past.length > this.max) this.past.shift();
    this.future = [];
  }

  undo(current: KvPlan): KvPlan | null {
    const s = this.past.pop();
    if (!s) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(s) as KvPlan;
  }

  redo(current: KvPlan): KvPlan | null {
    const s = this.future.pop();
    if (!s) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(s) as KvPlan;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

/** As duas plantas são iguais (para "há mudanças sem gravar")? */
export function kvSamePlan(a: KvPlan | null, b: KvPlan | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
