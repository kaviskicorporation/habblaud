// Fork Kaviski (KAVISKI-HUMANOS.md): salas próprias do escritório (que não são projetos) e os objetos de parede
// (quadro branco, mural de avisos, links) — o que servidor e página compartilham. Puro.
//
// Sala própria: guardada em <dataDir>/kaviski/rooms.json, com id `kvsala-<10 caracteres>` (nunca começa com '/', então
// não colide com o caminho de uma pasta de projeto). A área de conversa/voz é `r:<id>`, como nas salas de projeto. Ela
// NÃO entra no snapshot do servidor (nem no Habblaud World): a página pede a lista (já filtrada) e a monta no prédio.
import type { KvPerson } from './kaviski-humanos';
import { kvColor, KV_NAME_MAX } from './kaviski';

export type KvOwnRoomKind = 'pessoal' | 'reuniao' | 'descanso' | 'outra';
export const KV_OWN_ROOM_KINDS: readonly KvOwnRoomKind[] = ['pessoal', 'reuniao', 'descanso', 'outra'];
/** Quem vê: a equipe toda (e os clientes da lista) ou só as pessoas da lista. Admin e dono veem sempre. */
export type KvRoomAccess = 'equipe' | 'escolhidos';
export const KV_OWN_ROOM_PREFIX = 'kvsala-';
export const KV_OWN_ROOMS_MAX = 60;
export const KV_ROOM_PEOPLE_MAX = 200;
/** Paletas de sala (as mesmas 10 do tema original, client/src/art/theme.ts). */
export const KV_ROOM_STYLES = 10;
export const KV_DECOR_MAX = 16;

/** Itens decorativos que a pessoa pode pôr na própria sala (os móveis já existentes do Habblaud). */
export type KvDecorKind = 'planta' | 'planta_alta' | 'luminaria' | 'estante' | 'arquivo' | 'puff' | 'quadro' | 'poster' | 'relogio' | 'tapete';
export const KV_DECOR_FLOOR: readonly KvDecorKind[] = ['planta', 'planta_alta', 'luminaria', 'estante', 'arquivo', 'puff'];
export const KV_DECOR_WALL: readonly KvDecorKind[] = ['quadro', 'poster', 'relogio'];
export const KV_DECOR_KINDS: readonly KvDecorKind[] = [...KV_DECOR_FLOOR, ...KV_DECOR_WALL, 'tapete'];
/** Variantes aceitas por item (a primeira é a padrão). */
export const KV_DECOR_VARIANTS: Partial<Record<KvDecorKind, readonly string[]>> = {
  planta: ['fern', 'succulent', 'flower'],
  planta_alta: ['palm', 'ficus', 'monstera', 'bonsai'],
  puff: ['red', 'blue', 'yellow', 'green'],
  poster: ['code', 'coffee', 'rocket', 'cat', 'bug', 'ship_it'],
};

/**
 * Item decorativo em coordenadas LOCAIS da sala (tiles; o interior vai de x 1–14, y 2–10). Item de parede: só `x`
 * (centro, na parede norte). Tapete: `x, y, w, h` e a cor.
 */
export interface KvDecorItem {
  kind: KvDecorKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  variant?: string;
  color?: string;
}

export interface KvOwnRoom {
  id: string;
  kind: KvOwnRoomKind;
  name: string;
  /** Dono (id da pessoa). A sala pessoal sempre tem; as outras, quem criou. */
  owner?: string;
  access: KvRoomAccess;
  /** Pessoas da lista (ids): com `escolhidos`, só elas (e o dono/admin); com `equipe`, os clientes que também veem. */
  people: string[];
  /** Paleta (0..KV_ROOM_STYLES-1). */
  style: number;
  /** Cor de destaque (moldura da placa), opcional. */
  color?: string;
  decor: KvDecorItem[];
  createdAt: number;
  updatedAt: number;
}

export function kvIsOwnRoomId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(KV_OWN_ROOM_PREFIX) && /^kvsala-[A-Za-z0-9_-]{4,32}$/.test(id);
}

export function kvIsOwnRoomKind(v: unknown): v is KvOwnRoomKind {
  return typeof v === 'string' && (KV_OWN_ROOM_KINDS as readonly string[]).includes(v);
}

/** Nome da sala: sem controles, espaços colapsados, 1 a 40 caracteres. */
export function kvOwnRoomName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, KV_NAME_MAX);
  return s || undefined;
}

/** A pessoa vê a sala? Admin sempre; o dono sempre; `equipe`: quem não é cliente/visitante e os da lista. */
export function kvCanSeeOwnRoom(room: Pick<KvOwnRoom, 'owner' | 'access' | 'people'>, person: Pick<KvPerson, 'id' | 'role'> | undefined): boolean {
  if (!person) return false;
  if (person.role === 'admin' || room.owner === person.id) return true;
  if (room.people.includes(person.id)) return true;
  return room.access === 'equipe' && person.role === 'equipe';
}

/** Pode editar/apagar a sala (nome, quem vê, cor, decoração)? Admin ou o dono (que não seja cliente/visitante). */
export function kvCanEditOwnRoom(room: Pick<KvOwnRoom, 'owner'>, person: Pick<KvPerson, 'id' | 'role'> | undefined): boolean {
  if (!person) return false;
  return person.role === 'admin' || (person.role === 'equipe' && room.owner === person.id);
}

/** Pode criar uma sala deste tipo? Admin: qualquer; equipe: a própria sala pessoal e salas de reunião; os outros: não. */
export function kvCanCreateOwnRoom(kind: KvOwnRoomKind, person: Pick<KvPerson, 'role'> | undefined): boolean {
  if (person?.role === 'admin') return true;
  return person?.role === 'equipe' && (kind === 'pessoal' || kind === 'reuniao');
}

const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 4) / 4 : undefined);

/** Lista de decoração limpa (itens fora do lugar ou desconhecidos caem fora); undefined se não é uma lista. */
export function kvParseDecor(v: unknown): KvDecorItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: KvDecorItem[] = [];
  for (const raw of v.slice(0, KV_DECOR_MAX * 2)) {
    if (out.length >= KV_DECOR_MAX) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const kind = r.kind as KvDecorKind;
    if (!(KV_DECOR_KINDS as readonly string[]).includes(kind)) continue;
    const variants = KV_DECOR_VARIANTS[kind];
    const variant = typeof r.variant === 'string' && variants?.includes(r.variant) ? r.variant : variants?.[0];
    if ((KV_DECOR_WALL as readonly string[]).includes(kind)) {
      const x = num(r.x, 1, 15);
      if (x === undefined) continue;
      out.push({ kind, x, y: 0, ...(variant ? { variant } : {}) });
      continue;
    }
    const x = num(r.x, 1, 14);
    const y = num(r.y, 2, 10);
    if (x === undefined || y === undefined) continue;
    if (kind === 'tapete') {
      const w = num(r.w, 1, 8);
      const h = num(r.h, 1, 6);
      const color = kvColor(r.color);
      if (w === undefined || h === undefined || !color) continue;
      out.push({ kind, x, y, w: Math.min(w, 15 - x), h: Math.min(h, 11 - y), color });
      continue;
    }
    out.push({ kind, x: Math.floor(x), y: Math.floor(y), ...(variant ? { variant } : {}) });
  }
  return out;
}

// ------------------------------------------------------------------ objetos de parede

/** Áreas que têm objetos: salas (de projeto ou próprias) e as áreas do núcleo. O corredor não. */
export function kvObjectArea(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 1100) return undefined;
  return v.startsWith('r:') || v.startsWith('a:core:') ? v : undefined;
}

export const KV_NOTE_MAX = 280;
export const KV_NOTES_PER_AREA = 30;
export const KV_LINK_TITLE_MAX = 60;
export const KV_LINK_URL_MAX = 2000;
export const KV_LINKS_PER_AREA = 12;

export interface KvAuthor {
  id: string;
  name: string;
}

/** Nota no mural de avisos de uma área. */
export interface KvNote {
  id: string;
  area: string;
  text: string;
  by: KvAuthor;
  at: number;
}

/** Link/documento preso na parede de uma área, em `x` (tiles locais, centro do ícone). */
export interface KvWallLink {
  id: string;
  area: string;
  x: number;
  title: string;
  url: string;
  by: KvAuthor;
  at: number;
}

/** Texto curto (nota): sem controles exceto quebra de linha, até `max`. */
export function kvShortText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max).trim();
  return s || undefined;
}

/** Endereço http/https válido (sem usuário/senha embutidos), normalizado; undefined se não serve. */
export function kvSafeUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || s.length > KV_LINK_URL_MAX || /\s/.test(s)) return undefined;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (u.username || u.password || !u.hostname) return undefined;
  const out = u.toString();
  return out.length <= KV_LINK_URL_MAX ? out : undefined;
}

// ------------------------------------------------------------------ quadro branco

/** Coordenadas do quadro: inteiros de 0 a KV_BOARD_W x KV_BOARD_H (proporção da tela de desenho). */
export const KV_BOARD_W = 1600;
export const KV_BOARD_H = 1000;
export const KV_BOARD_OPS_MAX = 3000;
export const KV_BOARD_POINTS_MAX = 4000;
export const KV_BOARD_TEXT_MAX = 120;
export const KV_BOARD_COLORS: readonly string[] = ['#1d2433', '#e2604f', '#3f7fd8', '#4cae6a', '#f2c14e', '#8d66cf'];

export type KvBoardTool = 'pen' | 'eraser' | 'text';

/** Um traço (caneta/borracha: `pts` = x0,y0,x1,y1...) ou um texto no quadro. */
export interface KvBoardOp {
  id: string;
  tool: KvBoardTool;
  color: string;
  size: number;
  pts?: number[];
  text?: string;
  by: string;
  at: number;
}

export interface KvBoardState {
  area: string;
  ops: KvBoardOp[];
  /** Muda a cada alteração (limpar, desfazer...). */
  rev: number;
}

/** Evento `board` do fluxo de presença. */
export type KvBoardEvent =
  | { area: string; kind: 'op'; op: KvBoardOp; append?: boolean; rev: number }
  | { area: string; kind: 'remove'; id: string; rev: number }
  | { area: string; kind: 'clear'; rev: number; by: string };

export function kvBoardColor(v: unknown): string | undefined {
  return typeof v === 'string' && KV_BOARD_COLORS.includes(v) ? v : undefined;
}

/** Pontos do quadro limpos (pares de inteiros dentro do quadro); undefined se o formato não serve. */
export function kvBoardPoints(v: unknown, max = KV_BOARD_POINTS_MAX): number[] | undefined {
  if (!Array.isArray(v) || v.length % 2 !== 0 || v.length === 0 || v.length > max) return undefined;
  const out: number[] = [];
  for (let i = 0; i < v.length; i += 2) {
    const x = v[i];
    const y = v[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    out.push(Math.max(0, Math.min(KV_BOARD_W, Math.round(x))), Math.max(0, Math.min(KV_BOARD_H, Math.round(y))));
  }
  return out;
}

/** Id curto vindo da página (traço em andamento). */
export function kvClientId(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{4,24}$/.test(v) ? v : undefined;
}
