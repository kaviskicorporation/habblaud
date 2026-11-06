// Fork Kaviski (KAVISKI-HUMANOS.md): conversa no escritório (fase 2).
//
// POST /api/kaviski/humanos/chat  {text} ou {greet, to?}: fala ou cumprimento de quem está no escritório (precisa estar
//                                 numa área: o boneco dentro). Vai como evento `chat` do fluxo de presença SÓ para quem
//                                 está na mesma área (a sala de projeto é privada da sala; o cliente nunca recebe nada
//                                 de uma sala que não é dele, porque nem consegue estar nela).
// GET  /api/kaviski/humanos/chat?area=<área>  histórico curto da sala (só salas de projeto; só quem pode entrar nela).
//
// Histórico: as últimas KV_CHAT_HISTORY falas de cada sala de projeto, por até 24 h, em <dataDir>/kaviski/chat.json
// (gravado alguns segundos depois da última fala). Áreas abertas (núcleo, corredor) são por proximidade e não ficam
// guardadas. Limite: 1 fala por segundo e 20 por minuto por pessoa.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OfficeSnapshot } from '../../../shared/types';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { KV_CHAT_HISTORY, KV_CHAT_HISTORY_MS, kvChatText, type KvChatMessage } from '../../../shared/kaviski-presence';
import { GREETING_IDS } from '../../../shared/world/protocol';
import { tr } from '../../../shared/i18n';
import { kvAreaAllowed } from './livekit';
import type { KvPresence } from './presence';

const SAVE_MS = 3_000;

export type KvChatResult = { ok: true; message: KvChatMessage } | { ok: false; status: number; error: string };

export class KvChat {
  private readonly history = new Map<string, KvChatMessage[]>();
  private readonly sent = new Map<string, number[]>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly presence: KvPresence,
    private readonly snapshot: () => OfficeSnapshot,
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  post(person: KvPerson, body: unknown): KvChatResult {
    const area = this.presence.areaOf(person.id);
    if (!area) return { ok: false, status: 409, error: tr('entre no escritório (Andar) para conversar') };
    if (!kvAreaAllowed(area, person, this.snapshot())) return { ok: false, status: 403, error: tr('essa conversa não é sua') };
    const b = (body ?? {}) as Record<string, unknown>;
    const t = this.now();
    const times = (this.sent.get(person.id) ?? []).filter((x) => t - x < 60_000);
    if (times.length >= 20 || (times.length && t - times[times.length - 1]! < 800)) {
      return { ok: false, status: 429, error: tr('devagar: espere um pouco para falar de novo') };
    }
    const msg: KvChatMessage = { id: randomBytes(6).toString('base64url'), at: t, from: { id: person.id, name: person.name, role: person.role }, area };
    if (b.greet !== undefined) {
      if (typeof b.greet !== 'string' || !(GREETING_IDS as readonly string[]).includes(b.greet)) return { ok: false, status: 400, error: tr('cumprimento inválido') };
      msg.greet = b.greet;
      if (typeof b.to === 'string' && b.to !== person.id) {
        const to = this.presence.personOf(b.to);
        // só para quem está na mesma área (senão o cumprimento vai sem destinatário)
        if (to && this.presence.areaOf(to.id) === area) msg.to = { id: to.id, name: to.name };
      }
    } else {
      const text = kvChatText(b.text);
      if (!text) return { ok: false, status: 400, error: tr('mensagem vazia') };
      msg.text = text;
    }
    const pos = this.presence.posOf(person.id);
    if (pos) msg.pos = pos;
    times.push(t);
    this.sent.set(person.id, times);
    if (area.startsWith('r:') && msg.text) {
      const list = this.history.get(area) ?? [];
      list.push(msg);
      while (list.length > KV_CHAT_HISTORY) list.shift();
      this.history.set(area, list);
      this.scheduleSave();
    }
    this.presence.emit('chat', msg, (_viewer, viewerArea) => viewerArea === area);
    return { ok: true, message: msg };
  }

  /** Histórico da sala (só quem pode entrar nela). */
  list(person: KvPerson, area: string): KvChatMessage[] | undefined {
    if (!area.startsWith('r:') || !kvAreaAllowed(area, person, this.snapshot())) return undefined;
    const t = this.now();
    return (this.history.get(area) ?? []).filter((m) => t - m.at < KV_CHAT_HISTORY_MS);
  }

  private load(): void {
    if (!this.file) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, KvChatMessage[]>;
      const t = this.now();
      for (const [area, list] of Object.entries(data)) {
        if (!area.startsWith('r:') || !Array.isArray(list)) continue;
        const ok = list.filter((m) => m && typeof m.text === 'string' && typeof m.at === 'number' && t - m.at < KV_CHAT_HISTORY_MS).slice(-KV_CHAT_HISTORY);
        if (ok.length) this.history.set(area, ok);
      }
    } catch {
      // sem histórico ainda
    }
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_MS);
    this.saveTimer.unref?.();
  }

  save(): void {
    if (!this.file) return;
    try {
      const t = this.now();
      const out: Record<string, KvChatMessage[]> = {};
      for (const [area, list] of this.history) {
        const keep = list.filter((m) => t - m.at < KV_CHAT_HISTORY_MS);
        if (keep.length) out[area] = keep;
      }
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // segue em memória
    }
  }
}
