// Fork Kaviski (KAVISKI-HUMANOS.md): convites por link (fase 4) — o que servidor e página compartilham.
//
// Quem é admin ou equipe gera um convite: validade (1 h, 1 dia ou 7 dias), uso único ou várias pessoas e as salas que
// o visitante pode ver (como as do cliente; vazio = só as áreas comuns). O link abre uma página que pede só o nome; o
// visitante entra com o papel `visitante` (as restrições do cliente e mais: não pede tarefa, não chama agente, não
// convida) e a sessão dura até o convite vencer. Revogar o convite derruba os visitantes dele.
//
// Depois de criado, o convite se edita (PATCH): validade (+1 h, +1 dia, +7 dias ou data exata, até 30 dias a partir de
// agora), número de pessoas, descrição e o acesso — salas de projeto, salas próprias (uma a uma ou "todas as salas de
// reunião"), salas temáticas bloqueadas, voz/vídeo e o chat da sala. Quem decide é o servidor; quem já entrou recebe
// as mudanças na hora (e encurtar para antes de agora derruba).
import { tr } from './i18n';
import type { KvThemeKey } from './kaviski-plan';
import { KV_THEME_KEYS } from './kaviski-plan';
import { kvIsOwnRoomId } from './kaviski-rooms';

/** Validades que a tela oferece (ms). */
export const KV_INVITE_TTLS = { '1h': 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 } as const;
export type KvInviteTtl = keyof typeof KV_INVITE_TTLS;
/** Máximo de pessoas num convite de várias pessoas. */
export const KV_INVITE_MAX_USES = 50;
/** Validade máxima a partir de agora (criar ou editar). */
export const KV_INVITE_MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
/** Salas próprias liberadas uma a uma, no máximo. */
export const KV_INVITE_OWN_MAX = 60;
/** Máximo de convites guardados (vencidos há mais de 7 dias são esquecidos). */
export const KV_INVITES_MAX = 300;

export type KvInviteState = 'ativo' | 'vencido' | 'revogado' | 'esgotado';

/** Um convite como a tela de convites o vê. */
export interface KvInviteInfo {
  id: string;
  /** Para quem/para quê (opcional). */
  label?: string;
  by: { id: string; name: string };
  createdAt: number;
  expiresAt: number;
  /** 1 = uso único. */
  maxUses: number;
  uses: number;
  rooms: string[];
  /** Acesso além das salas de projeto (convites antigos: o padrão, KV_INVITE_ACCESS_DEFAULT). */
  access: KvInviteAccess;
  state: KvInviteState;
  /** Caminho do link (/convite/<token>), só enquanto ativo. */
  link?: string;
  /** Quem entrou por ele. */
  visitors: KvInviteVisitor[];
}

export interface KvInviteVisitor {
  id: string;
  name: string;
  joinedAt: number;
  /** Online agora (a tela de convites pede ao servidor). */
  online?: boolean;
  /** Onde está (área do escritório: `r:<sala>`, `a:<núcleo>`, `c`...), se online. */
  area?: string;
}

/**
 * O que o visitante pode além das salas de projeto (`rooms`). Tudo é decidido no servidor:
 * - `own`: salas próprias liberadas (ids `kvsala-...`) e `meetings`: todas as salas de reunião (as novas também);
 * - `blocked`: salas temáticas da planta onde ele não entra (aparecem fechadas, "Acesso restrito");
 * - `voice`: entra na voz e no vídeo das salas; `chat`: escreve no chat da sala (ler continua).
 */
export interface KvInviteAccess {
  own: string[];
  meetings: boolean;
  blocked: KvThemeKey[];
  voice: boolean;
  chat: boolean;
}

/** Acesso dos convites antigos (antes da edição): como era — nenhuma sala própria, temáticas abertas, voz e chat. */
export const KV_INVITE_ACCESS_DEFAULT: Readonly<KvInviteAccess> = Object.freeze({ own: [], meetings: false, blocked: [], voice: true, chat: true });

/**
 * Lê o acesso de um corpo (POST/PATCH) por cima de `base`: campos ausentes ficam como estão. Devolve o erro (já traduzido) quando algum campo não serve.
 */
export function kvParseInviteAccess(b: Record<string, unknown>, base: Readonly<KvInviteAccess> = KV_INVITE_ACCESS_DEFAULT): { access: KvInviteAccess } | { error: string } {
  const out: KvInviteAccess = { own: [...base.own], meetings: base.meetings, blocked: [...base.blocked], voice: base.voice, chat: base.chat };
  if (b.own !== undefined) {
    if (!Array.isArray(b.own) || b.own.length > KV_INVITE_OWN_MAX || !b.own.every(kvIsOwnRoomId)) return { error: tr('salas próprias inválidas') };
    out.own = [...new Set(b.own as string[])];
  }
  if (b.blocked !== undefined) {
    if (!Array.isArray(b.blocked) || !b.blocked.every((k) => (KV_THEME_KEYS as readonly unknown[]).includes(k))) return { error: tr('salas temáticas inválidas') };
    out.blocked = [...new Set(b.blocked as KvThemeKey[])];
  }
  for (const k of ['meetings', 'voice', 'chat'] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'boolean') return { error: tr('opção de acesso inválida') };
    out[k] = b[k];
  }
  return { access: out };
}

/** Acesso guardado num arquivo antigo/estranho: o que não serve volta ao padrão. */
export function kvNormInviteAccess(v: unknown): KvInviteAccess {
  if (!v || typeof v !== 'object') return { ...KV_INVITE_ACCESS_DEFAULT, own: [], blocked: [] };
  const r = v as Record<string, unknown>;
  return {
    own: Array.isArray(r.own) ? [...new Set(r.own.filter(kvIsOwnRoomId))].slice(0, KV_INVITE_OWN_MAX) : [],
    meetings: r.meetings === true,
    blocked: Array.isArray(r.blocked) ? [...new Set(r.blocked.filter((k): k is KvThemeKey => (KV_THEME_KEYS as readonly unknown[]).includes(k)))] : [],
    voice: r.voice !== false,
    chat: r.chat !== false,
  };
}

/**
 * Nova validade de uma edição: `extend` ('1h'|'1d'|'7d') soma ao fim atual (ou a agora, se já venceu); `expiresAt`
 * (epoch ms) é a data exata. Teto: agora + 30 dias. undefined = sem mudança; `{error}` = o motivo (já traduzido).
 */
export function kvInviteNewExpiry(b: Record<string, unknown>, current: number, now: number): number | undefined | { error: string } {
  const cap = now + KV_INVITE_MAX_AHEAD_MS;
  if (b.extend !== undefined) {
    if (!kvIsInviteTtl(b.extend)) return { error: tr('validade inválida (1h, 1d ou 7d)') };
    return Math.min(cap, Math.max(current, now) + KV_INVITE_TTLS[b.extend]);
  }
  if (b.expiresAt !== undefined) {
    const t = b.expiresAt;
    if (typeof t !== 'number' || !Number.isFinite(t)) return { error: tr('data de fim inválida') };
    if (t <= now) return { error: tr('a data de fim já passou (para encerrar agora, use Encerrar)') };
    if (t > cap + 60_000) return { error: tr('no máximo 30 dias a partir de agora') };
    return Math.min(cap, Math.round(t));
  }
  return undefined;
}

export function kvIsInviteTtl(v: unknown): v is KvInviteTtl {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(KV_INVITE_TTLS, v);
}
