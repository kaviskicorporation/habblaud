// Fork Kaviski (KAVISKI-HUMANOS.md): o boneco da pessoa — a pose que os outros veem (sentado, bebendo...) e a mesa
// fixa (`profile.desk`). Puro: usado pelo servidor (validação) e pela página.
//
// A pose vai junto da posição (KvPos.p, e o item na mão em KvPos.h); quem recebe procura o assento mais perto da
// posição e senta o boneco de corda nele. A mesa fixa é uma KvPos de sala (k='r'), a cadeira escolhida: a mesma regra
// de posição independente do prédio (shared/kaviski-presence.ts).
import type { KvPos } from './kaviski-presence';

/** Poses que a rede leva (as outras viram 'stand'). As sentadas pedem um assento no lugar. */
export const KV_POSES = ['sit', 'type', 'sleep', 'wait', 'drink', 'use', 'read', 'game', 'play', 'cheer', 'laugh', 'talk', 'stretch', 'raise_hand'] as const;
export type KvPose = (typeof KV_POSES)[number];
export const KV_SEATED_POSES: readonly KvPose[] = ['sit', 'type', 'sleep', 'wait'];
/** Itens na mão que a rede leva. */
export const KV_HELD = ['coffee', 'water', 'controller', 'paddle', 'phone', 'book', 'laptop', 'papers'] as const;
export type KvHeld = (typeof KV_HELD)[number];

export function kvIsPose(v: unknown): v is KvPose {
  return typeof v === 'string' && (KV_POSES as readonly string[]).includes(v);
}

export function kvIsHeld(v: unknown): v is KvHeld {
  return typeof v === 'string' && (KV_HELD as readonly string[]).includes(v);
}

export function kvSeatedPose(p: unknown): boolean {
  return typeof p === 'string' && (KV_SEATED_POSES as readonly string[]).includes(p as KvPose);
}

/** Altura (px) de uma sala de projeto: 12 tiles de 16 px (client/src/world/layout/room.ts). Usada para espelhar o y. */
export const KV_ROOM_H_PX = 12 * 16;
/** Duas mesas a menos disto (px, na mesma sala) são a mesma cadeira. */
const SAME_DESK_PX = 8;

/** Mesa fixa recebida (perfil ou POST): só posição de sala, parada; undefined = formato estranho. */
export function kvParseDesk(v: unknown, parsePos: (v: unknown) => KvPos | null | undefined): KvPos | undefined {
  const p = parsePos(v);
  if (!p || p.k !== 'r' || !p.r) return undefined;
  // salas da planta livre vão até 48x32 tiles (shared/kaviski-plan.ts)
  if (p.x < 0 || p.y < 0 || p.x > 64 * 16 || p.y > 32 * 16) return undefined;
  return { k: 'r', r: p.r, x: p.x, y: p.y, s: p.s === 's' ? 's' : 'n', d: p.d, m: 0 };
}

/** y como se a sala estivesse ao norte do corredor (o outro lado é espelhado). */
function northY(p: KvPos): number {
  return p.s === 's' ? KV_ROOM_H_PX - p.y : p.y;
}

/** As duas mesas são a mesma cadeira (mesma sala, quase o mesmo lugar)? */
export function kvSameDesk(a: KvPos | undefined, b: KvPos | undefined): boolean {
  if (!a || !b || a.k !== 'r' || b.k !== 'r' || a.r !== b.r) return false;
  return Math.abs(a.x - b.x) < SAME_DESK_PX && Math.abs(northY(a) - northY(b)) < SAME_DESK_PX;
}
