// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): peças de tela — ícones em pixel de cada tipo de arquivo (com
// a cor do tipo), nomes dos tipos, o ícone do botão do topo e datas curtas.
import type { KvFileKind, KvFolderAccess } from '../../../../../shared/kaviski-files';
import { intlLocale, tr } from '../../../../../shared/i18n';
import { pixelIcon } from '../../../ui/icons';
import type { KvKindFilter } from './files-model';

/** Botão do topo e da janela: gaveta de arquivo com uma pasta saindo. */
export const FILES_ICON = pixelIcon(['..######..', '.#......#.', '##########', '#........#', '#..####..#', '#........#', '##########', '#........#', '#..####..#', '##########']);

export const FOLDER_PIX = pixelIcon(['####......', '#...#.....', '##########', '#........#', '#........#', '#........#', '#........#', '##########']);
export const UPLOAD_PIX = pixelIcon(['...##...', '..####..', '.######.', '...##...', '...##...', '........', '#......#', '########']);
export const DOC_PIX = pixelIcon(['#####...', '#...##..', '#....##.', '#.####.#', '#......#', '#.####.#', '#......#', '########']);
export const NEWFOLDER_PIX = pixelIcon(['####.....', '#...#.##.', '######..#', '#........', '#...##...', '#..####..', '#...##...', '#########']);
export const STAR_PIX = pixelIcon(['...##...', '...##...', '########', '.######.', '..####..', '.##..##.', '##....##']);
export const CLOCK_PIX = pixelIcon(['..####..', '.#....#.', '#..#...#', '#..#...#', '#..###.#', '#......#', '.#....#.', '..####..']);
export const MEET_PIX = pixelIcon(['.##..##.', '.##..##.', '........', '########', '#......#', '########', '.##..##.']);
export const TRASH_PIX = pixelIcon(['..####..', '########', '.#....#.', '.#.##.#.', '.#.##.#.', '.#.##.#.', '.######.']);
export const USER_PIX = pixelIcon(['..##..', '.####.', '..##..', '......', '.####.', '######']);
export const GRID_PIX = pixelIcon(['###.###', '###.###', '###.###', '.......', '###.###', '###.###', '###.###']);
export const LIST_PIX = pixelIcon(['#.#####', '.......', '#.#####', '.......', '#.#####', '.......', '#.#####']);
export const DOWN_PIX = pixelIcon(['...##...', '...##...', '...##...', '.######.', '..####..', '...##...', '........', '########']);
export const LINK_PIX = pixelIcon(['.##.....', '#..#....', '#..#.##.', '.####..#', '...#...#', '....###.']);
export const HISTORY_PIX = pixelIcon(['..####..', '.#....#.', '#..#...#', '##.#...#', '#..###.#', '#......#', '.#....#.', '..####..']);
export const ACT_PIX = pixelIcon(['........', '......#.', '.....#.#', '#...#...', '.#.#....', '..#.....', '........']);
export const MOVE_PIX = pixelIcon(['####......', '#...#..#..', '#######.#.', '#....#####', '#......#.#', '#......#..', '##########']);
export const LOCKED_PIX = pixelIcon(['..####..', '.#....#.', '.#....#.', '########', '###..###', '###..###', '########']);
export const GLOBE_PIX = pixelIcon(['..####..', '.#.##.#.', '#..##..#', '########', '#..##..#', '.#.##.#.', '..####..']);
export const PEOPLE_PIX = pixelIcon(['.##..##.', '#..##..#', '.##..##.', '........', '###..###', '########']);

const KIND_ROWS: Record<KvFileKind, string[]> = {
  doc: ['#####...', '#...##..', '#.#..##.', '#.####.#', '#......#', '#.####.#', '#......#', '#.###..#', '########'],
  texto: ['#####...', '#...##..', '#....##.', '#.####.#', '#......#', '#.####.#', '#......#', '#.####.#', '########'],
  documento: ['#####...', '#...##..', '#....##.', '#.#.#..#', '#.#.#..#', '#.#.#..#', '#..#.#.#', '#......#', '########'],
  pdf: ['#####...', '#...##..', '#....##.', '#......#', '#.##...#', '#.#.#..#', '#.##...#', '#.#....#', '########'],
  imagem: ['########', '#......#', '#.##...#', '#.##...#', '#....#.#', '#...####', '#.######', '########'],
  planilha: ['########', '#..#...#', '########', '#..#...#', '########', '#..#...#', '########', '#..#...#', '########'],
  apresentacao: ['########', '#......#', '#.##.#.#', '#.##.#.#', '#......#', '########', '...##...', '..#..#..'],
  video: ['########', '#......#', '#..#...#', '#..##..#', '#..###.#', '#..##..#', '#..#...#', '########'],
  audio: ['....###.', '...####.', '...#..#.', '...#..#.', '...#..#.', '.###.##.', '####.##.', '.##.....'],
  compactado: ['########', '#..#...#', '#.###..#', '#..#...#', '#.###..#', '#..#...#', '#.###..#', '########'],
  codigo: ['........', '..#..#..', '.#....#.', '#..##..#', '.#....#.', '..#..#..', '........'],
  outro: ['#####...', '#...##..', '#....##.', '#......#', '#......#', '#......#', '#......#', '########'],
};

export const KIND_COLOR: Record<KvFileKind, string> = {
  doc: '#7cc8ff',
  texto: '#9fb4d6',
  documento: '#4f8ff7',
  pdf: '#ff5a6a',
  imagem: '#4fd18b',
  planilha: '#2fbf71',
  apresentacao: '#ff9a3d',
  video: '#a98bff',
  audio: '#f06fc6',
  compactado: '#e0b24a',
  codigo: '#5ee1ff',
  outro: '#aab2c5',
};

const kindIcons = new Map<KvFileKind, string>();
export function kvKindIcon(kind: KvFileKind): string {
  let s = kindIcons.get(kind);
  if (!s) kindIcons.set(kind, (s = pixelIcon(KIND_ROWS[kind])));
  return s;
}

export function kvKindName(kind: KvFileKind): string {
  switch (kind) {
    case 'doc':
      return tr('Documento do Voxtrin');
    case 'texto':
      return tr('Texto');
    case 'documento':
      return tr('Documento');
    case 'pdf':
      return 'PDF';
    case 'imagem':
      return tr('Imagem');
    case 'planilha':
      return tr('Planilha');
    case 'apresentacao':
      return tr('Apresentação');
    case 'video':
      return tr('Vídeo');
    case 'audio':
      return tr('Áudio');
    case 'compactado':
      return tr('Compactado');
    case 'codigo':
      return tr('Código');
    default:
      return tr('Arquivo');
  }
}

export function kvKindFilters(): { value: KvKindFilter; label: string }[] {
  return [
    { value: 'todos', label: tr('Todos os tipos') },
    { value: 'docs', label: tr('Documentos') },
    { value: 'pdf', label: 'PDF' },
    { value: 'imagens', label: tr('Imagens') },
    { value: 'planilhas', label: tr('Planilhas') },
    { value: 'apresentacoes', label: tr('Apresentações') },
    { value: 'midia', label: tr('Vídeo e áudio') },
    { value: 'outros', label: tr('Outros') },
  ];
}

export function kvAccessName(a: KvFolderAccess): string {
  return a === 'todos' ? tr('Todos (clientes também)') : a === 'pessoas' ? tr('Só pessoas escolhidas') : tr('Só a equipe');
}

export function kvAccessIcon(a: KvFolderAccess): string {
  return a === 'todos' ? GLOBE_PIX : a === 'pessoas' ? PEOPLE_PIX : LOCKED_PIX;
}

/** "agora", "há 5 min", "hoje 14:02", "ontem", "12 de out." */
export function kvWhen(t: number, now = Date.now()): string {
  const d = now - t;
  // passado recente: "agora", "há 5 min"; o futuro (reuniões) vai direto para "hoje 14:00" / data
  if (d >= 0 && d < 60_000) return tr('agora');
  if (d >= 0 && d < 3_600_000) return tr('há {0} min', [Math.round(d / 60_000)]);
  const day = new Date(t);
  const today = new Date(now);
  const time = day.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  if (day.toDateString() === today.toDateString()) return tr('hoje {0}', [time]);
  const y = new Date(now - 86_400_000);
  if (day.toDateString() === y.toDateString()) return tr('ontem {0}', [time]);
  if (day.toDateString() === new Date(now + 86_400_000).toDateString()) return tr('amanhã {0}', [time]);
  return day.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

export function kvDateTime(t: number): string {
  return new Date(t).toLocaleString(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function kvActivityText(action: string): string {
  switch (action) {
    case 'enviou':
      return tr('enviou');
    case 'nova-versao':
      return tr('enviou uma nova versão de');
    case 'criou-doc':
      return tr('criou o documento');
    case 'editou-doc':
      return tr('editou');
    case 'renomeou':
      return tr('renomeou');
    case 'moveu':
      return tr('moveu');
    case 'lixeira':
      return tr('mandou para a lixeira');
    case 'restaurou':
      return tr('restaurou');
    case 'apagou':
      return tr('apagou de vez');
    case 'pasta':
      return tr('mexeu na pasta');
    case 'apagou-pasta':
      return tr('apagou a pasta');
    case 'ligou':
      return tr('ligou a uma reunião');
    default:
      return action;
  }
}
