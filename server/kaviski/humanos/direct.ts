// Fork Kaviski (KAVISKI-HUMANOS.md): conversa 1:1 entre pessoas (estilo Teams) e a lista de contatos.
//
// GET  /api/kaviski/humanos/contacts        quem eu posso chamar para conversar (online ou não), com não lidas e a última fala
// GET  /api/kaviski/humanos/dm?with=<id>    a conversa com a pessoa
// POST /api/kaviski/humanos/dm              {to, text, urgent?}: manda; evento `dm` (KvDirectMessage) do fluxo de presença
//                                           para as páginas de quem manda e de quem recebe
// POST /api/kaviski/humanos/dm/read         {with}: li até agora
//
// Quem fala com quem: equipe e admin com todos; cliente com a equipe/admin e com os clientes da mesma empresa (as
// salas de um cobrem as do outro). Guardado em <dataDir>/kaviski/dm.json (600): as últimas 200 falas de cada conversa,
// por até 90 dias, e até onde cada um leu. Limite: 30 por minuto por pessoa.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { kvRestricted, kvRoomAllowed, type KvPerson } from '../../../shared/kaviski-humanos';
import { kvChatText, kvDefaultLook, type KvContact, type KvDirectMessage, type KvLook, type KvStatus } from '../../../shared/kaviski-presence';
import { tr } from '../../../shared/i18n';

const KEEP = 200;
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const SAVE_MS = 2_000;

interface FileShape {
  convs: Record<string, KvDirectMessage[]>;
  read: Record<string, Record<string, number>>;
}

/** Duas listas de salas se cruzam (uma pasta de uma está dentro de uma pasta da outra)? */
export function kvRulesOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((ra) => b.some((rb) => kvRoomAllowed(ra, [rb]) || kvRoomAllowed(rb, [ra])));
}

/** `viewer` pode conversar com `other`? */
export function kvCanTalk(viewer: KvPerson, other: KvPerson): boolean {
  if (viewer.id === other.id) return false;
  if (!kvRestricted(viewer) || !kvRestricted(other)) return true;
  return kvRulesOverlap(viewer.rooms, other.rooms);
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface KvDirectDeps {
  /** Todas as contas (a do .env incluída). */
  people(): KvPerson[];
  /** Quem está online agora e como. */
  online(): Map<string, KvStatus>;
  look(id: string): KvLook | undefined;
  /** Manda o evento às páginas de quem passar no filtro. */
  emit(event: string, data: unknown, to: (viewer: KvPerson) => boolean): void;
  file: string | null;
  now?: () => number;
}

export type KvDirectResult = { ok: true; message: KvDirectMessage } | { ok: false; status: number; error: string };

export class KvDirect {
  private data: FileShape = { convs: {}, read: {} };
  private readonly sent = new Map<string, number[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: KvDirectDeps) {
    this.now = deps.now ?? Date.now;
    this.load();
  }

  private person(id: unknown): KvPerson | undefined {
    return typeof id === 'string' ? this.deps.people().find((p) => p.id === id) : undefined;
  }

  send(from: KvPerson, body: unknown): KvDirectResult {
    const b = (body ?? {}) as Record<string, unknown>;
    const to = this.person(b.to);
    if (!to || !kvCanTalk(from, to)) return { ok: false, status: 404, error: tr('pessoa não encontrada') };
    const text = kvChatText(b.text);
    if (!text) return { ok: false, status: 400, error: tr('mensagem vazia') };
    const t = this.now();
    const times = (this.sent.get(from.id) ?? []).filter((x) => t - x < 60_000);
    if (times.length >= 30) return { ok: false, status: 429, error: tr('devagar: espere um pouco para falar de novo') };
    times.push(t);
    this.sent.set(from.id, times);
    const msg: KvDirectMessage = {
      id: randomBytes(6).toString('base64url'),
      at: t,
      from: { id: from.id, name: from.name, role: from.role },
      to: { id: to.id, name: to.name },
      text,
      ...(b.urgent === true ? { urgent: true } : {}),
    };
    const key = pairKey(from.id, to.id);
    const list = (this.data.convs[key] ??= []);
    list.push(msg);
    while (list.length > KEEP) list.shift();
    this.markRead(from.id, to.id, t);
    this.deps.emit('dm', msg, (viewer) => viewer.id === from.id || viewer.id === to.id);
    return { ok: true, message: msg };
  }

  /** A conversa com `withId` (só se podem conversar). */
  history(person: KvPerson, withId: unknown): KvDirectMessage[] | undefined {
    const other = this.person(withId);
    if (!other || !kvCanTalk(person, other)) return undefined;
    const t = this.now();
    return (this.data.convs[pairKey(person.id, other.id)] ?? []).filter((m) => t - m.at < KEEP_MS);
  }

  read(person: KvPerson, withId: unknown): boolean {
    const other = this.person(withId);
    if (!other || !kvCanTalk(person, other)) return false;
    this.markRead(person.id, other.id, this.now());
    return true;
  }

  private markRead(id: string, other: string, at: number): void {
    (this.data.read[id] ??= {})[other] = at;
    this.schedule();
  }

  /** Contatos de `person`: quem ele pode chamar, com status, não lidas e a última fala. */
  contacts(person: KvPerson): KvContact[] {
    const online = this.deps.online();
    const read = this.data.read[person.id] ?? {};
    const out: KvContact[] = [];
    for (const p of this.deps.people()) {
      if (!kvCanTalk(person, p)) continue;
      const conv = this.data.convs[pairKey(person.id, p.id)] ?? [];
      const last = conv[conv.length - 1];
      const since = read[p.id] ?? 0;
      const unread = conv.filter((m) => m.from.id === p.id && m.at > since).length;
      out.push({
        id: p.id,
        name: p.name,
        role: p.role,
        look: this.deps.look(p.id) ?? kvDefaultLook(p.id),
        ...(online.has(p.id) ? { online: true, status: online.get(p.id) } : {}),
        unread,
        ...(last ? { last: { text: last.text, at: last.at, mine: last.from.id === person.id } } : {}),
      });
    }
    out.sort((a, b) => b.unread - a.unread || (b.last?.at ?? 0) - (a.last?.at ?? 0) || Number(!!b.online) - Number(!!a.online) || a.name.localeCompare(b.name));
    return out;
  }

  private load(): void {
    if (!this.deps.file) return;
    try {
      const d = JSON.parse(readFileSync(this.deps.file, 'utf8')) as Partial<FileShape>;
      const t = this.now();
      for (const [k, list] of Object.entries(d.convs ?? {})) {
        if (!Array.isArray(list)) continue;
        const ok = list.filter((m) => m && typeof m.text === 'string' && typeof m.at === 'number' && t - m.at < KEEP_MS).slice(-KEEP);
        if (ok.length) this.data.convs[k] = ok;
      }
      if (d.read && typeof d.read === 'object') this.data.read = d.read;
    } catch {
      // sem conversas ainda
    }
  }

  private schedule(): void {
    if (!this.deps.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, SAVE_MS);
    this.timer.unref?.();
  }

  save(): void {
    if (!this.deps.file) return;
    try {
      mkdirSync(dirname(this.deps.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.deps.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.deps.file);
    } catch {
      // segue em memória
    }
  }
}
