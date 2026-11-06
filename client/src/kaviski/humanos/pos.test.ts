// Fork Kaviski (KAVISKI-HUMANOS.md): a posição de uma pessoa sobrevive a prédios montados de jeitos diferentes.
import { describe, expect, it } from 'vitest';
import { TILE } from '../../world/constants';
import { kvDecodePos, kvEncodePos, type KvBuildingGeom } from './pos';

// Prédio do admin: a sala "a" na coluna 2 (norte) e a "b" na coluna 3 (sul).
const admin: KvBuildingGeom = {
  coreEndTx: 32,
  rooms: [
    { id: 'a', rect: { x: 32, y: 0, w: 16, h: 12 }, side: 'north' },
    { id: 'b', rect: { x: 48, y: 17, w: 16, h: 12 }, side: 'south' },
  ],
};
// Prédio do cliente: só a sala "b", que ficou na primeira vaga (norte).
const client: KvBuildingGeom = { coreEndTx: 32, rooms: [{ id: 'b', rect: { x: 32, y: 0, w: 16, h: 12 }, side: 'north' }] };

describe('posição das pessoas', () => {
  it('no núcleo vai em px absolutos', () => {
    const p = kvEncodePos(admin, 40, 43, 'down', 0);
    expect(p).toMatchObject({ k: 'a', x: 40, y: 43 });
    expect(kvDecodePos(client, p)).toEqual({ x: 40, y: 43 });
  });
  it('dentro da sala vai relativa a ela, espelhada se a sala mudou de lado', () => {
    const x = (48 + 3) * TILE;
    const y = (17 + 2) * TILE;
    const p = kvEncodePos(admin, x, y, 'up', 1);
    expect(p).toMatchObject({ k: 'r', r: 'b', x: 3 * TILE, y: 2 * TILE, s: 's' });
    expect(kvDecodePos(admin, p)).toEqual({ x, y });
    expect(kvDecodePos(client, p)).toEqual({ x: (32 + 3) * TILE, y: (12 - 2) * TILE });
  });
  it('no corredor vai pela coluna da sala; sala que não existe aqui = sem lugar', () => {
    const p = kvEncodePos(admin, (32 + 5) * TILE, 14 * TILE, 'right', 2);
    expect(p).toMatchObject({ k: 'c', r: 'a', x: 5 * TILE, y: 14 * TILE });
    expect(kvDecodePos(client, p)).toBeNull();
  });
  it('planta livre: fora das salas vai absoluta; no corredor da faixa, pela sala da coluna', () => {
    const plan: KvBuildingGeom = {
      coreEndTx: 0,
      rooms: [{ id: 'a', rect: { x: 50, y: 0, w: 16, h: 12 }, side: 'north' }, { id: 't', rect: { x: 10, y: 30, w: 20, h: 14 } }],
      plan: { strip: { x: 50, y: 12, w: 16, h: 5 }, vertical: false },
    };
    expect(kvEncodePos(plan, 5 * TILE, 40 * TILE, 'up', 0)).toMatchObject({ k: 'a', x: 5 * TILE, y: 40 * TILE });
    const c = kvEncodePos(plan, 53 * TILE, 14 * TILE, 'up', 0);
    expect(c).toMatchObject({ k: 'c', r: 'a', x: 3 * TILE, y: 14 * TILE });
    // sala de lugar fixo: sem espelho (o lado é o mesmo para todos)
    const r = kvEncodePos(plan, 12 * TILE, 33 * TILE, 'up', 0);
    expect(r).toMatchObject({ k: 'r', r: 't', s: 'n' });
    expect(kvDecodePos(plan, r)).toEqual({ x: 12 * TILE, y: 33 * TILE });
    // faixa vertical: y relativo à sala da fileira
    const v: KvBuildingGeom = { coreEndTx: 0, rooms: [{ id: 'w', rect: { x: 0, y: 40, w: 16, h: 12 } }], plan: { strip: { x: 16, y: 40, w: 5, h: 12 }, vertical: true } };
    const pv = kvEncodePos(v, 18 * TILE, 45 * TILE, 'down', 1);
    expect(pv).toMatchObject({ k: 'c', r: 'w', x: 18 * TILE, y: 5 * TILE, v: 1 });
    expect(kvDecodePos({ ...v, rooms: [{ id: 'w', rect: { x: 0, y: 64, w: 16, h: 12 } }] }, pv)).toEqual({ x: 18 * TILE, y: 69 * TILE });
  });
});
