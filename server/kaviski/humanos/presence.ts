// Fork Kaviski (KAVISKI-HUMANOS.md): presença ao vivo das pessoas (fase 1b).
//
// GET  /api/kaviski/humanos/presence  fluxo SSE: evento `people` (KvPresenceState) logo ao conectar e a cada mudança
//                                     (no máximo ~10 por segundo). Enquanto a página está conectada, a pessoa está online.
// POST /api/kaviski/humanos/presence  {pos?, status?}: onde estou (KvPos, null = fora do escritório) e como estou.
//
// Cada página recebe uma lista feita para quem ela é (filtro no servidor, como o snapshot):
// - equipe e admin veem todo mundo, em qualquer sala;
// - cliente vê a equipe/admin e só os clientes que dividem alguma sala liberada com ele; a posição de quem está numa
//   sala que ele não vê não vai (a pessoa aparece na lista sem lugar).
// Um cliente também não consegue dizer que está numa sala que não é dele (a posição é descartada).
// O SSE não passa por http/sse.ts (é um fluxo à parte, só nosso).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OfficeSnapshot } from '../../../shared/types';
import { kvAllowedRoomIds, kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import { kvDefaultLook, kvIsStatus, kvParsePos, type KvLook, type KvPos, type KvPresencePerson, type KvPresenceState, type KvStatus } from '../../../shared/kaviski-presence';

/** Depois que a última página fecha, a pessoa fica mais este tempo (recarregar a página não a tira e põe de volta). */
export const OFFLINE_GRACE_MS = 8_000;
const FLUSH_MS = 100;
const PING_MS = 20_000;
/** Máximo de POSTs por segundo por pessoa (andar manda ~8). */
const MAX_POSTS_PER_S = 25;

interface Entry {
  person: KvPerson;
  status: KvStatus;
  pos?: KvPos;
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
  now?: () => number;
}

export class KvPresence {
  private readonly entries = new Map<string, Entry>();
  private readonly viewers = new Set<Viewer>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pinger: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly deps: KvPresenceDeps) {
    this.now = deps.now ?? Date.now;
    this.pinger = setInterval(() => {
      for (const v of this.viewers) if (!v.res.destroyed) v.res.write(': ping\n\n');
    }, PING_MS);
    this.pinger.unref?.();
  }

  stop(): void {
    clearInterval(this.pinger);
    if (this.timer) clearTimeout(this.timer);
    for (const v of this.viewers) v.res.end();
    this.viewers.clear();
    for (const e of this.entries.values()) if (e.offlineTimer) clearTimeout(e.offlineTimer);
  }

  /** Quem está online agora (para a voz e o vídeo, fase 1c). */
  online(): { person: KvPerson; status: KvStatus; pos?: KvPos }[] {
    return [...this.entries.values()].map((e) => ({ person: e.person, status: e.status, pos: e.pos }));
  }

  /** Conta ou papel mudou (tela de Pessoas): atualiza quem está online; conta apagada sai. */
  refresh(person: KvPerson | undefined, id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (!person) {
      this.entries.delete(id);
      for (const v of [...this.viewers]) if (v.person.id === id) v.res.end();
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
    if ('pos' in b) {
      const pos = kvParsePos(b.pos);
      if (pos === undefined) return 'pos';
      if (pos && pos.r && kvRestricted(person) && !kvAllowedRoomIds(this.deps.snapshot(), person.rooms).has(pos.r)) return 'room';
      e.pos = pos ?? undefined;
    }
    if ('status' in b) {
      if (!kvIsStatus(b.status)) return 'status';
      e.status = b.status;
    }
    this.schedule();
    return null;
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
    const state: KvPresenceState = { me: v.person.id, people: this.visibleTo(v.person, snap) };
    const data = JSON.stringify(state);
    if (data === v.last) return;
    v.last = data;
    v.res.write(`event: people\ndata: ${data}\n\n`);
  }

  /** A lista como `viewer` pode ver (regras no topo do arquivo). */
  visibleTo(viewer: KvPerson, snap: OfficeSnapshot): KvPresencePerson[] {
    const restricted = kvRestricted(viewer);
    const mine = restricted ? kvAllowedRoomIds(snap, viewer.rooms) : null;
    const out: KvPresencePerson[] = [];
    for (const e of this.entries.values()) {
      const p = e.person;
      if (restricted && p.id !== viewer.id && kvRestricted(p)) {
        // outro cliente: só se dividem alguma sala
        const theirs = kvAllowedRoomIds(snap, p.rooms);
        if (![...theirs].some((id) => mine!.has(id))) continue;
      }
      let pos = e.pos;
      if (pos?.r && mine && !mine.has(pos.r)) pos = undefined;
      out.push({
        id: p.id,
        name: p.name,
        role: p.role,
        status: e.status,
        look: this.deps.look(p.id) ?? kvDefaultLook(p.id),
        ...(pos ? { pos } : {}),
        since: e.since,
      });
    }
    out.sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
    return out;
  }
}
