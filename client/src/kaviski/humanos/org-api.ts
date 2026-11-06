// Fork Kaviski (KAVISKI-HUMANOS.md → "Organograma e agentes fixos"): o organograma na página — busca
// GET /api/kaviski/humanos/org (já filtrado pelo servidor), relê no evento `org` do fluxo de presença e avisa quem
// ouve. Outras frentes leem daqui (`kvOrg()`, `kvOnOrg(cb)`), sem buscar de novo.
import type { KvDept, KvOrgAgent, KvOrgDoc, KvOrgInfo, KvOrgPerson } from '../../../../shared/kaviski-org';
import { tr } from '../../../../shared/i18n';
import { kvPeople } from './world';

const API = '/api/kaviski/humanos/org';

let doc: KvOrgDoc | null = null;
let loading: Promise<KvOrgDoc | null> | null = null;
const listeners = new Set<(d: KvOrgDoc | null) => void>();
let bound = false;

/** O organograma atual (null até carregar ou sem pessoas no escritório). */
export function kvOrg(): KvOrgDoc | null {
  return doc;
}

export function kvOnOrg(cb: (d: KvOrgDoc | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Busca de novo (e liga a releitura pelo evento `org`, uma vez). */
export function kvLoadOrg(): Promise<KvOrgDoc | null> {
  if (!bound && kvPeople.client) {
    bound = true;
    kvPeople.client.onEvent('org', () => void kvLoadOrg());
  }
  loading ??= fetch(API, { credentials: 'same-origin', cache: 'no-store' })
    .then(async (r) => (r.ok ? ((await r.json()) as KvOrgDoc) : null))
    .catch(() => null)
    .then((d) => {
      loading = null;
      if (d) {
        doc = d;
        for (const cb of listeners) cb(d);
      }
      return d;
    });
  return loading;
}

/** A área pelo id. */
export function kvDept(id: string | undefined): KvDept | undefined {
  return id ? doc?.depts.find((d) => d.id === id) : undefined;
}

/** O organograma de uma pessoa (cargo, área, gestor). */
export function kvOrgOf(personId: string): KvOrgPerson | undefined {
  return doc?.people.find((p) => p.id === personId);
}

/** Nome de um nó (`u:`/`a:`) para mostrar "responde a Fulano". */
export function kvOrgName(ref: string | undefined): string | undefined {
  if (!ref || !doc) return undefined;
  if (ref.startsWith('u:')) return doc.people.find((p) => `u:${p.id}` === ref)?.name;
  if (ref.startsWith('a:')) return doc.agents.find((a) => `a:${a.id}` === ref)?.name;
  return undefined;
}

async function send(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) void kvLoadOrg();
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: tr('Sem conexão com o Habblaud.') } };
  }
}

/** Grava o organograma de uma pessoa (admin). Devolve o erro ou null. */
export async function kvSaveOrgPerson(id: string, info: KvOrgInfo): Promise<string | null> {
  const r = await send('POST', `/people/${encodeURIComponent(id)}`, info);
  return r.ok ? null : String(r.data.error ?? tr('Não deu para salvar.'));
}

export async function kvSaveDepts(depts: KvDept[]): Promise<string | null> {
  const r = await send('POST', '/depts', { depts });
  return r.ok ? null : String(r.data.error ?? tr('Não deu para salvar.'));
}

/** Cria ou muda um agente fixo. Devolve o agente gravado ou o erro. */
export async function kvSaveFixedAgent(agent: Partial<KvOrgAgent>): Promise<{ agent?: KvOrgAgent; error?: string }> {
  const r = await send('POST', '/agents', { agent });
  return r.ok ? { agent: r.data.agent as KvOrgAgent } : { error: String(r.data.error ?? tr('Não deu para salvar.')) };
}

export async function kvRemoveFixedAgent(id: string): Promise<string | null> {
  const r = await send('DELETE', `/agents/${encodeURIComponent(id)}`, {});
  return r.ok ? null : String(r.data.error ?? tr('Não deu para apagar.'));
}
