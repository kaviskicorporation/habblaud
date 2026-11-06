// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): salas de reunião como recursos que se reservam
// (no espírito das salas do Microsoft Teams/Outlook): tipos de sala, capacidade, equipamentos, reservas com convidados,
// repetição, check-in, liberação automática e reuniões privadas. O que servidor e página dividem. Puro.
//
// - Sala de reunião = sala própria (rooms.json) do tipo `reuniao`, com `meet` (KvMeetConfig): o layout (cabine,
//   bate-papo, reunião, conselho, treinamento, criativa), a capacidade e o que tem nela.
// - Reserva (KvMeeting) em <dataDir>/kaviski/meetings.json. Uma sala não aceita duas reservas no mesmo horário.
// - Reunião privada: enquanto acontece, a sala fica trancada para quem não foi convidado (bate na porta) e quem está
//   fora não vê ninguém lá dentro, não ouve, não lê a conversa nem o quadro (tudo conferido no servidor).
// - Convidado que não veria a sala (cliente, por exemplo) passa a vê-la de 15 min antes a 5 min depois da reunião.
import { tr } from './i18n';

/** Layout (e jeito de usar) de uma sala de reunião. */
export type KvMeetLayout = 'cabine' | 'bate-papo' | 'reuniao' | 'conselho' | 'treinamento' | 'criativa';
export const KV_MEET_LAYOUTS: readonly KvMeetLayout[] = ['cabine', 'bate-papo', 'reuniao', 'conselho', 'treinamento', 'criativa'];

/** O que a sala tem (filtro do "achar sala", como os recursos do Teams). */
export type KvMeetEquip = 'tela' | 'video' | 'quadro' | 'som' | 'projetor' | 'cafe' | 'acessivel';
export const KV_MEET_EQUIPS: readonly KvMeetEquip[] = ['tela', 'video', 'quadro', 'som', 'projetor', 'cafe', 'acessivel'];

export interface KvMeetConfig {
  layout: KvMeetLayout;
  /** Lugares (1..KV_MEET_CAPACITY_MAX). */
  capacity: number;
  equipment: KvMeetEquip[];
  /** Aceita reservas (false = sala de uso livre, sem agenda). */
  bookable: boolean;
  /** Reserva sem ninguém na sala até KV_MEET_RELEASE_MS depois do começo é liberada (como o "check-in" do Teams Rooms). */
  autoRelease: boolean;
  /** Reservas novas já vêm marcadas como privadas. */
  privateDefault: boolean;
}

export const KV_MEET_CAPACITY_MAX = 60;

/** Cada layout: nome, ícone, capacidade e tamanho sugeridos (planta livre), equipamentos e se nasce privada. */
export interface KvMeetLayoutInfo {
  key: KvMeetLayout;
  name: string;
  icon: string;
  desc: string;
  capacity: number;
  /** Tamanho sugerido na planta livre (tiles). */
  w: number;
  h: number;
  equipment: KvMeetEquip[];
  privateDefault: boolean;
}

/** Textos em português: quem mostra passa por `tr()` (as traduções ficam em shared/locales/kaviski-reunioes.ts). */
export const KV_MEET_LAYOUT_INFO: Record<KvMeetLayout, KvMeetLayoutInfo> = {
  cabine: { key: 'cabine', name: 'Cabine de chamada', icon: '📞', desc: 'Para uma chamada ou uma conversa a dois, com isolamento acústico.', capacity: 2, w: 8, h: 8, equipment: ['tela', 'video', 'som'], privateDefault: true },
  'bate-papo': { key: 'bate-papo', name: 'Sala de bate-papo', icon: '☕', desc: 'Mesa redonda e sofá para conversas rápidas de até 4 pessoas.', capacity: 4, w: 10, h: 9, equipment: ['tela', 'video', 'cafe'], privateDefault: false },
  reuniao: { key: 'reuniao', name: 'Sala de reunião', icon: '🗓️', desc: 'Mesa grande, tela e quadro branco: a sala de reunião do dia a dia.', capacity: 8, w: 14, h: 10, equipment: ['tela', 'video', 'quadro', 'som'], privateDefault: false },
  conselho: { key: 'conselho', name: 'Sala de conselho', icon: '🏛️', desc: 'Mesa longa com cadeiras executivas e telão, para diretoria e clientes.', capacity: 14, w: 20, h: 12, equipment: ['tela', 'video', 'quadro', 'som', 'cafe'], privateDefault: true },
  treinamento: { key: 'treinamento', name: 'Sala de treinamento', icon: '🎓', desc: 'Fileiras de mesas de frente para o telão e o quadro: aulas e apresentações.', capacity: 20, w: 20, h: 14, equipment: ['tela', 'projetor', 'quadro', 'som', 'acessivel'], privateDefault: false },
  criativa: { key: 'criativa', name: 'Sala criativa', icon: '💡', desc: 'Puffs, sofás e quadros por toda parte para brainstorm e oficinas.', capacity: 8, w: 14, h: 12, equipment: ['quadro', 'tela', 'cafe'], privateDefault: false },
};

export const KV_MEET_EQUIP_INFO: Record<KvMeetEquip, { name: string; icon: string }> = {
  tela: { name: 'Tela', icon: '🖥️' },
  video: { name: 'Videoconferência', icon: '🎥' },
  quadro: { name: 'Quadro branco', icon: '🖊️' },
  som: { name: 'Som', icon: '🔊' },
  projetor: { name: 'Projetor', icon: '📽️' },
  cafe: { name: 'Café', icon: '☕' },
  acessivel: { name: 'Acessível', icon: '♿' },
};

/** Nome e descrição do tipo de sala, já traduzidos (os mesmos textos de KV_MEET_LAYOUT_INFO). */
export function kvMeetLayoutText(k: KvMeetLayout): { name: string; desc: string } {
  switch (k) {
    case 'cabine':
      return { name: tr('Cabine de chamada'), desc: tr('Para uma chamada ou uma conversa a dois, com isolamento acústico.') };
    case 'bate-papo':
      return { name: tr('Sala de bate-papo'), desc: tr('Mesa redonda e sofá para conversas rápidas de até 4 pessoas.') };
    case 'conselho':
      return { name: tr('Sala de conselho'), desc: tr('Mesa longa com cadeiras executivas e telão, para diretoria e clientes.') };
    case 'treinamento':
      return { name: tr('Sala de treinamento'), desc: tr('Fileiras de mesas de frente para o telão e o quadro: aulas e apresentações.') };
    case 'criativa':
      return { name: tr('Sala criativa'), desc: tr('Puffs, sofás e quadros por toda parte para brainstorm e oficinas.') };
    default:
      return { name: tr('Sala de reunião'), desc: tr('Mesa grande, tela e quadro branco: a sala de reunião do dia a dia.') };
  }
}

/** Nome do equipamento, já traduzido. */
export function kvMeetEquipName(e: KvMeetEquip): string {
  switch (e) {
    case 'tela':
      return tr('Tela');
    case 'video':
      return tr('Videoconferência');
    case 'quadro':
      return tr('Quadro branco');
    case 'som':
      return tr('Som');
    case 'projetor':
      return tr('Projetor');
    case 'cafe':
      return tr('Café');
    default:
      return tr('Acessível');
  }
}

export function kvIsMeetLayout(v: unknown): v is KvMeetLayout {
  return typeof v === 'string' && (KV_MEET_LAYOUTS as readonly string[]).includes(v);
}

/** A configuração padrão de um layout. */
export function kvDefaultMeet(layout: KvMeetLayout = 'reuniao'): KvMeetConfig {
  const i = KV_MEET_LAYOUT_INFO[layout];
  return { layout, capacity: i.capacity, equipment: [...i.equipment], bookable: true, autoRelease: true, privateDefault: i.privateDefault };
}

/**
 * Configuração vinda da rede (ou do arquivo), limpa. `base` completa o que faltar (edição parcial). undefined = formato
 * inválido.
 */
export function kvParseMeet(v: unknown, base?: KvMeetConfig): KvMeetConfig | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const b = v as Record<string, unknown>;
  const layout = b.layout === undefined ? (base?.layout ?? 'reuniao') : kvIsMeetLayout(b.layout) ? b.layout : undefined;
  if (!layout) return undefined;
  // trocar o layout traz os padrões dele (capacidade, equipamentos), a não ser que venham junto
  const from = base && base.layout === layout ? base : kvDefaultMeet(layout);
  const out: KvMeetConfig = { ...from, equipment: [...from.equipment] };
  if (b.capacity !== undefined) {
    if (typeof b.capacity !== 'number' || !Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > KV_MEET_CAPACITY_MAX) return undefined;
    out.capacity = b.capacity;
  }
  if (b.equipment !== undefined) {
    if (!Array.isArray(b.equipment) || b.equipment.length > 20) return undefined;
    out.equipment = KV_MEET_EQUIPS.filter((e) => (b.equipment as unknown[]).includes(e));
  }
  for (const k of ['bookable', 'autoRelease', 'privateDefault'] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'boolean') return undefined;
    out[k] = b[k] as boolean;
  }
  return out;
}

// ------------------------------------------------------------------ reservas

/** Repetição simples (como a do Outlook): todo dia, dias úteis ou toda semana, N vezes. */
export type KvMeetFreq = 'diaria' | 'uteis' | 'semanal';
export const KV_MEET_FREQS: readonly KvMeetFreq[] = ['diaria', 'uteis', 'semanal'];
export interface KvMeetRepeat {
  freq: KvMeetFreq;
  /** Quantas reuniões no total, contando a primeira (2..KV_MEET_REPEAT_MAX). */
  count: number;
}

export const KV_MEET_TITLE_MAX = 80;
export const KV_MEET_NOTE_MAX = 500;
export const KV_MEET_PEOPLE_MAX = 60;
export const KV_MEET_REPEAT_MAX = 52;
/** Duração: de 5 min a 12 h. */
export const KV_MEET_MIN_MS = 5 * 60_000;
export const KV_MEET_MAX_MS = 12 * 60 * 60_000;
/** Até quando dá para marcar (dias a partir de hoje). */
export const KV_MEET_AHEAD_DAYS = 365;
/** Sem ninguém na sala até este tempo depois do começo: a reserva é liberada (autoRelease). */
export const KV_MEET_RELEASE_MS = 10 * 60_000;
/** Check-in vale a partir deste tempo antes do começo. */
export const KV_MEET_EARLY_MS = 5 * 60_000;
/** Convidado que não veria a sala passa a vê-la deste tempo antes... */
export const KV_MEET_GUEST_BEFORE_MS = 15 * 60_000;
/** ...até este tempo depois do fim. */
export const KV_MEET_GUEST_AFTER_MS = 5 * 60_000;
/** "Usar agora" pela porta da sala: durações oferecidas (min). */
export const KV_MEET_QUICK_MIN: readonly number[] = [15, 30, 60];

export interface KvMeetPerson {
  id: string;
  name: string;
}

/** Uma reserva como fica no servidor. */
export interface KvMeeting {
  id: string;
  /** Id da sala (kvsala-...). */
  room: string;
  title: string;
  start: number;
  end: number;
  /** Quem marcou (organizador). */
  by: KvMeetPerson;
  /** Convidados (ids; sem o organizador). */
  people: string[];
  private: boolean;
  note?: string;
  /** Reuniões da mesma série (repetição) dividem este id. */
  series?: string;
  /** Primeira vez que alguém da reunião entrou na sala (ou apertou "Fazer check-in"). */
  checkin?: number;
  /** Liberada sem ninguém aparecer (autoRelease) ou cancelada: some da agenda da sala (fica para o histórico). */
  released?: 'auto' | 'cancelada';
  createdAt: number;
  updatedAt: number;
}

/** Uma reserva como a página a recebe (o que cada um vê). */
export interface KvMeetingView {
  id: string;
  room: string;
  start: number;
  end: number;
  private: boolean;
  /** Sou o organizador ou um convidado. */
  mine: boolean;
  /** Título: só quem é da reunião vê o de uma privada (os outros: undefined). */
  title?: string;
  /** Organizador: escondido numa privada para quem não é da reunião. */
  by?: KvMeetPerson;
  /** Convidados (só para quem é da reunião). */
  people?: KvMeetPerson[];
  note?: string;
  series?: string;
  checkin?: number;
  released?: 'auto' | 'cancelada';
  /** Posso mudar/cancelar (organizador ou admin). */
  canEdit?: boolean;
}

/** Sala de reunião reservável como a página a recebe (GET meetings). */
export interface KvMeetRoomView {
  id: string;
  name: string;
  meet: KvMeetConfig;
  color?: string;
}

/** Resposta do GET /api/kaviski/humanos/meetings. */
export interface KvMeetingsState {
  now: number;
  rooms: KvMeetRoomView[];
  meetings: KvMeetingView[];
  /** Posso marcar reuniões (equipe e admin). */
  canBook: boolean;
  /** Quem dá para convidar (só para quem pode marcar). */
  people?: { id: string; name: string; role: string }[];
}

/** Título limpo: sem controles, espaços colapsados, até KV_MEET_TITLE_MAX. */
export function kvMeetTitle(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? [...s].slice(0, KV_MEET_TITLE_MAX).join('').trim() : undefined;
}

/** Os dois horários se sobrepõem (encostar não conta). */
export function kvOverlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** A reserva ainda ocupa a sala (não foi liberada nem cancelada). */
export function kvMeetActive(m: Pick<KvMeeting, 'released'>): boolean {
  return !m.released;
}

/** A reunião está acontecendo agora. */
export function kvMeetLive(m: Pick<KvMeeting, 'start' | 'end' | 'released'>, now: number): boolean {
  return !m.released && m.start <= now && m.end > now;
}

/** A pessoa é da reunião (organizador ou convidado). */
export function kvInMeeting(m: Pick<KvMeeting, 'by' | 'people'>, personId: string): boolean {
  return m.by.id === personId || m.people.includes(personId);
}

/** Repetição vinda da rede, limpa (undefined = sem repetição ou inválida). */
export function kvParseRepeat(v: unknown): KvMeetRepeat | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  if (!(KV_MEET_FREQS as readonly unknown[]).includes(b.freq)) return null;
  if (typeof b.count !== 'number' || !Number.isInteger(b.count) || b.count < 1 || b.count > KV_MEET_REPEAT_MAX) return null;
  if (b.count === 1) return undefined;
  return { freq: b.freq as KvMeetFreq, count: b.count };
}

/**
 * Os horários de uma série (o primeiro é o próprio `start`), na hora local do fuso `tz` (padrão: o do processo):
 * a reunião das 15h continua às 15h depois do horário de verão.
 */
export function kvExpandRepeat(start: number, end: number, repeat: KvMeetRepeat | undefined, tz?: string): { start: number; end: number }[] {
  const dur = end - start;
  if (!repeat) return [{ start, end }];
  const out: { start: number; end: number }[] = [];
  const wall = wallOf(start, tz);
  for (let day = 0; out.length < repeat.count && day < 400; day++) {
    if (repeat.freq === 'semanal' && day % 7 !== 0) continue;
    const s = fromWall({ ...wall, d: wall.d + day }, tz);
    if (repeat.freq === 'uteis') {
      const wd = weekdayOf(s, tz);
      if (wd === 0 || wd === 6) continue;
    }
    out.push({ start: s, end: s + dur });
  }
  return out;
}

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function parts(t: number, tz?: string): Record<string, number> {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(t))) {
    if (p.type === 'weekday') out.wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.value);
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

function wallOf(t: number, tz?: string): Wall {
  const p = parts(t, tz);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute! };
}

function weekdayOf(t: number, tz?: string): number {
  return parts(t, tz).wd!;
}

/** Hora de parede → epoch ms no fuso (duas voltas acertam a diferença do fuso, inclusive na troca de horário). */
function fromWall(w: Wall, tz?: string): number {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = parts(t, tz);
    const seen = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
    t += guess - seen;
  }
  return t;
}

// ------------------------------------------------------------------ arquivo .ics (Adicionar à minha agenda)

function icsDate(t: number): string {
  return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
}

/** Dobra as linhas em 75 octetos (RFC 5545), sem cortar caractere no meio. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** Um VCALENDAR com a reunião (para baixar e abrir no Outlook/Google/Apple). */
export function kvMeetingIcs(m: { id: string; title: string; start: number; end: number; note?: string; by?: KvMeetPerson; people?: KvMeetPerson[] }, place: string, company: string, labels: { by: string; people: string }, now = Date.now()): string {
  const who = [m.by ? `${labels.by}: ${m.by.name}` : '', m.people?.length ? `${labels.people}: ${m.people.map((p) => p.name).join(', ')}` : ''].filter(Boolean);
  const desc = [m.note ?? '', ...who].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${icsText(company)}//Voxtrin//PT`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.id}@voxtrin`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(m.start)}`,
    `DTEND:${icsDate(m.end)}`,
    `SUMMARY:${icsText(m.title)}`,
    `LOCATION:${icsText(place)}`,
    ...(desc ? [`DESCRIPTION:${icsText(desc)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
