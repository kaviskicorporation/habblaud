// Fork Kaviski (KAVISKI-HUMANOS.md): pessoas no escritório — o que servidor e página compartilham.
//
// Papéis: admin (tudo, inclusive a tela de Pessoas), equipe (tudo que a porta remota libera, menos administração) e
// cliente (só ver as salas permitidas; nada de terminal, mensagens, permissões ou Novo agente). As salas permitidas são
// uma lista de caminhos: cada um vale para a própria pasta e para tudo que estiver dentro dela
// (ex.: /home/hostadmin/projetos/Clientes/12-Rarm cobre todos os projetos da Rarm). Só o cliente é filtrado.
import type { FeedItem, Notice, OfficeSnapshot } from './types';
import { kvPathKey } from './kaviski';

/** `visitante` = quem entrou por um convite (link), sem conta: as restrições do cliente e mais algumas (KAVISKI-HUMANOS.md). */
export type KvRole = 'admin' | 'equipe' | 'cliente' | 'visitante';
/** Papéis de conta (users.json): o visitante nunca é uma conta. */
export const KV_ROLES: readonly KvRole[] = ['admin', 'equipe', 'cliente'];

/** Uma pessoa como a página e a tela de administração a veem (nunca o hash da senha). */
export interface KvPerson {
  id: string;
  user: string;
  name: string;
  role: KvRole;
  /** Salas permitidas (só valem para o cliente). */
  rooms: string[];
  /** Conta do HABBLAUD_REMOTE_USER (não se apaga nem troca de papel pela tela). */
  builtin?: boolean;
  /** Cliente que pode pedir tarefas (mandar mensagem) aos agentes das salas dele (fase 3; o admin libera). */
  request?: boolean;
  createdAt?: number;
  /** Visitante: até quando o convite vale (epoch ms); a sessão acaba junto. */
  until?: number;
}

/** GET /api/kaviski/humanos/me */
export interface KvMe {
  enabled: boolean;
  /** Quem está nesta página (ausente: porta local de outro Host, ou humanos desligado). */
  person?: KvPerson;
  /** Pela porta local (o próprio computador): age como admin. */
  local?: boolean;
}

export const KV_USER_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export const KV_PERSON_NAME_MAX = 40;
export const KV_PASSWORD_MIN = 8;
export const KV_PASSWORD_MAX = 200;
export const KV_ROOM_RULES_MAX = 200;
export const KV_PEOPLE_MAX = 500;

export function kvIsRole(v: unknown): v is KvRole {
  return typeof v === 'string' && (KV_ROLES as readonly string[]).includes(v);
}

/** Usuário normalizado (minúsculo, sem espaços) ou undefined se inválido. */
export function kvUserName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return KV_USER_RE.test(s) ? s : undefined;
}

/** Nome exibido: sem controles, espaços colapsados, 1 a 40 caracteres. */
export function kvPersonName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, KV_PERSON_NAME_MAX);
  return s || undefined;
}

/** Lista de salas permitidas limpa (caminhos absolutos, sem repetição); undefined se o formato não serve. */
export function kvRoomRules(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > KV_ROOM_RULES_MAX) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string') return undefined;
    const p = item.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (!p) continue;
    if (!p.startsWith('/') || p.length > 1024) return undefined;
    const clean = p.length > 1 ? p.replace(/\/+$/, '') : p;
    const key = kvPathKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** A sala (caminho) está liberada pelas regras? A regra vale para a pasta e para o que estiver dentro dela. */
export function kvRoomAllowed(path: string | undefined, rules: readonly string[]): boolean {
  if (!path) return false;
  const p = kvPathKey(path);
  for (const rule of rules) {
    const r = kvPathKey(rule);
    if (!r) continue;
    if (r === '/' || p === r || p.startsWith(`${r}/`)) return true;
  }
  return false;
}

/** Quem é filtrado: o cliente e o visitante (convite por link). */
export function kvRestricted(person: Pick<KvPerson, 'role'> | undefined): boolean {
  return person?.role === 'cliente' || person?.role === 'visitante';
}

/** Ids das salas do snapshot liberadas pelas regras. */
export function kvAllowedRoomIds(snap: Pick<OfficeSnapshot, 'rooms'>, rules: readonly string[]): Set<string> {
  return new Set(snap.rooms.filter((r) => kvRoomAllowed(r.path || r.id, rules)).map((r) => r.id));
}

/**
 * Snapshot para um cliente: só as salas permitidas e os agentes delas; sem os terminais abertos, as contas (uso do
 * Claude/Codex) e o Habblaud World, que são da empresa. Devolve um objeto novo (o original segue para os outros).
 */
export function kvFilterSnapshot(snap: OfficeSnapshot, rules: readonly string[]): OfficeSnapshot {
  const ids = kvAllowedRoomIds(snap, rules);
  const meta = { ...snap.meta };
  delete meta.world;
  const out: OfficeSnapshot = {
    ...snap,
    rooms: snap.rooms.filter((r) => ids.has(r.id)),
    agents: snap.agents.filter((a) => ids.has(a.roomId)),
    accounts: [],
    meta,
  };
  delete out.ptys;
  return out;
}

export function kvFilterFeed(items: readonly FeedItem[], ids: ReadonlySet<string>): FeedItem[] {
  return items.filter((f) => ids.has(f.roomId));
}

/** Aviso para um cliente: só os de uma sala liberada (os gerais falam da empresa toda). */
export function kvNoticeAllowed(n: Notice, ids: ReadonlySet<string>): boolean {
  return !!n.roomId && ids.has(n.roomId);
}
