// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre" → "Organograma e agentes fixos"): áreas da empresa, cargo/área/
// gestor de cada pessoa e os agentes de IA fixos. Vale com a planta ligada ou não.
//
// Dados:
// - <dataDir>/kaviski/org.json (600): `{version, depts, agents}` — áreas e agentes fixos;
// - o cargo/área/gestor de cada pessoa fica na conta (users.json, `profile.org`), apagado junto com ela.
//
// Rotas (/api/kaviski/humanos/org...):
//   GET    org                {depts, agents, people, can}: filtrado por papel (abaixo)
//   POST   org/depts          {depts}: troca a lista de áreas (admin)
//   POST   org/people/:id     {title?, dept?, reportsTo?}: o organograma de uma pessoa (admin)
//   POST   org/agents         {agent}: cria ou muda um agente fixo (admin e equipe)
//   DELETE org/agents/:id     (admin e equipe)
// Toda mudança manda o evento `org` (sem dados) às páginas, que relêem.
//
// Quem vê o quê: admin e equipe veem tudo. Cliente e visitante veem só a equipe (admin + equipe, sem usuário nem papel),
// a si mesmos, as áreas e os agentes fixos das salas que eles veem (sem a regra `match`); gestor escondido não aparece.
// Ninguém de fora vê os outros clientes.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OfficeSnapshot } from '../../../shared/types';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import { tr } from '../../../shared/i18n';
import { kvSameDesk } from '../../../shared/kaviski-desk';
import { kvPathKey } from '../../../shared/kaviski';
import { kvDefaultLook, kvParseLook, type KvPos } from '../../../shared/kaviski-presence';
import {
  kvDefaultDepts,
  kvNewOrgId,
  kvNormDepts,
  kvNormOrgAgents,
  kvNormOrgInfo,
  kvWouldCycle,
  type KvDept,
  type KvOrgAgent,
  type KvOrgDoc,
  type KvOrgInfo,
  type KvOrgPerson,
} from '../../../shared/kaviski-org';
import { HttpError, readJson, sendJson } from '../../http/app';
import { log } from '../../log';
import { kvAreaAllowed } from './livekit';

export const ORG_PATH = '/api/kaviski/humanos/org';

interface FileShape {
  version: 1;
  depts?: KvDept[];
  agents: KvOrgAgent[];
}

export interface KvOrgDeps {
  /** Todas as contas (com a embutida), como a página as vê. */
  people: () => KvPerson[];
  profile: (id: string) => Record<string, unknown>;
  setProfile: (id: string, profile: Record<string, unknown>) => boolean;
  snapshot: () => OfficeSnapshot;
  /** Avisa as páginas (evento `org`). */
  changed: () => void;
  audit?: (person: KvPerson, action: string, detail: string, ok: boolean) => void;
}

/** A mesa fixa de um agente como KvPos de sala (para comparar com as mesas das pessoas). */
export function kvAgentSeatPos(a: KvOrgAgent): KvPos | undefined {
  return a.seat ? { k: 'r', r: a.room, x: a.seat.x, y: a.seat.y, s: a.seatSide ?? 'n', d: 'down', m: 0 } : undefined;
}

export class KvOrg {
  private depts: KvDept[] | null = null;
  private agents: KvOrgAgent[] = [];

  constructor(private readonly file: string | null) {}

  load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      this.depts = Array.isArray(data.depts) ? kvNormDepts(data.depts) : null;
      this.agents = kvNormOrgAgents(data.agents, [], this.deptIds());
    } catch (err) {
      log.warn(tr('org.json ilegível ({0}); o organograma começa vazio.', [(err as Error).message]));
    }
  }

  private save(): void {
    if (!this.file) return;
    const data: FileShape = { version: 1, ...(this.depts ? { depts: this.depts } : {}), agents: this.agents };
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  /** As áreas (as padrão enquanto ninguém gravou as suas). */
  deptList(): KvDept[] {
    return (this.depts ?? kvDefaultDepts(tr)).map((d) => ({ ...d }));
  }

  get defaults(): boolean {
    return !this.depts;
  }

  deptIds(): Set<string> {
    return new Set(this.deptList().map((d) => d.id));
  }

  agentList(): KvOrgAgent[] {
    return this.agents.map((a) => ({ ...a }));
  }

  setDepts(depts: KvDept[]): void {
    this.depts = depts;
    const ids = this.deptIds();
    for (const a of this.agents) if (a.dept && !ids.has(a.dept)) delete a.dept;
    this.save();
  }

  /** Cria (sem id) ou troca um agente fixo. */
  upsertAgent(a: KvOrgAgent): KvOrgAgent {
    const i = this.agents.findIndex((x) => x.id === a.id);
    if (i >= 0) this.agents[i] = a;
    else this.agents.push(a);
    this.save();
    return a;
  }

  removeAgent(id: string): boolean {
    const i = this.agents.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.agents.splice(i, 1);
    // quem respondia a ele fica sem gestor
    for (const a of this.agents) if (a.reportsTo === `a:${id}`) delete a.reportsTo;
    this.save();
    return true;
  }
}

/** O id da sala no snapshot para a referência guardada (o contrato da planta guarda o caminho normalizado). */
export function kvRoomIdIn(snap: Pick<OfficeSnapshot, 'rooms'>, ref: string): string {
  if (!ref.startsWith('/')) return ref;
  const key = kvPathKey(ref);
  return snap.rooms.find((r) => r.id === ref || kvPathKey(r.id) === key)?.id ?? ref;
}

/** O organograma da pessoa guardado na conta. */
export function kvOrgInfoOf(profile: Record<string, unknown>, self: string, deptIds?: ReadonlySet<string>): KvOrgInfo {
  return kvNormOrgInfo(profile.org, `u:${self}`, deptIds);
}

/** O documento que a pessoa `viewer` recebe (filtrado por papel). */
export function kvOrgDocFor(org: KvOrg, viewer: KvPerson, deps: Pick<KvOrgDeps, 'people' | 'profile' | 'snapshot'>): KvOrgDoc {
  const restricted = kvRestricted(viewer);
  const deptIds = org.deptIds();
  const all = deps.people();
  const visiblePeople = restricted ? all.filter((p) => p.role === 'admin' || p.role === 'equipe' || p.id === viewer.id) : all;
  const snap = deps.snapshot();
  const agents = restricted ? org.agentList().filter((a) => !!kvAreaAllowed(`r:${kvRoomIdIn(snap, a.room)}`, viewer, snap)) : org.agentList();
  const keys = new Set([...visiblePeople.map((p) => `u:${p.id}`), ...agents.map((a) => `a:${a.id}`)]);
  const people: KvOrgPerson[] = visiblePeople.map((p) => {
    const prof = deps.profile(p.id);
    const info = kvOrgInfoOf(prof, p.id, deptIds);
    if (info.reportsTo && !keys.has(info.reportsTo)) delete info.reportsTo;
    const look = kvParseLook(prof.look) ?? kvDefaultLook(p.id);
    return { id: p.id, name: p.name, ...info, ...(restricted ? {} : { role: p.role }), look };
  });
  const outAgents = agents.map((a) => {
    const c: KvOrgAgent = { ...a };
    if (c.reportsTo && !keys.has(c.reportsTo)) delete c.reportsTo;
    if (restricted) c.match = 'main';
    return c;
  });
  const depts = org.deptList().map((d) => {
    if (d.lead && !keys.has(d.lead)) {
      const c = { ...d };
      delete c.lead;
      return c;
    }
    return d;
  });
  return {
    depts,
    agents: outAgents,
    people,
    can: viewer.role === 'admin' ? 'admin' : viewer.role === 'equipe' ? 'equipe' : null,
    ...(org.defaults ? { defaults: true } : {}),
  };
}

/** "A quem responde" de todo mundo (pessoas e agentes fixos), para conferir ciclos. */
function bossMap(org: KvOrg, deps: Pick<KvOrgDeps, 'people' | 'profile'>): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>();
  for (const p of deps.people()) m.set(`u:${p.id}`, kvOrgInfoOf(deps.profile(p.id), p.id).reportsTo);
  for (const a of org.agentList()) m.set(`a:${a.id}`, a.reportsTo);
  return m;
}

/** Confere o gestor: existe e não fecha ciclo. Devolve o erro ou null. */
export function kvCheckBoss(org: KvOrg, deps: Pick<KvOrgDeps, 'people' | 'profile'>, key: string, boss: string | undefined): string | null {
  if (!boss) return null;
  const m = bossMap(org, deps);
  if (!m.has(boss)) return tr('o gestor escolhido não existe');
  m.set(key, boss);
  if (kvWouldCycle((k) => m.get(k), key, boss)) return tr('assim o organograma faria um ciclo (alguém acabaria sendo gestor de si mesmo)');
  return null;
}

/** Trata as rotas do organograma. true = respondeu. */
export function kvOrgRoute(req: IncomingMessage, res: ServerResponse, path: string, person: KvPerson | undefined, org: KvOrg, deps: KvOrgDeps): boolean {
  if (path !== ORG_PATH && !path.startsWith(`${ORG_PATH}/`)) return false;
  const method = req.method ?? 'GET';
  const fail = (err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };
  if (!person) {
    req.resume();
    sendJson(res, 403, { error: tr('entre com a sua conta para ver o organograma') });
    return true;
  }
  const sub = path.slice(ORG_PATH.length);
  if (sub === '' && (method === 'GET' || method === 'HEAD')) {
    req.resume();
    sendJson(res, 200, kvOrgDocFor(org, person, deps));
    return true;
  }
  const admin = person.role === 'admin';
  const team = admin || person.role === 'equipe';
  const deny = (msg: string) => {
    req.resume();
    sendJson(res, 403, { error: msg });
    return true;
  };
  const note = (action: string, detail: string) => deps.audit?.(person, action, detail, true);

  if (sub === '/depts') {
    if (method !== 'POST') return (req.resume(), res.setHeader('Allow', 'POST'), sendJson(res, 405, { error: tr('método não permitido') }), true);
    if (!admin) return deny(tr('só quem é admin cuida das áreas'));
    readJson(req, 64 * 1024)
      .then((body) => {
        const depts = kvNormDepts((body as { depts?: unknown })?.depts);
        const keys = new Set([...deps.people().map((p) => `u:${p.id}`), ...org.agentList().map((a) => `a:${a.id}`)]);
        for (const d of depts) if (d.lead && !keys.has(d.lead)) delete d.lead;
        org.setDepts(depts);
        note('organograma: áreas', depts.map((d) => d.name).join(', '));
        deps.changed();
        sendJson(res, 200, { depts });
      })
      .catch(fail);
    return true;
  }

  const personItem = /^\/people\/([^/]+)$/.exec(sub);
  if (personItem) {
    if (method !== 'POST') return (req.resume(), res.setHeader('Allow', 'POST'), sendJson(res, 405, { error: tr('método não permitido') }), true);
    if (!admin) return deny(tr('só quem é admin muda o organograma das pessoas'));
    let id = '';
    try {
      id = decodeURIComponent(personItem[1]!);
    } catch {
      // cai no 404
    }
    readJson(req, 8192)
      .then((body) => {
        const who = deps.people().find((p) => p.id === id);
        if (!who) throw new HttpError(404, tr('pessoa não encontrada'));
        const info = kvNormOrgInfo(body, `u:${id}`, org.deptIds());
        const err = kvCheckBoss(org, deps, `u:${id}`, info.reportsTo);
        if (err) throw new HttpError(400, err);
        const profile = deps.profile(id);
        if (Object.keys(info).length) profile.org = info;
        else delete profile.org;
        if (!deps.setProfile(id, profile)) throw new HttpError(404, tr('pessoa não encontrada'));
        note('organograma: pessoa', [who.name, info.title].filter(Boolean).join(' · '));
        deps.changed();
        sendJson(res, 200, { org: info });
      })
      .catch(fail);
    return true;
  }

  if (sub === '/agents' || sub.startsWith('/agents/')) {
    if (!team) return deny(tr('só a equipe fixa agentes'));
    if (sub.startsWith('/agents/')) {
      if (method !== 'DELETE') return (req.resume(), res.setHeader('Allow', 'DELETE'), sendJson(res, 405, { error: tr('método não permitido') }), true);
      req.resume();
      let id = '';
      try {
        id = decodeURIComponent(sub.slice('/agents/'.length));
      } catch {
        // cai no 404
      }
      const was = org.agentList().find((a) => a.id === id);
      if (!was || !org.removeAgent(id)) return (sendJson(res, 404, { error: tr('agente fixo não encontrado') }), true);
      note('agente fixo apagado', was.name);
      deps.changed();
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method !== 'POST') return (req.resume(), res.setHeader('Allow', 'POST'), sendJson(res, 405, { error: tr('método não permitido') }), true);
    readJson(req, 16 * 1024)
      .then((body) => {
        const raw = { ...((body as { agent?: Record<string, unknown> })?.agent ?? {}) };
        const isNew = !raw.id;
        if (isNew) raw.id = kvNewOrgId('ag');
        else if (!org.agentList().some((a) => a.id === raw.id)) throw new HttpError(404, tr('agente fixo não encontrado'));
        if (isNew && org.agentList().length >= 200) throw new HttpError(400, tr('agentes fixos demais (máximo {0})', [200]));
        const problems: { msg: string }[] = [];
        const [a] = kvNormOrgAgents([raw], problems, org.deptIds());
        if (!a) throw new HttpError(400, tr('agente fixo inválido: precisa de nome, sala e qual agente senta ali'));
        const err = kvCheckBoss(org, deps, `a:${a.id}`, a.reportsTo);
        if (err) throw new HttpError(400, err);
        const seat = kvAgentSeatPos(a);
        if (seat) {
          const other = org.agentList().find((x) => x.id !== a.id && kvSameDesk(kvAgentSeatPos(x), seat));
          if (other) throw new HttpError(409, tr('essa cadeira já é de {0}', [other.name]));
          for (const p of deps.people()) {
            const desk = deps.profile(p.id).desk as KvPos | undefined;
            if (desk && kvSameDesk(desk, seat)) throw new HttpError(409, tr('essa cadeira é a mesa fixa de {0}', [p.name]));
          }
        }
        org.upsertAgent(a);
        note(isNew ? 'agente fixo criado' : 'agente fixo alterado', a.name);
        deps.changed();
        sendJson(res, isNew ? 201 : 200, { agent: a });
      })
      .catch(fail);
    return true;
  }
  req.resume();
  sendJson(res, 404, { error: tr('não encontrado') });
  return true;
}
