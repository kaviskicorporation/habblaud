// Fork Kaviski (KAVISKI-HUMANOS.md): presença ao vivo, lado da página. Abre o fluxo SSE de GET
// /api/kaviski/humanos/presence (quem está online, já filtrado pelo servidor) e manda a minha posição e o meu status por
// POST. A posição sai no máximo a cada SEND_MS enquanto ando, e uma última vez quando paro.
import type { KvChatMessage, KvDirectMessage, KvPos, KvPresencePerson, KvPresenceState, KvStatus } from '../../../../shared/kaviski-presence';

const URL_ = '/api/kaviski/humanos/presence';
/** Eventos do fluxo da frente W2 (social.ts): chamar, reações, roda privada, bater na porta; `dm` é da conversa 1:1. */
const KV_SOCIAL_EVENTS = ['ring', 'react', 'bubble', 'knock', 'knock-answer', 'dm'] as const;
export type KvSocialEvent = (typeof KV_SOCIAL_EVENTS)[number];
type KvStatusPart = { status?: KvStatus; note?: string; until?: number };
export const SEND_MS = 120;

type Listener = (s: KvPresenceState) => void;

export class KvPresenceClient {
  state: KvPresenceState | null = null;
  private es: EventSource | null = null;
  private readonly listeners = new Set<Listener>();
  /** Outros eventos do fluxo (chat da fase 2, chamada de agente da fase 3). */
  private readonly events = new Map<string, Set<(data: unknown) => void>>();
  private pending: { pos?: KvPos | null; area?: string | null } & KvStatusPart = {};
  private lastArea: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;
  private lastPosKey = '';
  /** A última posição mandada (para mandar de novo depois de uma reconexão). */
  private lastPos: KvPos | null = null;
  private lastStatus: KvStatusPart | null = null;

  start(): void {
    if (this.es) return;
    this.es = new EventSource(URL_, { withCredentials: true });
    this.es.addEventListener('open', () => {
      // reconectou (servidor reiniciado): o servidor me esqueceu, manda de novo onde estou
      if (this.lastPos || this.lastStatus) this.queue({ ...(this.lastPos ? { pos: this.lastPos, area: this.lastArea } : {}), ...(this.lastStatus ?? {}) }, true);
    });
    this.es.addEventListener('people', (ev) => {
      try {
        this.state = JSON.parse((ev as MessageEvent<string>).data) as KvPresenceState;
      } catch {
        return;
      }
      for (const cb of this.listeners) cb(this.state);
    });
    for (const name of ['chat', 'summon', ...KV_SOCIAL_EVENTS]) {
      this.es.addEventListener(name, (ev) => {
        let data: unknown;
        try {
          data = JSON.parse((ev as MessageEvent<string>).data);
        } catch {
          return;
        }
        for (const cb of this.events.get(name) ?? []) cb(data);
      });
    }
  }

  /** Ouve um evento do fluxo de presença (`chat`, `summon`, `dm` e os da W2). */
  onEvent<T>(name: 'chat' | 'summon' | KvSocialEvent, cb: (data: T) => void): () => void {
    let set = this.events.get(name);
    if (!set) this.events.set(name, (set = new Set()));
    set.add(cb as (data: unknown) => void);
    return () => void set.delete(cb as (data: unknown) => void);
  }

  /** Fala no chat (ou cumprimenta): devolve o erro do servidor ou null. */
  async say(body: { text: string } | { greet: string; to?: string }): Promise<string | null> {
    try {
      const res = await fetch('/api/kaviski/humanos/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return null;
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      return b.error ?? String(res.status);
    } catch {
      return 'offline';
    }
  }

  /** Manda uma fala na conversa 1:1: o erro do servidor ou null. */
  async direct(to: string, text: string, urgent = false): Promise<string | null> {
    try {
      const res = await fetch('/api/kaviski/humanos/dm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, text, ...(urgent ? { urgent: true } : {}) }),
      });
      if (res.ok) return null;
      return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? String(res.status);
    } catch {
      return 'offline';
    }
  }

  /** A conversa 1:1 com a pessoa. */
  async directHistory(withId: string): Promise<KvDirectMessage[]> {
    try {
      const res = await fetch(`/api/kaviski/humanos/dm?with=${encodeURIComponent(withId)}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return [];
      return ((await res.json()) as { messages?: KvDirectMessage[] }).messages ?? [];
    } catch {
      return [];
    }
  }

  /** Li a conversa 1:1 até agora. */
  async directRead(withId: string): Promise<void> {
    await fetch('/api/kaviski/humanos/dm/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ with: withId }),
    }).catch(() => {});
  }

  /** Histórico curto de uma sala. */
  async history(area: string): Promise<KvChatMessage[]> {
    try {
      const res = await fetch(`/api/kaviski/humanos/chat?area=${encodeURIComponent(area)}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return [];
      return ((await res.json()) as { messages?: KvChatMessage[] }).messages ?? [];
    } catch {
      return [];
    }
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    if (this.state) cb(this.state);
    return () => void this.listeners.delete(cb);
  }

  me(): KvPresencePerson | undefined {
    return this.state?.people.find((p) => p.id === this.state?.me);
  }

  /** Minha posição e a área em que estou (null = saí do escritório). Repetida e igual não sai. */
  setPos(pos: KvPos | null, area: string | null = null): void {
    const key = pos ? `${pos.k}|${pos.r ?? ''}|${pos.x}|${pos.y}|${pos.d}|${pos.m}|${pos.p ?? ''}|${pos.h ?? ''}|${pos.z ?? ''}|${area ?? ''}` : 'null';
    if (key === this.lastPosKey) return;
    this.lastPosKey = key;
    this.lastPos = pos;
    const areaChanged = area !== this.lastArea;
    this.lastArea = pos ? area : null;
    this.queue({ pos, area: pos ? area : null }, !pos || pos.m === 0 || areaChanged);
  }

  /** Meu status; W2: com a nota e o "até" (status.ts kvSetStatus decide qual vale). */
  setStatus(status: KvStatus, note = '', until = 0): void {
    this.lastStatus = { status, note, until };
    this.queue({ status, note, until }, true);
  }

  private queue(part: { pos?: KvPos | null; area?: string | null } & KvStatusPart, now: boolean): void {
    Object.assign(this.pending, part);
    if (this.timer) {
      if (!now) return;
      clearTimeout(this.timer);
    }
    const wait = now ? 0 : Math.max(0, this.lastSent + SEND_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastSent = Date.now();
      const body = this.pending;
      this.pending = {};
      void fetch(URL_, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    }, wait);
  }
}
