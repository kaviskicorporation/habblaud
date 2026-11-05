// Fork Kaviski (ver KAVISKI.md na raiz): tipos e funções puras usadas pelo servidor e pelo cliente.
//
// - Estilo por sala (cor e grupo do cliente, sala fixa, nome): POST /api/rooms/style, vai no snapshot em RoomInfo.kaviski.
//   Sala fixa (`pinned`): existe sempre no escritório, mesmo vazia (a empresa inteira, um projeto por sala).
// - TwiCC (interface web do Claude Code): HABBLAUD_TWICC_URL vai no snapshot em meta.kaviski.twiccUrl e o cliente monta
//   o link da sessão (/project/<id>/session/<id>).
// Nada aqui muda o comportamento original quando as variáveis e o arquivo de estilos não existem.
import type { OfficeSnapshot, Provider, RoomInfo } from './types';

/** Estilo de uma sala (cor do cliente e nome do grupo); é o que vai no snapshot em RoomInfo.kaviski. */
export interface KvRoomStyle {
  /** Cor em #rrggbb (minúsculas). */
  color?: string;
  /** Nome do grupo/cliente (curto). */
  group?: string;
  /** Sala fixa: existe sempre no escritório, mesmo sem ninguém. */
  pinned?: boolean;
  /** Sala escondida: nem a sala nem os agentes dela aparecem (projeto fora da organização da empresa). */
  hidden?: boolean;
}

/** Entrada do mapa de estilos guardada no servidor (o que vai ao snapshot é só o KvRoomStyle). */
export interface KvRoomEntry extends KvRoomStyle {
  /** Nome da sala quando não há apelido manual (botão direito > Renomear). */
  name?: string;
  /** Só nas fixas: o caminho como veio (com as maiúsculas), id e caminho da sala enquanto ela está vazia. */
  path?: string;
}

/** O que o fork acrescenta ao meta do snapshot. */
export interface KvMeta {
  /** Base do TwiCC (ex.: http://192.168.1.220:3500), sem barra no fim. */
  twiccUrl?: string;
  /** Nome da empresa (HABBLAUD_BRAND): no topo, no título da aba e na tela de login. */
  brand?: string;
}

/** RoomInfo com o campo do fork (opcional: ausente = sem estilo). */
export type KvRoomInfo = RoomInfo & { kaviski?: KvRoomStyle };
/** Meta do snapshot com o campo do fork. */
export type KvSnapshotMeta = OfficeSnapshot['meta'] & { kaviski?: KvMeta };

export const KV_GROUP_MAX = 40;
/** Nome de sala (o mesmo limite de model/room-aliases.ts ROOM_NAME_MAX). */
export const KV_NAME_MAX = 40;
/** Nome da empresa (HABBLAUD_BRAND). */
export const KV_BRAND_MAX = 60;
export const KV_PATH_MAX = 1024;
export const KV_ROOMS_MAX = 500;

/** `#rgb` ou `#rrggbb` -> `#rrggbb` minúsculo; qualquer outra coisa -> undefined. */
export function kvColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return undefined;
}

/** Nome do grupo limpo: sem caracteres de controle, espaços colapsados, até KV_GROUP_MAX. Vazio -> undefined. */
export function kvGroup(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? [...s].slice(0, KV_GROUP_MAX).join('').trim() : undefined;
}

/** Nome de sala limpo (mesma regra do grupo, até KV_NAME_MAX). Vazio -> undefined. */
export function kvRoomName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? [...s].slice(0, KV_NAME_MAX).join('').trim() : undefined;
}

/** Nome da empresa (HABBLAUD_BRAND) limpo, até KV_BRAND_MAX. Vazio -> undefined. */
export function kvBrand(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? [...s].slice(0, KV_BRAND_MAX).join('').trim() : undefined;
}

/** Caminho como a sala o usa (cwd normalizado, como model/rooms.ts normalizeCwd), com barras normais. */
export function kvRoomPath(p: string): string {
  const s = p.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

/** Chave comparável de um caminho (igual à de server/model/room-aliases.ts pathKey). */
export function kvPathKey(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Luminância relativa (WCAG) de #rrggbb. */
export function kvLuminance(hex: string): number {
  const c = kvColor(hex) ?? '#000000';
  const ch = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Cor do texto sobre um fundo `hex`: escuro em cores claras, claro em cores escuras. */
export function kvTextOn(hex: string): string {
  return kvLuminance(hex) > 0.4 ? '#14181f' : '#ffffff';
}

// ---------------------------------------------------------------- TwiCC

/** Base do TwiCC: só http(s), sem query/fragmento, sem barra no fim. Inválida -> undefined. */
export function kvTwiccBase(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (u.username || u.password) return undefined;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * Id do projeto no TwiCC = nome da pasta em ~/.claude/projects: o cwd com tudo que não é letra/número trocado por "-"
 * (a mesma regra de server/sources/watcher.ts encodeCwd). Caminhos muito longos o Claude Code encurta com um hash: aí
 * não dá para montar com segurança (undefined).
 */
export function kvProjectId(cwd: string | undefined): string | undefined {
  const p = (cwd ?? '').trim();
  if (!p.startsWith('/') || p.startsWith('/demo/')) return undefined;
  const id = p.replace(/\/+$/, '').replace(/[^a-zA-Z0-9]/g, '-');
  return id.length > 1 && id.length <= 200 ? id : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O que é preciso saber de uma sessão para abrir no TwiCC. */
export interface KvSessionRef {
  provider?: Provider;
  /** 'main' | 'sub' (agente); ausente = sessão do histórico. */
  kind?: string;
  /** Pasta do projeto (cwd). */
  cwd?: string;
  /** Nome codificado da pasta (histórico do Claude Code), usado quando `cwd` falta. */
  projectDir?: string;
  sessionId: string;
}

/**
 * URL da sessão no TwiCC (`<base>/project/<project_id>/session/<session_id>`), ou undefined quando não dá para montar com
 * segurança: sem base, id que não é UUID (demo), projeto desconhecido ou subagente do Codex (o thread do sub não é uma
 * sessão do TwiCC). No Claude Code o subagente leva à sessão principal (o sessionId dele é o da sessão que o disparou).
 * No Codex, o TwiCC usa o id do thread (o mesmo sessionId do Habblaud) e o projeto pelo cwd, como no Claude Code.
 */
export function kvTwiccSessionUrl(base: string | undefined, s: KvSessionRef): string | undefined {
  const b = kvTwiccBase(base);
  if (!b || !UUID.test(s.sessionId)) return undefined;
  const codex = s.provider === 'codex';
  if (codex && s.kind === 'sub') return undefined;
  let project = kvProjectId(s.cwd);
  // Só no Claude Code o projectDir do histórico é o nome da pasta em ~/.claude/projects (no Codex pode ser outra coisa).
  if (!project && !codex && s.projectDir && /^-[A-Za-z0-9-]{1,199}$/.test(s.projectDir)) project = s.projectDir;
  if (!project) return undefined;
  return `${b}/project/${encodeURIComponent(project)}/session/${encodeURIComponent(s.sessionId.toLowerCase())}`;
}

// ---------------------------------------------------------------- sala pela URL

/** Valor de `?sala=` (ou `?room=`) da URL, já decodificado; undefined se não veio. */
export function kvRoomParam(search: string): string | undefined {
  const p = new URLSearchParams(search);
  const v = p.get('sala') ?? p.get('room');
  return v && v.trim() && v.length <= KV_PATH_MAX ? v.trim() : undefined;
}

/** Sala cujo caminho (ou id) bate com `want` (mesma regra de comparação dos nomes de sala). */
export function kvFindRoom<T extends { id: string; path: string }>(rooms: readonly T[], want: string): T | undefined {
  const k = kvPathKey(want);
  if (!k) return undefined;
  return rooms.find((r) => kvPathKey(r.path) === k) ?? rooms.find((r) => kvPathKey(r.id) === k);
}
