// Fork Kaviski (KAVISKI-HUMANOS.md): conversa 1:1 com quem entrou por convite — a equipe precisa conseguir responder
// (antes dava "pessoa não encontrada": o KvDirect só conhecia as contas fixas).
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../../log';
import type { KvContact } from '../../../shared/kaviski-presence';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { KvInvites } from './invites';
import { closeAll, json, login, start, visit } from './test-harness';

setQuiet(true);
afterEach(closeAll);
const ADMIN: KvPerson = { id: 'admin', user: 'kavisvi', name: 'Vitor', role: 'admin', rooms: [] };

describe('conversa 1:1 com visitante', () => {
  it('KvInvites.activePeople lista só os visitantes com convite valendo', () => {
    let t = 1_800_000_000_000;
    const inv = new KvInvites(null, () => Buffer.alloc(32, 7), () => t);
    const a = inv.create(ADMIN, { ttl: '1h', maxUses: 5 });
    if (!a.ok) throw new Error('create');
    const j = inv.join(a.invite.link!.slice(9), 'Carla');
    if (!j.ok) throw new Error('join');
    expect(inv.activePeople().map((p) => [p.id, p.role])).toEqual([[j.person.id, 'visitante']]);
    inv.revoke(a.invite.id);
    expect(inv.activePeople()).toEqual([]);
    const b = inv.create(ADMIN, { ttl: '1h' });
    if (!b.ok) throw new Error('create');
    expect(inv.join(b.invite.link!.slice(9), 'Davi').ok).toBe(true);
    t += 2 * 60 * 60 * 1000; // venceu
    expect(inv.activePeople()).toEqual([]);
  });

  it('equipe → visitante funciona (enviar, digitando, ler, histórico e contatos); depois de revogado, não', async () => {
    const h = await start();
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    const r = await fetch(`${h.base}/api/kaviski/humanos/users`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ user: 'bia', role: 'equipe', rooms: [], password: 'senha-bia-1' }) });
    expect(r.status).toBe(201);
    const bia = await login(h, 'bia', 'senha-bia-1');
    const made = await fetch(`${h.base}/api/kaviski/humanos/invites`, { method: 'POST', headers: { ...json, cookie: admin }, body: JSON.stringify({ ttl: '1d', maxUses: 3 }) });
    const { invite } = (await made.json()) as { invite: { id: string; link: string } };
    const v = await visit(h, invite.link, 'Carla');
    const vis = v.cookie!;
    const me = ((await (await fetch(`${h.base}/api/kaviski/humanos/me`, { headers: { cookie: vis } })).json()) as { person: KvPerson }).person;
    const biaMe = ((await (await fetch(`${h.base}/api/kaviski/humanos/me`, { headers: { cookie: bia } })).json()) as { person: KvPerson }).person;

    const post = (cookie: string, path: string, body: unknown) => fetch(`${h.base}/api/kaviski/humanos/dm${path}`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify(body) });
    // visitante → equipe (já funcionava)
    expect((await post(vis, '', { to: biaMe.id, text: 'oi, Bia' })).status).toBe(200);
    // equipe → visitante (o bug)
    expect((await post(bia, '', { to: me.id, text: 'oi, Carla!' })).status).toBe(200);
    expect((await post(bia, '/typing', { to: me.id })).status).toBe(200);
    expect((await post(bia, '/read', { with: me.id })).status).toBe(200);
    const page = (await (await fetch(`${h.base}/api/kaviski/humanos/dm?with=${me.id}`, { headers: { cookie: bia } })).json()) as { messages: { text: string }[] };
    expect(page.messages.map((m) => m.text)).toEqual(['oi, Bia', 'oi, Carla!']);
    const contacts = ((await (await fetch(`${h.base}/api/kaviski/humanos/contacts`, { headers: { cookie: bia } })).json()) as { contacts: KvContact[] }).contacts;
    expect(contacts.find((c) => c.id === me.id)).toMatchObject({ name: 'Carla', role: 'visitante' });
    // a tela de admin (lista de contas) continua sem os visitantes
    const accounts = (await (await fetch(`${h.base}/api/kaviski/humanos/users`, { headers: { cookie: admin } })).json()) as { people: KvPerson[] };
    expect(accounts.people.some((p) => p.id === me.id)).toBe(false);

    await fetch(`${h.base}/api/kaviski/humanos/invites/${invite.id}`, { method: 'DELETE', headers: { ...json, cookie: admin } });
    expect((await post(bia, '', { to: me.id, text: 'ainda aí?' })).status).toBe(404);
    const after = ((await (await fetch(`${h.base}/api/kaviski/humanos/contacts`, { headers: { cookie: bia } })).json()) as { contacts: KvContact[] }).contacts;
    expect(after.some((c) => c.id === me.id)).toBe(false);
  });
});
