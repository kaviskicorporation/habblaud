// Fork Kaviski (KAVISKI-HUMANOS.md → "Organograma e agentes fixos"): rotas do organograma pela porta remota.
import { afterEach, describe, expect, it } from 'vitest';
import { closeAll, INTERNO, json, login, RARM, start, type Harness } from './test-harness';
import type { KvOrgDoc } from '../../../shared/kaviski-org';

afterEach(closeAll);

async function setup(): Promise<{ h: Harness; admin: string; equipe: string; cliente: string; ids: Record<string, string>; rooms: Record<string, string> }> {
  const h = await start();
  const admin = await login(h, 'kavisvi', 'senha-do-admin');
  const ids: Record<string, string> = { kavisvi: 'admin' };
  for (const [user, role] of [['bia', 'equipe'], ['caio', 'equipe'], ['rarm', 'cliente'], ['outro', 'cliente']]) {
    const r = await fetch(`${h.base}/api/kaviski/humanos/users`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ user, role, rooms: user === 'rarm' ? ['/proj/Clientes/12-Rarm'] : user === 'outro' ? ['/proj/Clientes/99-X'] : [], password: `senha-${user}-1` }) });
    expect(r.status).toBe(201);
    ids[user] = ((await r.json()) as { person: { id: string } }).person.id;
  }
  const snap = (await (await fetch(`${h.base}/api/snapshot`, { headers: { cookie: admin } })).json()) as { rooms: { id: string; path: string }[] };
  const rooms = { rarm: snap.rooms.find((r) => r.path === RARM)!.id, interno: snap.rooms.find((r) => r.path === INTERNO)!.id };
  return { h, admin, equipe: await login(h, 'bia', 'senha-bia-1'), cliente: await login(h, 'rarm', 'senha-rarm-1'), ids, rooms };
}

const post = (h: Harness, path: string, cookie: string, body: unknown, method = 'POST') => fetch(`${h.base}/api/kaviski/humanos/org${path}`, { method, headers: { ...json, cookie }, body: JSON.stringify(body) });
const get = async (h: Harness, cookie: string) => (await (await fetch(`${h.base}/api/kaviski/humanos/org`, { headers: { cookie } })).json()) as KvOrgDoc;

describe('organograma', () => {
  it('áreas padrão; admin grava áreas e o organograma das pessoas, sem ciclo', async () => {
    const { h, admin, equipe, ids } = await setup();
    const doc = await get(h, admin);
    expect(doc.defaults).toBe(true);
    expect(doc.depts.length).toBeGreaterThan(3);
    expect(doc.can).toBe('admin');
    expect((await get(h, equipe)).can).toBe('equipe');

    const depts = [
      { id: 'dp-dir', name: 'Diretoria', color: '#f2b33d', icon: 'coroa', lead: 'u:admin' },
      { id: 'dp-dev', name: 'Dev', color: '#4aa3ff', icon: 'codigo' },
    ];
    expect((await post(h, '/depts', equipe, { depts })).status).toBe(403);
    expect((await post(h, '/depts', admin, { depts })).status).toBe(200);

    expect((await post(h, `/people/${ids.bia}`, admin, { title: 'Tech lead', dept: 'dp-dev', reportsTo: 'u:admin' })).status).toBe(200);
    expect((await post(h, `/people/${ids.caio}`, admin, { title: 'Dev', dept: 'dp-dev', reportsTo: `u:${ids.bia}` })).status).toBe(200);
    // a admin respondendo ao Caio fecharia um ciclo
    const cyc = await post(h, '/people/admin', admin, { reportsTo: `u:${ids.caio}` });
    expect(cyc.status).toBe(400);
    expect((await post(h, '/people/admin', admin, { reportsTo: 'u:ninguem' })).status).toBe(400);
    expect((await post(h, `/people/${ids.caio}`, equipe, { title: 'x' })).status).toBe(403);
    expect((await post(h, '/people/zzz', admin, { title: 'x' })).status).toBe(404);

    const after = await get(h, admin);
    expect(after.defaults).toBeUndefined();
    expect(after.people.find((p) => p.id === ids.caio)).toMatchObject({ title: 'Dev', dept: 'dp-dev', reportsTo: `u:${ids.bia}`, role: 'equipe' });
    // área apagada: some das pessoas
    expect((await post(h, '/depts', admin, { depts: depts.slice(0, 1) })).status).toBe(200);
    expect((await get(h, admin)).people.find((p) => p.id === ids.caio)!.dept).toBeUndefined();
  });

  it('agentes fixos: equipe cria, cadeira única, cliente vê só os da sala dele e só a equipe', async () => {
    const { h, admin, equipe, cliente, ids, rooms } = await setup();
    await post(h, `/people/${ids.bia}`, admin, { title: 'Tech lead', reportsTo: 'u:admin' });
    await post(h, `/people/${ids.caio}`, admin, { reportsTo: `u:${ids.bia}` });
    expect((await post(h, '/agents', cliente, { agent: { name: 'x', room: rooms.rarm, match: 'main' } })).status).toBe(403);
    const mk = await post(h, '/agents', equipe, { agent: { name: 'Claude · Rarm', room: rooms.rarm, match: 'main', seat: { x: 40, y: 60 }, seatSide: 'n', title: 'Dev', reportsTo: `u:${ids.bia}` } });
    expect(mk.status).toBe(201);
    const { agent } = (await mk.json()) as { agent: { id: string } };
    expect(agent.id).toMatch(/^ag-/);
    // mesma cadeira (vista do outro lado do corredor): não
    expect((await post(h, '/agents', equipe, { agent: { name: 'Outro', room: rooms.rarm, match: 'sub', seat: { x: 41, y: 192 - 61 }, seatSide: 's' } })).status).toBe(409);
    expect((await post(h, '/agents', equipe, { agent: { name: 'Codex · Site', room: rooms.interno, match: 'provider:codex', reportsTo: `a:${agent.id}` } })).status).toBe(201);
    // agente respondendo a si mesmo pela cadeia: ciclo
    expect((await post(h, '/agents', equipe, { agent: { id: agent.id, name: 'Claude · Rarm', room: rooms.rarm, match: 'main', reportsTo: 'a:ag-naoexiste' } })).status).toBe(400);
    expect((await post(h, '/agents', equipe, { agent: { name: '', room: rooms.rarm, match: 'main' } })).status).toBe(400);

    const all = await get(h, equipe);
    expect(all.agents).toHaveLength(2);
    expect(all.people.map((p) => p.id).sort()).toEqual(['admin', ids.bia, ids.caio, ids.rarm, ids.outro].sort());

    const mine = await get(h, cliente);
    expect(mine.can).toBeNull();
    expect(mine.agents.map((a) => a.name)).toEqual(['Claude · Rarm']);
    expect(mine.agents[0]!.match).toBe('main');
    // sem o outro cliente, com ele mesmo; sem papel
    expect(mine.people.map((p) => p.id).sort()).toEqual(['admin', ids.bia, ids.caio, ids.rarm].sort());
    expect(mine.people.every((p) => p.role === undefined)).toBe(true);
    expect(JSON.stringify(mine)).not.toContain('Codex · Site');

    expect((await post(h, `/agents/${agent.id}`, cliente, {}, 'DELETE')).status).toBe(403);
    expect((await post(h, `/agents/${agent.id}`, equipe, {}, 'DELETE')).status).toBe(200);
    const left = await get(h, admin);
    expect(left.agents).toHaveLength(1);
    expect(left.agents[0]!.reportsTo).toBeUndefined();
  });
});
