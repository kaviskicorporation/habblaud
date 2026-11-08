// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): a parte pura da janela — o caminho da pasta, o que cada
// vista mostra (pasta, recentes, favoritos, meus, documentos, das reuniões, lixeira), busca, filtro por tipo, ordem e
// o modelo da ata de reunião. Sem DOM: testado em files-model.test.ts.
import type { KvFileKind, KvFilesState, KvFileView, KvFolderView } from '../../../../../shared/kaviski-files';

export type KvFilesNav = 'pasta' | 'recentes' | 'favoritos' | 'meus' | 'docs' | 'reunioes' | 'lixeira';
export type KvFilesSort = 'nome' | 'recente' | 'tamanho' | 'tipo';
export type KvKindFilter = 'todos' | 'docs' | 'pdf' | 'imagens' | 'planilhas' | 'apresentacoes' | 'midia' | 'outros';

export interface KvFilesQuery {
  nav: KvFilesNav;
  folder: string | null;
  text: string;
  kind: KvKindFilter;
  sort: KvFilesSort;
  me: string;
  /** Só os arquivos desta reunião. */
  meeting?: string;
}

const KIND_GROUP: Record<KvFileKind, KvKindFilter> = {
  doc: 'docs',
  texto: 'docs',
  documento: 'docs',
  pdf: 'pdf',
  imagem: 'imagens',
  planilha: 'planilhas',
  apresentacao: 'apresentacoes',
  video: 'midia',
  audio: 'midia',
  compactado: 'outros',
  codigo: 'outros',
  outro: 'outros',
};

export function kvKindGroup(kind: KvFileKind): KvKindFilter {
  return KIND_GROUP[kind];
}

/** Sem acento e minúsculo, para a busca. */
export function kvFold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** As pastas do caminho, da raiz até `id`. */
export function kvFolderPath(id: string | null, folders: readonly KvFolderView[]): KvFolderView[] {
  const by = new Map(folders.map((f) => [f.id, f]));
  const out: KvFolderView[] = [];
  for (let cur = id, i = 0; cur && i < 12; i++) {
    const f = by.get(cur);
    if (!f) break;
    out.unshift(f);
    cur = f.parent;
  }
  return out;
}

/** Subpastas de `parent` (só as que eu vejo; uma pasta cuja mãe não vejo aparece na raiz). */
export function kvSubfolders(parent: string | null, folders: readonly KvFolderView[]): KvFolderView[] {
  const ids = new Set(folders.map((f) => f.id));
  return folders.filter((f) => (parent === null ? f.parent === null || !ids.has(f.parent) : f.parent === parent)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Quantos arquivos (sem a lixeira) há na pasta e nas de dentro. */
export function kvFolderCount(id: string, s: Pick<KvFilesState, 'files' | 'folders'>): number {
  const inside = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of s.folders) if (f.parent && inside.has(f.parent) && !inside.has(f.id)) (inside.add(f.id), (grew = true));
  }
  return s.files.filter((f) => f.folder !== null && inside.has(f.folder)).length;
}

function matches(f: KvFileView, text: string): boolean {
  if (!text) return true;
  const hay = kvFold([f.name, f.desc ?? '', f.tags.join(' '), f.by.name, ...f.meetings.map((m) => m.title)].join(' '));
  return kvFold(text)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function kvSortFiles(list: KvFileView[], sort: KvFilesSort): KvFileView[] {
  const by = {
    nome: (a: KvFileView, b: KvFileView) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    recente: (a: KvFileView, b: KvFileView) => b.updated - a.updated,
    tamanho: (a: KvFileView, b: KvFileView) => b.size - a.size,
    tipo: (a: KvFileView, b: KvFileView) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  }[sort];
  return [...list].sort(by);
}

/** Os arquivos que a vista mostra. Na pasta (sem busca), só os de dentro dela; com busca, os da pasta e das de dentro. */
export function kvVisibleFiles(s: Pick<KvFilesState, 'files' | 'trash' | 'folders'>, q: KvFilesQuery): KvFileView[] {
  let list: KvFileView[];
  switch (q.nav) {
    case 'lixeira':
      list = s.trash;
      break;
    case 'recentes':
      list = kvSortFiles(s.files, 'recente').slice(0, 40);
      break;
    case 'favoritos':
      list = s.files.filter((f) => f.star);
      break;
    case 'meus':
      list = s.files.filter((f) => f.by.id === q.me);
      break;
    case 'docs':
      list = s.files.filter((f) => f.type === 'doc' || kvKindGroup(f.kind) === 'docs');
      break;
    case 'reunioes':
      list = s.files.filter((f) => f.meetings.length && (!q.meeting || f.meetings.some((m) => m.id === q.meeting)));
      break;
    default: {
      if (q.text) {
        const inside = new Set<string | null>([q.folder]);
        if (q.folder === null) list = s.files;
        else {
          let grew = true;
          while (grew) {
            grew = false;
            for (const f of s.folders) if (f.parent && inside.has(f.parent) && !inside.has(f.id)) (inside.add(f.id), (grew = true));
          }
          list = s.files.filter((f) => inside.has(f.folder));
        }
      } else {
        const ids = new Set(s.folders.map((f) => f.id));
        // arquivo numa pasta que não vejo (veio de uma reunião) aparece na raiz
        list = s.files.filter((f) => (q.folder === null ? f.folder === null || !ids.has(f.folder) : f.folder === q.folder));
      }
    }
  }
  list = list.filter((f) => matches(f, q.text) && (q.kind === 'todos' || kvKindGroup(f.kind) === q.kind));
  return q.nav === 'recentes' && q.sort === 'recente' ? list : kvSortFiles(list, q.sort);
}

/** Os arquivos agrupados por reunião (a mais recente primeiro). */
export function kvByMeeting(files: readonly KvFileView[], only?: string): { id: string; title: string; start: number; private?: boolean; files: KvFileView[] }[] {
  const groups = new Map<string, { id: string; title: string; start: number; private?: boolean; files: KvFileView[] }>();
  for (const f of files) {
    for (const m of f.meetings) {
      if (only && m.id !== only) continue;
      let g = groups.get(m.id);
      if (!g) groups.set(m.id, (g = { id: m.id, title: m.title, start: m.start, ...(m.private ? { private: true } : {}), files: [] }));
      g.files.push(f);
    }
  }
  return [...groups.values()].sort((a, b) => b.start - a.start);
}

/** Texto da ata de uma reunião (Markdown), com os rótulos já traduzidos. */
export function kvAtaTemplate(
  m: { title: string; when: string; room?: string; by?: string; people: string[]; note?: string },
  L: { ata: string; date: string; room: string; by: string; people: string; agenda: string; notes: string; decisions: string; next: string; who: string; until: string },
): string {
  const lines = [
    `# ${L.ata}: ${m.title}`,
    '',
    `**${L.date}:** ${m.when}`,
    ...(m.room ? [`**${L.room}:** ${m.room}`] : []),
    ...(m.by ? [`**${L.by}:** ${m.by}`] : []),
    '',
    `## ${L.people}`,
    ...(m.people.length ? m.people.map((p) => `- [ ] ${p}`) : ['- ']),
    '',
    `## ${L.agenda}`,
    ...(m.note ? m.note.split(/\r?\n/).map((l) => (l.trim() ? `- ${l.trim()}` : '')) : ['- ']),
    '',
    `## ${L.notes}`,
    '',
    '',
    `## ${L.decisions}`,
    '- ',
    '',
    `## ${L.next}`,
    `- [ ] … — ${L.who}: … — ${L.until}: …`,
    '',
  ];
  return lines.join('\n');
}
