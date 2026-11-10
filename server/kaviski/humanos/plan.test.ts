// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): a planta gravada no servidor (plan.ts): versões, 409 quando duas
// pessoas editam, quem grava, o filtro por quem vê e as salas fixas no snapshot (sem ir ao Habblaud World vazias).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../../log';
import { tempDir } from '../../test/fixtures';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../shared/types';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { KV_PLAN_HISTORY, kvPlanRoomRef, type KvPlan, type KvPlanItem } from '../../../shared/kaviski-plan';
import { project } from '../../../shared/world/projection';
import { createKaviski } from '../index';
import { KvPlanStore, kvCanEditPlan, kvPlanFor, kvPlanPinned, kvUsePlan } from './plan';
import { closeAll, INTERNO, json, login, RARM, start } from './test-harness';

setQuiet(true);

const P = (id: string, role: KvPerson['role'], rooms: string[] = []): KvPerson => ({ id, user: id, name: id.toUpperCase(), role, rooms });
const admin = P('adm', 'admin');
const ana = P('ana', 'equipe');
const bia = P('bia', 'cliente', ['/proj/Clientes/12-Rarm']);
const visit = P('vis', 'visitante', []);

const FPF = '/proj/Clientes/14-FPF/05.Hub';

function item(id: string, kind: KvPlanItem['kind'], x: number, y: number, w: number, h: number, extra: Partial<KvPlanItem> = {}): KvPlanItem {
  return { id: `el-${id}`, kind, x, y, w, h, ...extra };
}

function plan(extra: Partial<KvPlan> = {}): KvPlan {
  return {
    v: 1,
    on: true,
    w: 120,
    h: 60,
    auto: { x: 80, y: 0, dir: 'e' },
    items: [
      item('rec', 'nucleo', 0, 0, 16, 12, { ref: 'recepcao' }),
      item('cor', 'corredor', 0, 12, 100, 4),
      item('rarm', 'projeto', 16, 0, 16, 12, { ref: kvPlanRoomRef(RARM), name: 'Rarm' }),
      item('fpf', 'projeto', 32, 0, 16, 12, { ref: kvPlanRoomRef(FPF), fixed: true }),
      item('sala', 'propria', 48, 0, 12, 12, { ref: 'kvsala-abc' }),
      item('rh', 'tema', 60, 0, 12, 12, { ref: 'rh' }),
    ],
    agents: [
      { id: 'ag-a', name: 'Claude Rarm', room: kvPlanRoomRef(RARM), match: 'main' },
      { id: 'ag-b', name: 'Claude FPF', room: kvPlanRoomRef(FPF), match: 'main' },
      { id: 'ag-c', name: 'Recepcionista', room: 'rh', match: 'main' },
    ],
    ...extra,
  };
}

let dir: string;
let cleanup: () => void = () => {};
beforeEach(() => {
  ({ dir, cleanup } = tempDir('kv-plan-'));
});
afterEach(async () => {
  kvUsePlan(null);
  cleanup();
  await closeAll();
});

describe('planta: gravar, versões e conflito', () => {
  it('grava com base certa, sobe a versão, guarda quem e quando; base velha = 409 com a atual', () => {
    let t = 1000;
    const s = new KvPlanStore(join(dir, 'kaviski', 'plan.json'), () => t);
    expect(s.doc()).toEqual({ plan: null, version: 0, updatedAt: 0 });
    const r1 = s.write(admin, { plan: plan(), base: 0 });
    expect(r1.ok).toBe(true);
    expect(s.doc()).toMatchObject({ version: 1, updatedAt: 1000, by: 'ADM' });
    t = 2000;
    // a Ana abriu na versão 1 e gravou; o admin, também na 1, perde a corrida
    const r2 = s.write(admin, { plan: plan({ name: 'Kaviski' }), base: 1 });
    expect(r2.ok).toBe(true);
    const r3 = s.write(admin, { plan: plan({ name: 'Outra' }), base: 1 });
    expect(r3).toMatchObject({ ok: false, status: 409 });
    if (!r3.ok) expect(r3.doc?.plan?.name).toBe('Kaviski');
    expect(s.write(admin, { plan: plan() })).toMatchObject({ ok: false, status: 400 });
    // arquivo 600 e relido igual
    const file = join(dir, 'kaviski', 'plan.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const s2 = new KvPlanStore(file);
    s2.load();
    expect(s2.doc()).toEqual(s.doc());
    expect(s2.versions().map((v) => v.version)).toEqual([2, 1]);
  });

  it('valida com kvNormPlan e devolve os problemas (item sobreposto sai)', () => {
    const s = new KvPlanStore(null);
    const p = plan();
    p.items.push(item('bad', 'projeto', 20, 2, 12, 10, { ref: '/x/y' }));
    const r = s.write(admin, { plan: p, base: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.problems.some((x) => x.id === 'el-bad')).toBe(true);
      expect(r.doc.plan!.items.some((i) => i.id === 'el-bad')).toBe(false);
    }
  });

  it('guarda só as últimas KV_PLAN_HISTORY versões e volta para uma antiga como versão nova', () => {
    const s = new KvPlanStore(null);
    for (let i = 0; i < KV_PLAN_HISTORY + 5; i++) expect(s.write(admin, { plan: plan({ name: `v${i + 1}` }), base: i }).ok).toBe(true);
    const list = s.versions();
    expect(list.length).toBe(KV_PLAN_HISTORY + 1); // a atual + as guardadas
    expect(list[0]).toMatchObject({ version: KV_PLAN_HISTORY + 5, items: 6, by: 'ADM' });
    const target = list[3].version;
    const r = s.restore(admin, { version: target });
    expect(r.ok).toBe(true);
    expect(s.doc().plan!.name).toBe(`v${target}`);
    expect(s.version).toBe(KV_PLAN_HISTORY + 6);
    expect(s.versions()[0].note).toBe(`voltou para a versão ${target}`);
    expect(s.restore(admin, { version: 1 })).toMatchObject({ ok: false, status: 404 });
    expect(s.restore(admin, { version: target, base: 3 })).toMatchObject({ ok: false, status: 409 });
  });

  it('quem grava: admin sempre; equipe só com editors=equipe (e não troca isso); cliente e visitante nunca', () => {
    const s = new KvPlanStore(null);
    expect(kvCanEditPlan(ana, null)).toBe(false);
    expect(s.write(ana, { plan: plan(), base: 0 })).toMatchObject({ ok: false, status: 403 });
    expect(s.write(admin, { plan: plan({ editors: 'equipe' }), base: 0 }).ok).toBe(true);
    expect(kvCanEditPlan(ana, s.plan())).toBe(true);
    // a equipe tenta tirar a própria permissão de outro jeito: editors fica como estava
    const r = s.write(ana, { plan: plan({ editors: undefined, name: 'Ana' }), base: 1 });
    expect(r.ok).toBe(true);
    expect(s.plan()!.editors).toBe('equipe');
    expect(s.write(bia, { plan: plan(), base: 2 })).toMatchObject({ ok: false, status: 403 });
    expect(s.write(visit, { plan: plan(), base: 2 })).toMatchObject({ ok: false, status: 403 });
    expect(kvCanEditPlan(undefined, s.plan())).toBe(false);
  });
});

describe('planta: filtro por quem vê', () => {
  const seesOwn = (id: string, p: KvPerson) => p.role === 'admin' || (id === 'kvsala-abc' && p.role === 'equipe');

  it('cliente: só as salas de projeto dele (sem o caminho das outras), sem sala própria que não vê, agentes filtrados', () => {
    const v = kvPlanFor(plan(), bia, { seesOwn });
    const refs = v.items.map((i) => i.ref);
    expect(refs).toContain(kvPlanRoomRef(RARM));
    expect(JSON.stringify(v)).not.toContain('14-fpf');
    expect(refs).not.toContain('kvsala-abc');
    expect(refs).toContain('rh');
    expect(refs).toContain('recepcao');
    expect(v.agents?.map((a) => a.id)).toEqual(['ag-a', 'ag-c']);
  });

  it('visitante sem salas: só áreas comuns e temáticas (as outras salas, fechadas)', () => {
    const v = kvPlanFor(plan(), visit, { seesOwn });
    expect(v.items.filter((i) => (i.kind === 'projeto' || i.kind === 'propria') && !i.blocked)).toEqual([]);
    expect(v.items.filter((i) => i.blocked)).toHaveLength(3);
    expect(v.agents?.map((a) => a.id)).toEqual(['ag-c']);
  });

  it('cliente/visitante: sala sem acesso vira um lugar fechado e anônimo (nada vaza)', () => {
    const p = plan();
    p.items[2] = { ...p.items[2], name: 'Projeto Secreto', color: '#ff0000', palette: 3, style: 'ilhas', locked: true, doors: [{ side: 's', at: 7 }] };
    p.items[5] = { ...p.items[5], name: 'Pessoas e RH' };
    const v = kvPlanFor(p, { ...visit, guest: { own: [], meetings: false, blocked: ['rh'], voice: true, chat: true } }, { seesOwn, blocksTheme: (k, who) => !!who.guest?.blocked.includes(k) });
    const shut = v.items.filter((i) => i.blocked);
    // Rarm, FPF, a sala própria e o RH (bloqueado no convite)
    expect(shut).toHaveLength(4);
    for (const it of shut) {
      expect(Object.keys(it).sort()).toEqual(['blocked', 'doors', 'h', 'id', 'kind', 'w', 'x', 'y']);
      expect(it.id).toMatch(/^el-blk\d+$/);
      expect(it.kind).toBe('propria');
    }
    expect(shut[0]).toMatchObject({ x: 16, y: 0, w: 16, h: 12, doors: [{ side: 's', at: 7 }] });
    const text = JSON.stringify(v);
    for (const bad of ['12-rarm', '14-fpf', 'Projeto Secreto', 'kvsala-abc', 'Pessoas e RH', '"rh"', 'el-rarm', 'el-fpf', 'el-sala', 'el-rh', 'Claude', 'Recepcionista', '#ff0000']) expect(text, bad).not.toContain(bad);
    expect(v.agents).toBeUndefined();
    // o cliente vê a dele normal; equipe nunca recebe item fechado
    expect(kvPlanFor(p, bia, { seesOwn }).items.find((i) => i.id === 'el-rarm')?.name).toBe('Projeto Secreto');
    expect(kvPlanFor(p, ana, { seesOwn: () => false, blocksTheme: () => true }).items.some((i) => i.blocked)).toBe(false);
  });

  it('equipe vê todos os projetos; sala própria que não vê sai; o original não muda', () => {
    const p = plan();
    const before = JSON.stringify(p);
    const v = kvPlanFor(p, ana, { seesOwn: () => false });
    expect(v.items.filter((i) => i.kind === 'projeto')).toHaveLength(2);
    expect(v.items.some((i) => i.kind === 'propria')).toBe(false);
    v.items[0].x = 99;
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('planta: salas fixas no snapshot', () => {
  const room = (path: string, slot: number): RoomInfo => ({ id: path, name: path.split('/').pop()!, path, slot, seed: 1, createdAt: 1 });
  const agent = (id: string, roomId: string) => ({ id, roomId, kind: 'main', provider: 'claude', name: id }) as unknown as AgentInfo;

  it('sala fixa da planta ligada entra vazia (com as maiúsculas do caminho); desligada, não', () => {
    const s = new KvPlanStore(null);
    kvUsePlan(s);
    s.rememberPaths([FPF]);
    expect(s.write(admin, { plan: plan(), base: 0 }).ok).toBe(true);
    expect(kvPlanPinned()).toEqual([[kvPlanRoomRef(FPF), { pinned: true, path: FPF }]]);
    const kv = createKaviski({ dataDir: null, env: {} });
    const snap = { rooms: [room(RARM, 0)], agents: [agent('a', RARM)], meta: {} } as unknown as OfficeSnapshot;
    kv.decorate(snap);
    const fixed = snap.rooms.find((r) => r.path === FPF);
    expect(fixed).toMatchObject({ id: FPF, name: '05.Hub', kaviski: { pinned: true } });
    // Habblaud World: o uplink monta o prédio só com as salas que têm agentes (server/world/uplink.ts)
    const roomsUp = [...new Set(snap.agents.map((a) => a.roomId))].map((id) => ({ id }));
    const up = project({ rooms: roomsUp, agents: snap.agents, theme: 'none', version: 't', options: { compactions: false, tokensVisible: false } }, { floorId: (id: string) => `f_${id.length.toString(16).padStart(10, '0')}`, agentId: (id: string) => `a_${id.length.toString(16).padStart(8, '0')}` }, 0);
    expect(JSON.stringify(up)).not.toContain('FPF');
    expect(JSON.stringify(up)).not.toContain('05.Hub');
    // planta desligada: sem salas fixas
    expect(s.write(admin, { plan: plan({ on: false }), base: 1 }).ok).toBe(true);
    expect(kvPlanPinned()).toEqual([]);
    const snap2 = { rooms: [room(RARM, 0)], agents: [agent('a', RARM)], meta: {} } as unknown as OfficeSnapshot;
    kv.decorate(snap2);
    expect(snap2.rooms.map((r) => r.path)).toEqual([RARM]);
  });

  it('sala escondida no mapa de estilos não volta pela planta', () => {
    const s = new KvPlanStore(null);
    kvUsePlan(s);
    expect(s.write(admin, { plan: plan(), base: 0 }).ok).toBe(true);
    const kv = createKaviski({ dataDir: null, env: {} });
    kv.styles.replace(new Map([[kvPlanRoomRef(FPF), { hidden: true }]]));
    const snap = { rooms: [room(RARM, 0)], agents: [agent('a', RARM)], meta: {} } as unknown as OfficeSnapshot;
    kv.decorate(snap);
    expect(snap.rooms.map((r) => r.path)).toEqual([RARM]);
  });
});

describe('planta: rotas', () => {
  it('admin grava pela porta local; duas pessoas editando: a segunda recebe 409; cliente recebe filtrada; registro', async () => {
    const h = await start();
    const mk = async (body: Record<string, unknown>) => {
      const r = await fetch(`${h.localBase}/api/kaviski/humanos/users`, { method: 'POST', headers: json, body: JSON.stringify(body) });
      expect(r.status).toBe(201);
    };
    await mk({ user: 'ana', name: 'Ana', role: 'equipe', password: 'senha-da-ana-1' });
    await mk({ user: 'bia', name: 'Bia', role: 'cliente', password: 'senha-da-bia-1', rooms: ['/proj/Clientes/12-Rarm'] });
    const p = plan();
    p.items.push(item('int', 'projeto', 72, 0, 16, 12, { ref: kvPlanRoomRef(INTERNO) }));
    const get0 = (await (await fetch(`${h.localBase}/api/kaviski/humanos/plan`)).json()) as { version: number; canEdit: boolean; plan: unknown };
    expect(get0).toMatchObject({ version: 0, canEdit: true, plan: null });
    const post = (base: number, cookie?: string, extra: Partial<KvPlan> = {}) =>
      fetch(`${cookie ? h.base : h.localBase}/api/kaviski/humanos/plan`, { method: 'POST', headers: { ...json, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ plan: { ...p, ...extra }, base, paths: [FPF] }) });
    const r1 = await post(0);
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { version: number }).version).toBe(1);
    const r2 = await post(0);
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as { doc: { version: number } }).doc.version).toBe(1);
    // equipe sem liberação: 403
    const anaC = await login(h, 'ana', 'senha-da-ana-1');
    expect((await post(1, anaC)).status).toBe(403);
    // admin libera a equipe; a Ana grava
    expect((await post(1, undefined, { editors: 'equipe' })).status).toBe(200);
    expect((await post(2, anaC, { editors: 'equipe', name: 'Pela Ana' })).status).toBe(200);
    // cliente: filtrada, sem poder gravar, sem versões
    const biaC = await login(h, 'bia', 'senha-da-bia-1');
    const gb = await fetch(`${h.base}/api/kaviski/humanos/plan`, { headers: { Cookie: biaC } });
    const body = (await gb.json()) as { canEdit: boolean; plan: KvPlan };
    expect(body.canEdit).toBe(false);
    expect(body.plan.items.filter((i) => i.kind === 'projeto').map((i) => i.ref)).toEqual([kvPlanRoomRef(RARM)]);
    expect(JSON.stringify(body)).not.toContain('Interno');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('14-fpf');
    expect((await post(3, biaC)).status).toBe(403);
    expect((await fetch(`${h.base}/api/kaviski/humanos/plan/versions`, { headers: { Cookie: biaC } })).status).toBe(403);
    // versões e restaurar (pela Ana)
    const vs = (await (await fetch(`${h.base}/api/kaviski/humanos/plan/versions`, { headers: { Cookie: anaC } })).json()) as { versions: { version: number }[] };
    expect(vs.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    const rr = await fetch(`${h.base}/api/kaviski/humanos/plan/restore`, { method: 'POST', headers: { ...json, Cookie: anaC }, body: JSON.stringify({ version: 2, base: 3 }) });
    expect(rr.status).toBe(200);
    expect(((await rr.json()) as { version: number }).version).toBe(4);
    // registro
    const audit = (await (await fetch(`${h.localBase}/api/kaviski/humanos/audit`)).json()) as { entries: { action: string }[] };
    expect(audit.entries.filter((e) => e.action === 'planta gravada').length).toBe(3);
    expect(audit.entries.some((e) => e.action === 'planta restaurada')).toBe(true);
    // arquivo sem segredo e com o caminho de verdade guardado
    const file = readFileSync(join(h.dataDir, 'kaviski', 'plan.json'), 'utf8');
    expect(file).toContain(FPF);
    expect(existsSync(join(h.dataDir, 'kaviski', 'plan.json'))).toBe(true);
  });
});
