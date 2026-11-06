// Fork Kaviski (KAVISKI-HUMANOS.md): voz e vídeo (fase 1c) — o Habblaud só emite o token de entrada no LiveKit.
//
// O LiveKit (servidor de mídia, Apache 2.0) roda à parte (container `habblaud-livekit`); o navegador fala direto com
// ele. Aqui só se decide QUEM entra EM QUAL chamada: uma chamada por área do escritório (cada sala de projeto, cada área
// comum do núcleo e o corredor). Cliente só ganha token para as salas dele e para as áreas comuns/corredor.
//
// Variáveis (no .env, nunca no git):
//   HABBLAUD_LIVEKIT_URL     endereço que o NAVEGADOR usa (wss://... no endereço público; ws://127.0.0.1:7880 em teste)
//   HABBLAUD_LIVEKIT_KEY     chave da API do LiveKit
//   HABBLAUD_LIVEKIT_SECRET  segredo da API do LiveKit (assina o token; mínimo 32 caracteres)
import { createHash, createHmac } from 'node:crypto';
import type { OfficeSnapshot } from '../../../shared/types';
import { kvAllowedRoomIds, kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';

/** Áreas fixas do núcleo (client/src/world/layout/core.ts). */
export const KV_CORE_AREAS = ['core:recepcao', 'core:banheiros', 'core:copa', 'core:lounge'] as const;
export const KV_CORRIDOR = 'corredor';
/** Validade do token (a página pede outro a cada troca de área, e de novo antes de vencer). */
export const TOKEN_TTL_S = 2 * 60 * 60;

export interface KvLiveKitConfig {
  url: string;
  key: string;
  secret: string;
}

/** Configuração do LiveKit pelo ambiente (undefined = voz e vídeo desligados) e o motivo, se parece intencional. */
export function kvLiveKitConfig(env: NodeJS.ProcessEnv): { config?: KvLiveKitConfig; warning?: string } {
  const url = env.HABBLAUD_LIVEKIT_URL?.trim() ?? '';
  const key = env.HABBLAUD_LIVEKIT_KEY?.trim() ?? '';
  const secret = env.HABBLAUD_LIVEKIT_SECRET?.trim() ?? '';
  if (!url && !key && !secret) return {};
  if (!/^wss?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(url)) return { warning: 'HABBLAUD_LIVEKIT_URL' };
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(key)) return { warning: 'HABBLAUD_LIVEKIT_KEY' };
  if (secret.length < 32) return { warning: 'HABBLAUD_LIVEKIT_SECRET' };
  return { config: { url: url.replace(/\/+$/, ''), key, secret } };
}

/** Nome da chamada no LiveKit para uma área (sem o caminho da pasta: só um resumo). */
export function kvCallName(area: string): string {
  return `kv-${createHash('sha256').update(area, 'utf8').digest('hex').slice(0, 20)}`;
}

/**
 * A pessoa pode entrar na chamada desta área? Área: `r:<id da sala>`, `a:<área do núcleo>` ou `c` (corredor).
 * Devolve o nome legível da área (para a página) ou undefined.
 */
export function kvAreaAllowed(area: unknown, person: KvPerson, snap: OfficeSnapshot): string | undefined {
  if (typeof area !== 'string' || area.length > 1100) return undefined;
  if (area === 'c') return KV_CORRIDOR;
  if (area.startsWith('a:')) return (KV_CORE_AREAS as readonly string[]).includes(area.slice(2)) ? area.slice(2) : undefined;
  if (!area.startsWith('r:')) return undefined;
  const id = area.slice(2);
  const room = snap.rooms.find((r) => r.id === id);
  if (!room) return undefined;
  if (kvRestricted(person) && !kvAllowedRoomIds(snap, person.rooms).has(id)) return undefined;
  return room.name;
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');

/** Token de acesso do LiveKit (JWT HS256) para entrar em `room` como `person`. */
export function kvLiveKitToken(cfg: KvLiveKitConfig, person: Pick<KvPerson, 'id' | 'name'>, room: string, nowS = Math.floor(Date.now() / 1000)): string {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    iss: cfg.key,
    sub: person.id,
    name: person.name,
    nbf: nowS - 10,
    exp: nowS + TOKEN_TTL_S,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  });
  const sig = createHmac('sha256', cfg.secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
