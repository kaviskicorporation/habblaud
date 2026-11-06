// Fork Kaviski (KAVISKI-HUMANOS.md → "ir e fazer"): as preferências da pessoa na página. Com conta, vêm do servidor
// (GET/POST /api/kaviski/humanos/prefs, perfil da conta) e valem em qualquer navegador; sem conta (ou o servidor não
// responde), ficam no localStorage deste navegador.
import { KV_PREFS_DEFAULT, KV_PREFS_PATH, kvParsePrefs, kvPrefsOf, type KvPersonPrefs } from '../../../../shared/kaviski-prefs';

/** Cópia no navegador, para quem está sem conta. */
export const KV_PREFS_LOCAL = 'habblaud.kv.prefs';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class KvPrefsStore {
  private prefs: KvPersonPrefs = { ...KV_PREFS_DEFAULT };
  /** true = as preferências moram na conta (o servidor respondeu). */
  private remote = false;
  private readonly listeners = new Set<(p: KvPersonPrefs) => void>();
  private readonly fetchImpl: typeof fetch;
  private readonly storage: StorageLike | null;

  constructor(opts: { fetch?: typeof fetch; storage?: StorageLike | null } = {}) {
    this.fetchImpl = opts.fetch ?? ((...a) => fetch(...a));
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.prefs = this.readLocal();
  }

  get(): KvPersonPrefs {
    return { ...this.prefs };
  }

  /** As preferências estão salvas na conta (e não só neste navegador)? */
  get inAccount(): boolean {
    return this.remote;
  }

  on(fn: (p: KvPersonPrefs) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Busca as da conta; sem conta, ficam as do navegador. */
  async load(): Promise<void> {
    try {
      const res = await this.fetchImpl(KV_PREFS_PATH, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { prefs?: unknown };
      this.remote = true;
      this.prefs = kvPrefsOf(body?.prefs);
      this.emit();
    } catch {
      // sem servidor: fica o do navegador
    }
  }

  /** Muda e grava (na conta, se tiver; senão no navegador). Devolve false se a conta não aceitou. */
  async set(patch: Partial<KvPersonPrefs>): Promise<boolean> {
    const clean = kvParsePrefs(patch);
    if (!clean) return false;
    this.prefs = { ...this.prefs, ...clean };
    this.emit();
    if (!this.remote) {
      this.writeLocal();
      return true;
    }
    try {
      const res = await this.fetchImpl(KV_PREFS_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs: clean }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { prefs?: unknown };
      this.prefs = kvPrefsOf(body?.prefs);
      this.emit();
      return true;
    } catch {
      // a conta não gravou: fica valendo nesta página e no navegador
      this.writeLocal();
      return false;
    }
  }

  private emit(): void {
    const p = this.get();
    for (const fn of this.listeners) fn(p);
  }

  private readLocal(): KvPersonPrefs {
    try {
      const raw = this.storage?.getItem(KV_PREFS_LOCAL);
      return kvPrefsOf(raw ? JSON.parse(raw) : undefined);
    } catch {
      return { ...KV_PREFS_DEFAULT };
    }
  }

  private writeLocal(): void {
    try {
      this.storage?.setItem(KV_PREFS_LOCAL, JSON.stringify(this.prefs));
    } catch {
      // sem localStorage
    }
  }
}

/** As preferências desta página. */
export const kvPrefs = new KvPrefsStore();
