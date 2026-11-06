// Fork Kaviski (KAVISKI-HUMANOS.md): objetos de parede do escritório — quadro branco compartilhado por sala, mural de
// avisos (núcleo e salas) e links/documentos presos na parede.
//
// GET    /api/kaviski/humanos/objects        notas e links de todas as áreas que quem pede pode ver + resumo dos quadros
// POST   /api/kaviski/humanos/notes          {area, text}: nota no mural (sala: quem entra nela; núcleo: só a equipe)
// DELETE /api/kaviski/humanos/notes/:id      autor, admin ou o dono da sala própria
// POST   /api/kaviski/humanos/links          {area, x, title, url}: link na parede (só a equipe; http/https)
// DELETE /api/kaviski/humanos/links/:id      autor, admin ou o dono da sala própria
// GET    /api/kaviski/humanos/board?area=    o quadro inteiro da sala
// POST   /api/kaviski/humanos/board          {area, kind: 'op'|'undo'|'clear', ...}: traço/texto, desfazer o meu último, limpar
//
// Ao vivo pelo fluxo de presença: evento `objects` {area} (a página relê) e `board` (KvBoardEvent), SÓ para quem pode
// ver a área (kvAreaAllowed: o cliente nunca recebe nada de uma sala que não é dele). Gravado em
// <dataDir>/kaviski/objects.json e boards.json (600).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import {
  KV_BOARD_OPS_MAX,
  KV_BOARD_POINTS_MAX,
  KV_BOARD_TEXT_MAX,
  KV_LINK_TITLE_MAX,
  KV_LINKS_PER_AREA,
  KV_NOTE_MAX,
  KV_NOTES_PER_AREA,
  kvBoardColor,
  kvBoardPoints,
  kvClientId,
  kvIsOwnRoomId,
  kvObjectArea,
  kvSafeUrl,
  kvShortText,
  type KvBoardEvent,
  type KvBoardOp,
  type KvBoardState,
  type KvNote,
  type KvWallLink,
} from '../../../shared/kaviski-rooms';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';

export const OBJECTS_PATH = '/api/kaviski/humanos/objects';
export const NOTES_PATH = '/api/kaviski/humanos/notes';
export const LINKS_PATH = '/api/kaviski/humanos/links';
export const BOARD_PATH = '/api/kaviski/humanos/board';
const BOARD_SAVE_MS = 2_000;
/** Um traço em andamento aceita pedaços novos por este tempo. */
const STROKE_OPEN_MS = 60_000;
const MAX_BOARD_POSTS_PER_S = 40;

export type KvObjResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export interface KvObjectsDeps {
  /** A pessoa pode ver/entrar nesta área? (kvAreaAllowed com o snapshot atual e as salas próprias.) */
  canAccess(area: string, person: KvPerson): boolean;
  /** Pode moderar a área (dono de uma sala própria). */
  canModerate?(area: string, person: KvPerson): boolean;
  now?: () => number;
}

interface Board {
  ops: KvBoardOp[];
  rev: number;
  at: number;
}

const fail = <T>(status: number, error: string): KvObjResult<T> => ({ ok: false, status, error });
const newId = () => randomBytes(6).toString('base64url');

export class KvObjects {
  private notes: KvNote[] = [];
  private links: KvWallLink[] = [];
  private readonly boards = new Map<string, Board>();
  private readonly posts = new Map<string, { w: number; n: number; lastNote: number }>();
  private boardTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly deps: KvObjectsDeps,
    private readonly dir: string | null,
  ) {
    this.now = deps.now ?? Date.now;
    this.load();
  }

  // ------------------------------------------------------------ leitura

  /** Notas, links e resumo dos quadros das áreas que a pessoa vê. */
  listFor(person: KvPerson): { notes: KvNote[]; links: KvWallLink[]; boards: Record<string, { count: number; rev: number; at: number }> } {
    const ok = new Map<string, boolean>();
    const can = (area: string) => {
      let v = ok.get(area);
      if (v === undefined) ok.set(area, (v = this.deps.canAccess(area, person)));
      return v;
    };
    const boards: Record<string, { count: number; rev: number; at: number }> = {};
    for (const [area, b] of this.boards) if (b.ops.length && can(area)) boards[area] = { count: b.ops.length, rev: b.rev, at: b.at };
    return { notes: this.notes.filter((n) => can(n.area)), links: this.links.filter((l) => can(l.area)), boards };
  }

  board(person: KvPerson, rawArea: unknown): KvObjResult<KvBoardState> {
    const area = this.roomArea(rawArea);
    if (!area || !this.deps.canAccess(area, person)) return fail(403, tr('esse quadro não é seu'));
    const b = this.boards.get(area);
    return { ok: true, value: { area, ops: b?.ops ?? [], rev: b?.rev ?? 0 } };
  }

  // ------------------------------------------------------------ mural

  addNote(person: KvPerson, body: unknown): KvObjResult<KvNote> {
    const b = (body ?? {}) as Record<string, unknown>;
    const area = kvObjectArea(b.area);
    if (!area || !this.deps.canAccess(area, person)) return fail(403, tr('esse mural não é seu'));
    if (kvRestricted(person) && !area.startsWith('r:')) return fail(403, tr('só a equipe escreve no mural da recepção'));
    const text = kvShortText(b.text, KV_NOTE_MAX);
    if (!text) return fail(400, tr('nota vazia'));
    const t = this.now();
    const p = this.rate(person.id);
    if (t - p.lastNote < 2_000) return fail(429, tr('devagar: espere um pouco para escrever de novo'));
    if (this.notes.filter((n) => n.area === area).length >= KV_NOTES_PER_AREA) return fail(400, tr('mural cheio (máximo {0} notas): apague alguma antes', [KV_NOTES_PER_AREA]));
    p.lastNote = t;
    const note: KvNote = { id: newId(), area, text, by: { id: person.id, name: person.name }, at: t };
    this.notes.push(note);
    this.saveObjects();
    return { ok: true, value: note };
  }

  removeNote(person: KvPerson, id: string): KvObjResult<KvNote> {
    const n = this.notes.find((x) => x.id === id);
    if (!n || !this.deps.canAccess(n.area, person)) return fail(404, tr('nota não encontrada'));
    if (!this.mayRemove(person, n.area, n.by.id)) return fail(403, tr('só quem escreveu (ou um admin) apaga a nota'));
    this.notes = this.notes.filter((x) => x !== n);
    this.saveObjects();
    return { ok: true, value: n };
  }

  // ------------------------------------------------------------ links

  addLink(person: KvPerson, body: unknown): KvObjResult<KvWallLink> {
    const b = (body ?? {}) as Record<string, unknown>;
    const area = kvObjectArea(b.area);
    if (!area || !this.deps.canAccess(area, person)) return fail(403, tr('essa parede não é sua'));
    if (kvRestricted(person)) return fail(403, tr('só a equipe prende links na parede'));
    const url = kvSafeUrl(b.url);
    if (!url) return fail(400, tr('endereço inválido (use http:// ou https://)'));
    const title = kvShortText(b.title, KV_LINK_TITLE_MAX)?.replace(/\n/g, ' ');
    if (!title) return fail(400, tr('dê um título ao link'));
    if (typeof b.x !== 'number' || !Number.isFinite(b.x) || b.x < 0.5 || b.x > 15.5) return fail(400, tr('posição inválida'));
    if (this.links.filter((l) => l.area === area).length >= KV_LINKS_PER_AREA) return fail(400, tr('parede cheia (máximo {0} links)', [KV_LINKS_PER_AREA]));
    const link: KvWallLink = { id: newId(), area, x: Math.round(b.x * 4) / 4, title, url, by: { id: person.id, name: person.name }, at: this.now() };
    this.links.push(link);
    this.saveObjects();
    return { ok: true, value: link };
  }

  removeLink(person: KvPerson, id: string): KvObjResult<KvWallLink> {
    const l = this.links.find((x) => x.id === id);
    if (!l || !this.deps.canAccess(l.area, person)) return fail(404, tr('link não encontrado'));
    if (!this.mayRemove(person, l.area, l.by.id)) return fail(403, tr('só quem prendeu (ou um admin) tira o link'));
    this.links = this.links.filter((x) => x !== l);
    this.saveObjects();
    return { ok: true, value: l };
  }

  // ------------------------------------------------------------ quadro branco

  /** Traço/texto, desfazer ou limpar. Devolve o evento para as outras páginas. */
  boardPost(person: KvPerson, body: unknown): KvObjResult<KvBoardEvent> {
    const b = (body ?? {}) as Record<string, unknown>;
    const area = this.roomArea(b.area);
    if (!area || !this.deps.canAccess(area, person)) return fail(403, tr('esse quadro não é seu'));
    const t = this.now();
    const p = this.rate(person.id);
    const w = Math.floor(t / 1000);
    if (p.w !== w) {
      p.w = w;
      p.n = 0;
    }
    if (++p.n > MAX_BOARD_POSTS_PER_S) return fail(429, tr('devagar'));
    let board = this.boards.get(area);
    if (b.kind === 'clear') {
      if (kvRestricted(person)) return fail(403, tr('só a equipe limpa o quadro'));
      if (!board?.ops.length) return { ok: true, value: { area, kind: 'clear', rev: board?.rev ?? 0, by: person.name } };
      board.ops = [];
      board.rev++;
      board.at = t;
      this.scheduleBoards();
      return { ok: true, value: { area, kind: 'clear', rev: board.rev, by: person.name } };
    }
    if (b.kind === 'undo') {
      const ops = board?.ops ?? [];
      let i = ops.length - 1;
      while (i >= 0 && ops[i]!.by !== person.id) i--;
      if (!board || i < 0) return fail(404, tr('nada seu para desfazer'));
      const [gone] = ops.splice(i, 1);
      board.rev++;
      board.at = t;
      this.scheduleBoards();
      return { ok: true, value: { area, kind: 'remove', id: gone!.id, rev: board.rev } };
    }
    if (b.kind !== 'op') return fail(400, tr('pedido inválido'));
    const raw = (b.op ?? {}) as Record<string, unknown>;
    const cid = kvClientId(raw.id);
    if (!cid) return fail(400, tr('traço inválido'));
    const id = `${person.id}:${cid}`;
    board ??= this.boards.set(area, { ops: [], rev: 0, at: t }).get(area)!;
    // pedaço novo de um traço em andamento (do mesmo autor, ainda aberto)
    if (b.append === true) {
      const op = board.ops.find((o) => o.id === id);
      if (!op || op.by !== person.id || !op.pts || t - op.at > STROKE_OPEN_MS) return fail(409, tr('traço já fechado'));
      const pts = kvBoardPoints(raw.pts, KV_BOARD_POINTS_MAX - op.pts.length);
      if (!pts) return fail(400, tr('traço inválido'));
      op.pts.push(...pts);
      board.rev++;
      board.at = t;
      this.scheduleBoards();
      return { ok: true, value: { area, kind: 'op', op: { ...op, pts }, append: true, rev: board.rev } };
    }
    if (board.ops.some((o) => o.id === id)) return fail(409, tr('traço repetido'));
    if (board.ops.length >= KV_BOARD_OPS_MAX) return fail(400, tr('quadro cheio: limpe ou desfaça antes'));
    const tool = raw.tool === 'eraser' || raw.tool === 'text' ? raw.tool : raw.tool === 'pen' ? 'pen' : undefined;
    if (!tool) return fail(400, tr('ferramenta inválida'));
    const size = typeof raw.size === 'number' && Number.isFinite(raw.size) ? Math.max(1, Math.min(80, Math.round(raw.size))) : 4;
    const color = tool === 'eraser' ? '#ffffff' : kvBoardColor(raw.color);
    if (!color) return fail(400, tr('cor inválida'));
    const op: KvBoardOp = { id, tool, color, size, by: person.id, at: t };
    if (tool === 'text') {
      const text = kvShortText(raw.text, KV_BOARD_TEXT_MAX)?.replace(/\n/g, ' ');
      const pts = kvBoardPoints(raw.pts, 2);
      if (!text || !pts) return fail(400, tr('texto inválido'));
      op.text = text;
      op.pts = pts;
    } else {
      const pts = kvBoardPoints(raw.pts);
      if (!pts) return fail(400, tr('traço inválido'));
      op.pts = pts;
    }
    board.ops.push(op);
    board.rev++;
    board.at = t;
    this.scheduleBoards();
    return { ok: true, value: { area, kind: 'op', op, rev: board.rev } };
  }

  /** Sala própria apagada (ou que deixou de existir): some com tudo dela. */
  dropArea(area: string): void {
    const before = this.notes.length + this.links.length;
    this.notes = this.notes.filter((n) => n.area !== area);
    this.links = this.links.filter((l) => l.area !== area);
    if (this.notes.length + this.links.length !== before) this.saveObjects();
    if (this.boards.delete(area)) this.scheduleBoards();
  }

  /** Grava o que estiver pendente (desligar). */
  flush(): void {
    if (this.boardTimer) {
      clearTimeout(this.boardTimer);
      this.boardTimer = null;
      this.saveBoards();
    }
  }

  // ------------------------------------------------------------ internos

  /** Quadro só existe em sala (de projeto ou própria). */
  private roomArea(v: unknown): string | undefined {
    const a = kvObjectArea(v);
    return a?.startsWith('r:') ? a : undefined;
  }

  private mayRemove(person: KvPerson, area: string, author: string): boolean {
    return person.id === author || person.role === 'admin' || (kvIsOwnRoomId(area.slice(2)) && !!this.deps.canModerate?.(area, person));
  }

  private rate(id: string) {
    let p = this.posts.get(id);
    if (!p) this.posts.set(id, (p = { w: 0, n: 0, lastNote: 0 }));
    return p;
  }

  private file(name: string): string | null {
    return this.dir ? `${this.dir}/${name}` : null;
  }

  private load(): void {
    const of = this.file('objects.json');
    if (of) {
      try {
        const d = JSON.parse(readFileSync(of, 'utf8')) as { notes?: KvNote[]; links?: KvWallLink[] };
        this.notes = (d.notes ?? []).filter((n) => n && typeof n.text === 'string' && kvObjectArea(n.area) && n.by?.id);
        this.links = (d.links ?? []).filter((l) => l && kvSafeUrl(l.url) && kvObjectArea(l.area) && l.by?.id);
      } catch {
        // nada ainda
      }
    }
    const bf = this.file('boards.json');
    if (bf) {
      try {
        const d = JSON.parse(readFileSync(bf, 'utf8')) as Record<string, Board>;
        for (const [area, b] of Object.entries(d)) {
          if (!this.roomArea(area) || !Array.isArray(b?.ops)) continue;
          this.boards.set(area, { ops: b.ops.filter((o) => o && typeof o.id === 'string' && Array.isArray(o.pts)), rev: Number(b.rev) || 0, at: Number(b.at) || 0 });
        }
      } catch {
        // nada ainda
      }
    }
  }

  private write(path: string | null, data: unknown): void {
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, path);
    } catch {
      // segue em memória
    }
  }

  private saveObjects(): void {
    this.write(this.file('objects.json'), { notes: this.notes, links: this.links });
  }

  private scheduleBoards(): void {
    if (!this.dir || this.boardTimer) return;
    this.boardTimer = setTimeout(() => {
      this.boardTimer = null;
      this.saveBoards();
    }, BOARD_SAVE_MS);
    this.boardTimer.unref?.();
  }

  private saveBoards(): void {
    const out: Record<string, Board> = {};
    for (const [area, b] of this.boards) if (b.ops.length) out[area] = b;
    this.write(this.file('boards.json'), out);
  }
}

// ------------------------------------------------------------------ rota

export interface KvObjectsRouteDeps {
  objects: KvObjects;
  whoIs(req: IncomingMessage): KvPerson | undefined;
  /** Manda um evento do fluxo de presença a quem pode ver a área. */
  emit(event: 'objects' | 'board', area: string, data: unknown): void;
  audit?(person: KvPerson, action: string, detail: string, ok: boolean): void;
}

/** true = a rota é daqui (já respondeu). */
export function kvObjectsRoute(req: IncomingMessage, res: ServerResponse, url: URL, deps: KvObjectsRouteDeps): boolean {
  const path = url.pathname;
  const isNotes = path === NOTES_PATH || path.startsWith(`${NOTES_PATH}/`);
  const isLinks = path === LINKS_PATH || path.startsWith(`${LINKS_PATH}/`);
  if (path !== OBJECTS_PATH && path !== BOARD_PATH && !isNotes && !isLinks) return false;
  const method = req.method ?? 'GET';
  const person = deps.whoIs(req);
  const failRes = (err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };
  if (!person) {
    req.resume();
    sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
    return true;
  }
  const o = deps.objects;
  const isRead = method === 'GET' || method === 'HEAD';
  if (path === OBJECTS_PATH) {
    req.resume();
    if (!isRead) sendJson(res, 405, { error: tr('método não permitido') });
    else sendJson(res, 200, o.listFor(person));
    return true;
  }
  if (path === BOARD_PATH && isRead) {
    req.resume();
    const r = o.board(person, url.searchParams.get('area'));
    if (r.ok) sendJson(res, 200, r.value);
    else sendJson(res, r.status, { error: r.error });
    return true;
  }
  // DELETE /notes/:id e /links/:id
  if ((isNotes && path !== NOTES_PATH) || (isLinks && path !== LINKS_PATH)) {
    req.resume();
    if (method !== 'DELETE') {
      res.setHeader('Allow', 'DELETE');
      sendJson(res, 405, { error: tr('método não permitido') });
      return true;
    }
    let id = '';
    try {
      id = decodeURIComponent(path.slice((isNotes ? NOTES_PATH : LINKS_PATH).length + 1));
    } catch {
      // 404 abaixo
    }
    const r = isNotes ? o.removeNote(person, id) : o.removeLink(person, id);
    if (!r.ok) {
      sendJson(res, r.status, { error: r.error });
      return true;
    }
    deps.audit?.(person, isNotes ? 'apagar nota' : 'tirar link', isNotes ? (r.value as KvNote).text : (r.value as KvWallLink).title, true);
    deps.emit('objects', r.value.area, { area: r.value.area });
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (method !== 'POST') {
    req.resume();
    res.setHeader('Allow', path === BOARD_PATH ? 'GET, POST' : 'POST');
    sendJson(res, 405, { error: tr('método não permitido') });
    return true;
  }
  readJson(req, path === BOARD_PATH ? 64_000 : 8_192)
    .then((body) => {
      if (path === BOARD_PATH) {
        const r = o.boardPost(person, body);
        if (!r.ok) throw new HttpError(r.status, r.error);
        if (r.value.kind === 'clear') deps.audit?.(person, 'limpar quadro', r.value.area, true);
        deps.emit('board', r.value.area, r.value);
        return sendJson(res, 200, { ok: true, rev: r.value.rev });
      }
      const r = isNotes ? o.addNote(person, body) : o.addLink(person, body);
      if (!r.ok) throw new HttpError(r.status, r.error);
      deps.audit?.(person, isNotes ? 'nota no mural' : 'link na parede', isNotes ? (r.value as KvNote).text : `${(r.value as KvWallLink).title} · ${(r.value as KvWallLink).url}`, true);
      deps.emit('objects', r.value.area, { area: r.value.area });
      sendJson(res, 201, isNotes ? { note: r.value } : { link: r.value });
    })
    .catch(failRes);
  return true;
}
