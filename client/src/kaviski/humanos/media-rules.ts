// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): as regras da voz, sem DOM nem LiveKit (testadas em
// media-rules.test.ts) — em que chamada eu entro e com que volume ouço cada pessoa.
import { TILE } from '../../world/constants';

/** Proximidade nas áreas abertas: volume cheio até NEAR tiles, some em FAR. */
const NEAR = 3 * TILE;
const FAR = 11 * TILE;

export function proximityVolume(dist: number): number {
  if (dist <= NEAR) return 1;
  if (dist >= FAR) return 0;
  return 1 - (dist - NEAR) / (FAR - NEAR);
}

/** O pedaço do kvPeople (world.ts) que decide a chamada. `resting` vem do modo clássico (W1); `callArea`, da roda privada (W2). */
export interface KvCallInputs {
  inside: boolean;
  area: string | null;
  /** Modo clássico / descansando: fora de chamada, microfone e câmera desligados (a preferência fica). */
  resting?: boolean;
  /** Área de chamada que vale para mim (`b:<id>` numa roda privada; null = nenhuma; undefined = a da área). */
  callArea?: string | null;
  client?: { me(): { status?: string } | undefined } | null;
}

/** Em que chamada eu devo estar agora (null: nenhuma). Em não perturbe, nenhuma: não entro nem ouço ninguém. */
export function kvCallWanted(p: KvCallInputs): string | null {
  if (!p.inside || p.resting) return null;
  if (kvDoNotDisturb(p)) return null;
  return p.callArea === undefined ? p.area : p.callArea;
}

export function kvDoNotDisturb(p: Pick<KvCallInputs, 'client'>): boolean {
  return p.client?.me()?.status === 'naoperturbe';
}

/** Áreas em que todos se ouvem por igual: sala de projeto (`r:`) e roda privada (`b:`). O resto vai pela distância. */
export function kvAreaIsClosed(area: string | null): boolean {
  return !!area && (area.startsWith('r:') || area.startsWith('b:'));
}

/**
 * Volume de uma pessoa da minha chamada (0 a 1): cheio em sala fechada, pela distância nas abertas (sem posição: mudo);
 * 0 enquanto troco de área (`hushed`) e 0 para quem está no palco (a voz dele já chega pelo palco, não em dobro).
 */
export function kvVolumeFor(o: { area: string | null; dist: number | null; hushed: boolean; onStage: boolean }): number {
  if (o.hushed || o.onStage) return 0;
  if (kvAreaIsClosed(o.area)) return 1;
  return o.dist === null ? 0 : proximityVolume(o.dist);
}
