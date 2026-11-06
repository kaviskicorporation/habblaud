// Fork Kaviski (KAVISKI-HUMANOS.md): agenda de cada pessoa pelo "endereço secreto no formato iCal" (Google Agenda,
// Outlook, iCloud...). Sem OAuth (não há credenciais do Google): a pessoa cola o endereço e o servidor lê o ICS.
//
// - Guardado em <dataDir>/kaviski/agenda.json (permissão 600), fora do users.json de propósito: o perfil pode ir
//   inteiro para a página em algum recurso futuro, e o endereço é um segredo (quem tem o link lê a agenda). Nunca volta
//   ao navegador (só "calendar.google.com · …ics") nem vai a log.
// - Busca: só https (webcal:// vira https://), até 3 redirecionamentos (sempre https), 10 s, 2 MB, e nunca para
//   endereço interno (loopback, rede local, link-local: conferido no IP resolvido, o que barra DNS rebinding).
//   HABBLAUD_AGENDA_PRIVATE=1 libera a rede local (agenda num servidor próprio, ex.: Nextcloud na empresa).
// - A cada 5 min relê as agendas ligadas; os eventos ficam em memória (de ontem até depois de amanhã).
// - GET  /api/kaviski/humanos/agenda          {configured, hint?, fetchedAt?, error?, events: [... + room?]}
//   POST /api/kaviski/humanos/agenda          {url} (vazio = desligar) → a mesma resposta, já com a primeira leitura
//   GET  /api/kaviski/humanos/agenda/rooms    reuniões com sala nas próximas 24 h, de todas as agendas, sem título nem
//                                             dono: só sala e horário, e só as salas que quem pede pode ver.
// Visitante não tem agenda.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import { kvParseIcs, type KvCalEvent } from '../../../shared/kaviski-ics';
import type { KvAgendaEventOut, KvAgendaState, KvRoomBooking } from '../../../shared/kaviski-agenda';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';

export const AGENDA_PATH = '/api/kaviski/humanos/agenda';
export const AGENDA_ROOMS_PATH = '/api/kaviski/humanos/agenda/rooms';
const REFRESH_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const URL_MAX = 2048;
const DAY = 86_400_000;

let allowPrivate = false;
/** HABBLAUD_AGENDA_PRIVATE=1: aceita agenda em endereço da rede local (servidor próprio). */
export function kvAgendaAllowPrivate(on: boolean): void {
  allowPrivate = on;
}

/** Uma sala que dá para achar no texto do evento (de projeto ou sala própria). */
export interface KvAgendaRoom {
  id: string;
  name: string;
  /** Caminho da pasta (sala de projeto): o último pedaço também vale como nome. */
  path?: string;
  /** Área de chat/voz (r:<id>). */
  area: string;
}

// ---------------------------------------------------------------- endereço e busca

/** Endereço limpo (https) ou o motivo da recusa. */
export function kvAgendaUrl(v: unknown): { url: string } | { error: string } {
  if (typeof v !== 'string') return { error: tr('endereço inválido') };
  let s = v.trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:/i, 'https:');
  if (s.length > URL_MAX) return { error: tr('endereço longo demais') };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: tr('endereço inválido') };
  }
  if (u.protocol !== 'https:') return { error: tr('use o endereço https:// (ou webcal://) da agenda') };
  if (u.username || u.password) return { error: tr('endereço com usuário e senha não é aceito') };
  if (!allowPrivate && kvPrivateHost(u.hostname)) return { error: tr('endereço interno não é aceito') };
  return { url: u.toString() };
}

/** Só o suficiente para a pessoa reconhecer qual agenda está ligada (nunca o caminho secreto). */
export function kvAgendaHint(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    // "basic.ics" diz qual é; um pedaço com cara de chave só mostra o fim
    const tail = /^[a-z._-]{1,16}$/i.test(last) ? `…/${last}` : last ? `…${last.slice(-4)}` : '';
    return `${u.hostname}${tail ? ` · ${tail}` : ''}`;
  } catch {
    return '?';
  }
}

/** IP de loopback, rede privada, link-local, CGNAT ou "não roteável" (v4 e v6). */
export function kvPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (m) return kvPrivateIp(m[1]!);
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

/** Nome que é (ou parece) interno: IP privado escrito direto, localhost, .local, .internal. */
export function kvPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(h)) return kvPrivateIp(h);
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || !h.includes('.');
}

/** Erro com texto nosso (vai como está para a página). */
class AgendaError extends Error {}

/** Lê um fluxo até `max` bytes (passou disso: erro). */
export function kvReadLimited(stream: Readable, max = MAX_BYTES): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        stream.destroy();
        fail(new AgendaError(tr('agenda grande demais (mais de {0} MB)', [Math.round(max / 1024 / 1024)])));
      } else chunks.push(c);
    });
    stream.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', fail);
  });
}

/** Resolve o nome e recusa endereço interno (vale para cada conexão, inclusive depois de redirecionar). */
function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void {
  dnsLookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err, '', 0);
    const addrs = list as LookupAddress[];
    if (!addrs.length || (!allowPrivate && addrs.some((a) => kvPrivateIp(a.address)))) {
      return cb(new AgendaError(tr('endereço interno não é aceito')) as NodeJS.ErrnoException, '', 0);
    }
    if ((options as { all?: boolean }).all) cb(null, addrs);
    else cb(null, addrs[0]!.address, addrs[0]!.family);
  });
}

/** Busca o ICS (só https, sem endereço interno, com prazo e limite de tamanho). */
export function kvFetchIcs(url: string, redirects = 3): Promise<string> {
  return new Promise((ok, fail) => {
    const checked = kvAgendaUrl(url);
    if ('error' in checked) return fail(new AgendaError(checked.error));
    const req = request(checked.url, { method: 'GET', lookup: safeLookup as never, timeout: FETCH_TIMEOUT_MS, headers: { Accept: 'text/calendar, */*;q=0.5', 'User-Agent': 'Habblaud-Kaviski/1 (agenda)' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return fail(new AgendaError(tr('redirecionamentos demais')));
        let next: string;
        try {
          next = new URL(res.headers.location, checked.url).toString();
        } catch {
          return fail(new AgendaError(tr('redirecionamento inválido')));
        }
        return kvFetchIcs(next, redirects - 1).then(ok, fail);
      }
      if (status !== 200) {
        res.resume();
        return fail(new AgendaError(status === 404 || status === 410 ? tr('a agenda não existe mais (o endereço mudou?)') : status === 401 || status === 403 ? tr('a agenda recusou o acesso (endereço secreto trocado?)') : tr('a agenda respondeu {0}', [status])));
      }
      kvReadLimited(res).then((text) => {
        if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) return fail(new AgendaError(tr('isso não parece uma agenda iCal (.ics)')));
        ok(text);
      }, fail);
    });
    req.on('timeout', () => req.destroy(new AgendaError(tr('a agenda demorou demais para responder'))));
    req.on('error', (err: NodeJS.ErrnoException) => fail(err instanceof AgendaError ? err : new AgendaError(tr('não deu para buscar a agenda ({0})', [err.code ?? 'erro']))));
    req.end();
  });
}

// ---------------------------------------------------------------- salas no texto do evento

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** A sala citada no local (ou, sem local, na descrição) do evento: a de nome mais longo que aparece inteiro. */
export function kvMatchRoom(ev: Pick<KvCalEvent, 'location' | 'description'>, rooms: readonly KvAgendaRoom[]): KvAgendaRoom | undefined {
  for (const text of [ev.location, ev.description]) {
    if (!text) continue;
    const hay = ` ${norm(text)} `;
    let best: KvAgendaRoom | undefined;
    let bestLen = 0;
    for (const r of rooms) {
      const names = [r.name, r.path?.split('/').filter(Boolean).pop() ?? ''];
      for (const n of names) {
        const k = norm(n);
        if (k.length < 3 || k.length <= bestLen) continue;
        if (hay.includes(` ${k} `)) {
          best = r;
          bestLen = k.length;
        }
      }
    }
    if (best) return best;
  }
  return undefined;
}

// ---------------------------------------------------------------- guarda e leitura

interface Stored {
  url: string;
  setAt: number;
}

interface Cache {
  events: KvCalEvent[];
  fetchedAt?: number;
  error?: string;
  busy?: Promise<void>;
}

export interface KvAgendaDeps {
  file: string | null;
  now?: () => number;
  fetcher?: (url: string) => Promise<string>;
  /** Fuso dos horários "flutuantes" (padrão: o do servidor). */
  tz?: string;
}

export class KvAgenda {
  private stored = new Map<string, Stored>();
  private readonly cache = new Map<string, Cache>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly fetcher: (url: string) => Promise<string>;

  constructor(private readonly deps: KvAgendaDeps) {
    this.now = deps.now ?? Date.now;
    this.fetcher = deps.fetcher ?? ((u) => kvFetchIcs(u));
  }

  load(): void {
    if (!this.deps.file || !existsSync(this.deps.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.deps.file, 'utf8')) as Record<string, Stored>;
      for (const [id, s] of Object.entries(data)) {
        if (s && typeof s.url === 'string' && !('error' in kvAgendaUrl(s.url))) this.stored.set(id, { url: s.url, setAt: Number(s.setAt) || 0 });
      }
    } catch {
      // sem agendas ainda
    }
  }

  private save(): void {
    if (!this.deps.file) return;
    try {
      mkdirSync(dirname(this.deps.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.deps.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(this.stored), null, 2)}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.deps.file);
    } catch {
      // segue em memória
    }
  }

  /** Relê as agendas a cada 5 min (uma de cada vez). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refreshAll(), REFRESH_MS);
    this.timer.unref?.();
    void this.refreshAll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refreshAll(): Promise<void> {
    for (const id of [...this.stored.keys()]) {
      const c = this.cache.get(id);
      if (c?.fetchedAt && this.now() - c.fetchedAt < REFRESH_MS - 30_000) continue;
      await this.refresh(id);
    }
  }

  /** Lê de novo a agenda da pessoa (uma leitura por vez por pessoa). */
  refresh(id: string): Promise<void> {
    const s = this.stored.get(id);
    if (!s) return Promise.resolve();
    const c = this.cache.get(id) ?? { events: [] };
    this.cache.set(id, c);
    if (c.busy) return c.busy;
    c.busy = (async () => {
      try {
        const text = await this.fetcher(s.url);
        const t = this.now();
        c.events = kvParseIcs(text, t - DAY, t + 3 * DAY, this.deps.tz);
        c.error = undefined;
      } catch (err) {
        c.error = (err as Error).message || tr('não deu para buscar a agenda');
      } finally {
        c.fetchedAt = this.now();
        c.busy = undefined;
      }
    })();
    return c.busy;
  }

  configured(id: string): boolean {
    return this.stored.has(id);
  }

  ids(): string[] {
    return [...this.stored.keys()];
  }

  /** Liga (url) ou desliga (vazio) a agenda da pessoa; com url, já faz a primeira leitura. */
  async set(id: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    if (raw === '' || raw === null) {
      this.stored.delete(id);
      this.cache.delete(id);
      this.save();
      return { ok: true };
    }
    const checked = kvAgendaUrl(raw);
    if ('error' in checked) return { ok: false, error: checked.error };
    this.stored.set(id, { url: checked.url, setAt: this.now() });
    this.cache.delete(id);
    this.save();
    await this.refresh(id);
    return { ok: true };
  }

  /** O que a página da pessoa recebe (sem o endereço). */
  state(id: string, rooms: readonly KvAgendaRoom[]): KvAgendaState {
    const s = this.stored.get(id);
    if (!s) return { configured: false, events: [] };
    const c = this.cache.get(id);
    const t = this.now();
    const events = (c?.events ?? []).filter((e) => e.end > t - 12 * 60 * 60 * 1000 && e.start < t + 2 * DAY).map((e) => this.out(e, rooms));
    return { configured: true, hint: kvAgendaHint(s.url), ...(c?.fetchedAt ? { fetchedAt: c.fetchedAt } : {}), ...(c?.error ? { error: c.error } : {}), events };
  }

  private out(e: KvCalEvent, rooms: readonly KvAgendaRoom[]): KvAgendaEventOut {
    const room = e.allDay ? undefined : kvMatchRoom(e, rooms);
    return {
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      busy: e.busy,
      ...(e.location ? { location: e.location } : {}),
      ...(room ? { room: { id: room.id, name: room.name, area: room.area } } : {}),
    };
  }

  /** Horários ocupados da agenda da pessoa (só início e fim, sem título: assistente de agendamento das reuniões). */
  busyOf(id: string, from: number, to: number): { start: number; end: number }[] {
    if (!this.stored.has(id)) return [];
    return (this.cache.get(id)?.events ?? []).filter((e) => e.busy && !e.allDay && e.end > from && e.start < to).map((e) => ({ start: e.start, end: e.end }));
  }

  /** Salas ocupadas nas próximas 24 h por alguma agenda (cada pessoa acha as salas que ela vê). */
  bookings(roomsFor: (id: string) => readonly KvAgendaRoom[]): KvRoomBooking[] {
    const t = this.now();
    const out: KvRoomBooking[] = [];
    const seen = new Set<string>();
    for (const [id, c] of this.cache) {
      if (!this.stored.has(id)) continue;
      const rooms = roomsFor(id);
      if (!rooms.length) continue;
      for (const e of c.events) {
        if (e.allDay || e.end <= t || e.start > t + DAY) continue;
        const r = kvMatchRoom(e, rooms);
        if (!r) continue;
        const key = `${r.id}|${e.start}|${e.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ roomId: r.id, area: r.area, start: e.start, end: e.end });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }
}

// ---------------------------------------------------------------- rotas

export interface KvAgendaRouteDeps {
  who: KvPerson | undefined;
  agenda: KvAgenda;
  /** Salas que a pessoa pode ver (de projeto e próprias). */
  roomsFor: (person: KvPerson) => KvAgendaRoom[];
  /** A pessoa dona de uma agenda (para achar as salas dela nas reservas). */
  personById: (id: string) => KvPerson | undefined;
  audit?: { add(p: KvPerson, action: string, extra: { ok: boolean; detail?: string }): unknown };
}

export function kvAgendaRoute(req: IncomingMessage, res: ServerResponse, path: string, deps: KvAgendaRouteDeps): void {
  const method = req.method ?? 'GET';
  const who = deps.who;
  if (!who) {
    req.resume();
    return sendJson(res, 403, { error: tr('entre com a sua conta para ter uma agenda') });
  }
  if (path === AGENDA_ROOMS_PATH) {
    req.resume();
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    const mine = new Set(deps.roomsFor(who).map((r) => r.id));
    const list = deps.agenda.bookings((id) => {
      const p = deps.personById(id);
      return p ? deps.roomsFor(p) : [];
    });
    return sendJson(res, 200, { bookings: list.filter((b) => mine.has(b.roomId)) });
  }
  if (who.role === 'visitante') {
    req.resume();
    return sendJson(res, 403, { error: tr('visitante não tem agenda') });
  }
  if (method === 'GET' || method === 'HEAD') {
    req.resume();
    return sendJson(res, 200, deps.agenda.state(who.id, deps.roomsFor(who)));
  }
  if (method !== 'POST') {
    req.resume();
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  readJson(req, 8192)
    .then(async (body) => {
      const raw = (body as { url?: unknown })?.url;
      const r = await deps.agenda.set(who.id, typeof raw === 'string' ? raw.trim() : raw);
      if (!r.ok) throw new HttpError(400, r.error);
      const on = deps.agenda.configured(who.id);
      deps.audit?.add(who, on ? 'agenda ligada' : 'agenda desligada', { ok: true });
      sendJson(res, 200, deps.agenda.state(who.id, deps.roomsFor(who)));
    })
    .catch((err) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else sendJson(res, 500, { error: tr('erro interno') });
    });
}
