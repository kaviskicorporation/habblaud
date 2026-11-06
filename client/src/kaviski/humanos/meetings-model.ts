// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): a lógica pura das telas de reunião
// (meetings-dialog.ts, meetings-panel.ts): agrupar por dia, juntar e achar vãos livres, a linha do tempo (posição,
// arrasto, clique num vão), achar sala (filtro e ordem) e o estado agora de uma sala. Sem DOM; testada em
// meetings-model.test.ts.
import type { KvMeetEquip, KvMeetingView, KvMeetRoomView } from '../../../../shared/kaviski-meetings';
import { KV_MEET_MAX_MS, KV_MEET_MIN_MS, kvOverlaps } from '../../../../shared/kaviski-meetings';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** Passo do arrasto e do clique na linha do tempo. */
export const KV_MEET_STEP = 15 * MIN;
/** Durações oferecidas em chips (min). */
export const KV_MEET_DURATIONS: readonly number[] = [15, 30, 45, 60, 90, 120];
/** "Começa às..." (âmbar) quando a próxima está a menos disso. */
export const KV_MEET_SOON_MS = 15 * MIN;

export interface Span {
  start: number;
  end: number;
}

/** Início do dia local de `t`. */
export function dayStartOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** O dia seguinte (meia-noite local, certo também na troca do horário de verão). */
export function nextDay(day: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Hoje, amanhã ou outro dia (para o rótulo do grupo). */
export function kvDayKind(day: number, now: number): 'hoje' | 'amanha' | 'outro' {
  const today = dayStartOf(now);
  if (day === today) return 'hoje';
  if (day === nextDay(today)) return 'amanha';
  return 'outro';
}

/** Agrupa por dia (o da hora de início; a que já começou antes de hoje fica em hoje), em ordem. */
export function kvGroupByDay<T extends Span>(list: readonly T[], now: number): { day: number; items: T[] }[] {
  const today = dayStartOf(now);
  const map = new Map<number, T[]>();
  for (const m of [...list].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const d = Math.max(today, dayStartOf(m.start));
    const arr = map.get(d);
    if (arr) arr.push(m);
    else map.set(d, [m]);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([day, items]) => ({ day, items }));
}

/** Junta horários que se sobrepõem ou encostam, em ordem. */
export function kvMergeSpans(list: readonly Span[]): Span[] {
  const s = list.filter((x) => x.end > x.start).map((x) => ({ start: x.start, end: x.end })).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push(x);
  }
  return out;
}

/** Os vãos livres entre `from` e `to`, dados os horários ocupados. */
export function kvFreeSpans(busy: readonly Span[], from: number, to: number): Span[] {
  const out: Span[] = [];
  let cur = from;
  for (const b of kvMergeSpans(busy)) {
    if (b.end <= from) continue;
    if (b.start >= to) break;
    if (b.start > cur) out.push({ start: cur, end: Math.min(b.start, to) });
    cur = Math.max(cur, b.end);
  }
  if (cur < to) out.push({ start: cur, end: to });
  return out;
}

/** Arredonda para baixo no passo (minutos locais: o passo conta a partir da meia-noite). */
export function kvSnap(t: number, step = KV_MEET_STEP, mode: 'floor' | 'round' | 'ceil' = 'round'): number {
  const day = dayStartOf(t);
  const f = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
  return day + f((t - day) / step) * step;
}

/**
 * Clique num ponto da linha do tempo: o novo início da reunião de `dur` ms. Num horário ocupado: null (nada muda).
 * Num vão: o início é o ponto (para baixo no passo, sem sair do vão); se a reunião não cabe até o fim do vão, recua
 * para caber; se o vão é menor que a reunião, começa no começo do vão.
 */
export function kvClickSlot(busy: readonly Span[], t: number, dur: number, range: Span, step = KV_MEET_STEP): number | null {
  const gap = kvFreeSpans(busy, range.start, range.end).find((g) => t >= g.start && t < g.end);
  if (!gap) return null;
  let s = Math.max(gap.start, kvSnap(t, step, 'floor'));
  if (s + dur > gap.end) s = Math.max(gap.start, gap.end - dur);
  return s;
}

/** A primeira hora livre (no passo) a partir de `from` em que cabe `dur` antes de `until`; null = não há. */
export function kvNextFree(busy: readonly Span[], from: number, dur: number, until: number, step = KV_MEET_STEP): number | null {
  for (const g of kvFreeSpans(busy, kvSnap(from, step, 'ceil'), until)) {
    const s = kvSnap(g.start, step, 'ceil');
    if (s + dur <= g.end) return s;
  }
  return null;
}

// ------------------------------------------------------------------ linha do tempo

/** O intervalo mostrado: 8h–20h do dia, aumentado (horas cheias) para caber o horário escolhido. */
export function kvTimelineRange(day: number, sel?: Span, fromHour = 8, toHour = 20): Span {
  let a = day + fromHour * HOUR;
  let b = day + toHour * HOUR;
  if (sel) {
    if (sel.start < a) a = Math.max(day, Math.floor((sel.start - day) / HOUR) * HOUR + day);
    if (sel.end > b) b = Math.min(nextDay(day), Math.ceil((sel.end - day) / HOUR) * HOUR + day);
  }
  return { start: a, end: b };
}

/** Posição (0..1) de um horário na linha do tempo (preso nas pontas). */
export function kvTimeFrac(t: number, range: Span): number {
  const w = range.end - range.start;
  if (w <= 0) return 0;
  return Math.min(1, Math.max(0, (t - range.start) / w));
}

/** Horário de uma posição (0..1) na linha do tempo. */
export function kvFracTime(f: number, range: Span): number {
  return range.start + Math.min(1, Math.max(0, f)) * (range.end - range.start);
}

/** Onde e de que largura (frações) fica um bloco; null = fora do intervalo. */
export function kvBlock(span: Span, range: Span): { left: number; width: number } | null {
  if (span.end <= range.start || span.start >= range.end) return null;
  const left = kvTimeFrac(span.start, range);
  return { left, width: Math.max(0, kvTimeFrac(span.end, range) - left) };
}

/** Arrastar o bloco: o novo início, dado o início de quando pegou, o deslocamento (px) e a largura total (px). */
export function kvDragStart(origStart: number, dur: number, dx: number, widthPx: number, range: Span, step = KV_MEET_STEP): number {
  if (widthPx <= 0) return origStart;
  const raw = origStart + (dx / widthPx) * (range.end - range.start);
  const s = kvSnap(raw, step, 'round');
  return Math.min(Math.max(s, range.start), range.end - dur);
}

/** Duração limpa (5 min a 12 h). */
export function kvClampDur(ms: number): number {
  return Math.min(KV_MEET_MAX_MS, Math.max(KV_MEET_MIN_MS, ms));
}

// ------------------------------------------------------------------ achar sala

export interface KvRoomFit {
  room: KvMeetRoomView;
  /** Reservas que batem com o horário escolhido (vazio = livre). */
  busy: KvMeetingView[];
  /** Cabe e tem o que se pediu. */
  matches: boolean;
}

/**
 * As salas reserváveis para um horário: as que batem com o filtro (capacidade mínima e equipamentos) livres primeiro
 * (as de capacidade mais perto do pedido antes), depois as ocupadas; a sala `keep` (a escolhida) aparece mesmo fora do
 * filtro. `ignore` = a reunião que está sendo editada (não ocupa a própria sala).
 */
export function kvRankRooms(
  rooms: readonly KvMeetRoomView[],
  meetings: readonly KvMeetingView[],
  slot: Span,
  o: { capMin?: number; equip?: readonly KvMeetEquip[]; ignore?: string; keep?: string } = {},
): KvRoomFit[] {
  const cap = o.capMin ?? 1;
  const eq = o.equip ?? [];
  const out: KvRoomFit[] = [];
  for (const room of rooms) {
    if (!room.meet.bookable) continue;
    const matches = room.meet.capacity >= cap && eq.every((e) => room.meet.equipment.includes(e));
    if (!matches && room.id !== o.keep) continue;
    const busy = meetings.filter((m) => m.room === room.id && !m.released && m.id !== o.ignore && kvOverlaps(m, slot)).sort((a, b) => a.start - b.start);
    out.push({ room, busy, matches });
  }
  const score = (f: KvRoomFit) => (f.busy.length ? 2 : 0) + (f.matches ? 0 : 1);
  return out.sort((a, b) => score(a) - score(b) || a.room.meet.capacity - b.room.meet.capacity || a.room.name.localeCompare(b.room.name));
}

/** Quantas salas reserváveis o filtro esconde. */
export function kvHiddenByFilter(rooms: readonly KvMeetRoomView[], capMin: number, equip: readonly KvMeetEquip[]): number {
  return rooms.filter((r) => r.meet.bookable && !(r.meet.capacity >= capMin && equip.every((e) => r.meet.equipment.includes(e)))).length;
}

// ------------------------------------------------------------------ estado agora

export interface KvRoomNow {
  /** livre, ocupada (reunião agora) ou breve (a próxima começa em menos de 15 min). */
  kind: 'livre' | 'ocupada' | 'breve';
  cur?: KvMeetingView;
  next?: KvMeetingView;
  /** Ocupada: até quando, contando reuniões emendadas. Livre: até a próxima (undefined = o resto do dia). */
  until?: number;
}

export function kvRoomNow(roomId: string, meetings: readonly KvMeetingView[], now: number): KvRoomNow {
  const list = meetings.filter((m) => m.room === roomId && !m.released && m.end > now).sort((a, b) => a.start - b.start);
  const cur = list.find((m) => m.start <= now);
  const next = list.find((m) => m.start > now);
  if (cur) {
    let until = cur.end;
    for (const m of list) if (m.start <= until && m.end > until) until = m.end;
    return { kind: 'ocupada', cur, next, until };
  }
  if (next && next.start - now <= KV_MEET_SOON_MS) return { kind: 'breve', next, until: next.start };
  return { kind: 'livre', next, until: next?.start };
}

/** "Usar agora": quantos minutos cabem antes da próxima reserva (Infinity = sem próxima). */
export function kvQuickMax(roomId: string, meetings: readonly KvMeetingView[], now: number): number {
  const s = kvRoomNow(roomId, meetings, now);
  if (s.kind === 'ocupada') return 0;
  return s.next ? Math.floor((s.next.start - now) / MIN) : Infinity;
}

// ------------------------------------------------------------------ campos de data e hora

const pad = (n: number) => String(n).padStart(2, '0');

/** Valor de um <input type="date"> (dia local). */
export function kvDateValue(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Valor de um <input type="time"> (hora local). */
export function kvTimeValue(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Dia ("2026-11-12") e hora ("14:30") locais → epoch ms; null = inválido. */
export function kvFromInputs(date: string, time: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const hh = Number(tm[1]);
  const mi = Number(tm[2]);
  if (hh > 23 || mi > 59) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hh, mi, 0, 0);
  if (d.getDate() !== Number(dm[3])) return null;
  return d.getTime();
}

/** O próximo horário redondo (no passo) depois de agora: o início sugerido de uma reunião nova. */
export function kvSuggestStart(now: number, step = 30 * MIN): number {
  return kvSnap(now + 5 * MIN, step, 'ceil');
}
