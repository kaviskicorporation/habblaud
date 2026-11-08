// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): os arquivos internos da empresa. Pastas com acesso (equipe,
// todos ou pessoas escolhidas), arquivos enviados e documentos escritos aqui (Markdown), versões, favoritos, lixeira
// (30 dias) e a ligação com as reuniões (meetings.ts). Índice em <dataDir>/kaviski/files/index.json e o conteúdo em
// <dataDir>/kaviski/files/blobs/<id> (permissão 600).
//
// GET    /api/kaviski/humanos/files                      o que eu vejo: pastas, arquivos, lixeira, atividade
// POST   /api/kaviski/humanos/files/upload               {name, folder, data (base64), mime?, meeting?, replace?}
// POST   /api/kaviski/humanos/files/doc                  {name, folder, text, meeting?}  → documento novo
// POST   /api/kaviski/humanos/files/<id>                 {name?, folder?, desc?, tags?, star?, text?}
// POST   /api/kaviski/humanos/files/<id>/link            {meeting, on}  liga/desliga a uma reunião
// POST   /api/kaviski/humanos/files/<id>/trash | /restore | /revert {version}
// DELETE /api/kaviski/humanos/files/<id>                 apaga de vez (só da lixeira: quem enviou ou admin)
// GET    /api/kaviski/humanos/files/<id>/raw[?v=n&dl=1]  o conteúdo (páginas e SVG numa sandbox, como as entregas)
// POST   /api/kaviski/humanos/files/folders              {name, parent, access, people, color?}
// POST   /api/kaviski/humanos/files/folders/<id>         muda {name?, parent?, access?, people?, color?}
// DELETE /api/kaviski/humanos/files/folders/<id>         apaga a pasta vazia
//
// Regras (todas aqui, no servidor): ver pela pasta (e todas as mães), por ser da reunião ligada ou por ter enviado;
// mudar: quem enviou, a equipe ou um admin; o cliente envia nas pastas que vê, o visitante só lê. Nada disto vai ao
// snapshot do Office nem ao Habblaud World.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import {
  KV_DOC_MAX,
  KV_FILE_DESC_MAX,
  KV_FILE_MAX,
  KV_FILE_MEETINGS_MAX,
  KV_FILE_VERSIONS_MAX,
  KV_FOLDER_ACCESS,
  KV_FOLDER_DEPTH_MAX,
  KV_TRASH_DAYS,
  kvCanEditFile,
  kvCleanFileName,
  kvCleanTags,
  kvFileKind,
  kvFileMime,
  kvSeesFile,
  kvSeesFolder,
  kvUniqueName,
  type KvFile,
  type KvFileActivity,
  type KvFileMeeting,
  type KvFilesState,
  type KvFileView,
  type KvFileWho,
  type KvFolder,
  type KvFolderAccess,
  type KvFolderView,
} from '../../../shared/kaviski-files';
import type { KvMeeting } from '../../../shared/kaviski-meetings';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';
import { errMsg, log } from '../../log';
import { kvFrameHeaders } from '../frame';

const DAY = 86_400_000;
const ACTIVITY_MAX = 200;
const FOLDERS_MAX = 2000;
const FILES_MAX = 20_000;
/** Espaço total (todas as versões); HABBLAUD_FILES_MAX_GB muda. */
const DEFAULT_MAX_GB = 10;

interface FileShape {
  version: 1;
  folders: KvFolder[];
  files: KvFile[];
  activity: KvFileActivity[];
}

export type KvFilesResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const bad = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const good = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

const newId = (prefix: string) => `${prefix}${randomBytes(9).toString('base64url')}`;
const who = (p: KvPerson): KvFileWho => ({ id: p.id, name: p.name });

export interface KvFilesDeps {
  /** Pasta dos arquivos (null = só na memória, nos testes sem disco). */
  dir: string | null;
  now?: () => number;
  /** A reunião pelo id (meetings.ts). */
  meeting?: (id: string) => KvMeeting | undefined;
  people?: () => { id: string; name: string; role: string }[];
  changed?: () => void;
  audit?: (person: KvPerson, action: string, detail: string, ok: boolean) => void;
  maxBytes?: number;
}

export class KvFiles {
  private folders = new Map<string, KvFolder>();
  private files = new Map<string, KvFile>();
  private activity: KvFileActivity[] = [];
  /** Conteúdo na memória quando não há pasta (testes). */
  private readonly mem = new Map<string, Buffer>();
  private readonly now: () => number;
  readonly maxBytes: number;

  constructor(private readonly deps: KvFilesDeps) {
    this.now = deps.now ?? Date.now;
    this.maxBytes = deps.maxBytes ?? DEFAULT_MAX_GB * 1024 ** 3;
  }

  // ------------------------------------------------------------------ disco

  private get indexFile(): string | null {
    return this.deps.dir ? join(this.deps.dir, 'index.json') : null;
  }

  private blobPath(blob: string): string | null {
    return this.deps.dir && /^b[A-Za-z0-9_-]{8,}$/.test(blob) ? join(this.deps.dir, 'blobs', blob) : null;
  }

  load(): void {
    const file = this.indexFile;
    if (!file) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileShape>;
      for (const f of Array.isArray(data.folders) ? data.folders : []) {
        if (f && typeof f.id === 'string' && typeof f.name === 'string' && f.by) this.folders.set(f.id, { ...f, people: Array.isArray(f.people) ? f.people : [], parent: f.parent ?? null });
      }
      for (const f of Array.isArray(data.files) ? data.files : []) {
        if (!f || typeof f.id !== 'string' || typeof f.blob !== 'string' || !f.by) continue;
        this.files.set(f.id, { ...f, tags: Array.isArray(f.tags) ? f.tags : [], meetings: Array.isArray(f.meetings) ? f.meetings : [], stars: Array.isArray(f.stars) ? f.stars : [], versions: Array.isArray(f.versions) ? f.versions : [] });
      }
      this.activity = Array.isArray(data.activity) ? data.activity.slice(0, ACTIVITY_MAX) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('Arquivos: não deu para ler {0} ({1}).', [file, errMsg(err)]));
    }
    this.sweep();
  }

  private save(): void {
    const file = this.indexFile;
    if (!file) return;
    try {
      mkdirSync(this.deps.dir!, { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp`;
      const data: FileShape = { version: 1, folders: [...this.folders.values()], files: [...this.files.values()], activity: this.activity };
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (err) {
      log.warn(tr('Arquivos: não deu para gravar {0} ({1}).', [file, errMsg(err)]));
    }
  }

  private writeBlob(data: Buffer): string {
    const blob = newId('b');
    const path = this.blobPath(blob);
    if (!path) {
      this.mem.set(blob, data);
      return blob;
    }
    mkdirSync(join(this.deps.dir!, 'blobs'), { recursive: true, mode: 0o700 });
    writeFileSync(path, data, { mode: 0o600 });
    return blob;
  }

  private dropBlob(blob: string): void {
    this.mem.delete(blob);
    const path = this.blobPath(blob);
    if (path) rmSync(path, { force: true });
  }

  /** O conteúdo de uma versão (Buffer na memória ou o caminho no disco). */
  blobOf(blob: string): { mem?: Buffer; path?: string } | null {
    const m = this.mem.get(blob);
    if (m) return { mem: m };
    const path = this.blobPath(blob);
    if (!path) return null;
    try {
      statSync(path);
      return { path };
    } catch {
      return null;
    }
  }

  readText(blob: string): string {
    const b = this.blobOf(blob);
    if (!b) return '';
    return (b.mem ?? readFileSync(b.path!)).toString('utf8');
  }

  /** Espaço usado (todas as versões). */
  used(): number {
    let n = 0;
    for (const f of this.files.values()) {
      n += f.size;
      for (const v of f.versions) n += v.size;
    }
    return n;
  }

  /** Lixeira vencida some de vez. */
  sweep(): void {
    const limit = this.now() - KV_TRASH_DAYS * DAY;
    let changed = false;
    for (const f of [...this.files.values()]) {
      if (f.trashed && f.trashed.at < limit) {
        this.purgeFile(f);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private purgeFile(f: KvFile): void {
    this.dropBlob(f.blob);
    for (const v of f.versions) this.dropBlob(v.blob);
    this.files.delete(f.id);
  }

  private log(p: KvPerson, action: string, name: string, extra: { file?: string; folder?: string | null } = {}): void {
    this.activity.unshift({ at: this.now(), who: who(p), action, name, ...extra });
    if (this.activity.length > ACTIVITY_MAX) this.activity.length = ACTIVITY_MAX;
  }

  private done(p: KvPerson, action: string, detail: string): void {
    this.save();
    this.deps.audit?.(p, `arquivos:${action}`, detail, true);
    this.deps.changed?.();
  }

  // ------------------------------------------------------------------ leitura

  get(id: string): KvFile | undefined {
    return this.files.get(id);
  }

  folder(id: string): KvFolder | undefined {
    return this.folders.get(id);
  }

  sees(f: KvFile, p: KvPerson): boolean {
    return kvSeesFile(f, this.folders, p);
  }

  private seesFolder(id: string | null, p: KvPerson): boolean {
    return kvSeesFolder(id, this.folders, p);
  }

  private canEditFolder(f: KvFolder, p: KvPerson): boolean {
    return p.role === 'admin' || f.by.id === p.id || (p.role === 'equipe' && f.access !== 'pessoas');
  }

  /** Pode enviar/criar nesta pasta: equipe e admin onde veem; cliente nas pastas que vê (nunca na raiz). */
  canUploadTo(folder: string | null, p: KvPerson): boolean {
    if (p.role === 'visitante') return false;
    if (folder === null) return !kvRestricted(p);
    return this.folders.has(folder) && this.seesFolder(folder, p);
  }

  /** Título da reunião para quem olha (privada e de fora: "Reunião privada"). */
  private meetingFor(m: KvFileMeeting, p: KvPerson): { id: string; title: string; start: number; private?: boolean } {
    const live = this.deps.meeting?.(m.id);
    const people = live ? [live.by.id, ...live.people] : m.people;
    const priv = live ? live.private : m.private;
    const open = !priv || p.role === 'admin' || people.includes(p.id);
    return { id: m.id, title: open ? (live?.title ?? m.title) : tr('Reunião privada'), start: live?.start ?? m.start, ...(priv ? { private: true } : {}) };
  }

  view(f: KvFile, p: KvPerson): KvFileView {
    return {
      id: f.id,
      name: f.name,
      folder: f.folder,
      type: f.type,
      kind: kvFileKind(f.name, f.mime, f.type),
      mime: f.mime,
      size: f.size,
      version: f.version,
      versions: f.versions.map((v) => ({ n: v.n, size: v.size, name: v.name, by: v.by, at: v.at })),
      by: f.by,
      at: f.at,
      updated: f.updated,
      updatedBy: f.updatedBy,
      ...(f.desc ? { desc: f.desc } : {}),
      tags: [...f.tags],
      meetings: f.meetings.map((m) => this.meetingFor(m, p)),
      star: f.stars.includes(p.id),
      canEdit: kvCanEditFile(f, p),
      ...(f.trashed ? { trashed: f.trashed } : {}),
    };
  }

  private folderView(f: KvFolder, p: KvPerson): KvFolderView {
    return { id: f.id, name: f.name, parent: f.parent, access: f.access, people: [...f.people], ...(f.color ? { color: f.color } : {}), by: f.by, at: f.at, canEdit: this.canEditFolder(f, p) };
  }

  state(p: KvPerson): KvFilesState {
    const folders = [...this.folders.values()].filter((f) => this.seesFolder(f.id, p));
    const seen = [...this.files.values()].filter((f) => this.sees(f, p));
    const fileIds = new Set(seen.map((f) => f.id));
    const folderIds = new Set(folders.map((f) => f.id));
    const team = !kvRestricted(p);
    return {
      now: this.now(),
      folders: folders.map((f) => this.folderView(f, p)).sort((a, b) => a.name.localeCompare(b.name)),
      files: seen.filter((f) => !f.trashed).map((f) => this.view(f, p)),
      trash: seen.filter((f) => f.trashed && (kvCanEditFile(f, p) || f.by.id === p.id)).map((f) => this.view(f, p)),
      activity: this.activity.filter((a) => (a.file ? fileIds.has(a.file) : a.folder === undefined || a.folder === null ? team : folderIds.has(a.folder))).slice(0, 60),
      canUpload: p.role !== 'visitante',
      canFolder: team,
      usage: { used: this.used(), max: this.maxBytes },
      ...(team ? { people: (this.deps.people?.() ?? []).map((x) => ({ id: x.id, name: x.name, role: x.role })) } : {}),
    };
  }

  // ------------------------------------------------------------------ pastas

  private depth(id: string | null): number {
    let d = 0;
    for (let cur = id; cur !== null && d <= KV_FOLDER_DEPTH_MAX + 1; d++) cur = this.folders.get(cur)?.parent ?? null;
    return d;
  }

  private cleanAccess(body: Record<string, unknown>, base?: KvFolder): { access: KvFolderAccess; people: string[] } {
    const access = KV_FOLDER_ACCESS.includes(body.access as KvFolderAccess) ? (body.access as KvFolderAccess) : (base?.access ?? 'equipe');
    const ids = new Set((this.deps.people?.() ?? []).map((x) => x.id));
    const people = Array.isArray(body.people) ? [...new Set(body.people.filter((x): x is string => typeof x === 'string' && (ids.size === 0 || ids.has(x))))].slice(0, 200) : (base?.people ?? []);
    return { access, people };
  }

  createFolder(p: KvPerson, body: unknown): KvFilesResult<KvFolder> {
    const b = (body ?? {}) as Record<string, unknown>;
    const name = kvCleanFileName(b.name);
    if (!name) return bad(400, tr('dê um nome à pasta'));
    const parent = typeof b.parent === 'string' && b.parent ? b.parent : null;
    if (parent !== null && (!this.folders.has(parent) || !this.seesFolder(parent, p))) return bad(404, tr('pasta não encontrada'));
    if (kvRestricted(p) && (parent === null || p.role === 'visitante')) return bad(403, tr('só a equipe cria pastas aqui'));
    if (this.depth(parent) >= KV_FOLDER_DEPTH_MAX) return bad(400, tr('pastas demais uma dentro da outra'));
    if (this.folders.size >= FOLDERS_MAX) return bad(400, tr('pastas demais'));
    const siblings = [...this.folders.values()].filter((f) => f.parent === parent).map((f) => f.name);
    // cliente não escolhe o acesso: a pasta dele herda o da mãe
    const acc = kvRestricted(p) ? { access: this.folders.get(parent!)!.access, people: [...this.folders.get(parent!)!.people, p.id] } : this.cleanAccess(b);
    const color = typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : undefined;
    const f: KvFolder = { id: newId('fd'), name: kvUniqueName(name, siblings), parent, ...acc, ...(color ? { color } : {}), by: who(p), at: this.now() };
    this.folders.set(f.id, f);
    this.log(p, 'pasta', f.name, { folder: parent });
    this.done(p, 'pasta', f.name);
    return good(f);
  }

  /** A pasta "Reuniões" da equipe (cria se não existe): é onde nascem as atas. */
  meetingsFolder(p: KvPerson): string | null {
    const name = tr('Reuniões');
    const found = [...this.folders.values()].find((f) => f.parent === null && f.name === name);
    if (found) return found.id;
    if (kvRestricted(p)) return null;
    const f: KvFolder = { id: newId('fd'), name, parent: null, access: 'equipe', people: [], color: '#3f7fd8', by: who(p), at: this.now() };
    this.folders.set(f.id, f);
    return f.id;
  }

  updateFolder(p: KvPerson, id: string, body: unknown): KvFilesResult<KvFolder> {
    const f = this.folders.get(id);
    if (!f || !this.seesFolder(id, p)) return bad(404, tr('pasta não encontrada'));
    if (!this.canEditFolder(f, p)) return bad(403, tr('você não pode mudar esta pasta'));
    const b = (body ?? {}) as Record<string, unknown>;
    if (b.name !== undefined) {
      const name = kvCleanFileName(b.name);
      if (!name) return bad(400, tr('dê um nome à pasta'));
      f.name = kvUniqueName(name, [...this.folders.values()].filter((x) => x.parent === f.parent && x.id !== f.id).map((x) => x.name));
    }
    if (b.parent !== undefined) {
      const parent = typeof b.parent === 'string' && b.parent ? b.parent : null;
      if (parent !== null && (!this.folders.has(parent) || !this.seesFolder(parent, p))) return bad(404, tr('pasta não encontrada'));
      for (let cur = parent; cur !== null; cur = this.folders.get(cur)?.parent ?? null) if (cur === f.id) return bad(400, tr('uma pasta não vai para dentro dela mesma'));
      if (parent === null && kvRestricted(p)) return bad(403, tr('só a equipe cria pastas aqui'));
      if (this.depth(parent) >= KV_FOLDER_DEPTH_MAX) return bad(400, tr('pastas demais uma dentro da outra'));
      f.parent = parent;
    }
    if (!kvRestricted(p) && (b.access !== undefined || b.people !== undefined)) Object.assign(f, this.cleanAccess(b, f));
    if (b.color !== undefined) {
      if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) f.color = b.color;
      else delete f.color;
    }
    this.log(p, 'pasta', f.name, { folder: f.id });
    this.done(p, 'pasta-mudou', f.name);
    return good(f);
  }

  deleteFolder(p: KvPerson, id: string): KvFilesResult<true> {
    const f = this.folders.get(id);
    if (!f || !this.seesFolder(id, p)) return bad(404, tr('pasta não encontrada'));
    if (!this.canEditFolder(f, p)) return bad(403, tr('você não pode mudar esta pasta'));
    if ([...this.folders.values()].some((x) => x.parent === id) || [...this.files.values()].some((x) => x.folder === id && !x.trashed)) return bad(409, tr('esvazie a pasta antes de apagar'));
    for (const x of this.files.values()) if (x.folder === id) x.folder = f.parent; // os da lixeira voltam para a mãe
    this.folders.delete(id);
    this.log(p, 'apagou-pasta', f.name, { folder: f.parent });
    this.done(p, 'pasta-apagada', f.name);
    return good(true);
  }

  // ------------------------------------------------------------------ arquivos

  private checkMeeting(p: KvPerson, id: unknown): KvFilesResult<KvFileMeeting | null> {
    if (id === undefined || id === null || id === '') return good(null);
    if (typeof id !== 'string') return bad(400, tr('reunião inválida'));
    const m = this.deps.meeting?.(id);
    if (!m) return bad(404, tr('reunião não encontrada'));
    const people = [m.by.id, ...m.people];
    if (!people.includes(p.id) && p.role !== 'admin' && (m.private || kvRestricted(p))) return bad(403, tr('você não é desta reunião'));
    return good({ id: m.id, title: m.title, start: m.start, ...(m.private ? { private: true } : {}), people });
  }

  private room(size: number): boolean {
    return this.used() + size <= this.maxBytes;
  }

  /** Envio: arquivo novo, ou nova versão de `replace`. */
  upload(p: KvPerson, body: unknown): KvFilesResult<KvFile> {
    const b = (body ?? {}) as Record<string, unknown>;
    const name = kvCleanFileName(b.name);
    if (!name) return bad(400, tr('arquivo sem nome'));
    if (typeof b.data !== 'string') return bad(400, tr('arquivo vazio'));
    const data = Buffer.from(b.data, 'base64');
    if (data.length > KV_FILE_MAX) return bad(413, tr('arquivo grande demais (até {0} MB)', [KV_FILE_MAX / 1024 / 1024]));
    if (!this.room(data.length)) return bad(507, tr('o espaço dos arquivos acabou: apague o que não precisa (e esvazie a lixeira)'));
    const mime = kvFileMime(name, b.mime);
    if (typeof b.replace === 'string' && b.replace) {
      const f = this.files.get(b.replace);
      if (!f || !this.sees(f, p) || f.trashed) return bad(404, tr('arquivo não encontrado'));
      if (!kvCanEditFile(f, p)) return bad(403, tr('você não pode mudar este arquivo'));
      this.pushVersion(f, p, this.writeBlob(data), data.length, mime, name);
      this.log(p, 'nova-versao', f.name, { file: f.id });
      this.done(p, 'nova-versao', f.name);
      return good(f);
    }
    // 'reunioes': a pasta Reuniões da equipe (envio pela reunião)
    const folder = b.folder === 'reunioes' ? this.meetingsFolder(p) : typeof b.folder === 'string' && b.folder ? b.folder : null;
    if (!this.canUploadTo(folder, p)) return bad(403, tr('você não pode enviar arquivos nesta pasta'));
    const meet = this.checkMeeting(p, b.meeting);
    if (!meet.ok) return meet;
    if (this.files.size >= FILES_MAX) return bad(400, tr('arquivos demais'));
    const f = this.newFile(p, { name, folder, type: 'arquivo', mime, data, meeting: meet.value });
    this.log(p, 'enviou', f.name, { file: f.id });
    this.done(p, 'enviou', f.name);
    return good(f);
  }

  private newFile(p: KvPerson, o: { name: string; folder: string | null; type: 'arquivo' | 'doc'; mime: string; data: Buffer; meeting: KvFileMeeting | null }): KvFile {
    const taken = [...this.files.values()].filter((x) => x.folder === o.folder && !x.trashed).map((x) => x.name);
    const t = this.now();
    const f: KvFile = {
      id: newId('fl'),
      name: kvUniqueName(o.name, taken),
      folder: o.folder,
      type: o.type,
      mime: o.mime,
      size: o.data.length,
      blob: this.writeBlob(o.data),
      version: 1,
      versions: [],
      by: who(p),
      at: t,
      updated: t,
      updatedBy: who(p),
      tags: [],
      meetings: o.meeting ? [o.meeting] : [],
      stars: [],
    };
    this.files.set(f.id, f);
    return f;
  }

  private pushVersion(f: KvFile, p: KvPerson, blob: string, size: number, mime: string, name: string): void {
    f.versions.unshift({ n: f.version, blob: f.blob, size: f.size, mime: f.mime, name: f.name, by: f.updatedBy, at: f.updated });
    while (f.versions.length > KV_FILE_VERSIONS_MAX) this.dropBlob(f.versions.pop()!.blob);
    f.blob = blob;
    f.size = size;
    f.mime = mime;
    if (f.type === 'arquivo') f.name = kvUniqueName(name, [...this.files.values()].filter((x) => x.folder === f.folder && x.id !== f.id && !x.trashed).map((x) => x.name));
    f.version += 1;
    f.updated = this.now();
    f.updatedBy = who(p);
  }

  /** Documento novo (Markdown escrito aqui). */
  createDoc(p: KvPerson, body: unknown): KvFilesResult<KvFile> {
    const b = (body ?? {}) as Record<string, unknown>;
    let name = kvCleanFileName(b.name) ?? tr('Documento sem título');
    if (!/\.md$/i.test(name)) name = `${name}.md`;
    const text = typeof b.text === 'string' ? b.text : '';
    if (text.length > KV_DOC_MAX) return bad(413, tr('documento grande demais'));
    let folder = typeof b.folder === 'string' && b.folder ? b.folder : null;
    const meet = this.checkMeeting(p, b.meeting);
    if (!meet.ok) return meet;
    if (b.folder === 'reunioes') folder = this.meetingsFolder(p);
    if (!this.canUploadTo(folder, p)) return bad(403, tr('você não pode enviar arquivos nesta pasta'));
    const data = Buffer.from(text, 'utf8');
    if (!this.room(data.length)) return bad(507, tr('o espaço dos arquivos acabou: apague o que não precisa (e esvazie a lixeira)'));
    const f = this.newFile(p, { name, folder, type: 'doc', mime: 'text/markdown', data, meeting: meet.value });
    this.log(p, 'criou-doc', f.name, { file: f.id });
    this.done(p, 'criou-doc', f.name);
    return good(f);
  }

  update(p: KvPerson, id: string, body: unknown): KvFilesResult<KvFile> {
    const f = this.files.get(id);
    if (!f || !this.sees(f, p)) return bad(404, tr('arquivo não encontrado'));
    const b = (body ?? {}) as Record<string, unknown>;
    // favorito: qualquer um que vê
    if (typeof b.star === 'boolean') {
      f.stars = f.stars.filter((x) => x !== p.id);
      if (b.star) f.stars.push(p.id);
    }
    const editing = ['name', 'folder', 'desc', 'tags', 'text'].some((k) => b[k] !== undefined);
    if (!editing) {
      this.save();
      return good(f);
    }
    if (!kvCanEditFile(f, p)) return bad(403, tr('você não pode mudar este arquivo'));
    if (f.trashed) return bad(409, tr('restaure o arquivo antes de mudar'));
    const actions: string[] = [];
    if (b.folder !== undefined) {
      const folder = typeof b.folder === 'string' && b.folder ? b.folder : null;
      if (folder !== f.folder) {
        if (!this.canUploadTo(folder, p)) return bad(403, tr('você não pode enviar arquivos nesta pasta'));
        f.folder = folder;
        f.name = kvUniqueName(f.name, [...this.files.values()].filter((x) => x.folder === folder && x.id !== f.id && !x.trashed).map((x) => x.name));
        actions.push('moveu');
      }
    }
    if (b.name !== undefined) {
      let name = kvCleanFileName(b.name);
      if (!name) return bad(400, tr('arquivo sem nome'));
      if (f.type === 'doc' && !/\.md$/i.test(name)) name = `${name}.md`;
      if (name !== f.name) {
        f.name = kvUniqueName(name, [...this.files.values()].filter((x) => x.folder === f.folder && x.id !== f.id && !x.trashed).map((x) => x.name));
        actions.push('renomeou');
      }
    }
    if (b.desc !== undefined) {
      const d = typeof b.desc === 'string' ? b.desc.trim().slice(0, KV_FILE_DESC_MAX) : '';
      if (d) f.desc = d;
      else delete f.desc;
    }
    if (b.tags !== undefined) f.tags = kvCleanTags(b.tags);
    if (b.text !== undefined) {
      if (f.type !== 'doc') return bad(400, tr('só os documentos do Voxtrin se editam aqui'));
      if (typeof b.text !== 'string' || b.text.length > KV_DOC_MAX) return bad(413, tr('documento grande demais'));
      const data = Buffer.from(b.text, 'utf8');
      if (!data.equals(Buffer.from(this.readText(f.blob), 'utf8'))) {
        if (!this.room(data.length)) return bad(507, tr('o espaço dos arquivos acabou: apague o que não precisa (e esvazie a lixeira)'));
        // salvar de novo em seguida (mesma pessoa, até 10 min) não cria uma versão a cada tecla
        const recent = f.updatedBy.id === p.id && this.now() - f.updated < 10 * 60_000 && f.version > 1;
        if (recent) {
          this.dropBlob(f.blob);
          f.blob = this.writeBlob(data);
          f.size = data.length;
          f.updated = this.now();
        } else this.pushVersion(f, p, this.writeBlob(data), data.length, 'text/markdown', f.name);
        actions.push('editou-doc');
      }
    }
    if (!actions.length) actions.push('detalhes');
    for (const a of actions) if (a !== 'detalhes') this.log(p, a, f.name, { file: f.id });
    this.done(p, actions[0]!, f.name);
    return good(f);
  }

  link(p: KvPerson, id: string, body: unknown): KvFilesResult<KvFile> {
    const f = this.files.get(id);
    if (!f || !this.sees(f, p)) return bad(404, tr('arquivo não encontrado'));
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.meeting !== 'string') return bad(400, tr('reunião inválida'));
    if (b.on === false) {
      const had = f.meetings.find((m) => m.id === b.meeting);
      if (!had) return good(f);
      if (!kvCanEditFile(f, p) && !had.people.includes(p.id)) return bad(403, tr('você não pode mudar este arquivo'));
      f.meetings = f.meetings.filter((m) => m.id !== b.meeting);
      this.done(p, 'desligou', f.name);
      return good(f);
    }
    if (!kvCanEditFile(f, p)) return bad(403, tr('você não pode mudar este arquivo'));
    if (f.meetings.some((m) => m.id === b.meeting)) return good(f);
    const meet = this.checkMeeting(p, b.meeting);
    if (!meet.ok) return meet;
    if (f.meetings.length >= KV_FILE_MEETINGS_MAX) return bad(400, tr('reuniões demais neste arquivo'));
    f.meetings.push(meet.value!);
    this.log(p, 'ligou', f.name, { file: f.id });
    this.done(p, 'ligou', `${f.name} → ${meet.value!.title}`);
    return good(f);
  }

  trash(p: KvPerson, id: string, on: boolean): KvFilesResult<KvFile> {
    const f = this.files.get(id);
    if (!f || !this.sees(f, p)) return bad(404, tr('arquivo não encontrado'));
    if (!kvCanEditFile(f, p)) return bad(403, tr('você não pode mudar este arquivo'));
    if (on) {
      if (f.trashed) return good(f);
      f.trashed = { at: this.now(), by: who(p) };
    } else {
      if (!f.trashed) return good(f);
      delete f.trashed;
      if (f.folder !== null && !this.folders.has(f.folder)) f.folder = null;
      f.name = kvUniqueName(f.name, [...this.files.values()].filter((x) => x.folder === f.folder && x.id !== f.id && !x.trashed).map((x) => x.name));
    }
    this.log(p, on ? 'lixeira' : 'restaurou', f.name, { file: f.id });
    this.done(p, on ? 'lixeira' : 'restaurou', f.name);
    return good(f);
  }

  purge(p: KvPerson, id: string): KvFilesResult<true> {
    const f = this.files.get(id);
    if (!f || !this.sees(f, p)) return bad(404, tr('arquivo não encontrado'));
    if (!f.trashed) return bad(409, tr('mande para a lixeira antes de apagar de vez'));
    if (p.role !== 'admin' && f.by.id !== p.id) return bad(403, tr('só quem enviou ou um admin apaga de vez'));
    this.purgeFile(f);
    this.log(p, 'apagou', f.name);
    this.done(p, 'apagou', f.name);
    return good(true);
  }

  revert(p: KvPerson, id: string, body: unknown): KvFilesResult<KvFile> {
    const f = this.files.get(id);
    if (!f || !this.sees(f, p) || f.trashed) return bad(404, tr('arquivo não encontrado'));
    if (!kvCanEditFile(f, p)) return bad(403, tr('você não pode mudar este arquivo'));
    const n = Number((body as { version?: unknown } | null)?.version);
    const v = f.versions.find((x) => x.n === n);
    if (!v) return bad(404, tr('versão não encontrada'));
    const src = this.blobOf(v.blob);
    if (!src) return bad(404, tr('versão não encontrada'));
    const data = src.mem ?? readFileSync(src.path!);
    if (!this.room(data.length)) return bad(507, tr('o espaço dos arquivos acabou: apague o que não precisa (e esvazie a lixeira)'));
    this.pushVersion(f, p, this.writeBlob(data), data.length, v.mime, v.name);
    this.log(p, 'nova-versao', f.name, { file: f.id });
    this.done(p, 'voltou-versao', `${f.name} v${n}`);
    return good(f);
  }

  /** Reunião cancelada/apagada não apaga os arquivos: a ligação fica com o título copiado. */
  hasMeetingFiles(meetingId: string): number {
    let n = 0;
    for (const f of this.files.values()) if (!f.trashed && f.meetings.some((m) => m.id === meetingId)) n++;
    return n;
  }
}

// ------------------------------------------------------------------ rota

export const FILES_PATH = '/api/kaviski/humanos/files';
/** Corpo de um envio: o arquivo em base64 (4/3) e o resto. */
const UPLOAD_BODY_MAX = Math.ceil((KV_FILE_MAX * 4) / 3) + 64 * 1024;

export function kvIsFilesPath(path: string): boolean {
  return path === FILES_PATH || path.startsWith(`${FILES_PATH}/`);
}

/** Tipos que abrem dentro da janela (prévia); o resto baixa. */
const INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon|svg\+xml)|application\/pdf|video\/(mp4|webm|quicktime)|audio\/(mpeg|wav|ogg|mp4|opus|flac)|text\/(plain|markdown|csv|tab-separated-values)|application\/json)$/;

function sendRaw(req: IncomingMessage, res: ServerResponse, files: KvFiles, f: KvFile, v: number | null, download: boolean): void {
  const ver = v === null || v === f.version ? { blob: f.blob, mime: f.mime, name: f.name, size: f.size } : f.versions.find((x) => x.n === v);
  if (!ver) return sendJson(res, 404, { error: tr('versão não encontrada') });
  const src = files.blobOf(ver.blob);
  if (!src) return sendJson(res, 404, { error: tr('arquivo não encontrado') });
  const inline = !download && INLINE.test(ver.mime);
  // texto vai como texto puro (um .html enviado nunca roda aqui); página e SVG numa sandbox sem scripts
  const type = !inline ? 'application/octet-stream' : /^text\//.test(ver.mime) ? 'text/plain; charset=utf-8' : ver.mime === 'application/json' ? 'application/json; charset=utf-8' : ver.mime;
  const sandbox = ver.mime !== 'application/pdf';
  res.writeHead(
    200,
    kvFrameHeaders({
      'Content-Type': type,
      'Content-Length': ver.size,
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(ver.name)}`,
      ...(sandbox ? { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'" } : {}),
    }),
  );
  if (req.method === 'HEAD') return void res.end();
  if (src.mem) return void res.end(src.mem);
  const s = createReadStream(src.path!);
  s.on('error', () => res.destroy());
  s.pipe(res);
}

export interface KvFilesRouteDeps {
  files: KvFiles;
  whoIs(req: IncomingMessage): KvPerson | undefined;
}

export function kvFilesRoute(req: IncomingMessage, res: ServerResponse, url: URL, deps: KvFilesRouteDeps): void {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  const person = deps.whoIs(req);
  const fs = deps.files;
  const fail = (err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };
  if (!person) {
    req.resume();
    return sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
  }
  const answer = <T>(r: KvFilesResult<T>, ok: (v: T) => unknown, status = 200) => (r.ok ? sendJson(res, status, ok(r.value)) : sendJson(res, r.status, { error: r.error }));
  const fileOut = (f: KvFile) => ({ file: fs.view(f, person) });
  const isRead = method === 'GET' || method === 'HEAD';
  const rest = path === FILES_PATH ? '' : path.slice(FILES_PATH.length + 1);
  const parts = rest.split('/').map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return '';
    }
  });

  if (!rest) {
    req.resume();
    if (!isRead) return sendJson(res, 405, { error: tr('método não permitido') });
    fs.sweep();
    return sendJson(res, 200, fs.state(person));
  }
  if (isRead) {
    req.resume();
    const [id, what] = parts;
    const f = id ? fs.get(id) : undefined;
    if (!f || !fs.sees(f, person) || what !== 'raw') return sendJson(res, 404, { error: tr('arquivo não encontrado') });
    const v = url.searchParams.get('v');
    return sendRaw(req, res, fs, f, v ? Number(v) : null, url.searchParams.get('dl') === '1');
  }
  if (method === 'DELETE') {
    req.resume();
    if (parts[0] === 'folders' && parts[1] && parts.length === 2) return answer(fs.deleteFolder(person, parts[1]), () => ({ ok: true }));
    if (parts.length === 1 && parts[0]) return answer(fs.purge(person, parts[0]), () => ({ ok: true }));
    return sendJson(res, 404, { error: tr('rota desconhecida') });
  }
  if (method !== 'POST') {
    req.resume();
    res.setHeader('Allow', 'GET, POST, DELETE');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  const big = parts[0] === 'upload';
  readJson(req, big ? UPLOAD_BODY_MAX : parts[0] === 'doc' || parts.length === 1 ? KV_DOC_MAX * 2 + 16_384 : 16_384)
    .then((body) => {
      const [a, b, c] = parts;
      if (a === 'upload' && !b) return answer(fs.upload(person, body), fileOut, 201);
      if (a === 'doc' && !b) return answer(fs.createDoc(person, body), fileOut, 201);
      if (a === 'folders') {
        if (!b) return answer(fs.createFolder(person, body), (f) => ({ id: f.id }), 201);
        if (!c) return answer(fs.updateFolder(person, b, body), (f) => ({ id: f.id }));
        throw new HttpError(404, tr('rota desconhecida'));
      }
      if (a && !b) return answer(fs.update(person, a, body), fileOut);
      if (a && b === 'link') return answer(fs.link(person, a, body), fileOut);
      if (a && b === 'trash') return answer(fs.trash(person, a, true), fileOut);
      if (a && b === 'restore') return answer(fs.trash(person, a, false), fileOut);
      if (a && b === 'revert') return answer(fs.revert(person, a, body), fileOut);
      throw new HttpError(404, tr('rota desconhecida'));
    })
    .catch(fail);
}
