// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): plantas prontas. "Clássico" reproduz o prédio de sempre (núcleo
// à esquerda, corredor, salas em pares norte/sul crescendo para leste): ligar a planta não mexe em nada. A de exemplo é
// uma empresa maior, com alas, salas temáticas e jardim, para testar o motor. Puro (sem DOM).
import { KV_PLAN_VERSION, type KvPlan, type KvPlanItem } from '../../../../shared/kaviski-plan';

/** O prédio de hoje como planta. `vagas` = quantas posições das primeiras salas viram vagas (pares norte/sul). */
export function kvPlanClassic(opts: { vagas?: number; name?: string } = {}): KvPlan {
  const n = Math.max(0, Math.min(40, Math.floor(opts.vagas ?? 0)));
  const cols = Math.ceil(n / 2);
  const items: KvPlanItem[] = [
    { id: 'el-recepcao', kind: 'nucleo', ref: 'recepcao', x: 0, y: 0, w: 16, h: 12, locked: true },
    { id: 'el-copa', kind: 'nucleo', ref: 'copa', x: 16, y: 0, w: 16, h: 12 },
    { id: 'el-banheiros', kind: 'nucleo', ref: 'banheiros', x: 0, y: 17, w: 16, h: 12 },
    { id: 'el-lounge', kind: 'nucleo', ref: 'lounge', x: 16, y: 17, w: 16, h: 12 },
    { id: 'el-corredor', kind: 'corredor', x: 0, y: 12, w: 32 + cols * 16, h: 5 },
  ];
  for (let k = 0; k < n; k++) {
    const north = k % 2 === 0;
    items.push({ id: `el-vaga${k}`, kind: 'vaga', x: 32 + Math.floor(k / 2) * 16, y: north ? 0 : 17, w: 16, h: 12, doors: [{ side: north ? 's' : 'n', at: 7 }], order: k });
  }
  const plan: KvPlan = { v: KV_PLAN_VERSION, on: true, w: 32 + cols * 16 + 16, h: 29, items, auto: { x: 32 + cols * 16, y: 0, dir: 'e' } };
  if (opts.name) plan.name = opts.name;
  return plan;
}

/** Uma empresa maior: ala norte e sul no corredor principal, uma ala vertical com jardim e salas temáticas. */
export function kvPlanExample(): KvPlan {
  const it = (id: string, kind: KvPlanItem['kind'], x: number, y: number, w: number, h: number, extra: Partial<KvPlanItem> = {}): KvPlanItem => ({ id: `el-${id}`, kind, x, y, w, h, ...extra });
  const s = (at: number) => [{ side: 's' as const, at }];
  const n = (at: number) => [{ side: 'n' as const, at }];
  const items: KvPlanItem[] = [
    // núcleo + corredor principal
    it('recepcao', 'nucleo', 2, 2, 16, 12, { ref: 'recepcao', locked: true }),
    it('copa', 'nucleo', 18, 2, 16, 12, { ref: 'copa' }),
    it('banheiros', 'nucleo', 2, 19, 16, 12, { ref: 'banheiros' }),
    it('lounge', 'nucleo', 18, 19, 16, 12, { ref: 'lounge' }),
    it('principal', 'corredor', 2, 14, 116, 5, { name: 'Avenida' }),
    // ala norte
    it('rh', 'tema', 34, 2, 16, 12, { ref: 'rh', doors: s(7) }),
    it('reuniao', 'tema', 50, 2, 20, 12, { ref: 'reuniao', doors: s(9) }),
    it('vaga0', 'vaga', 70, 2, 16, 12, { doors: s(7), order: 0 }),
    it('vaga2', 'vaga', 86, 2, 16, 12, { doors: s(7), order: 2 }),
    it('vaga4', 'vaga', 102, 2, 16, 12, { doors: s(7), order: 4 }),
    // ala sul
    it('agentes', 'tema', 34, 19, 18, 12, { ref: 'agentes', doors: n(8) }),
    it('ala', 'corredor', 52, 19, 6, 40, { name: 'Ala do jardim' }),
    it('diretoria', 'tema', 58, 19, 14, 12, { ref: 'diretoria', doors: n(6) }),
    it('vaga1', 'vaga', 72, 19, 16, 12, { doors: n(7), order: 1 }),
    it('vaga3', 'vaga', 88, 19, 16, 12, { doors: n(7), order: 3 }),
    it('ti', 'tema', 104, 19, 14, 12, { ref: 'ti', doors: n(6) }),
    // ala vertical
    it('foco', 'tema', 36, 33, 16, 11, { ref: 'foco', doors: [{ side: 'e', at: 4 }] }),
    it('auditorio', 'tema', 30, 45, 22, 14, { ref: 'auditorio', doors: [{ side: 'e', at: 5 }] }),
    it('jardim', 'jardim', 58, 33, 22, 12, { name: 'Jardim' }),
    it('arquitetura', 'tema', 58, 47, 16, 12, { ref: 'arquitetura', doors: [{ side: 'w', at: 5 }] }),
    it('passeio', 'corredor', 74, 45, 44, 3),
    it('recepcao2', 'tema', 80, 33, 18, 12, { ref: 'recepcao', doors: s(8) }),
    it('descanso', 'tema', 98, 33, 20, 12, { ref: 'descanso', doors: s(9) }),
    it('provador', 'tema', 74, 48, 12, 11, { ref: 'provador', doors: n(5) }),
    it('correio', 'tema', 86, 48, 12, 11, { ref: 'correio', doors: n(5) }),
    it('vaga5', 'vaga', 98, 48, 16, 12, { doors: n(7), order: 5 }),
  ];
  return { v: KV_PLAN_VERSION, on: true, name: 'Kaviski', w: 134, h: 62, items, auto: { x: 118, y: 2, dir: 'e' } };
}
