import { describe, expect, it } from 'vitest';
import { FURNITURE } from '../../art/api';
import { KV_SPRITES, kvSpriteDims } from './themes-dims';
import { KV_SPRITE_KEYS, kvBuildSprite } from './themes-sprites';

describe('itens em pixel art das salas temáticas', () => {
  it('todo item medido tem desenho, e vice-versa', () => {
    expect(new Set(KV_SPRITE_KEYS)).toEqual(new Set(Object.keys(KV_SPRITES)));
  });

  it('cada item desenha alguma coisa, com contorno e âncora dentro do sprite', () => {
    for (const k of KV_SPRITE_KEYS) {
      const f = kvBuildSprite(k, 3)!;
      expect(f.base.buf.countOpaque(), k).toBeGreaterThan(30);
      expect(f.base.ax).toBeGreaterThan(0);
      expect(f.base.ay).toBeGreaterThan(0);
    }
  });

  it('o suporte bate com o tipo (chão/parede) e a TV e o espelho têm a área dinâmica', () => {
    for (const k of KV_SPRITE_KEYS) expect(FURNITURE[kvSpriteDims(k)!.carrier].mount, k).toBe(kvSpriteDims(k)!.mount);
    expect(kvBuildSprite('kv-bigtv')!.base.rects?.tv).toBeTruthy();
    expect(kvBuildSprite('kv-vanity')!.base.rects?.glass).toBeTruthy();
    expect(kvBuildSprite('kv-nada')).toBeNull();
    expect(kvSpriteDims('desk')).toBeUndefined();
  });
});
