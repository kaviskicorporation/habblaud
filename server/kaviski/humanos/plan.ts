// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): a planta da empresa gravada no servidor, igual para todo mundo,
// em <dataDir>/kaviski/plan.json (permissão 600): a planta atual, a versão, quem gravou e quando, e as últimas
// KV_PLAN_HISTORY versões (desfazer / "voltar para esta").
//
// GET  /api/kaviski/humanos/plan           KvPlanDoc (filtrada por quem vê) + `canEdit`
// POST /api/kaviski/humanos/plan           {plan, base, note?, paths?}: grava se `base` = versão atual; senão 409 com a atual
// GET  /api/kaviski/humanos/plan/versions  {versions: KvPlanVersionInfo[]} (só quem edita)
// POST /api/kaviski/humanos/plan/restore   {version, base?}: a versão antiga vira a atual (nova versão)
//
// Quem grava: admin; a equipe só com `editors: 'equipe'` (e não troca isso); cliente e visitante nunca.
// Filtro (aqui, no servidor): cliente/visitante não recebem itens `projeto` de salas que não vê (nem o caminho), nem
// `propria` que não vê, nem as salas temáticas que o convite bloqueia, nem agentes fixos dessas salas: no lugar de cada
// uma vai um item anônimo `blocked` (id novo, só o retângulo e as portas) que a página desenha como sala fechada
// ("Acesso restrito"). Para a equipe, as salas próprias "só escolhidas" que ela não vê saem (como antes).
//
// Salas fixas (`projeto` com `fixed: true`, planta ligada) entram no snapshot vazias e apagadas pelo mesmo caminho das
// `pinned` do mapa de estilos (server/kaviski/index.ts junta as duas listas com `kvPlanPinned`). O Habblaud World nunca
// as vê vazias: o uplink conta só salas com agentes (teste em plan.test.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  KV_PLAN_HISTORY,
  kvNormPlan,
  kvPlanRoomRef,
  type KvPlan,
  type KvPlanDoc,
  type KvPlanItem,
  type KvPlanProblem,
  type KvPlanVersionInfo,
} from '../../../shared/kaviski-plan';
import { kvRestricted, kvRoomAllowed, type KvPerson } from '../../../shared/kaviski-humanos';
import { kvPathKey, kvRoomPath, type KvRoomEntry } from '../../../shared/kaviski';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';
import { errMsg, log } from '../../log';

export const PLAN_PATH = '/api/kaviski/humanos/plan';
const VERSIONS_PATH = `${PLAN_PATH}/versions`;
const RESTORE_PATH = `${PLAN_PATH}/restore`;
/** Corpo máximo do POST (400 itens com portas e nomes cabem com folga). */
const BODY_MAX = 512 * 1024;
const PATHS_MAX = 600;

interface Stored {
  version: number;
  at: number;
  by?: string;
  byId?: string;
  note?: string;
  plan: KvPlan;
}

interface FileShape {
  version: 1;
  current: Stored | null;
  history: Stored[];
  /** ref (caminho em minúsculas) → caminho como é (com as maiúsculas): id da sala fixa enquanto está vazia. */
  paths: Record<string, string>;
}

export type KvPlanSaveResult =
  | { ok: true; doc: KvPlanDoc; problems: KvPlanProblem[] }
  | { ok: false; status: number; error: string; doc?: KvPlanDoc; problems?: KvPlanProblem[] };

/** Quem pode gravar a planta (`plan` = a atual: vale o `editors` dela). */
export function kvCanEditPlan(person: KvPerson | undefined, plan: Pick<KvPlan, 'editors'> | null): boolean {
  if (!person) return false;
  if (person.role === 'admin') return true;
  return person.role === 'equipe' && plan?.editors === 'equipe';
}

export interface KvPlanViewDeps {
  /** A pessoa vê a sala de projeto (ref = caminho)? Padrão: as regras do cliente (`person.rooms`). */
  seesProject?(ref: string, person: KvPerson): boolean;
  /** A pessoa vê a sala própria? */
  seesOwn(id: string, person: KvPerson): boolean;
  /** A sala temática está bloqueada para a pessoa (convite)? */
  blocksTheme?(key: string, person: KvPerson): boolean;
}

/**
 * A planta como `person` pode ver. Equipe/admin: tudo menos as salas próprias que não vê. Cliente/visitante: só as
 * salas de projeto liberadas para ele (as outras saem, com o caminho). Agentes fixos de sala escondida saem junto.
 * Devolve um objeto novo.
 */
export function kvPlanFor(plan: KvPlan, person: KvPerson, deps: KvPlanViewDeps): KvPlan {
  const restricted = kvRestricted(person);
  const seesProject = (ref: string) => !restricted || (deps.seesProject ? deps.seesProject(ref, person) : kvRoomAllowed(ref, person.rooms));
  const hidden = new Set<string>();
  let blockedN = 0;
  const items: KvPlanItem[] = [];
  for (const it of plan.items) {
    let shut = false;
    if (it.kind === 'projeto' && it.ref && !seesProject(it.ref)) shut = true;
    else if (it.kind === 'propria' && it.ref && !deps.seesOwn(it.ref, person)) shut = true;
    else if (restricted && it.kind === 'tema' && it.ref && deps.blocksTheme?.(it.ref, person)) shut = true;
    if (!shut) {
      items.push({ ...it, ...(it.doors ? { doors: it.doors.map((d) => ({ ...d })) } : {}) });
      continue;
    }
    hidden.add(it.id);
    if (it.ref) hidden.add(it.ref);
    // cliente/visitante: o lugar continua lá, fechado e anônimo (nada do que tem dentro, nem de quem é)
    if (restricted) items.push({ id: `el-blk${blockedN++}`, kind: 'propria', x: it.x, y: it.y, w: it.w, h: it.h, doors: (it.doors ?? []).map((d) => ({ ...d })), blocked: true });
  }
  const out: KvPlan = { ...plan, items, auto: { ...plan.auto } };
  if (plan.agents) {
    const agents = plan.agents.filter((a) => {
      if (hidden.has(a.room) || (a.room.startsWith('kv:') && hidden.has(a.room.slice(3)))) return false;
      if (a.room.startsWith('kvsala-')) return deps.seesOwn(a.room, person);
      if (a.room.startsWith('/') || /^[a-z]:\//i.test(a.room)) return seesProject(a.room);
      return true; // sala temática ou do plano
    });
    if (agents.length) out.agents = agents.map((a) => ({ ...a }));
    else delete out.agents;
  }
  return out;
}

export class KvPlanStore {
  private current: Stored | null = null;
  private history: Stored[] = [];
  private paths: Record<string, string> = {};
  /** Chamados depois de gravar/restaurar (evento `plan`, salas fixas no snapshot). */
  readonly onChange = new Set<() => void>();

  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  load(): void {
    if (!this.file) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      const read = (s: unknown): Stored | null => {
        if (!s || typeof s !== 'object') return null;
        const r = s as Stored;
        const plan = kvNormPlan(r.plan).plan;
        if (!plan || typeof r.version !== 'number' || r.version < 1) return null;
        return { version: Math.round(r.version), at: Number(r.at) || 0, ...(typeof r.by === 'string' ? { by: r.by } : {}), ...(typeof r.byId === 'string' ? { byId: r.byId } : {}), ...(typeof r.note === 'string' ? { note: r.note } : {}), plan };
      };
      this.current = read(data.current);
      this.history = (Array.isArray(data.history) ? data.history : []).map(read).filter((s): s is Stored => !!s).slice(-KV_PLAN_HISTORY);
      this.paths = {};
      if (data.paths && typeof data.paths === 'object') for (const [k, v] of Object.entries(data.paths)) if (typeof v === 'string' && kvPathKey(v) === k) this.paths[k] = v;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('Planta: não deu para ler {0} ({1}).', [this.file, errMsg(err)]));
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.tmp`;
      const data: FileShape = { version: 1, current: this.current, history: this.history, paths: this.paths };
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      log.warn(tr('Planta: não deu para gravar {0} ({1}).', [this.file, errMsg(err)]));
    }
  }

  get version(): number {
    return this.current?.version ?? 0;
  }

  /** A planta atual (sem filtro). */
  plan(): KvPlan | null {
    return this.current?.plan ?? null;
  }

  /** O documento completo (sem filtro). */
  doc(): KvPlanDoc {
    const c = this.current;
    return c ? { plan: c.plan, version: c.version, updatedAt: c.at, ...(c.by ? { by: c.by } : {}) } : { plan: null, version: 0, updatedAt: 0 };
  }

  versions(): KvPlanVersionInfo[] {
    const all = [...this.history, ...(this.current ? [this.current] : [])];
    return all
      .map((s) => ({ version: s.version, at: s.at, ...(s.by ? { by: s.by } : {}), items: s.plan.items.length, ...(s.note ? { note: s.note } : {}) }))
      .reverse();
  }

  /** Caminhos com as maiúsculas, para as salas fixas vazias (só caminho absoluto cuja chave é o ref). */
  rememberPaths(paths: Iterable<string>): void {
    let n = Object.keys(this.paths).length;
    for (const raw of paths) {
      if (typeof raw !== 'string' || raw.length > 1024) continue;
      const p = kvRoomPath(raw);
      if (!/^(\/|[A-Za-z]:\/)/.test(p)) continue;
      const k = kvPathKey(p);
      if (this.paths[k] === p) continue;
      if (!this.paths[k] && n >= PATHS_MAX) continue;
      if (!this.paths[k]) n++;
      this.paths[k] = p;
    }
  }

  pathOf(ref: string): string | undefined {
    return this.paths[kvPathKey(ref)];
  }

  /**
   * Grava uma planta nova. `base` = a versão que o editor abriu: se outra pessoa gravou no meio, 409 com a atual (as
   * duas edições não se apagam). Equipe não troca o `editors`.
   */
  write(person: KvPerson, body: unknown): KvPlanSaveResult {
    const b = (body ?? {}) as { plan?: unknown; base?: unknown; note?: unknown };
    const cur = this.plan();
    if (!kvCanEditPlan(person, cur)) return { ok: false, status: 403, error: tr('só quem é admin (ou a equipe, se liberada) muda a planta') };
    if (typeof b.base !== 'number' || !Number.isInteger(b.base)) return { ok: false, status: 400, error: tr('falta a versão de base (base)') };
    if (b.base !== this.version) return { ok: false, status: 409, error: tr('a planta mudou enquanto você editava (versão {0})', [this.version]), doc: this.doc() };
    const { plan, problems } = kvNormPlan(b.plan);
    if (!plan) return { ok: false, status: 400, error: tr('planta inválida'), problems };
    if (person.role !== 'admin') {
      if (cur?.editors) plan.editors = cur.editors;
      else delete plan.editors;
    }
    const note = typeof b.note === 'string' ? b.note.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    this.commit(plan, person, note || undefined);
    return { ok: true, doc: this.doc(), problems };
  }

  /** Uma versão antiga volta a ser a atual (como uma gravação nova: o histórico não se perde). */
  restore(person: KvPerson, body: unknown): KvPlanSaveResult {
    const b = (body ?? {}) as { version?: unknown; base?: unknown };
    const cur = this.plan();
    if (!kvCanEditPlan(person, cur)) return { ok: false, status: 403, error: tr('só quem é admin (ou a equipe, se liberada) muda a planta') };
    if (typeof b.base === 'number' && b.base !== this.version) return { ok: false, status: 409, error: tr('a planta mudou enquanto você editava (versão {0})', [this.version]), doc: this.doc() };
    const old = this.history.find((s) => s.version === b.version);
    if (!old) return { ok: false, status: 404, error: tr('versão não encontrada') };
    const plan: KvPlan = JSON.parse(JSON.stringify(old.plan)) as KvPlan;
    if (person.role !== 'admin') {
      if (cur?.editors) plan.editors = cur.editors;
      else delete plan.editors;
    }
    this.commit(plan, person, tr('voltou para a versão {0}', [old.version]));
    return { ok: true, doc: this.doc(), problems: [] };
  }

  private commit(plan: KvPlan, person: KvPerson, note?: string): void {
    if (this.current) this.history.push(this.current);
    if (this.history.length > KV_PLAN_HISTORY) this.history = this.history.slice(-KV_PLAN_HISTORY);
    this.current = { version: this.version + 1, at: this.now(), by: person.name, byId: person.id, ...(note ? { note } : {}), plan };
    this.save();
    for (const f of this.onChange) {
      try {
        f();
      } catch (err) {
        log.warn(tr('Planta: aviso de mudança falhou ({0}).', [errMsg(err)]));
      }
    }
  }

  /**
   * Salas fixas da planta ligada, no formato do mapa de estilos (chave = caminho comparável, `pinned` e o caminho com as
   * maiúsculas quando conhecido). Só `projeto` com `fixed`.
   */
  pinned(): [string, KvRoomEntry][] {
    const plan = this.plan();
    if (!plan?.on) return [];
    const out: [string, KvRoomEntry][] = [];
    const seen = new Set<string>();
    for (const it of plan.items) {
      if (it.kind !== 'projeto' || !it.fixed || !it.ref) continue;
      const key = kvPlanRoomRef(it.ref);
      if (seen.has(key)) continue;
      const path = this.pathOf(key) ?? it.ref;
      if (!/^(\/|[A-Za-z]:\/)/.test(path)) continue;
      seen.add(key);
      out.push([key, { pinned: true, path }]);
    }
    return out;
  }
}

// ------------------------------------------------------------------ ponte para o snapshot (server/kaviski/index.ts)

let active: KvPlanStore | null = null;
const listeners = new Set<() => void>();

/** Liga a planta no snapshot (salas fixas). Chamado por createHumanos. */
export function kvUsePlan(store: KvPlanStore | null): void {
  active = store;
  store?.onChange.add(() => {
    for (const f of listeners) f();
  });
  for (const f of listeners) f();
}

/** Salas fixas da planta (vazio sem planta ligada ou sem HABBLAUD_HUMANOS). */
export function kvPlanPinned(): [string, KvRoomEntry][] {
  return active?.pinned() ?? [];
}

/** Avisa quando as salas fixas podem ter mudado (o fork marca o Office como sujo). */
export function kvOnPlanPinned(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

// ------------------------------------------------------------------ rota

export interface KvPlanRouteDeps {
  store: KvPlanStore;
  whoIs(req: IncomingMessage): KvPerson | undefined;
  view: KvPlanViewDeps;
  /** Caminhos das salas que existem agora (snapshot), para guardar as maiúsculas. */
  knownPaths?(): Iterable<string>;
  /** Avisa as páginas (evento `plan`). */
  changed(version: number): void;
  audit?(person: KvPerson, action: string, detail: string, ok: boolean): void;
}

export function kvIsPlanPath(path: string): boolean {
  return path === PLAN_PATH || path === VERSIONS_PATH || path === RESTORE_PATH;
}

export function kvPlanRoute(req: IncomingMessage, res: ServerResponse, path: string, deps: KvPlanRouteDeps): void {
  const method = req.method ?? 'GET';
  const person = deps.whoIs(req);
  const fail = (err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };
  if (!person) {
    req.resume();
    return sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
  }
  const { store } = deps;
  const isRead = method === 'GET' || method === 'HEAD';
  const docFor = (): KvPlanDoc & { canEdit: boolean } => {
    const d = store.doc();
    return { ...d, plan: d.plan ? kvPlanFor(d.plan, person, deps.view) : null, canEdit: kvCanEditPlan(person, d.plan) };
  };
  if (path === PLAN_PATH && isRead) {
    req.resume();
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 200, docFor());
  }
  if (path === VERSIONS_PATH) {
    req.resume();
    if (!isRead) {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    if (!kvCanEditPlan(person, store.plan())) return sendJson(res, 403, { error: tr('só quem é admin (ou a equipe, se liberada) muda a planta') });
    return sendJson(res, 200, { versions: store.versions() });
  }
  if (method !== 'POST') {
    req.resume();
    res.setHeader('Allow', path === PLAN_PATH ? 'GET, POST' : 'POST');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  if (!kvCanEditPlan(person, store.plan())) {
    req.resume();
    return sendJson(res, 403, { error: tr('só quem é admin (ou a equipe, se liberada) muda a planta') });
  }
  readJson(req, BODY_MAX)
    .then((body) => {
      const restoring = path === RESTORE_PATH;
      if (!restoring) {
        const paths = (body as { paths?: unknown })?.paths;
        store.rememberPaths([...(deps.knownPaths?.() ?? []), ...(Array.isArray(paths) ? paths.slice(0, PATHS_MAX) : [])]);
      }
      const r = restoring ? store.restore(person, body) : store.write(person, body);
      if (!r.ok) {
        if (r.status === 409 && r.doc) {
          const d = r.doc;
          return sendJson(res, 409, { error: r.error, doc: { ...d, plan: d.plan ? kvPlanFor(d.plan, person, deps.view) : null, canEdit: true } });
        }
        throw new HttpError(r.status, r.problems?.length ? `${r.error}: ${r.problems.map((p) => p.msg).join('; ')}` : r.error);
      }
      const plan = r.doc.plan!;
      const detail = restoring ? tr('versão {0} (de {1})', [r.doc.version, String((body as { version?: unknown })?.version ?? '')]) : tr('versão {0} · {1} itens{2}', [r.doc.version, plan.items.length, plan.on ? '' : tr(' · desligada')]);
      deps.audit?.(person, restoring ? 'planta restaurada' : 'planta gravada', detail, true);
      log.info(tr('Planta: {0} gravou a versão {1}.', [person.name, r.doc.version]));
      deps.changed(r.doc.version);
      sendJson(res, 200, { ...docFor(), problems: r.problems });
    })
    .catch(fail);
}
