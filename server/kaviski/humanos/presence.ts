// Fork Kaviski (KAVISKI-HUMANOS.md): presença ao vivo das pessoas (fase 1b).
//
// GET  /api/kaviski/humanos/presence  fluxo SSE: evento `people` (KvPresenceState) logo ao conectar e a cada mudança
//                                     (no máximo ~10 por segundo). Enquanto a página está conectada, a pessoa está online.
// POST /api/kaviski/humanos/presence  {pos?, area?, status?, note?, until?}: onde estou (KvPos, null = fora do
//                                     escritório) e como estou (W2: nota do status até 60 caracteres e "até", epoch ms).
//
// Cada página recebe uma lista feita para quem ela é (filtro no servidor, como o snapshot):
// - equipe e admin veem todo mundo, em qualquer sala;
// - cliente vê a equipe/admin e só os clientes que dividem alguma sala liberada com ele; a posição de quem está numa
//   sala que ele não vê não vai (a pessoa aparece na lista sem lugar).
// Um cliente também não consegue dizer que está numa sala que não é dele (a posição é descartada).
// O SSE não passa por http/sse.ts (é um fluxo à parte, só nosso).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OfficeSnapshot } from '../../../shared/types';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import { kvAreaAllowed } from './livekit';
import { kvOwnRoomIdsFor, kvRoomIdsFor } from './rooms';
import { kvIsOwnRoomId } from '../../../shared/kaviski-rooms';
import { kvDefaultLook, kvIsStatus, kvParsePos, type KvLook, type KvPos, type KvPresencePerson, type KvPresenceState, type KvStatus } from '../../../shared/kaviski-presence';
import { kvStatusNote, kvStatusUntil } from '../../../shared/kaviski-social';

/** Depois que a última página fecha, a pessoa fica mais este tempo (recarregar a página não a tira e põe de volta). */
export const OFFLINE_GRACE_MS = 8_000;
const FLUSH_MS = 100;
const PING_MS = 20_000;
/** Máximo de POSTs por segundo por pessoa (andar manda ~8). */
const MAX_POSTS_PER_S = 25;

interface Entry {
  person: KvPerson;
  status: KvStatus;
  /** Nota do status e até quando vale (W2: o servidor limpa quando vence). */
  note?: string;
  until?: number;
  pos?: KvPos;
  /** Área do escritório (a da chamada de voz e do chat): `r:<sala>`, `a:<núcleo>` ou `c`. */
  area?: string;
  since: number;
  conns: number;
  offlineTimer?: ReturnType<typeof setTimeout>;
  window: number;
  posts: number;
}

interface Viewer {
  res: ServerResponse;
  person: KvPerson;
  last: string;
}

export interface KvPresenceDeps {
  snapshot: () => OfficeSnapshot;
  /** Boneco salvo na conta da pessoa. */
  look: (id: string) => KvLook | undefined;
  /** Mesa fixa da pessoa (desk.ts). */
  desk?: (id: string) => KvPos | undefined;
  now?: () => number;
  /** Recusa um POST (ex.: posição dentro de sala trancada, social.ts): devolve o código do erro ou null. */
  guard?: (person: KvPerson, body: Record<string, unknown>) => string | null;
  /** Campos a mais de uma pessoa como `viewer` a vê (mão levantada, roda privada...). */
  extra?: (viewer: KvPerson, id: string) => Partial<KvPresencePerson>;
  /** Campos a mais do estado de cada página (salas trancadas...). */
  state?: (viewer: KvPerson, snap: OfficeSnapshot) => Partial<KvPresenceState>;
  /** A área de voz e chat que vale para a pessoa, se não for a do boneco (roda privada `b:<id>`). */
  callArea?: (id: string) => string | undefined;
  /** A pessoa mudou de lugar ou saiu (id), para quem guarda estado por pessoa. */
  changed?: (id: string) => void;
}

export class KvPresence {
  private readonly entries = new Map<string, Entry>();
  private readonly viewers = new Set<Viewer>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pinger: ReturnType<typeof setInterval>;
  private readonly sweeper: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly deps: KvPresenceDeps) {
    this.now = deps.now ?? Date.now;
    this.pinger = setInterval(() => {
      for (const v of this.viewers) if (!v.res.destroyed) v.res.write(': ping\n\n');
    }, PING_MS);
    this.pinger.unref?.();
    this.sweeper = setInterval(() => this.expire(), 5_000);
    this.sweeper.unref?.();
  }

  stop(): void {
    clearInterval(this.pinger);
    clearInterval(this.sweeper);
    if (this.timer) clearTimeout(this.timer);
    for (const v of this.viewers) v.res.end();
    this.viewers.clear();
    for (const e of this.entries.values()) if (e.offlineTimer) clearTimeout(e.offlineTimer);
  }

  /** Quem está online agora (para a voz e o vídeo, fase 1c). */
  online(): { person: KvPerson; status: KvStatus; pos?: KvPos; area?: string }[] {
    return [...this.entries.values()].map((e) => ({ person: e.person, status: e.status, pos: e.pos, area: e.area }));
  }

  /** Status de quem está online (undefined = offline). */
  statusOf(id: string): KvStatus | undefined {
    return this.entries.get(id)?.status;
  }

  /** "Até" vencido: a nota some e o status volta a disponível (W2). */
  expire(): void {
    const t = this.now();
    let any = false;
    for (const e of this.entries.values()) {
      if (e.until && e.until <= t) {
        e.until = undefined;
        e.note = undefined;
        e.status = 'disponivel';
        any = true;
      }
    }
    if (any) this.schedule();
  }

  /** Conta ou papel mudou (tela de Pessoas): atualiza quem está online; conta apagada sai. */
  refresh(person: KvPerson | undefined, id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (!person) {
      this.entries.delete(id);
      for (const v of [...this.viewers]) if (v.person.id === id) v.res.end();
      this.deps.changed?.(id);
    } else e.person = person;
    this.schedule();
  }

  /** Abre o fluxo SSE desta página. */
  attach(req: IncomingMessage, res: ServerResponse, person: KvPerson): void {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    let e = this.entries.get(person.id);
    if (!e) {
      e = { person, status: 'disponivel', since: this.now(), conns: 0, window: 0, posts: 0 };
      this.entries.set(person.id, e);
    }
    e.person = person;
    e.conns++;
    if (e.offlineTimer) {
      clearTimeout(e.offlineTimer);
      e.offlineTimer = undefined;
    }
    const viewer: Viewer = { res, person, last: '' };
    this.viewers.add(viewer);
    this.send(viewer, this.deps.snapshot());
    this.schedule();
    let closed = false;
    const drop = () => {
      if (closed) return;
      closed = true;
      this.viewers.delete(viewer);
      const cur = this.entries.get(person.id);
      if (!cur) return;
      cur.conns = Math.max(0, cur.conns - 1);
      if (cur.conns === 0) {
        cur.offlineTimer = setTimeout(() => {
          if (cur.conns === 0 && this.entries.get(person.id) === cur) {
            this.entries.delete(person.id);
            this.deps.changed?.(person.id);
            this.schedule();
          }
        }, OFFLINE_GRACE_MS);
        cur.offlineTimer.unref?.();
      }
    };
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
  }

  /** POST: posição e status da própria pessoa. Devolve o erro (texto) ou null. */
  update(person: KvPerson, body: unknown): string | null {
    const e = this.entries.get(person.id);
    if (!e) return 'offline';
    const t = this.now();
    const w = Math.floor(t / 1000);
    if (w !== e.window) {
      e.window = w;
      e.posts = 0;
    }
    if (++e.posts > MAX_POSTS_PER_S) return 'rate';
    const b = (body ?? {}) as Record<string, unknown>;
    const refused = this.deps.guard?.(person, b);
    if (refused) return refused;
    if ('pos' in b) {
      const pos = kvParsePos(b.pos);
      if (pos === undefined) return 'pos';
      if (pos && pos.r && kvRestricted(person) && !kvRoomIdsFor(this.deps.snapshot(), person).has(pos.r)) return 'room';
      e.pos = pos ?? undefined;
      if (!pos) e.area = undefined;
    }
    if ('area' in b) {
      if (b.area === null || !e.pos) e.area = undefined;
      else {
        if (!kvAreaAllowed(b.area, person, this.deps.snapshot())) return 'area';
        e.area = b.area as string;
      }
    }
    if ('status' in b) {
      if (!kvIsStatus(b.status)) return 'status';
      e.status = b.status;
    }
    // W2: nota e "até" (vão junto com o status; vazio/0 limpa)
    if ('note' in b) {
      const note = kvStatusNote(b.note);
      if (note === undefined) return 'note';
      e.note = note || undefined;
    }
    if ('until' in b) {
      const until = kvStatusUntil(b.until, t);
      if (until === undefined) return 'until';
      e.until = until || undefined;
    }
    this.deps.changed?.(person.id);
    this.schedule();
    return null;
  }

  /** Área atual de uma pessoa online (undefined = fora do escritório). */
  areaOf(id: string): string | undefined {
    return this.entries.get(id)?.area;
  }

  /** A área de voz e chat de uma pessoa: a da roda privada em que está (`b:<id>`) ou a do boneco. */
  callAreaOf(id: string): string | undefined {
    const area = this.entries.get(id)?.area;
    return area ? (this.deps.callArea?.(id) ?? area) : undefined;
  }

  /** Posição atual de uma pessoa online. */
  posOf(id: string): KvPos | undefined {
    return this.entries.get(id)?.pos;
  }

  /** Quem está online agora (a pessoa, pelo id). */
  personOf(id: string): KvPerson | undefined {
    return this.entries.get(id)?.person;
  }

  /** Manda um evento a cada página cuja pessoa passa no filtro (chat, cumprimentos, chamadas de agente). */
  emit(event: string, data: unknown, to: (viewer: KvPerson, area: string | undefined) => boolean): void {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const v of this.viewers) {
      if (v.res.destroyed || v.res.writableEnded) continue;
      if (to(v.person, this.entries.get(v.person.id)?.area)) v.res.write(chunk);
    }
  }

  /** O boneco mudou (perfil salvo): todo mundo recebe. */
  touch(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_MS);
    this.timer.unref?.();
  }

  private flush(): void {
    if (!this.viewers.size) return;
    const snap = this.deps.snapshot();
    for (const v of this.viewers) this.send(v, snap);
  }

  /** Monta e manda a lista desta página (só se mudou desde a última). */
  private send(v: Viewer, snap: OfficeSnapshot): void {
    if (v.res.destroyed || v.res.writableEnded) return;
    const state: KvPresenceState = { me: v.person.id, people: this.visibleTo(v.person, snap), ...this.deps.state?.(v.person, snap) };
    const data = JSON.stringify(state);
    if (data === v.last) return;
    v.last = data;
    v.res.write(`event: people\ndata: ${data}\n\n`);
  }

  /** A lista como `viewer` pode ver (regras no topo do arquivo). */
  visibleTo(viewer: KvPerson, snap: OfficeSnapshot): KvPresencePerson[] {
    const restricted = kvRestricted(viewer);
    const mine = restricted ? kvRoomIdsFor(snap, viewer) : null;
    let own: Set<string> | undefined;
    const out: KvPresencePerson[] = [];
    for (const e of this.entries.values()) {
      const p = e.person;
      if (restricted && p.id !== viewer.id && kvRestricted(p)) {
        // outro cliente: só se dividem alguma sala
        const theirs = kvRoomIdsFor(snap, p);
        if (![...theirs].some((id) => mine!.has(id))) continue;
      }
      let pos = e.pos;
      if (pos?.r && mine && !mine.has(pos.r)) pos = undefined;
      const desk = this.deps.desk?.(p.id);
      if (pos?.r && kvIsOwnRoomId(pos.r) && !(own ??= kvOwnRoomIdsFor(viewer)).has(pos.r)) pos = undefined; // sala própria que ele não vê
      out.push({
        id: p.id,
        name: p.name,
        role: p.role,
        status: e.status,
        look: this.deps.look(p.id) ?? kvDefaultLook(p.id),
        ...(pos ? { pos } : {}),
        ...(desk?.r && (!mine || mine.has(desk.r)) ? { desk } : {}),
        since: e.since,
        ...(e.note ? { note: e.note } : {}),
        ...(e.until ? { until: e.until } : {}),
        ...this.deps.extra?.(viewer, p.id),
      });
    }
    out.sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
    return out;
  }
}
