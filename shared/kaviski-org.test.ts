import { describe, expect, it } from 'vitest';
import {
  kvBreakCycles,
  kvDefaultDepts,
  kvFixedMatches,
  kvMatchFixedAgents,
  kvNormDepts,
  kvNormOrgAgents,
  kvNormOrgInfo,
  kvOrgLayout,
  kvOrgTree,
  kvWouldCycle,
  type KvLiveAgent,
} from './kaviski-org';

describe('áreas', () => {
  it('limpa e corta área-mãe em ciclo', () => {
    const problems: { msg: string }[] = [];
    const d = kvNormDepts(
      [
        { id: 'dp-a', name: ' Dev ', color: '#ABC', icon: 'codigo', parent: 'dp-b' },
        { id: 'dp-b', name: 'Front', color: 'azul', icon: 'nada', parent: 'dp-a' },
        { id: 'dp-a', name: 'repetida' },
        { id: 'xx', name: 'id ruim' },
        { id: 'dp-c', name: '' },
      ],
      problems,
    );
    expect(d.map((x) => x.id)).toEqual(['dp-a', 'dp-b']);
    expect(d[0]).toMatchObject({ name: 'Dev', color: '#abc', icon: 'codigo' });
    expect(d[1]!.icon).toBe('pessoas');
    expect(d[1]!.color).toMatch(/^#/);
    // uma das duas perde a mãe (sem ciclo)
    expect(d.filter((x) => x.parent).length).toBe(1);
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it('áreas padrão são válidas', () => {
    expect(kvNormDepts(kvDefaultDepts())).toHaveLength(kvDefaultDepts().length);
  });
});

describe('cargo e gestor', () => {
  it('não responde a si mesmo e a área precisa existir', () => {
    expect(kvNormOrgInfo({ title: '  Dev  sênior ', dept: 'dp-x', reportsTo: 'u:ana' }, 'u:ana', new Set(['dp-y']))).toEqual({ title: 'Dev sênior' });
    expect(kvNormOrgInfo({ dept: 'dp-y', reportsTo: 'a:ag-1' }, 'u:ana', new Set(['dp-y']))).toEqual({ dept: 'dp-y', reportsTo: 'a:ag-1' });
    expect(kvNormOrgInfo({ reportsTo: 'x:1' }, 'u:ana')).toEqual({});
  });

  it('ciclos', () => {
    const boss = new Map<string, string | undefined>([
      ['u:a', 'u:b'],
      ['u:b', 'u:c'],
      ['u:c', undefined],
    ]);
    expect(kvWouldCycle((k) => boss.get(k), 'u:c', 'u:a')).toBe(true);
    expect(kvWouldCycle((k) => boss.get(k), 'u:a', 'u:c')).toBe(false);
    boss.set('u:c', 'u:a');
    const cut = kvBreakCycles(boss);
    expect(cut).toHaveLength(1);
    // depois de cortar, ninguém sobe para sempre
    for (const k of boss.keys()) expect(kvWouldCycle((x) => boss.get(x), k, boss.get(k))).toBe(false);
  });
});

describe('agentes fixos', () => {
  const live: KvLiveAgent[] = [
    { id: 'c:1', roomId: '/p/site', name: 'Marina', provider: 'claude' },
    { id: 'c:1:sub', roomId: '/p/site', name: 'Explore', parentId: 'c:1' },
    { id: 'x:2', roomId: '/p/site', name: 'Davi', provider: 'codex' },
    { id: 'c:3', roomId: '/p/app', name: 'Lia' },
  ];

  it('regras', () => {
    expect(kvFixedMatches('main', live[0]!)).toBe(true);
    expect(kvFixedMatches('main', live[1]!)).toBe(false);
    expect(kvFixedMatches('sub', live[1]!)).toBe(true);
    expect(kvFixedMatches('provider:codex', live[2]!)).toBe(true);
    expect(kvFixedMatches('provider:claude', live[2]!)).toBe(false);
    expect(kvFixedMatches('name:marína', live[0]!)).toBe(true);
  });

  it('um agente para cada fixo, o mais específico primeiro', () => {
    const m = kvMatchFixedAgents(
      [
        { id: 'ag-a', room: '/p/site', match: 'main' },
        { id: 'ag-b', room: '/p/site', match: 'name:marina' },
        { id: 'ag-c', room: '/P/Site/', match: 'main' },
        { id: 'ag-d', room: '/p/app', match: 'sub' },
      ],
      live,
    );
    expect(m.get('ag-b')).toBe('c:1');
    expect(m.get('ag-a')).toBe('x:2');
    expect(m.has('ag-c')).toBe(false);
    expect(m.has('ag-d')).toBe(false);
  });

  it('normaliza com lado e aparência', () => {
    const a = kvNormOrgAgents([{ id: 'ag-1', name: 'Claude', room: '/p/site', match: 'main', seat: { x: 40, y: 60 }, seatSide: 's', look: { seed: -1, parts: { hair: 2 } }, reportsTo: 'a:ag-1' }]);
    expect(a[0]).toMatchObject({ seat: { x: 40, y: 60 }, seatSide: 's', look: { seed: 4294967295, parts: { hair: 2 } } });
    expect(a[0]!.reportsTo).toBeUndefined();
  });
});

describe('árvore e desenho', () => {
  const doc = {
    depts: [
      { id: 'dp-dir', name: 'Diretoria', color: '#fff', icon: 'coroa' as const, order: 0 },
      { id: 'dp-dev', name: 'Dev', color: '#00f', icon: 'codigo' as const, order: 1 },
    ],
    people: [
      { id: 'vitor', name: 'Vitor', dept: 'dp-dir' },
      { id: 'ana', name: 'Ana', dept: 'dp-dev', reportsTo: 'u:vitor' },
      { id: 'bia', name: 'Bia', dept: 'dp-dev', reportsTo: 'u:ana' },
      { id: 'caio', name: 'Caio', reportsTo: 'u:bia' },
    ],
    agents: [{ id: 'ag-1', name: 'Claude · Site', room: '/p/site', match: 'main', dept: 'dp-dev', reportsTo: 'u:ana' }],
  };
  const live: KvLiveAgent[] = [
    { id: 'c:1', roomId: '/p/site', name: 'Marina' },
    { id: 'c:1:s', roomId: '/p/site', name: 'Explore', parentId: 'c:1' },
    { id: 'c:9', roomId: '/p/app', name: 'Lia' },
  ];

  it('hierarquia: gestor, fixo aceso e equipe de IA', () => {
    const t = kvOrgTree(doc, live, { group: 'hierarquia', show: 'todos' });
    const by = new Map(t.map((n) => [n.key, n]));
    expect(by.get('u:ana')!.parent).toBe('u:vitor');
    expect(by.get('a:ag-1')).toMatchObject({ parent: 'u:ana', liveId: 'c:1' });
    // o subagente do fixo fica debaixo do fixo (via grupo do projeto)
    expect(by.get('l:c:1:s')!.parent).toBe('a:ag-1');
    expect(by.has('l:c:1')).toBe(false);
    expect(by.get('p:/p/app')!.parent).toBeNull();
  });

  it('por área: gestor de outra área vira a área', () => {
    const t = kvOrgTree(doc, [], { group: 'area', show: 'pessoas', labels: { noDept: 'Sem área' } });
    const by = new Map(t.map((n) => [n.key, n]));
    expect(by.get('u:ana')!.parent).toBe('d:dp-dev');
    expect(by.get('u:bia')!.parent).toBe('u:ana');
    expect(by.get('u:caio')!.parent).toBe('d:-');
    expect(by.get('d:-')!.name).toBe('Sem área');
    expect(t[0]!.key).toBe('d:dp-dir');
  });

  it('filtros e gestor escondido', () => {
    const t = kvOrgTree(doc, live, { group: 'hierarquia', show: 'agentes' });
    expect(t.some((n) => n.kind === 'person')).toBe(false);
    expect(t.find((n) => n.key === 'a:ag-1')!.parent).toBeNull();
  });

  it('desenho: pai no meio dos filhos, sem sobrepor, linhas em degrau', () => {
    const nodes = [
      { key: 'r', parent: null, kind: 'person' as const },
      { key: 'a', parent: 'r', kind: 'person' as const },
      { key: 'b', parent: 'r', kind: 'person' as const },
      { key: 'b1', parent: 'b', kind: 'person' as const },
    ];
    const L = kvOrgLayout(nodes, { w: 100, h: 50, gapX: 20, gapY: 40 });
    const box = new Map(L.boxes.map((b) => [b.key, b]));
    const r = box.get('r')!;
    const a = box.get('a')!;
    const b = box.get('b')!;
    expect(r.x + 50).toBe(Math.round((a.x + b.x + 100) / 2));
    expect(a.y).toBe(90);
    expect(box.get('b1')!.y).toBe(180);
    for (const x of L.boxes) for (const y of L.boxes) if (x !== y) expect(x.x + x.w <= y.x || y.x + y.w <= x.x || x.y + x.h <= y.y || y.y + y.h <= x.y).toBe(true);
    const e = L.edges.find((x) => x.to === 'a')!;
    expect(e.pts).toHaveLength(4);
    expect(e.pts[1]![1]).toBe(e.pts[2]![1]);
  });

  it('desenho: muitas folhas viram coluna', () => {
    const nodes = [{ key: 'r', parent: null, kind: 'person' as const }, ...Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, parent: 'r', kind: 'person' as const }))];
    const L = kvOrgLayout(nodes, { w: 100, h: 50, gapX: 20, gapY: 40, stackFrom: 4 });
    const xs = new Set(L.boxes.filter((b) => b.key !== 'r').map((b) => b.x));
    expect(xs.size).toBe(1);
    expect(L.width).toBeLessThan(300);
  });
});
