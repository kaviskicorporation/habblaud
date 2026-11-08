// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): o contrato comum dos arquivos internos da empresa — pastas
// com acesso (equipe, todos ou pessoas escolhidas), arquivos enviados e documentos escritos no próprio Voxtrin
// (Markdown), versões, ligação com reuniões, favoritos e lixeira. Puro (sem DOM nem Node): servidor e página usam.

/** Quem vê a pasta: só a equipe (admin + equipe), todos com conta (clientes também) ou só as pessoas escolhidas. */
export type KvFolderAccess = 'equipe' | 'todos' | 'pessoas';
export const KV_FOLDER_ACCESS: readonly KvFolderAccess[] = ['equipe', 'todos', 'pessoas'];

/** Tipo do arquivo para ícone, filtro e prévia. */
export type KvFileKind = 'doc' | 'texto' | 'pdf' | 'imagem' | 'planilha' | 'apresentacao' | 'documento' | 'video' | 'audio' | 'compactado' | 'codigo' | 'outro';

export const KV_FILE_MAX = 25 * 1024 * 1024;
export const KV_DOC_MAX = 400_000;
export const KV_FILE_NAME_MAX = 120;
export const KV_FILE_DESC_MAX = 600;
export const KV_FILE_TAGS_MAX = 8;
export const KV_FILE_TAG_MAX = 24;
export const KV_FILE_VERSIONS_MAX = 20;
export const KV_FILE_MEETINGS_MAX = 10;
export const KV_FOLDER_DEPTH_MAX = 6;
/** Na lixeira por mais que isto, some de vez. */
export const KV_TRASH_DAYS = 30;

export interface KvFileWho {
  id: string;
  name: string;
}

export interface KvFolder {
  id: string;
  name: string;
  /** Pasta mãe (null = raiz). */
  parent: string | null;
  access: KvFolderAccess;
  /** access 'pessoas': quem vê (o criador e os admins sempre veem). */
  people: string[];
  color?: string;
  by: KvFileWho;
  at: number;
}

/** Reunião ligada a um arquivo (cópia do título e do horário: a reunião some 30 dias depois de acabar). */
export interface KvFileMeeting {
  id: string;
  title: string;
  start: number;
  /** Reunião privada (fora dela, só "Reunião privada"). */
  private?: boolean;
  /** Organizador e convidados (ids), para quem é da reunião ver o arquivo mesmo sem ver a pasta. */
  people: string[];
}

export interface KvFileVersion {
  n: number;
  blob: string;
  size: number;
  mime: string;
  name: string;
  by: KvFileWho;
  at: number;
}

export interface KvFile {
  id: string;
  name: string;
  /** Pasta (null = raiz: só a equipe). */
  folder: string | null;
  /** 'doc' = documento escrito no Voxtrin (Markdown, editável aqui); 'arquivo' = enviado. */
  type: 'arquivo' | 'doc';
  mime: string;
  size: number;
  blob: string;
  /** Número da versão atual (1, 2, ...). */
  version: number;
  /** Versões anteriores (a mais nova primeiro). */
  versions: KvFileVersion[];
  by: KvFileWho;
  at: number;
  updated: number;
  updatedBy: KvFileWho;
  desc?: string;
  tags: string[];
  meetings: KvFileMeeting[];
  /** Quem marcou como favorito (ids). */
  stars: string[];
  trashed?: { at: number; by: KvFileWho };
}

/** Um arquivo como a página recebe. */
export interface KvFileView {
  id: string;
  name: string;
  folder: string | null;
  type: 'arquivo' | 'doc';
  kind: KvFileKind;
  mime: string;
  size: number;
  version: number;
  versions: { n: number; size: number; name: string; by: KvFileWho; at: number }[];
  by: KvFileWho;
  at: number;
  updated: number;
  updatedBy: KvFileWho;
  desc?: string;
  tags: string[];
  meetings: { id: string; title: string; start: number; private?: boolean }[];
  star: boolean;
  canEdit: boolean;
  trashed?: { at: number; by: KvFileWho };
}

export interface KvFolderView {
  id: string;
  name: string;
  parent: string | null;
  access: KvFolderAccess;
  people: string[];
  color?: string;
  by: KvFileWho;
  at: number;
  canEdit: boolean;
}

export interface KvFileActivity {
  at: number;
  who: KvFileWho;
  /** enviou | nova-versao | criou-doc | editou-doc | renomeou | moveu | lixeira | restaurou | apagou | pasta | ligou */
  action: string;
  name: string;
  file?: string;
  folder?: string | null;
}

export interface KvFilesState {
  now: number;
  folders: KvFolderView[];
  files: KvFileView[];
  trash: KvFileView[];
  activity: KvFileActivity[];
  /** Posso enviar/criar (cliente: só nas pastas que vê; visitante: não). */
  canUpload: boolean;
  /** Posso criar pastas na raiz e escolher o acesso (equipe e admin). */
  canFolder: boolean;
  usage: { used: number; max: number };
  /** Pessoas para escolher no acesso "pessoas" (só para a equipe). */
  people?: { id: string; name: string; role: string }[];
}

const EXT: Record<string, KvFileKind> = {
  md: 'texto', markdown: 'texto', txt: 'texto', log: 'texto', csv: 'planilha', tsv: 'planilha',
  pdf: 'pdf',
  png: 'imagem', jpg: 'imagem', jpeg: 'imagem', gif: 'imagem', webp: 'imagem', svg: 'imagem', bmp: 'imagem', ico: 'imagem', avif: 'imagem',
  xls: 'planilha', xlsx: 'planilha', ods: 'planilha', numbers: 'planilha',
  ppt: 'apresentacao', pptx: 'apresentacao', odp: 'apresentacao', key: 'apresentacao',
  doc: 'documento', docx: 'documento', odt: 'documento', rtf: 'documento', pages: 'documento',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', opus: 'audio',
  zip: 'compactado', rar: 'compactado', '7z': 'compactado', gz: 'compactado', tar: 'compactado', tgz: 'compactado',
  js: 'codigo', ts: 'codigo', json: 'codigo', py: 'codigo', html: 'codigo', css: 'codigo', sql: 'codigo', sh: 'codigo', yml: 'codigo', yaml: 'codigo', xml: 'codigo', php: 'codigo', java: 'codigo', go: 'codigo', rs: 'codigo', c: 'codigo', cpp: 'codigo',
};

export function kvFileExt(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** Tipo pelo nome (e pelo MIME, se o nome não diz). */
export function kvFileKind(name: string, mime = '', type: 'arquivo' | 'doc' = 'arquivo'): KvFileKind {
  if (type === 'doc') return 'doc';
  const byExt = EXT[kvFileExt(name)];
  if (byExt) return byExt;
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/')) return 'texto';
  return 'outro';
}

/** Dá para ler como texto na prévia. */
export function kvFileIsText(kind: KvFileKind, name: string): boolean {
  return kind === 'doc' || kind === 'texto' || kind === 'codigo' || ['csv', 'tsv'].includes(kvFileExt(name));
}

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown', txt: 'text/plain', log: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', opus: 'audio/opus', flac: 'audio/flac',
  zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint', html: 'text/html', xml: 'application/xml',
};

/** MIME pelo nome (o que o navegador mandou só vale se for um MIME bem formado). */
export function kvFileMime(name: string, sent?: unknown): string {
  const byExt = MIME_BY_EXT[kvFileExt(name)];
  if (byExt) return byExt;
  if (typeof sent === 'string' && /^[a-z]+\/[a-z0-9.+-]{1,80}$/i.test(sent)) return sent.toLowerCase();
  return 'application/octet-stream';
}

/**
 * Nome de arquivo ou pasta limpo: sem barras, controles e espaços sobrando; até KV_FILE_NAME_MAX letras (mantém a
 * extensão). Vazio ou só pontos = undefined.
 */
export function kvCleanFileName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  let s = v.replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /^\.+$/.test(s)) return undefined;
  if (s.length > KV_FILE_NAME_MAX) {
    const ext = kvFileExt(s);
    const keep = ext ? `.${ext}` : '';
    s = s.slice(0, KV_FILE_NAME_MAX - keep.length).trimEnd() + keep;
  }
  return s;
}

/** Etiquetas limpas (minúsculas, sem repetir). */
export function kvCleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== 'string') continue;
    const s = t.replace(/[#,]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, KV_FILE_TAG_MAX);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= KV_FILE_TAGS_MAX) break;
  }
  return out;
}

/** "1,2 MB" */
export function kvFileSize(bytes: number): string {
  if (!(bytes >= 0)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${units[i]}`;
}

/** Um nome que não bate com os da lista ("Ata (2).md"). */
export function kvUniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((n) => n.toLowerCase()));
  if (!set.has(name.toLowerCase())) return name;
  const ext = kvFileExt(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  for (let i = 2; i < 1000; i++) {
    const n = `${base} (${i})${ext ? `.${ext}` : ''}`;
    if (!set.has(n.toLowerCase())) return n;
  }
  return `${base} (${Date.now()})${ext ? `.${ext}` : ''}`;
}

// ------------------------------------------------------------------ acesso (puro, testado)

export interface KvFilesViewer {
  id: string;
  role: string;
}

const isTeam = (p: KvFilesViewer) => p.role === 'admin' || p.role === 'equipe';

/** Vê a pasta sozinha (sem olhar as mães). */
function seesFolderSelf(f: Pick<KvFolder, 'access' | 'people' | 'by'>, p: KvFilesViewer): boolean {
  if (p.role === 'admin' || f.by.id === p.id) return true;
  if (f.access === 'todos') return p.role !== 'visitante' || f.people.includes(p.id);
  if (f.access === 'pessoas') return f.people.includes(p.id);
  return isTeam(p);
}

/** Vê a pasta: ela e todas as mães (uma pasta da equipe esconde tudo o que está dentro). */
export function kvSeesFolder(id: string | null, folders: ReadonlyMap<string, Pick<KvFolder, 'access' | 'people' | 'by' | 'parent'>>, p: KvFilesViewer): boolean {
  if (id === null) return isTeam(p);
  let cur: string | null = id;
  for (let i = 0; cur !== null && i <= KV_FOLDER_DEPTH_MAX + 2; i++) {
    const f = folders.get(cur);
    if (!f || !seesFolderSelf(f, p)) return false;
    cur = f.parent;
  }
  return true;
}

/** Vê o arquivo: pela pasta, ou por ser da reunião ligada a ele, ou por ter enviado. */
export function kvSeesFile(file: Pick<KvFile, 'folder' | 'meetings' | 'by'>, folders: ReadonlyMap<string, Pick<KvFolder, 'access' | 'people' | 'by' | 'parent'>>, p: KvFilesViewer): boolean {
  if (file.by.id === p.id || p.role === 'admin') return true;
  if (kvSeesFolder(file.folder, folders, p)) return true;
  return file.meetings.some((m) => m.people.includes(p.id));
}

/** Pode mudar o arquivo (renomear, nova versão, mover, lixeira): quem enviou, admin ou a equipe que vê. */
export function kvCanEditFile(file: Pick<KvFile, 'by'>, p: KvFilesViewer): boolean {
  return p.role === 'admin' || file.by.id === p.id || p.role === 'equipe';
}

// ------------------------------------------------------------------ Markdown (documentos do Voxtrin)

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Linha com negrito, itálico, código, riscado e links (só http/https/mailto). Entra já escapada. */
function inline(s: string): string {
  const codes: string[] = [];
  let out = s.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  out = out
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, t: string, u: string) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

/**
 * Markdown simples para HTML seguro: títulos (#..###), listas (-, *, 1.), tarefas (- [ ] / - [x]), citações (>),
 * blocos de código (```), linha (---), negrito, itálico, riscado, código e links. Todo o texto é escapado antes.
 */
export function kvMarkdown(src: string): string {
  const lines = escHtml(src.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  let code: string[] | null = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${code.join('\n')}</code></pre>`);
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) {
      flushPara();
      closeList();
      code = [];
      continue;
    }
    const hm = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hm) {
      flushPara();
      closeList();
      out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr>');
      continue;
    }
    const task = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (task || ul || ol) {
      flushPara();
      const want = ol && !task && !ul ? 'ol' : 'ul';
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      if (task) out.push(`<li class="is-task${task[1] === ' ' ? '' : ' is-done'}"><span class="kv-md-check" aria-hidden="true">${task[1] === ' ' ? '☐' : '☑'}</span> ${inline(task[2])}</li>`);
      else out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
      continue;
    }
    const q = /^&gt;\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      closeList();
      out.push(`<blockquote>${inline(q[1])}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    closeList();
    para.push(line);
  }
  if (code) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
  flushPara();
  closeList();
  return out.join('\n');
}
