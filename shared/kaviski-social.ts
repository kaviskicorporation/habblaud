// Fork Kaviski (KAVISKI-HUMANOS.md, "recursos do Gather" W2): o que servidor e página dividem para chamar uma pessoa,
// reações rápidas, nota do status, salas trancadas (bater na porta) e rodas de conversa privada.
//
// Áreas (as mesmas do chat e da voz, shared/kaviski-presence.ts): `r:<sala>`, `a:<núcleo>`, `c` (corredor) e, nesta
// frente, `b:<id>` = uma roda de conversa privada (só os membros ouvem e leem).

/** Nota do status: até este tamanho (em caracteres visíveis, emoji conta como um). */
export const KV_NOTE_MAX = 60;
/** "Até" no máximo daqui a 7 dias. */
export const KV_UNTIL_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** Reações rápidas, na ordem das teclas 1–9. ✋ = levantar/baixar a mão (fica até baixar). */
export const KV_REACTIONS: readonly string[] = ['👍', '❤️', '😂', '🎉', '👏', '☕', '✋', '😮', '🙏'];
export const KV_HAND = '✋';

/** Raio da roda de conversa privada: quem está a até isto (tiles) entra quando ela começa. */
export const KV_BUBBLE_TILES = 3;
/** Com 16 px por tile (client/src/art/api.ts TILE). */
export const KV_TILE_PX = 16;
/** Máximo de pessoas numa roda privada. */
export const KV_BUBBLE_MAX = 12;

/** Sala trancada como uma página a vê (KvPresenceState.locks). */
export interface KvLockInfo {
  /** `r:<id da sala>`. */
  area: string;
  /** Quem trancou. */
  by: string;
  /** Quantas pessoas estão na lista de quem pode entrar. */
  n: number;
  /** Quem recebe está na lista (pode entrar e sair). */
  in: boolean;
  /** Sala privada (reuniões): quem está fora não vê ninguém lá dentro, não ouve nem lê nada. */
  veil?: boolean;
  /** Reunião privada que trancou a sala (id da reserva, shared/kaviski-meetings.ts). */
  meeting?: string;
  /** Até quando a reunião vai (epoch ms). */
  until?: number;
  /** Título da reunião: só para quem é dela. */
  title?: string;
}

/** Evento `ring` (alguém me chamou). */
export interface KvRingEvent {
  id: string;
  at: number;
  from: { id: string; name: string; role: string };
}

/** Evento `react` (reação rápida sobre o boneco de alguém). */
export interface KvReactEvent {
  id: string;
  at: number;
  /** Quem reagiu. */
  who: string;
  emoji: string;
}

/** Evento `knock` (alguém bateu na porta de uma sala trancada em que estou). */
export interface KvKnockEvent {
  id: string;
  at: number;
  area: string;
  from: { id: string; name: string; role: string };
}

/** Evento `knock-answer`: para quem bateu (deixaram ou não) e para quem está dentro (o pedido foi respondido). */
export interface KvKnockAnswer {
  area: string;
  who: string;
  allow: boolean;
  by: string;
}

/** Nota limpa (sem controles, espaços colapsados, até KV_NOTE_MAX), '' = sem nota, undefined = inválida. */
export function kvStatusNote(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, KV_NOTE_MAX).join('');
}

/** "Até" válido (no futuro e a até KV_UNTIL_MAX_MS), 0 = sem prazo, undefined = inválido. */
export function kvStatusUntil(v: unknown, now: number): number | undefined {
  if (v === null || v === undefined || v === 0) return 0;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v <= now || v > now + KV_UNTIL_MAX_MS) return undefined;
  return Math.round(v);
}

export function kvIsReaction(v: unknown): v is string {
  return typeof v === 'string' && KV_REACTIONS.includes(v);
}

/** A área é de roda privada? */
export function kvIsBubbleArea(area: string | null | undefined): boolean {
  return !!area && area.startsWith('b:');
}

/** Área aberta (núcleo ou corredor): onde dá para abrir uma roda privada. */
export function kvIsOpenArea(area: string | null | undefined): boolean {
  return area === 'c' || (!!area && area.startsWith('a:'));
}

/** Uma menção a `name` no texto (@Ana, @ana.rarm, @"Ana Rarm" não: só a primeira palavra ou o usuário), sem acento. */
export function kvMentions(text: string, names: readonly string[]): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = norm(text);
  for (const raw of names) {
    const n = norm(raw.trim());
    if (n.length < 2) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_.-])@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u');
    if (re.test(t)) return true;
  }
  return false;
}
