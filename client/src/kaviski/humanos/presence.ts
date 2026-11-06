// Fork Kaviski (KAVISKI-HUMANOS.md): presença ao vivo, lado da página. Abre o fluxo SSE de GET
// /api/kaviski/humanos/presence (quem está online, já filtrado pelo servidor) e manda a minha posição e o meu status por
// POST. A posição sai no máximo a cada SEND_MS enquanto ando, e uma última vez quando paro.
import type { KvPos, KvPresencePerson, KvPresenceState, KvStatus } from '../../../../shared/kaviski-presence';

const URL_ = '/api/kaviski/humanos/presence';
export const SEND_MS = 120;

type Listener = (s: KvPresenceState) => void;

export class KvPresenceClient {
  state: KvPresenceState | null = null;
  private es: EventSource | null = null;
  private readonly listeners = new Set<Listener>();
  private pending: { pos?: KvPos | null; status?: KvStatus } = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;
  private lastPosKey = '';
  /** A última posição mandada (para mandar de novo depois de uma reconexão). */
  private lastPos: KvPos | null = null;
  private lastStatus: KvStatus | null = null;

  start(): void {
    if (this.es) return;
    this.es = new EventSource(URL_, { withCredentials: true });
    this.es.addEventListener('open', () => {
      // reconectou (servidor reiniciado): o servidor me esqueceu, manda de novo onde estou
      if (this.lastPos || this.lastStatus) this.queue({ ...(this.lastPos ? { pos: this.lastPos } : {}), ...(this.lastStatus ? { status: this.lastStatus } : {}) }, true);
    });
    this.es.addEventListener('people', (ev) => {
      try {
        this.state = JSON.parse((ev as MessageEvent<string>).data) as KvPresenceState;
      } catch {
        return;
      }
      for (const cb of this.listeners) cb(this.state);
    });
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    if (this.state) cb(this.state);
    return () => void this.listeners.delete(cb);
  }

  me(): KvPresencePerson | undefined {
    return this.state?.people.find((p) => p.id === this.state?.me);
  }

  /** Minha posição (null = saí do escritório). Repetida e igual não sai. */
  setPos(pos: KvPos | null): void {
    const key = pos ? `${pos.k}|${pos.r ?? ''}|${pos.x}|${pos.y}|${pos.d}|${pos.m}` : 'null';
    if (key === this.lastPosKey) return;
    this.lastPosKey = key;
    this.lastPos = pos;
    this.queue({ pos }, !pos || pos.m === 0);
  }

  setStatus(status: KvStatus): void {
    this.lastStatus = status;
    this.queue({ status }, true);
  }

  private queue(part: { pos?: KvPos | null; status?: KvStatus }, now: boolean): void {
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
