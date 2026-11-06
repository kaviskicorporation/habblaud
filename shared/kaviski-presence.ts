// Fork Kaviski (KAVISKI-HUMANOS.md): presença das pessoas no escritório (fase 1b) — o que servidor e página trocam.
//
// Cada página monta o prédio do seu jeito (o cliente só vê as salas dele, então as colunas mudam de lugar). Por isso a
// posição nunca vai em px absolutos do prédio de quem anda, e sim relativa a algo que todos têm igual:
//   k='r'  dentro de uma sala de projeto: (x, y) a partir do canto da sala `r` (id da sala), `s` = lado do corredor
//          em que ela estava (quem a vê do outro lado espelha o y);
//   k='c'  no corredor: x a partir do canto da coluna da sala `r`, y absoluto (o corredor tem a mesma altura em todo prédio);
//   k='a'  no núcleo (recepção, copa, banheiros, lounge), que fica sempre no mesmo lugar: (x, y) absolutos.
import { kvColor } from './kaviski';
import { parseAppearanceParts, parseSeed, type AppearanceParts } from './appearance';
import type { KvRole } from './kaviski-humanos';

export type KvStatus = 'disponivel' | 'ocupado' | 'ausente';
export const KV_STATUSES: readonly KvStatus[] = ['disponivel', 'ocupado', 'ausente'];
export type KvDir = 'up' | 'down' | 'left' | 'right';

export interface KvPos {
  k: 'r' | 'c' | 'a';
  /** Id da sala (k='r' e 'c'). */
  r?: string;
  x: number;
  y: number;
  /** Lado da sala no prédio de quem mandou (k='r'). */
  s?: 'n' | 's';
  d: KvDir;
  /** Andando (1) ou correndo (2); 0 = parado. */
  m: 0 | 1 | 2;
}

/** O boneco salvo na conta. */
export interface KvLook {
  seed: number;
  look: 'f' | 'm';
  parts?: AppearanceParts;
  /** Cor da pessoa (crachá e bolinha da lista). */
  color?: string;
}

/** Uma pessoa como as outras páginas a recebem. */
export interface KvPresencePerson {
  id: string;
  name: string;
  role: KvRole;
  status: KvStatus;
  look: KvLook;
  /** Ausente = fora do escritório (andar desligado) ou numa sala que quem recebe não vê. */
  pos?: KvPos;
  /** Desde quando está online (epoch ms). */
  since: number;
}

/** Evento `people` do GET /api/kaviski/humanos/presence. */
export interface KvPresenceState {
  me: string;
  people: KvPresencePerson[];
}

/** Limite de coordenada (px de mundo): prédios enormes passam disso, mas não há prédio com 2 mil colunas. */
const COORD_MAX = 1_000_000;
const DIRS: readonly KvDir[] = ['up', 'down', 'left', 'right'];

export function kvIsStatus(v: unknown): v is KvStatus {
  return typeof v === 'string' && (KV_STATUSES as readonly string[]).includes(v);
}

/** Posição recebida pela rede: limpa ou undefined (formato estranho). `null` explícito = saiu do escritório. */
export function kvParsePos(v: unknown): KvPos | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const p = v as Record<string, unknown>;
  if (p.k !== 'r' && p.k !== 'c' && p.k !== 'a') return undefined;
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= COORD_MAX ? Math.round(n * 10) / 10 : undefined);
  const x = num(p.x);
  const y = num(p.y);
  if (x === undefined || y === undefined) return undefined;
  const d = DIRS.includes(p.d as KvDir) ? (p.d as KvDir) : 'down';
  const m = p.m === 1 || p.m === 2 ? p.m : 0;
  const out: KvPos = { k: p.k, x, y, d, m };
  if (p.k !== 'a') {
    if (typeof p.r !== 'string' || !p.r || p.r.length > 1024) return undefined;
    out.r = p.r;
  }
  if (p.k === 'r') out.s = p.s === 's' ? 's' : 'n';
  return out;
}

/** Boneco recebido pela rede (perfil da conta): limpo ou undefined. */
export function kvParseLook(v: unknown): KvLook | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const b = v as Record<string, unknown>;
  const seed = parseSeed(b.seed);
  if (seed === null) return undefined;
  const look = b.look === 'm' ? 'm' : b.look === 'f' ? 'f' : undefined;
  if (!look) return undefined;
  const out: KvLook = { seed, look };
  if (b.parts !== undefined) {
    const parts = parseAppearanceParts(b.parts);
    if (!parts) return undefined;
    if (Object.keys(parts).length) out.parts = parts;
  }
  if (b.color !== undefined && b.color !== null && b.color !== '') {
    const c = kvColor(b.color);
    if (!c) return undefined;
    out.color = c;
  }
  return out;
}

/** Boneco padrão de quem nunca escolheu: sorteado pelo id (o mesmo em toda página). */
export function kvDefaultLook(id: string): KvLook {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return { seed: h >>> 0, look: h & 1 ? 'f' : 'm' };
}

// ---------------------------------------------------------------- fase 2: conversa

/** Tamanho máximo de uma mensagem de chat. */
export const KV_CHAT_MAX = 300;
/** Quantas mensagens o histórico de cada sala guarda (e por quanto tempo). */
export const KV_CHAT_HISTORY = 50;
export const KV_CHAT_HISTORY_MS = 24 * 60 * 60 * 1000;

/**
 * Uma fala no escritório (evento `chat` do fluxo de presença): texto ou cumprimento (ids do Habblaud World,
 * shared/world/protocol.ts GREETING_IDS). Só chega a quem está na mesma área. Nas salas de projeto vale para a sala
 * toda e fica no histórico curto; nas áreas abertas (núcleo, corredor) é por proximidade (a página confere a distância
 * pela posição de quem falou) e não fica guardada.
 */
export interface KvChatMessage {
  id: string;
  at: number;
  from: { id: string; name: string; role: KvRole };
  area: string;
  text?: string;
  greet?: string;
  to?: { id: string; name: string };
  /** Onde quem falou estava (para a proximidade nas áreas abertas). */
  pos?: KvPos;
}

/** Texto de chat limpo (sem controles, espaços colapsados, até KV_CHAT_MAX) ou undefined se vazio. */
export function kvChatText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s ? [...s].slice(0, KV_CHAT_MAX).join('') : undefined;
}

// ---------------------------------------------------------------- conversa 1:1 (estilo Teams)

/** Uma fala na conversa 1:1 (evento `dm` do fluxo de presença, para quem manda e quem recebe). */
export interface KvDirectMessage {
  id: string;
  at: number;
  from: { id: string; name: string; role: KvRole };
  to: { id: string; name: string };
  text: string;
  /** Pedido urgente (quem recebe ganha aviso mais chamativo). */
  urgent?: boolean;
}

/** Uma pessoa com quem dá para conversar (GET /api/kaviski/humanos/contacts). */
export interface KvContact {
  id: string;
  name: string;
  role: KvRole;
  look: KvLook;
  online?: boolean;
  status?: KvStatus;
  /** Falas dela que eu ainda não li. */
  unread: number;
  last?: { text: string; at: number; mine: boolean };
}
