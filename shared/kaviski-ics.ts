// Fork Kaviski (KAVISKI-HUMANOS.md): leitor de agenda no formato iCalendar (ICS, RFC 5545) — o "endereço secreto no
// formato iCal" do Google Agenda, do Outlook, do iCloud etc. Próprio e simples, sem biblioteca:
// - VEVENT com SUMMARY, LOCATION, DESCRIPTION, UID, STATUS (CANCELLED some), TRANSP (TRANSPARENT = livre);
// - DTSTART/DTEND (ou DURATION) em UTC (…Z), com TZID (fuso IANA; os nomes do Windows mais comuns no Brasil também),
//   "flutuante" (no fuso da agenda: X-WR-TIMEZONE, o primeiro VTIMEZONE ou o padrão) ou dia inteiro (VALUE=DATE);
// - RRULE básica: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY com INTERVAL, COUNT, UNTIL e BYDAY (semanal), EXDATE e as
//   exceções de uma ocorrência (RECURRENCE-ID).
// As repetições seguem a hora local do fuso do evento (reunião das 15h continua às 15h depois do horário de verão).

export interface KvCalEvent {
  uid: string;
  title: string;
  /** Início e fim (epoch ms). Dia inteiro: meia-noite no fuso da agenda. */
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  description?: string;
  /** false = marcado como "livre" (TRANSP:TRANSPARENT): não muda o status. */
  busy: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface DateVal {
  /** Hora de parede (ano, mês 1-12, dia, h, min, s). */
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** 'utc' | nome do fuso | null (flutuante). */
  tz: string | null;
  date: boolean;
}

const MAX_OCCURRENCES = 20_000;
const TEXT_MAX = 300;
const DAY = 86_400_000;

/** Nomes de fuso do Windows (Outlook/Exchange) mais comuns aqui → IANA. */
const WINDOWS_TZ: Record<string, string> = {
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Eastern Standard Time': 'America/Fortaleza',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/Manaus',
  'SA Pacific Standard Time': 'America/Bogota',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'Pacific SA Standard Time': 'America/Santiago',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'GTB Standard Time': 'Europe/Bucharest',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch {
      f = null;
    }
    formatters.set(tz, f);
  }
  return formatters.get(tz)!;
}

/** Fuso conhecido (IANA ou Windows) ou null. */
export function kvResolveTz(name: string | undefined | null): string | null {
  if (!name) return null;
  const n = name.trim().replace(/^"|"$/g, '').replace(/^\/[^/]+\/[^/]+\//, ''); // "/mozilla.org/20050126_1/Europe/Paris"
  if (/^(utc|gmt|z)$/i.test(n)) return 'UTC';
  if (formatter(n)) return n;
  const w = WINDOWS_TZ[n];
  return w && formatter(w) ? w : null;
}

/** Quanto o fuso está à frente do UTC (ms) no instante `utc`. */
function offsetAt(tz: string, utc: number): number {
  const f = formatter(tz);
  if (!f) return 0;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utc))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour === 24 ? 0 : p.hour!, p.minute!, p.second!) - Math.floor(utc / 1000) * 1000;
}

/** Hora de parede num fuso → epoch ms (na hora que não existe, por causa do horário de verão, anda para a frente). */
export function kvZonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (tz === 'UTC') return wall;
  const o1 = offsetAt(tz, wall - offsetAt(tz, wall));
  let t = wall - o1;
  const o2 = offsetAt(tz, t);
  if (o2 !== o1) t = wall - o2;
  return t;
}

/** Hora de parede de um instante num fuso. */
function wallOf(utc: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const t = new Date(utc + (tz === 'UTC' ? 0 : offsetAt(tz, utc)));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}

function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1);
    else if (raw) out.push(raw);
  }
  return out;
}

function parseLine(line: string): Prop | null {
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = head.split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0]!.toUpperCase(), params, value };
}

function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function cleanText(v: string | undefined, max = TEXT_MAX): string | undefined {
  if (!v) return undefined;
  // eslint-disable-next-line no-control-regex
  const s = unescapeText(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function parseDate(p: Prop | undefined, calTz: string | null): DateVal | null {
  if (!p) return null;
  const v = p.value.trim().split(',')[0]!;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const date = !m[4] || p.params.VALUE === 'DATE';
  const tz = m[7] ? 'utc' : (kvResolveTz(p.params.TZID) ?? calTz);
  return { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: date ? 0 : +m[4]!, mi: date ? 0 : +m[5]!, s: date ? 0 : +(m[6] ?? 0), tz, date };
}

function toUtc(v: DateVal, fallbackTz: string): number {
  const tz = v.tz === 'utc' ? 'UTC' : (v.tz ?? fallbackTz);
  return kvZonedToUtc(v.y, v.mo, v.d, v.h, v.mi, v.s, tz);
}

/** DURATION (P1DT2H, PT30M, P1W) em ms, ou null. */
export function kvParseDuration(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m || v.trim() === 'P' || v.trim().endsWith('T')) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 * 3600 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: number;
  byday?: number[];
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseRule(v: string | undefined, fallbackTz: string, calTz: string | null): Rule | null {
  if (!v) return null;
  const kv: Record<string, string> = {};
  for (const part of v.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  }
  const freq = kv.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  // regras que não sabemos ler direito: melhor não inventar ocorrências
  if (kv.BYSETPOS || kv.BYHOUR || kv.BYMINUTE || kv.BYYEARDAY || kv.BYWEEKNO || (freq !== 'WEEKLY' && kv.BYDAY) || kv.BYMONTHDAY || kv.BYMONTH) return null;
  const rule: Rule = { freq, interval: Math.max(1, Math.min(1000, Number(kv.INTERVAL) || 1)) };
  if (kv.COUNT) rule.count = Math.max(1, Math.min(MAX_OCCURRENCES, Number(kv.COUNT) || 1));
  if (kv.UNTIL) {
    const u = parseDate({ name: 'UNTIL', params: {}, value: kv.UNTIL }, calTz);
    if (u) rule.until = u.date ? toUtc(u, fallbackTz) + DAY - 1 : toUtc(u, fallbackTz);
  }
  if (kv.BYDAY) {
    const days = kv.BYDAY.split(',').map((d) => WEEKDAYS.indexOf(d.replace(/^[+-]?\d+/, ''))).filter((d) => d >= 0);
    if (days.length) rule.byday = [...new Set(days)].sort((a, b) => a - b);
  }
  return rule;
}

/** Dia (contado a partir de 1970-01-01) de uma data de parede. */
const dayNo = (y: number, mo: number, d: number) => Math.floor(Date.UTC(y, mo - 1, d) / DAY);
const fromDayNo = (n: number) => {
  const t = new Date(n * DAY);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/** Inícios (epoch ms) das ocorrências de uma regra, de `start` em diante, até `to`. */
function expand(start: DateVal, rule: Rule, tz: string, to: number): number[] {
  const out: number[] = [];
  const first = dayNo(start.y, start.mo, start.d);
  const at = (y: number, mo: number, d: number) => kvZonedToUtc(y, mo, d, start.h, start.mi, start.s, tz);
  let n = 0;
  const push = (t: number): boolean => {
    if (rule.until !== undefined && t > rule.until) return false;
    if (t > to) return false;
    out.push(t);
    n++;
    return !(rule.count !== undefined && n >= rule.count) && n < MAX_OCCURRENCES;
  };
  if (rule.freq === 'DAILY') {
    for (let k = 0; ; k += rule.interval) {
      const w = fromDayNo(first + k);
      if (!push(at(w.y, w.mo, w.d))) break;
    }
  } else if (rule.freq === 'WEEKLY') {
    const startDow = new Date(first * DAY).getUTCDay();
    const days = rule.byday ?? [startDow];
    // semana começa na segunda (WKST=MO, o padrão)
    const weekStart = first - ((startDow + 6) % 7);
    outer: for (let w = 0; ; w += rule.interval) {
      for (const dow of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        const day = weekStart + w * 7 + ((dow + 6) % 7);
        if (day < first) continue;
        const dd = fromDayNo(day);
        if (!push(at(dd.y, dd.mo, dd.d))) break outer;
      }
      if (w > MAX_OCCURRENCES * 7) break;
    }
  } else {
    for (let k = 0; k < MAX_OCCURRENCES; k += rule.interval) {
      const mo0 = rule.freq === 'MONTHLY' ? start.mo - 1 + k : start.mo - 1;
      const y = rule.freq === 'YEARLY' ? start.y + k : start.y + Math.floor(mo0 / 12);
      const mo = (((mo0 % 12) + 12) % 12) + 1;
      // dia 31 em mês sem 31 (ou 29/2 fora do bissexto) não existe: pula, como manda a RFC
      if (new Date(Date.UTC(y, mo - 1, start.d)).getUTCDate() !== start.d) continue;
      if (!push(at(y, mo, start.d))) break;
    }
  }
  return out;
}

interface RawEvent {
  props: Map<string, Prop[]>;
}

const one = (e: RawEvent, name: string) => e.props.get(name)?.[0];

/**
 * Lê um ICS e devolve os eventos (com as repetições já abertas) que cruzam [from, to], em ordem de início.
 * `defaultTz` vale para horários "flutuantes" sem fuso da agenda (padrão: o do servidor).
 */
export function kvParseIcs(text: string, from: number, to: number, defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): KvCalEvent[] {
  const lines = unfold(text);
  const events: RawEvent[] = [];
  let calTz: string | null = null;
  let firstVtz: string | null = null;
  let cur: RawEvent | null = null;
  let depth = 0;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase();
      if (what === 'VEVENT' && !cur) {
        cur = { props: new Map() };
        depth = 0;
      } else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      const what = p.value.trim().toUpperCase();
      if (cur && depth > 0) depth--;
      else if (cur && what === 'VEVENT') {
        events.push(cur);
        cur = null;
      }
      continue;
    }
    if (cur) {
      if (depth > 0) continue; // VALARM etc.
      const list = cur.props.get(p.name) ?? [];
      list.push(p);
      cur.props.set(p.name, list);
    } else if (p.name === 'X-WR-TIMEZONE') calTz = kvResolveTz(p.value);
    else if (p.name === 'TZID' && !firstVtz) firstVtz = kvResolveTz(p.value);
  }
  const tzCal = calTz ?? firstVtz;
  const fallback = kvResolveTz(defaultTz) ?? 'UTC';
  const baseTz = tzCal ?? fallback;

  // exceções de uma ocorrência (RECURRENCE-ID): trocam a ocorrência original
  const overrides = new Map<string, Set<number>>();
  for (const e of events) {
    const rid = parseDate(one(e, 'RECURRENCE-ID'), tzCal);
    const uid = one(e, 'UID')?.value ?? '';
    if (!rid || !uid) continue;
    const set = overrides.get(uid) ?? new Set<number>();
    set.add(toUtc(rid, baseTz));
    overrides.set(uid, set);
  }

  const out: KvCalEvent[] = [];
  let n = 0;
  for (const e of events) {
    const start = parseDate(one(e, 'DTSTART'), tzCal);
    if (!start) continue;
    const uid = one(e, 'UID')?.value ?? `sem-uid-${n++}`;
    const cancelled = one(e, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED';
    const tz = start.tz === 'utc' ? 'UTC' : (start.tz ?? baseTz);
    const t0 = toUtc(start, baseTz);
    const endVal = parseDate(one(e, 'DTEND'), tzCal);
    const dur = kvParseDuration(one(e, 'DURATION')?.value);
    let length = endVal ? toUtc(endVal, baseTz) - t0 : dur !== null ? dur : start.date ? DAY : 0;
    if (!(length >= 0) || length > 400 * DAY) length = start.date ? DAY : 0;
    const base = {
      uid,
      title: cleanText(one(e, 'SUMMARY')?.value, 120) ?? '',
      allDay: start.date,
      location: cleanText(one(e, 'LOCATION')?.value),
      description: cleanText(one(e, 'DESCRIPTION')?.value),
      busy: one(e, 'TRANSP')?.value.trim().toUpperCase() !== 'TRANSPARENT',
    };
    const isOverride = !!one(e, 'RECURRENCE-ID');
    const rule = isOverride ? null : parseRule(one(e, 'RRULE')?.value, baseTz, tzCal);
    let starts: number[];
    if (rule) {
      const ex = new Set<number>();
      for (const p of e.props.get('EXDATE') ?? []) {
        for (const v of p.value.split(',')) {
          const d = parseDate({ ...p, value: v }, tzCal);
          if (d) ex.add(toUtc(d, baseTz));
        }
      }
      const skip = overrides.get(uid);
      // dia inteiro repete na "parede" do fuso da agenda
      starts = expand(start, rule, start.date ? baseTz : tz, to).filter((t) => !ex.has(t) && !skip?.has(t));
    } else starts = [t0];
    if (cancelled) continue;
    for (const s of starts) {
      const end = start.date && rule ? endOfAllDay(s, length, baseTz) : s + length;
      if (end < from || s > to || (end === s && s < from)) continue;
      const ev: KvCalEvent = { uid, title: base.title, start: s, end, allDay: base.allDay, busy: base.busy };
      if (base.location) ev.location = base.location;
      if (base.description) ev.description = base.description;
      out.push(ev);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end || a.uid.localeCompare(b.uid));
}

/** Fim de uma ocorrência de dia inteiro (mesmo número de dias, à meia-noite local, com ou sem horário de verão). */
function endOfAllDay(start: number, length: number, tz: string): number {
  const w = wallOf(start, tz);
  const days = Math.max(1, Math.round(length / DAY));
  const e = fromDayNo(dayNo(w.y, w.mo, w.d) + days);
  return kvZonedToUtc(e.y, e.mo, e.d, 0, 0, 0, tz);
}
