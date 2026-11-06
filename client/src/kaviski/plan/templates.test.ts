// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): os modelos do "Monte a sua empresa" saem válidos de primeira —
// sem sobreposição, aceitos inteiros pelo kvNormPlan, toda sala com porta para um corredor e caminho até a recepção.
import { describe, expect, it } from 'vitest';
import { KV_THEME_KEYS, kvNormPlan, kvPlanRoomRef, kvRectsOverlap, type KvPlan } from '../../../../shared/kaviski-plan';
import { kvPlanWarnings } from './editor-model';
import { KV_DEFAULT_THEMES, KV_TEMPLATE_STYLES, kvCompanyDefaults, kvMakeCompany, kvPlanFromClassic, kvTemplateUnits, type KvCompanyOpts } from './templates';

const projects = (n: number) => Array.from({ length: n }, (_, i) => ({ ref: kvPlanRoomRef(`/proj/Clientes/${i}/01.App`), name: `App ${i}` }));
const own = [
  { id: 'kvsala-aaaaaaaaaa', name: 'Sala de Ana' },
  { id: 'kvsala-bbbbbbbbbb', name: 'Sala Azul' },
];

function valid(p: KvPlan): void {
  const { plan, problems } = kvNormPlan(p);
  expect(problems).toEqual([]);
  expect(plan!.items.length).toBe(p.items.length);
  for (let i = 0; i < p.items.length; i++) for (let j = i + 1; j < p.items.length; j++) expect(kvRectsOverlap(p.items[i], p.items[j]), `${p.items[i].id} × ${p.items[j].id}`).toBe(false);
  const warns = kvPlanWarnings(p);
  expect(warns, JSON.stringify(warns.map((w) => ({ ...w, it: p.items.find((i) => i.id === w.id) })))).toEqual([]);
}

describe('modelos: Monte a sua empresa', () => {
  const sizes: [string, Partial<KvCompanyOpts>][] = [
    ['vazia', { themes: [], meetings: 0, vacancies: 0 }],
    ['pequena', { themes: ['rh', 'reuniao'], meetings: 0, vacancies: 2, projects: projects(1) }],
    ['padrão', { themes: KV_DEFAULT_THEMES, meetings: 2, vacancies: 4, projects: projects(5), own }],
    ['todas as temáticas', { themes: KV_THEME_KEYS, meetings: 3, vacancies: 6, projects: projects(9), own }],
    ['grande', { themes: KV_THEME_KEYS, meetings: 6, vacancies: 10, projects: projects(20), own }],
  ];
  for (const style of KV_TEMPLATE_STYLES) {
    for (const [label, o] of sizes) {
      it(`${style} · ${label}: válida, sem sobreposição, toda sala com porta e caminho`, () => {
        const p = kvMakeCompany({ name: 'Kaviski', style, themes: [], meetings: 0, vacancies: 0, ...o });
        valid(p);
        expect(p.name).toBe('Kaviski');
        expect(p.items.filter((i) => i.kind === 'nucleo').map((i) => i.ref).sort()).toEqual(['banheiros', 'copa', 'lounge', 'recepcao']);
      });
    }
  }

  it('todas as salas pedidas entram (temáticas, reuniões numeradas, próprias, projetos e vagas na ordem)', () => {
    const o: KvCompanyOpts = { style: 'campus', themes: ['rh', 'reuniao', 'foco'], meetings: 2, vacancies: 3, projects: projects(4), own };
    const p = kvMakeCompany(o);
    const count = (k: string) => p.items.filter((i) => i.kind === k).length;
    expect(count('tema')).toBe(5);
    expect(p.items.filter((i) => i.ref === 'reuniao').map((i) => i.name).sort()).toEqual(['Reunião 1', 'Reunião 2', 'Reunião 3']);
    expect(count('propria')).toBe(2);
    expect(count('projeto')).toBe(4);
    expect(p.items.filter((i) => i.kind === 'vaga').map((i) => i.order)).toEqual([0, 1, 2]);
    expect(kvTemplateUnits(o).length).toBe(14);
  });

  it('projeto repetido entra uma vez; padrões pelo número de pessoas', () => {
    const p = kvMakeCompany({ style: 'torre', themes: [], meetings: 0, vacancies: 0, projects: [...projects(2), ...projects(2)] });
    expect(p.items.filter((i) => i.kind === 'projeto')).toHaveLength(2);
    expect(kvCompanyDefaults(3)).toEqual({ meetings: 0, vacancies: 2 });
    expect(kvCompanyDefaults(30)).toEqual({ meetings: 4, vacancies: 8 });
  });

  it('empresa enorme não passa do limite da planta (o que não cabe fica para a faixa automática)', () => {
    for (const style of KV_TEMPLATE_STYLES) {
      const p = kvMakeCompany({ style, themes: KV_THEME_KEYS, meetings: 12, vacancies: 40, projects: projects(80), own });
      const { problems } = kvNormPlan(p);
      expect(problems, style).toEqual([]);
    }
  });
});

describe('prédio de hoje como planta', () => {
  it('as salas nos slots (par = norte, ímpar = sul), salas próprias depois, faixa automática no fim', () => {
    const p = kvPlanFromClassic(
      [
        { ref: 'a', slot: 0 },
        { ref: 'b', slot: 1 },
        { ref: 'c', slot: 4 },
      ],
      own,
    );
    valid(p);
    const at = (ref: string) => p.items.find((i) => i.ref === ref)!;
    expect(at('a')).toMatchObject({ x: 32, y: 0, doors: [{ side: 's', at: 7 }] });
    expect(at('b')).toMatchObject({ x: 32, y: 17, doors: [{ side: 'n', at: 7 }] });
    expect(at('c')).toMatchObject({ x: 64, y: 0 });
    expect(at(own[0].id)).toMatchObject({ x: 64, y: 17 });
    expect(at(own[1].id)).toMatchObject({ x: 80, y: 0 });
    expect(at('recepcao')).toMatchObject({ x: 0, y: 0 });
    expect(p.items.find((i) => i.kind === 'corredor')).toMatchObject({ x: 0, y: 12, w: 96, h: 5 });
    expect(p.auto).toEqual({ x: 96, y: 0, dir: 'e' });
  });
});
