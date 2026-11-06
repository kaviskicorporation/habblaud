// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): entrega ao mundo os itens em pixel art das salas
// temáticas. Gancho de 1 linha em client/src/world/index.ts: `const art = kvArt(artModule)`. O módulo de arte continua o
// mesmo; só `furnitureSprites(kind, 'kv-...')` é respondido aqui (themes-sprites.ts), com cache. Outros módulos do fork
// podem acrescentar sprites com `kvRegisterSprite`.
import type { ArtModule, FurnitureKind, FurnitureSprites, Sprite } from '../../art/api';
import type { BufFurniture, BufSprite } from '../../art/core/sprite';
import { kvBuildSprite } from './themes-sprites';

const extra = new Map<string, (seed: number) => BufFurniture>();
const cache = new Map<string, FurnitureSprites | null>();

/** Acrescenta um sprite próprio (variante `kv-<nome>`). */
export function kvRegisterSprite(variant: string, make: (seed: number) => BufFurniture): void {
  extra.set(variant, make);
  for (const k of cache.keys()) if (k.startsWith(`${variant}|`)) cache.delete(k);
}

function toSprite(s: BufSprite): Sprite {
  const c = document.createElement('canvas');
  c.width = Math.max(1, s.buf.w);
  c.height = Math.max(1, s.buf.h);
  const ctx = c.getContext('2d');
  if (ctx && s.buf.w > 0 && s.buf.h > 0) ctx.putImageData(new ImageData(s.buf.data, s.buf.w, s.buf.h), 0, 0);
  return { canvas: c, ax: s.ax, ay: s.ay, rects: s.rects };
}

/** Sprite pronto (canvas) de um item nosso; null = não é nosso. */
export function kvSprites(variant: string | undefined, seed = 0): FurnitureSprites | null {
  if (!variant || !variant.startsWith('kv-')) return null;
  const key = `${variant}|${seed % 4}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let out: FurnitureSprites | null = null;
  try {
    const f = extra.get(variant)?.(seed) ?? kvBuildSprite(variant, seed);
    if (f) out = { base: toSprite(f.base), front: f.front ? toSprite(f.front) : undefined };
  } catch {
    out = null;
  }
  cache.set(key, out);
  return out;
}

/** O módulo de arte do mundo com os itens das salas temáticas. */
export function kvArt(art: ArtModule): ArtModule {
  return {
    ...art,
    furnitureSprites(kind: FurnitureKind, variant?: string, state?: number, opts?: { seed?: number }): FurnitureSprites {
      return kvSprites(variant, opts?.seed ?? 0) ?? art.furnitureSprites(kind, variant, state, opts);
    },
  };
}
