import { describe, expect, it } from 'vitest';
import { FURNITURE } from '../../art/api';
import { KV_THEME_KEYS, type KvDoorSide, type KvThemeKey } from '../../../../shared/kaviski-plan';
import { kvFurnishTheme } from './themes';
import { kvHarnessRoom } from './themes-harness';
import { kvThemeActions } from './themes-info';
import { kvComputeActionSpots } from './themes-spots';
import { kvFurnisher } from './api';

/** Ações que podem faltar numa sala apertada (a principal de cada sala nunca falta). */
const MAIN: Record<KvThemeKey, string> = {
  rh: 'pessoas',
  diretoria: 'organograma',
  reuniao: 'agenda',
  recepcao: 'convites',
  provador: 'boneco',
  foco: 'foco',
  auditorio: 'palco',
  agentes: 'novo-agente',
  ti: 'config',
  arquitetura: 'planta',
  correio: 'conversas',
  descanso: 'classico',
  arquivo: 'arquivos',
};

const SIZES: [number, number][] = [
  [8, 8],
  [10, 9],
  [12, 10],
  [16, 12],
  [20, 14],
  [32, 20],
  [9, 16],
  [26, 8],
];
const SIDES: KvDoorSide[] = ['s', 'n', 'e', 'w'];

function furnish(key: KvThemeKey, w: number, h: number, side: KvDoorSide) {
  const r = kvHarnessRoom(key, w, h, side);
  kvFurnishTheme(key, r.ctx);
  const spots = kvComputeActionSpots([r.area], r.tags, (tx, ty) => r.walkable(tx - 10, ty - 20));
  return { ...r, spots };
}

/** Os tiles (locais) que a porta alcança andando. */
function reach(r: ReturnType<typeof furnish>): Set<string> {
  const seen = new Set<string>();
  const q = r.door.filter((d) => r.walkable(d.x, d.y)).map((d) => [d.x, d.y] as const);
  q.forEach(([x, y]) => seen.add(`${x},${y}`));
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) || !r.walkable(x + dx, y + dy)) continue;
      seen.add(k);
      q.push([x + dx, y + dy]);
    }
  }
  return seen;
}

describe('salas temáticas: mobília de qualquer tamanho', () => {
  it('registra um furnisher para cada sala temática', () => {
    for (const k of KV_THEME_KEYS) expect(kvFurnisher(`tema:${k}`), k).toBeTypeOf('function');
  });

  for (const key of KV_THEME_KEYS) {
    it(`${key}: a ação principal sempre tem item, e todo item é alcançável da porta`, () => {
      for (const [w, h] of SIZES) {
        for (const side of SIDES) {
          const r = furnish(key, w, h, side);
          const acts = new Set(r.spots.map((s) => s.action));
          expect(acts.has(MAIN[key]), `${key} ${w}x${h} porta ${side}`).toBe(true);
          const ok = reach(r);
          for (const s of r.spots) expect(ok.has(`${s.tx - 10},${s.ty - 20}`), `${key} ${w}x${h} ${side}: ${s.action} sem caminho`).toBe(true);
          // nada sobreposto (o harness recusa), nada fora do miolo
          for (const f of r.area.furniture) {
            const d = FURNITURE[f.kind].footprint;
            expect(f.tx - 10 >= 1 && f.tx - 10 + d.w <= w - 1 && f.ty - 20 >= 2 && f.ty - 20 + d.h <= h - 1, `${key} ${f.id}`).toBe(true);
          }
        }
      }
    });

    it(`${key}: no tamanho sugerido, todas as ações da sala têm item`, () => {
      const r = furnish(key, 16, 12, 's');
      const acts = new Set(r.spots.map((s) => s.action));
      for (const a of kvThemeActions(key)) expect(acts.has(a), `${key}: ${a}`).toBe(true);
      expect(r.area.furniture.length).toBeGreaterThan(4);
    });
  }
});
