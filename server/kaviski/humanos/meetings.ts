// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): reservas das salas de reunião, como as salas do
// Microsoft Teams/Outlook. Guardadas em <dataDir>/kaviski/meetings.json (permissão 600).
//
// GET    /api/kaviski/humanos/meetings?from=&to=     salas reserváveis que vejo + reservas do intervalo (até 62 dias)
// POST   /api/kaviski/humanos/meetings               marca {room, title, start, end, people?, private?, note?, repeat?,
//                                                    skipConflicts?} → 201 {meetings, warnings?, skipped?} | 409 {conflicts}
// POST   /api/kaviski/humanos/meetings/now           "usar agora" pela porta {room, minutes, private?, title?}
// GET    /api/kaviski/humanos/meetings/freebusy?people=a,b&from=&to=   horários ocupados (sem títulos; só a equipe)
// POST   /api/kaviski/humanos/meetings/<id>          muda (organizador ou admin) {title?, start?, end?, room?, people?,
//                                                    private?, note?, series?}
// DELETE /api/kaviski/humanos/meetings/<id>[?series=1]  cancela (esta, ou esta e as próximas da série)
// POST   /api/kaviski/humanos/meetings/<id>/checkin | /end | /extend {minutes}
//
// Regras (todas aqui, no servidor):
// - Marca quem é da equipe ou admin, numa sala de reunião que vê e que aceita reservas; nunca duas reservas no mesmo
//   horário na mesma sala.
// - Quem vê a sala vê as reservas dela; numa privada, quem não é da reunião vê só "ocupada" (sem título, organizador e
//   convidados). Quem é da reunião a vê mesmo sem ver a sala, e passa a ver a sala de 15 min antes a 5 min depois.
// - Check-in: a primeira pessoa da reunião que entra na sala (a partir de 5 min antes) faz o check-in sozinha.
//   Sem check-in até 10 min depois do começo, a sala é liberada (se a sala tem "liberar se ninguém aparecer").
// - Privada, enquanto acontece: a sala fica trancada e coberta (social.ts): só organizador e convidados entram (os outros
//   batem na porta), e quem está fora não vê ninguém lá dentro, não ouve, não lê a conversa nem o quadro.
// - Nada disto vai ao snapshot do Office nem ao Habblaud World (as salas próprias já não vão).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import { kvShortText, type KvOwnRoom } from '../../../shared/kaviski-rooms';
import {
  KV_MEET_AHEAD_DAYS,
  KV_MEET_EARLY_MS,
  KV_MEET_GUEST_AFTER_MS,
  KV_MEET_GUEST_BEFORE_MS,
  KV_MEET_MAX_MS,
  KV_MEET_MIN_MS,
  KV_MEET_NOTE_MAX,
  KV_MEET_PEOPLE_MAX,
  KV_MEET_RELEASE_MS,
  kvDefaultMeet,
  kvExpandRepeat,
  kvInMeeting,
  kvMeetLive,
  kvMeetTitle,
  kvOverlaps,
  kvParseRepeat,
  type KvMeetConfig,
  type KvMeeting,
  type KvMeetingsState,
  type KvMeetingView,
  type KvMeetPerson,
  type KvMeetRoomView,
} from '../../../shared/kaviski-meetings';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';
import { errMsg, log } from '../../log';
import type { KvRooms } from './rooms';
import type { KvMeetingLock } from './social';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Reservas guardadas no máximo (as velhas saem primeiro). */
const MEETINGS_MAX = 5000;
/** Reunião que acabou (ou foi liberada) há mais que isto some do arquivo. */
const KEEP_MS = 30 * DAY;
/** Janela máxima de um GET. */
const WINDOW_MAX = 62 * DAY;
const TICK_MS = 10_000;

interface FileShape {
  version: 1;
  meetings: KvMeeting[];
}

export type KvMeetResult<T = KvMeeting> = { ok: true; value: T; warnings?: string[]; skipped?: { start: number; end: number }[] } | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

const bad = (status: number, error: string, extra?: Record<string, unknown>): { ok: false; status: number; error: string; extra?: Record<string, unknown> } => ({ ok: false, status, error, ...(extra ? { extra } : {}) });

const floorMin = (t: number) => Math.floor(t / MINUTE) * MINUTE;

export interface KvMeetingsDeps {
  file: string | null;
  rooms: KvRooms;
  now?: () => number;
  /** Fuso das repetições (padrão: o do servidor). */
  tz?: string;
  /** Pessoas que existem (nome pelo id). */
  people: () => { id: string; name: string; role: string }[];
  /** Mudou alguma reserva: as páginas relêem (evento `meetings`). */
  changed?: () => void;
  /** Mudou quem vê qual sala (janela do convidado): as páginas relêem as salas e a planta. */
  roomsChanged?: () => void;
  /** Reuniões privadas acontecendo agora (social.ts tranca e cobre as salas). */
  locks?: (list: KvMeetingLock[]) => void;
  /** Horários ocupados da agenda (ICS) de uma pessoa (agenda.ts). */
  agendaBusy?: (id: string, from: number, to: number) => { start: number; end: number }[];
  audit?: (person: KvPerson, action: string, detail: string, ok: boolean) => void;
}

export class KvMeetings {
  private list: KvMeeting[] = [];
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private guestSig = '';
  private lockSig = '';

  constructor(private readonly deps: KvMeetingsDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ------------------------------------------------------------------ arquivo

  load(): void {
    if (!this.deps.file) return;
    try {
      const data = JSON.parse(readFileSync(this.deps.file, 'utf8')) as Partial<FileShape>;
      this.list = (Array.isArray(data.meetings) ? data.meetings : []).filter(
        (m) => m && typeof m.id === 'string' && typeof m.room === 'string' && typeof m.start === 'number' && typeof m.end === 'number' && m.end > m.start && m.by && typeof m.by.id === 'string',
      );
      for (const m of this.list) {
        m.people = Array.isArray(m.people) ? m.people.filter((p) => typeof p === 'string') : [];
        m.private = m.private === true;
        m.title = kvMeetTitle(m.title) ?? tr('Reunião');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('Reuniões: não deu para ler {0} ({1}).', [this.deps.file, errMsg(err)]));
    }
  }

  private save(): void {
    if (!this.deps.file) return;
    try {
      mkdirSync(dirname(this.deps.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.deps.file}.tmp`;
      const data: FileShape = { version: 1, meetings: this.list };
      writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
      renameSync(tmp, this.deps.file);
    } catch (err) {
      log.warn(tr('Reuniões: não deu para gravar {0} ({1}).', [this.deps.file, errMsg(err)]));
    }
  }

  /** Gravou e mudou: avisa as páginas e refaz as trancas das privadas. */
  private commit(): void {
    this.save();
    this.deps.changed?.();
    this.sync(true);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------------ consultas

  all(): readonly KvMeeting[] {
    return this.list;
  }

  get(id: string): KvMeeting | undefined {
    return this.list.find((m) => m.id === id);
  }

  /** A sala de reunião (com a configuração) pelo id. */
  private roomOf(id: unknown): { room: KvOwnRoom; meet: KvMeetConfig } | undefined {
    if (typeof id !== 'string') return undefined;
    const room = this.deps.rooms.get(id);
    if (!room || room.kind !== 'reuniao') return undefined;
    return { room, meet: room.meet ?? kvDefaultMeet() };
  }

  canBook(person: KvPerson | undefined): boolean {
    return person?.role === 'admin' || person?.role === 'equipe';
  }

  /** Pode mudar/cancelar: o organizador ou um admin. */
  private canEdit(m: KvMeeting, person: KvPerson): boolean {
    return person.role === 'admin' || m.by.id === person.id;
  }

  /** Reservas que ocupam a sala no horário (sem a `except`). */
  conflicts(room: string, slot: { start: number; end: number }, except?: string): KvMeeting[] {
    return this.list.filter((m) => m.room === room && !m.released && m.id !== except && kvOverlaps(m, slot));
  }

  /** O convidado vê a sala da reunião de 15 min antes a 5 min depois (regra do KvRooms.sees). */
  guestSees(roomId: string, personId: string, now = this.now()): boolean {
    return this.list.some((m) => m.room === roomId && !m.released && kvInMeeting(m, personId) && m.start - KV_MEET_GUEST_BEFORE_MS <= now && m.end + KV_MEET_GUEST_AFTER_MS > now);
  }

  /** A reunião acontecendo na sala agora. */
  liveIn(roomId: string, now = this.now()): KvMeeting | undefined {
    return this.list.find((m) => m.room === roomId && kvMeetLive(m, now));
  }

  /** Reuniões privadas acontecendo agora, para as trancas (social.ts). */
  privateLocks(now = this.now()): KvMeetingLock[] {
    return this.list
      .filter((m) => m.private && kvMeetLive(m, now))
      .map((m) => ({ id: m.id, area: `r:${m.room}`, by: { ...m.by }, members: [m.by.id, ...m.people], until: m.end, title: m.title }));
  }

  /** Horários ocupados de cada pessoa: reservas em que está + a agenda dela (sem títulos). */
  busy(ids: readonly string[], from: number, to: number): Record<string, { start: number; end: number }[]> {
    const out: Record<string, { start: number; end: number }[]> = {};
    for (const id of ids) {
      const own = this.list.filter((m) => !m.released && kvInMeeting(m, id) && m.end > from && m.start < to).map((m) => ({ start: m.start, end: m.end }));
      out[id] = [...own, ...(this.deps.agendaBusy?.(id, from, to) ?? [])].sort((a, b) => a.start - b.start);
    }
    return out;
  }

  /** O que `person` vê de uma reserva. */
  view(m: KvMeeting, person: KvPerson): KvMeetingView {
    const mine = kvInMeeting(m, person.id);
    const edit = this.canEdit(m, person);
    const open = mine || edit || !m.private;
    const names = new Map(this.deps.people().map((p) => [p.id, p.name]));
    const who = (id: string): KvMeetPerson => ({ id, name: names.get(id) ?? id });
    return {
      id: m.id,
      room: m.room,
      start: m.start,
      end: m.end,
      private: m.private,
      mine,
      ...(open ? { title: m.title, by: { ...m.by } } : {}),
      ...(mine || edit ? { people: m.people.map(who), ...(m.note ? { note: m.note } : {}) } : {}),
      ...(m.series ? { series: m.series } : {}),
      ...(m.checkin ? { checkin: m.checkin } : {}),
      ...(m.released ? { released: m.released } : {}),
      ...(edit ? { canEdit: true } : {}),
    };
  }

  /** GET: as salas reserváveis que vejo (e as das minhas reuniões) e as reservas do intervalo. */
  state(person: KvPerson, from: number, to: number): KvMeetingsState {
    const t = this.now();
    if (!(to > from) || to - from > WINDOW_MAX) {
      from = t - DAY;
      to = t + 15 * DAY;
    }
    const seen = new Set(this.deps.rooms.visibleTo(person).filter((r) => r.kind === 'reuniao').map((r) => r.id));
    const meetings = this.list.filter((m) => m.end > from && m.start < to && (seen.has(m.room) || kvInMeeting(m, person.id)) && (!m.released || kvInMeeting(m, person.id) || person.role === 'admin'));
    const ids = new Set([...seen, ...meetings.map((m) => m.room)]);
    const rooms: KvMeetRoomView[] = [];
    for (const id of ids) {
      const r = this.roomOf(id);
      if (!r) continue;
      rooms.push({ id, name: r.room.name, meet: { ...r.meet, equipment: [...r.meet.equipment] }, ...(r.room.color ? { color: r.room.color } : {}) });
    }
    rooms.sort((a, b) => a.meet.capacity - b.meet.capacity || a.name.localeCompare(b.name));
    const canBook = this.canBook(person);
    return {
      now: t,
      rooms,
      meetings: meetings.sort((a, b) => a.start - b.start).map((m) => this.view(m, person)),
      canBook,
      ...(canBook ? { people: this.deps.people().map((p) => ({ id: p.id, name: p.name, role: p.role })) } : {}),
    };
  }

  // ------------------------------------------------------------------ ações

  /** Horário vindo da rede: inteiros, fim depois do começo, duração permitida. */
  private slot(start: unknown, end: unknown): { start: number; end: number } | string {
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return tr('horário inválido');
    const s = floorMin(start);
    const e = floorMin(end);
    if (e - s < KV_MEET_MIN_MS) return tr('a reunião precisa ter pelo menos 5 minutos');
    if (e - s > KV_MEET_MAX_MS) return tr('a reunião pode ter no máximo 12 horas');
    if (s > this.now() + KV_MEET_AHEAD_DAYS * DAY) return tr('dá para marcar até um ano para a frente');
    return { start: s, end: e };
  }

  /** Lista de convidados limpa (pessoas que existem, sem repetir, sem o organizador). */
  private guests(v: unknown, organizer: string): string[] | string {
    if (!Array.isArray(v) || v.length > KV_MEET_PEOPLE_MAX) return tr('lista de convidados inválida');
    const known = new Set(this.deps.people().map((p) => p.id));
    const out: string[] = [];
    for (const id of v) {
      if (typeof id !== 'string' || !known.has(id)) return tr('convidado desconhecido');
      if (id !== organizer && !out.includes(id)) out.push(id);
    }
    return out;
  }

  private warnings(meet: KvMeetConfig, people: number): string[] {
    return people + 1 > meet.capacity ? [tr('{0} pessoas para {1} lugares nesta sala', [people + 1, meet.capacity])] : [];
  }

  /** A sala que `person` pode reservar. */
  private bookable(person: KvPerson, id: unknown): { room: KvOwnRoom; meet: KvMeetConfig } | string {
    const r = this.roomOf(id);
    if (!r || !this.deps.rooms.sees(r.room, person)) return tr('sala de reunião não encontrada');
    if (!r.meet.bookable) return tr('essa sala não aceita reservas (é de uso livre)');
    return r;
  }

  create(person: KvPerson, body: unknown): KvMeetResult<KvMeeting[]> {
    if (!this.canBook(person)) return bad(403, tr('só a equipe marca reuniões'));
    const b = (body ?? {}) as Record<string, unknown>;
    const r = this.bookable(person, b.room);
    if (typeof r === 'string') return bad(404, r);
    const slot = this.slot(b.start, b.end);
    if (typeof slot === 'string') return bad(400, slot);
    if (slot.end <= this.now()) return bad(400, tr('esse horário já passou'));
    const people = b.people === undefined ? [] : this.guests(b.people, person.id);
    if (typeof people === 'string') return bad(400, people);
    if (b.private !== undefined && typeof b.private !== 'boolean') return bad(400, tr('“privada” inválido'));
    const note = b.note === undefined || b.note === '' ? undefined : kvShortText(b.note, KV_MEET_NOTE_MAX);
    if (b.note !== undefined && b.note !== '' && !note) return bad(400, tr('nota inválida'));
    const repeat = kvParseRepeat(b.repeat);
    if (repeat === null) return bad(400, tr('repetição inválida'));
    const title = kvMeetTitle(b.title) ?? tr('Reunião de {0}', [person.name]);
    const slots = kvExpandRepeat(slot.start, slot.end, repeat, this.deps.tz);
    const busy = slots.map((s) => ({ s, hit: this.conflicts(r.room.id, s) }));
    const taken = busy.filter((x) => x.hit.length);
    if (taken.length && (b.skipConflicts !== true || taken.length === slots.length)) {
      const viewer = person;
      return bad(409, slots.length > 1 ? tr('{0} de {1} horários já estão reservados nesta sala', [taken.length, slots.length]) : tr('a sala já está reservada nesse horário'), {
        conflicts: taken.flatMap((x) => x.hit.map((m) => ({ start: m.start, end: m.end, ...(this.view(m, viewer).title ? { title: this.view(m, viewer).title } : {}) }))),
      });
    }
    const t = this.now();
    const series = slots.length > 1 ? randomBytes(6).toString('base64url') : undefined;
    const made: KvMeeting[] = [];
    for (const x of busy) {
      if (x.hit.length) continue;
      made.push({
        id: randomBytes(8).toString('base64url'),
        room: r.room.id,
        title,
        start: x.s.start,
        end: x.s.end,
        by: { id: person.id, name: person.name },
        people: [...people],
        private: typeof b.private === 'boolean' ? b.private : r.meet.privateDefault,
        ...(note ? { note } : {}),
        ...(series ? { series } : {}),
        createdAt: t,
        updatedAt: t,
      });
    }
    this.list.push(...made);
    this.prune();
    this.commit();
    this.deps.audit?.(person, 'marcar reunião', `${r.room.name} · ${title}${made.length > 1 ? ` (${made.length}x)` : ''}`, true);
    const warnings = this.warnings(r.meet, people.length);
    return { ok: true, value: made, ...(warnings.length ? { warnings } : {}), ...(taken.length ? { skipped: taken.map((x) => x.s) } : {}) };
  }

  update(person: KvPerson, id: string, body: unknown): KvMeetResult {
    const m = this.get(id);
    if (!m || !this.visible(m, person)) return bad(404, tr('reunião não encontrada'));
    if (!this.canEdit(m, person)) return bad(403, tr('só quem marcou (ou um admin) muda a reunião'));
    if (m.released) return bad(409, tr('essa reunião foi liberada ou cancelada'));
    const t = this.now();
    if (m.end <= t) return bad(409, tr('essa reunião já acabou'));
    const b = (body ?? {}) as Record<string, unknown>;
    const next: KvMeeting = { ...m, people: [...m.people], by: { ...m.by } };
    if (b.title !== undefined) {
      const title = kvMeetTitle(b.title);
      if (!title) return bad(400, tr('título inválido'));
      next.title = title;
    }
    if (b.private !== undefined) {
      if (typeof b.private !== 'boolean') return bad(400, tr('“privada” inválido'));
      next.private = b.private;
    }
    if (b.note !== undefined) {
      if (b.note === '' || b.note === null) delete next.note;
      else {
        const note = kvShortText(b.note, KV_MEET_NOTE_MAX);
        if (!note) return bad(400, tr('nota inválida'));
        next.note = note;
      }
    }
    if (b.people !== undefined) {
      const people = this.guests(b.people, m.by.id);
      if (typeof people === 'string') return bad(400, people);
      next.people = people;
    }
    let meet: KvMeetConfig | undefined;
    if (b.room !== undefined && b.room !== m.room) {
      const r = this.bookable(person, b.room);
      if (typeof r === 'string') return bad(404, r);
      next.room = r.room.id;
      meet = r.meet;
      delete next.checkin;
    }
    if (b.start !== undefined || b.end !== undefined) {
      const slot = this.slot(b.start ?? m.start, b.end ?? m.end);
      if (typeof slot === 'string') return bad(400, slot);
      if (slot.end <= t) return bad(400, tr('esse horário já passou'));
      next.start = slot.start;
      next.end = slot.end;
    }
    if (next.room !== m.room || next.start !== m.start || next.end !== m.end) {
      const hit = this.conflicts(next.room, next, m.id);
      if (hit.length) return bad(409, tr('a sala já está reservada nesse horário'), { conflicts: hit.map((x) => ({ start: x.start, end: x.end, ...(this.view(x, person).title ? { title: this.view(x, person).title } : {}) })) });
    }
    next.updatedAt = t;
    Object.assign(m, next);
    // série: título, convidados, privada e nota valem também para as próximas
    if (b.series === true && m.series) {
      for (const o of this.list) {
        if (o === m || o.series !== m.series || o.start < m.start || o.released) continue;
        o.title = m.title;
        o.people = [...m.people];
        o.private = m.private;
        if (m.note) o.note = m.note;
        else delete o.note;
        o.updatedAt = t;
      }
    }
    this.commit();
    this.deps.audit?.(person, 'mudar reunião', m.title, true);
    const r = meet ?? this.roomOf(m.room)?.meet;
    const warnings = r ? this.warnings(r, m.people.length) : [];
    return { ok: true, value: m, ...(warnings.length ? { warnings } : {}) };
  }

  cancel(person: KvPerson, id: string, series: boolean): KvMeetResult<number> {
    const m = this.get(id);
    if (!m || !this.visible(m, person)) return bad(404, tr('reunião não encontrada'));
    if (!this.canEdit(m, person)) return bad(403, tr('só quem marcou (ou um admin) cancela a reunião'));
    const gone = this.list.filter((o) => o === m || (series && !!m.series && o.series === m.series && o.start >= m.start));
    this.list = this.list.filter((o) => !gone.includes(o));
    this.commit();
    this.deps.audit?.(person, 'cancelar reunião', `${m.title}${gone.length > 1 ? ` (${gone.length}x)` : ''}`, true);
    return { ok: true, value: gone.length };
  }

  checkin(person: KvPerson, id: string): KvMeetResult {
    const m = this.get(id);
    if (!m || !this.visible(m, person)) return bad(404, tr('reunião não encontrada'));
    if (!kvInMeeting(m, person.id) && person.role !== 'admin') return bad(403, tr('só quem é da reunião faz o check-in'));
    const t = this.now();
    if (m.released) return bad(409, tr('essa reunião foi liberada ou cancelada'));
    if (t < m.start - KV_MEET_EARLY_MS || t >= m.end) return bad(409, tr('o check-in abre 5 minutos antes da reunião'));
    if (!m.checkin) {
      m.checkin = t;
      this.commit();
    }
    return { ok: true, value: m };
  }

  /** Encerra agora (a sala fica livre). Organizador, admin ou alguém da reunião que está na sala. */
  end(person: KvPerson, id: string, inRoom: boolean): KvMeetResult {
    const m = this.get(id);
    if (!m || !this.visible(m, person)) return bad(404, tr('reunião não encontrada'));
    if (!this.canEdit(m, person) && !(kvInMeeting(m, person.id) && inRoom)) return bad(403, tr('só quem é da reunião (e está na sala) encerra'));
    const t = this.now();
    if (!kvMeetLive(m, t)) return bad(409, tr('essa reunião não está acontecendo agora'));
    // acaba agora mesmo (a sala fica livre na hora; o que sobrar da reunião some da agenda)
    m.end = Math.max(m.start + 1, t);
    m.updatedAt = t;
    this.commit();
    this.deps.audit?.(person, 'encerrar reunião', m.title, true);
    return { ok: true, value: m };
  }

  extend(person: KvPerson, id: string, minutes: unknown): KvMeetResult {
    const m = this.get(id);
    if (!m || !this.visible(m, person)) return bad(404, tr('reunião não encontrada'));
    if (!kvInMeeting(m, person.id) && person.role !== 'admin') return bad(403, tr('só quem é da reunião estende o horário'));
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 5 || minutes > 120) return bad(400, tr('minutos inválidos'));
    const t = this.now();
    if (m.released || m.end <= t) return bad(409, tr('essa reunião já acabou'));
    const next = { start: m.start, end: m.end + minutes * MINUTE };
    if (next.end - next.start > KV_MEET_MAX_MS) return bad(400, tr('a reunião pode ter no máximo 12 horas'));
    const hit = this.conflicts(m.room, { start: m.end, end: next.end }, m.id);
    if (hit.length) return bad(409, tr('a sala tem outra reserva logo depois'), { conflicts: hit.map((x) => ({ start: x.start, end: x.end })), freeUntil: hit.sort((x, y) => x.start - y.start)[0]!.start });
    m.end = next.end;
    m.updatedAt = t;
    this.commit();
    return { ok: true, value: m };
  }

  /** "Usar agora" pela porta: começa agora, check-in feito; convidados = quem já está na sala. */
  quick(person: KvPerson, body: unknown, inside: readonly string[]): KvMeetResult {
    if (!this.canBook(person)) return bad(403, tr('só a equipe reserva salas'));
    const b = (body ?? {}) as Record<string, unknown>;
    const r = this.bookable(person, b.room);
    if (typeof r === 'string') return bad(404, r);
    const minutes = b.minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 5 || minutes > 240) return bad(400, tr('minutos inválidos'));
    if (b.private !== undefined && typeof b.private !== 'boolean') return bad(400, tr('“privada” inválido'));
    const t = this.now();
    const start = floorMin(t);
    const slot = { start, end: start + minutes * MINUTE };
    const live = this.liveIn(r.room.id, t);
    if (live) return bad(409, tr('a sala está ocupada agora'));
    const hit = this.conflicts(r.room.id, slot);
    if (hit.length) {
      const first = hit.sort((a, x) => a.start - x.start)[0]!;
      return bad(409, tr('a sala tem reserva logo mais: dá para usar até a próxima'), { conflicts: hit.map((x) => ({ start: x.start, end: x.end })), freeUntil: first.start });
    }
    const people = inside.filter((id, i) => id !== person.id && inside.indexOf(id) === i).slice(0, KV_MEET_PEOPLE_MAX);
    const m: KvMeeting = {
      id: randomBytes(8).toString('base64url'),
      room: r.room.id,
      title: kvMeetTitle(b.title) ?? tr('Uso imediato'),
      start,
      end: slot.end,
      by: { id: person.id, name: person.name },
      people,
      private: typeof b.private === 'boolean' ? b.private : r.meet.privateDefault,
      checkin: t,
      createdAt: t,
      updatedAt: t,
    };
    this.list.push(m);
    this.prune();
    this.commit();
    this.deps.audit?.(person, 'usar sala agora', `${r.room.name} · ${minutes} min${m.private ? ' · privada' : ''}`, true);
    return { ok: true, value: m };
  }

  /** Destrancaram a sala de uma reunião privada (social.ts): ela deixa de ser privada. */
  unlocked(id: string, person: KvPerson): void {
    const m = this.get(id);
    if (!m || !m.private) return;
    m.private = false;
    m.updatedAt = this.now();
    this.commit();
    this.deps.audit?.(person, 'reunião deixou de ser privada', m.title, true);
  }

  /** A pessoa mudou de área: entrou na sala de uma reunião dela (a partir de 5 min antes) = check-in. */
  onArea(personId: string, area: string | undefined): void {
    if (!area?.startsWith('r:')) return;
    const room = area.slice(2);
    const t = this.now();
    const m = this.list.find((x) => x.room === room && !x.released && !x.checkin && x.start - KV_MEET_EARLY_MS <= t && x.end > t && kvInMeeting(x, personId));
    if (!m) return;
    m.checkin = t;
    this.commit();
  }

  /** Sala apagada: as reservas dela somem. */
  dropRoom(id: string): void {
    const before = this.list.length;
    this.list = this.list.filter((m) => m.room !== id);
    if (this.list.length !== before) this.commit();
  }

  /** A cada 10 s: liberação automática, limpeza, janela dos convidados e trancas das privadas. */
  tick(): void {
    const t = this.now();
    let dirty = false;
    for (const m of this.list) {
      if (m.released || m.checkin || t < m.start + KV_MEET_RELEASE_MS || m.end <= t) continue;
      const r = this.roomOf(m.room);
      if (!r || !r.meet.autoRelease) continue;
      m.released = 'auto';
      m.updatedAt = t;
      dirty = true;
      log.info(tr('Reuniões: "{0}" liberada (ninguém apareceu em 10 min).', [m.title]));
    }
    // sala que não existe mais (ou deixou de ser de reunião)
    const before = this.list.length;
    this.list = this.list.filter((m) => this.roomOf(m.room));
    if (this.list.length !== before) dirty = true;
    if (this.prune()) dirty = true;
    if (dirty) {
      this.save();
      this.deps.changed?.();
    }
    this.sync(false);
  }

  /** Trancas das privadas e janela dos convidados (só avisa quando muda). */
  private sync(force: boolean): void {
    const t = this.now();
    const locks = this.privateLocks(t);
    const lockSig = JSON.stringify(locks);
    if (force || lockSig !== this.lockSig) {
      this.lockSig = lockSig;
      this.deps.locks?.(locks);
    }
    const guests = this.list
      .filter((m) => !m.released && m.start - KV_MEET_GUEST_BEFORE_MS <= t && m.end + KV_MEET_GUEST_AFTER_MS > t)
      .map((m) => `${m.room}:${[m.by.id, ...m.people].sort().join(',')}`)
      .sort()
      .join('|');
    if (guests !== this.guestSig) {
      const first = this.guestSig === '' && guests === '';
      this.guestSig = guests;
      if (!first) this.deps.roomsChanged?.();
    }
  }

  /** Tira as velhas (acabaram há mais de 30 dias) e segura o tamanho. true = tirou alguma. */
  private prune(): boolean {
    const t = this.now();
    const before = this.list.length;
    this.list = this.list.filter((m) => m.end > t - KEEP_MS);
    if (this.list.length > MEETINGS_MAX) this.list = this.list.sort((a, b) => b.end - a.end).slice(0, MEETINGS_MAX);
    return this.list.length !== before;
  }

  /** `person` vê esta reserva (vê a sala, ou é da reunião). */
  private visible(m: KvMeeting, person: KvPerson): boolean {
    return kvInMeeting(m, person.id) || person.role === 'admin' || this.deps.rooms.canSee(m.room, person);
  }
}

// ------------------------------------------------------------------ rota

export const MEETINGS_PATH = '/api/kaviski/humanos/meetings';

export interface KvMeetingsRouteDeps {
  meetings: KvMeetings;
  whoIs(req: IncomingMessage): KvPerson | undefined;
  /** Quem está online numa área agora (ids). */
  inArea(area: string): string[];
  /** A área atual da pessoa. */
  areaOf(id: string): string | undefined;
}

export function kvIsMeetingsPath(path: string): boolean {
  return path === MEETINGS_PATH || path.startsWith(`${MEETINGS_PATH}/`);
}

export function kvMeetingsRoute(req: IncomingMessage, res: ServerResponse, url: URL, deps: KvMeetingsRouteDeps): void {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  const person = deps.whoIs(req);
  const mt = deps.meetings;
  const fail = (err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };
  const answer = <T>(r: KvMeetResult<T>, ok: (v: T) => Record<string, unknown>, status = 200) => {
    if (!r.ok) return sendJson(res, r.status, { error: r.error, ...r.extra });
    sendJson(res, status, { ...ok(r.value), ...(r.warnings ? { warnings: r.warnings } : {}), ...(r.skipped ? { skipped: r.skipped } : {}) });
  };
  if (!person) {
    req.resume();
    return sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
  }
  const isRead = method === 'GET' || method === 'HEAD';
  const num = (k: string) => {
    const v = url.searchParams.get(k);
    return v === null || v === '' ? NaN : Number(v);
  };
  if (path === MEETINGS_PATH && isRead) {
    req.resume();
    return sendJson(res, 200, mt.state(person, num('from'), num('to')));
  }
  if (path === `${MEETINGS_PATH}/freebusy`) {
    req.resume();
    if (!isRead) return sendJson(res, 405, { error: tr('método não permitido') });
    if (kvRestricted(person)) return sendJson(res, 403, { error: tr('só a equipe vê a disponibilidade das pessoas') });
    const ids = (url.searchParams.get('people') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, KV_MEET_PEOPLE_MAX + 1);
    let from = num('from');
    let to = num('to');
    if (!(to > from) || to - from > 14 * DAY) {
      from = Date.now() - DAY;
      to = Date.now() + 2 * DAY;
    }
    return sendJson(res, 200, { busy: mt.busy(ids, from, to) });
  }
  if (method !== 'POST' && method !== 'DELETE') {
    req.resume();
    res.setHeader('Allow', 'GET, POST, DELETE');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  const rest = path === MEETINGS_PATH ? '' : path.slice(MEETINGS_PATH.length + 1);
  const [rawId, action] = rest.split('/');
  let id = '';
  try {
    id = decodeURIComponent(rawId ?? '');
  } catch {
    req.resume();
    return sendJson(res, 400, { error: tr('id inválido') });
  }
  if (method === 'DELETE') {
    req.resume();
    if (!id || action) return sendJson(res, 404, { error: tr('reunião não encontrada') });
    return answer(mt.cancel(person, id, url.searchParams.get('series') === '1'), (n) => ({ ok: true, cancelled: n }));
  }
  readJson(req, 16_384)
    .then((body) => {
      const view = (m: KvMeeting) => mt.view(m, person);
      if (!id) return answer(mt.create(person, body), (list) => ({ meetings: list.map(view) }), 201);
      if (id === 'now' && !action) {
        const room = (body as { room?: unknown })?.room;
        return answer(mt.quick(person, body, typeof room === 'string' ? deps.inArea(`r:${room}`) : []), (m) => ({ meeting: view(m) }), 201);
      }
      if (!action) return answer(mt.update(person, id, body), (m) => ({ meeting: view(m) }));
      if (action === 'checkin') return answer(mt.checkin(person, id), (m) => ({ meeting: view(m) }));
      if (action === 'end') {
        const m = mt.get(id);
        return answer(mt.end(person, id, !!m && deps.areaOf(person.id) === `r:${m.room}`), (x) => ({ meeting: view(x) }));
      }
      if (action === 'extend') return answer(mt.extend(person, id, (body as { minutes?: unknown })?.minutes), (m) => ({ meeting: view(m) }));
      throw new HttpError(404, tr('rota desconhecida'));
    })
    .catch(fail);
}
