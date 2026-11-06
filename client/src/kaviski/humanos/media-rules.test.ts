// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): quando entro na chamada e com que volume ouço.
import { describe, expect, it } from 'vitest';
import { TILE } from '../../world/constants';
import { kvCallWanted, kvVolumeFor, proximityVolume } from './media-rules';

const me = (status: string) => ({ me: () => ({ status }) });

describe('em que chamada eu entro', () => {
  it('a da área, só com o boneco no escritório', () => {
    expect(kvCallWanted({ inside: true, area: 'r:1' })).toBe('r:1');
    expect(kvCallWanted({ inside: false, area: 'r:1' })).toBeNull();
    expect(kvCallWanted({ inside: true, area: null })).toBeNull();
  });
  it('não perturbe e modo clássico: nenhuma', () => {
    expect(kvCallWanted({ inside: true, area: 'c', client: me('naoperturbe') })).toBeNull();
    expect(kvCallWanted({ inside: true, area: 'c', client: me('ocupado') })).toBe('c');
    expect(kvCallWanted({ inside: true, area: 'c', resting: true })).toBeNull();
  });
  it('roda privada: a área dela vale no lugar da área', () => {
    expect(kvCallWanted({ inside: true, area: 'c', callArea: 'b:x' })).toBe('b:x');
    expect(kvCallWanted({ inside: true, area: 'c', callArea: null })).toBeNull();
    expect(kvCallWanted({ inside: true, area: 'c', callArea: undefined })).toBe('c');
  });
});

describe('volume de cada pessoa', () => {
  it('cheio em sala e roda privada; pela distância nas áreas abertas', () => {
    expect(kvVolumeFor({ area: 'r:1', dist: 50 * TILE, hushed: false, onStage: false })).toBe(1);
    expect(kvVolumeFor({ area: 'b:x', dist: null, hushed: false, onStage: false })).toBe(1);
    expect(kvVolumeFor({ area: 'c', dist: 2 * TILE, hushed: false, onStage: false })).toBe(1);
    expect(kvVolumeFor({ area: 'a:core:copa', dist: 7 * TILE, hushed: false, onStage: false })).toBeCloseTo(0.5);
    expect(kvVolumeFor({ area: 'c', dist: 12 * TILE, hushed: false, onStage: false })).toBe(0);
    expect(kvVolumeFor({ area: 'c', dist: null, hushed: false, onStage: false })).toBe(0);
    expect(proximityVolume(0)).toBe(1);
  });
  it('trocando de área ou no palco: mudo (nada vaza, nada em dobro)', () => {
    expect(kvVolumeFor({ area: 'r:1', dist: 0, hushed: true, onStage: false })).toBe(0);
    expect(kvVolumeFor({ area: 'r:1', dist: 0, hushed: false, onStage: true })).toBe(0);
  });
});
