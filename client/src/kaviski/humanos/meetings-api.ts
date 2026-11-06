// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): as reservas de sala nesta página. Busca
// GET /api/kaviski/humanos/meetings (já filtrado pelo servidor: só salas que eu vejo, título de privada só para quem é
// da reunião), relê no evento `meetings` do fluxo de presença e a cada minuto, e avisa quem ouve.
import type { KvMeetingsState, KvMeetingView, KvMeetRoomView } from '../../../../shared/kaviski-meetings';
import { tr } from '../../../../shared/i18n';
import type { KvPresenceClient } from './presence';

export const MEETINGS_API = '/api/kaviski/humanos/meetings';
const POLL_MS = 60_000;
const DAY = 86_400_000;

let state: KvMeetingsState = { now: Date.now(), rooms: [], meetings: [], canBook: false };
const listeners = new Set<(s: KvMeetingsState) => void>();
let started = false;
let loading: Promise<void> | null = null;

export function kvMeetings(): KvMeetingsState {
  return state;
}

/** Avisa quando as reservas mudam (devolve a função que para de ouvir). */
export function kvOnMeetings(cb: (s: KvMeetingsState) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Início do dia local de `t`. */
export function kvDayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Busca as reservas de um intervalo (a janela padrão do armazém é de ontem a daqui a 14 dias). */
export async function kvFetchMeetings(from: number, to: number): Promise<KvMeetingsState | null> {
  try {
    const res = await fetch(`${MEETINGS_API}?from=${Math.round(from)}&to=${Math.round(to)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as KvMeetingsState;
  } catch {
    return null;
  }
}

export function kvReloadMeetings(): Promise<void> {
  loading ??= (async () => {
    const t = Date.now();
    const s = await kvFetchMeetings(kvDayStart(t) - DAY, kvDayStart(t) + 15 * DAY);
    loading = null;
    if (!s) return;
    state = { ...s, rooms: s.rooms ?? [], meetings: s.meetings ?? [] };
    for (const cb of listeners) cb(state);
  })();
  return loading;
}

export interface KvMeetResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  error: string;
}

/** POST/DELETE nas rotas das reuniões (`path` depois de /meetings, ex. '' para marcar, '/<id>' para mudar). */
export async function kvMeetRequest(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<KvMeetResult> {
  try {
    const res = await fetch(`${MEETINGS_API}${path}`, {
      method,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) void kvReloadMeetings();
    return { ok: res.ok, status: res.status, body: b, error: res.ok ? '' : typeof b.error === 'string' ? b.error : String(res.status) };
  } catch {
    return { ok: false, status: 0, body: {}, error: tr('Sem conexão com o Habblaud.') };
  }
}

/** A sala de reunião (reservável) pelo id. */
export function kvMeetRoom(id: string): KvMeetRoomView | undefined {
  return state.rooms.find((r) => r.id === id);
}

/** Reservas que ocupam a sala no intervalo (liberadas e canceladas fora), em ordem. */
export function kvRoomMeetings(roomId: string, from: number, to: number, list: readonly KvMeetingView[] = state.meetings): KvMeetingView[] {
  return list.filter((m) => m.room === roomId && !m.released && m.end > from && m.start < to).sort((a, b) => a.start - b.start);
}

/** A reunião que está acontecendo agora na sala. */
export function kvMeetingNow(roomId: string, now = Date.now()): KvMeetingView | undefined {
  return state.meetings.find((m) => m.room === roomId && !m.released && m.start <= now && m.end > now);
}

/** A próxima reunião da sala (começa depois de agora). */
export function kvNextMeeting(roomId: string, now = Date.now()): KvMeetingView | undefined {
  return kvRoomMeetings(roomId, now, Infinity).find((m) => m.start > now);
}

/** As minhas reuniões (organizador ou convidado) que ainda não acabaram, em ordem. */
export function kvMyMeetings(now = Date.now()): KvMeetingView[] {
  return state.meetings.filter((m) => m.mine && !m.released && m.end > now).sort((a, b) => a.start - b.start);
}

/** Título para mostrar: o da reunião ou "Reunião privada"/"Reservada". */
export function kvMeetLabel(m: KvMeetingView): string {
  return m.title ?? (m.private ? tr('Reunião privada') : tr('Reservada'));
}

export function kvStartMeetingsStore(client: KvPresenceClient): void {
  if (started) return;
  started = true;
  void kvReloadMeetings();
  client.onEvent('meetings', () => void kvReloadMeetings());
  // as salas mudaram (nova sala de reunião, outro tipo): a lista de salas reserváveis também
  client.onEvent('rooms', () => void kvReloadMeetings());
  setInterval(() => void kvReloadMeetings(), POLL_MS);
}
