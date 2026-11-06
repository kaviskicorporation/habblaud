// Fork Kaviski (KAVISKI-HUMANOS.md): convites por link (fase 4) — o que servidor e página compartilham.
//
// Quem é admin ou equipe gera um convite: validade (1 h, 1 dia ou 7 dias), uso único ou várias pessoas e as salas que
// o visitante pode ver (como as do cliente; vazio = só as áreas comuns). O link abre uma página que pede só o nome; o
// visitante entra com o papel `visitante` (as restrições do cliente e mais: não pede tarefa, não chama agente, não
// convida) e a sessão dura até o convite vencer. Revogar o convite derruba os visitantes dele.

/** Validades que a tela oferece (ms). */
export const KV_INVITE_TTLS = { '1h': 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 } as const;
export type KvInviteTtl = keyof typeof KV_INVITE_TTLS;
/** Máximo de pessoas num convite de várias pessoas. */
export const KV_INVITE_MAX_USES = 50;
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
  state: KvInviteState;
  /** Caminho do link (/convite/<token>), só enquanto ativo. */
  link?: string;
  /** Quem entrou por ele. */
  visitors: { id: string; name: string; joinedAt: number }[];
}

export function kvIsInviteTtl(v: unknown): v is KvInviteTtl {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(KV_INVITE_TTLS, v);
}
