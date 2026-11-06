// Fork Kaviski (KAVISKI-HUMANOS.md): pessoas no escritório. Tudo desligado sem HABBLAUD_HUMANOS=1.
//
// - Contas por pessoa (users.ts) e login por pessoa na porta remota (gate.ts, na frente do gate original).
// - Papéis: o que a porta remota libera (HABBLAUD_REMOTE_ALLOW) passa a depender de quem está logado
//   (humanos/request.ts kvRemoteAllows, usado nos ganchos de server/index.ts: `allows(feature, req)` e `canAnswer`).
// - Cliente: lista FECHADA de rotas (o que não está aqui responde 403, inclusive rotas novas do original) e o
//   snapshot/fluxo filtrados no servidor (shared/kaviski-humanos.ts, stream-filter.ts).
// - Rotas próprias em /api/kaviski/humanos/*: `me` (quem sou eu) e `users` (tela de Pessoas, só admin).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { OfficeSnapshot } from '../../../shared/types';
import { kvAllowedRoomIds, kvFilterSnapshot, kvPersonName, kvRestricted, type KvMe, type KvPerson } from '../../../shared/kaviski-humanos';
import { tr } from '../../../shared/i18n';
import { isTruthy } from '../../config';
import { HttpError, readJson, sendJson } from '../../http/app';
import { isLoopbackHost } from '../../http/guard';
import { isRemoteRequest, loadSecret, type RemoteConfig, type RemoteSessions } from '../../http/remote';
import { log } from '../../log';
import { builtinPerson, createPeopleGate, KvPersonSessions } from './gate';
import { kvPersonOf } from './request';
import { kvFilterStream } from './stream-filter';
import { BUILTIN_ID, KvUsers, publicPerson } from './users';

export const HUMANOS_API = '/api/kaviski/humanos';
const USERS_PATH = `${HUMANOS_API}/users`;
const AGENT_DETAIL = /^\/api\/agents\/([^/]+)$/;

type Gate = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;

export interface KvHumanos {
  readonly enabled: boolean;
  readonly users: KvUsers;
  /** Põe o login por pessoa na frente do gate original (sem HABBLAUD_HUMANOS=1, devolve o original). */
  gate(original: Gate, builtin: RemoteSessions, cfg: RemoteConfig): Gate;
  /** Antes da API (porta local e remota): rotas próprias e a trava do cliente. true = já respondeu. */
  before(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
}

export function kvHumanosEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.HABBLAUD_HUMANOS?.trim());
}

export interface KvHumanosDeps {
  dataDir: string | null;
  /** Snapshot atual completo (hub.current()). */
  snapshot: () => OfficeSnapshot;
  env?: NodeJS.ProcessEnv;
}

export function createHumanos(deps: KvHumanosDeps): KvHumanos {
  const env = deps.env ?? process.env;
  const enabled = kvHumanosEnabled(env);
  const builtinUser = env.HABBLAUD_REMOTE_USER?.trim() || undefined;
  const dir = deps.dataDir ? join(deps.dataDir, 'kaviski') : null;
  const users = new KvUsers(dir ? join(dir, 'users.json') : null, builtinUser);
  if (enabled) users.load();
  const builtinName = () => kvPersonName(users.profile(BUILTIN_ID).name) ?? builtinUser ?? 'admin';

  const isAdmin = (req: IncomingMessage): boolean => {
    const p = kvPersonOf(req);
    if (p) return p.role === 'admin';
    // Pela porta local, aberto no próprio computador: é o dono da máquina.
    return !isRemoteRequest(req) && isLoopbackHost(req.headers.host);
  };

  const people = (): KvPerson[] => [
    ...(builtinUser ? [builtinPerson(builtinUser, builtinName())] : []),
    ...users.list().map((u) => publicPerson(u)),
  ];

  const fail = (res: ServerResponse, err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };

  const usersRoute = (req: IncomingMessage, res: ServerResponse, path: string): void => {
    const method = req.method ?? 'GET';
    if (!isAdmin(req)) {
      req.resume();
      return sendJson(res, 403, { error: tr('só quem é admin cuida das pessoas') });
    }
    if (path === USERS_PATH) {
      if (method === 'GET' || method === 'HEAD') {
        req.resume();
        const snap = deps.snapshot();
        const rooms = snap.rooms.filter((r) => r.path?.startsWith('/')).map((r) => ({ path: r.path, name: r.name }));
        return sendJson(res, 200, { people: people(), rooms });
      }
      if (method !== 'POST') {
        req.resume();
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { error: tr('método não permitido') });
      }
      readJson(req)
        .then(async (body) => {
          const r = await users.create(body);
          if (!r.ok) throw new HttpError(r.status, r.error);
          log.info(tr('Pessoas: conta {0} criada ({1}).', [r.person.user, r.person.role]));
          sendJson(res, 201, { person: r.person });
        })
        .catch((err) => fail(res, err));
      return;
    }
    let id: string;
    try {
      id = decodeURIComponent(path.slice(USERS_PATH.length + 1));
    } catch {
      req.resume();
      return sendJson(res, 400, { error: tr('id inválido') });
    }
    if (method === 'DELETE') {
      req.resume();
      if (id === BUILTIN_ID) return sendJson(res, 400, { error: tr('a conta do .env (HABBLAUD_REMOTE_USER) não se apaga por aqui') });
      if (!users.remove(id)) return sendJson(res, 404, { error: tr('pessoa não encontrada') });
      log.info(tr('Pessoas: conta {0} apagada.', [id]));
      return sendJson(res, 200, { ok: true });
    }
    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'POST, DELETE');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    readJson(req)
      .then(async (body) => {
        if (id === BUILTIN_ID) {
          // A conta do .env: só o nome exibido (papel admin e senha do .env, sempre).
          const name = kvPersonName((body as { name?: unknown })?.name);
          if (!name) throw new HttpError(400, tr('nome inválido'));
          users.setProfile(BUILTIN_ID, { ...users.profile(BUILTIN_ID), name });
          return sendJson(res, 200, { person: builtinPerson(builtinUser ?? 'admin', name) });
        }
        const r = await users.update(id, body);
        if (!r.ok) throw new HttpError(r.status, r.error);
        sendJson(res, 200, { person: r.person });
      })
      .catch((err) => fail(res, err));
  };

  /** Rotas que um cliente pode usar (o resto: 403). */
  const clientRoute = (req: IncomingMessage, res: ServerResponse, path: string, person: KvPerson): boolean => {
    const method = req.method ?? 'GET';
    const isRead = method === 'GET' || method === 'HEAD';
    if (path === '/api/stream' && method === 'GET') {
      kvFilterStream(res, person.rooms);
      return false; // segue para o hub.attach, já filtrado
    }
    if (path === '/api/snapshot' && isRead) {
      req.resume();
      sendJson(res, 200, kvFilterSnapshot(deps.snapshot(), person.rooms));
      return true;
    }
    if ((path === '/api/access' || path === '/api/updates') && isRead) return false;
    const agent = AGENT_DETAIL.exec(path);
    if (agent && isRead) {
      let id = '';
      try {
        id = decodeURIComponent(agent[1]);
      } catch {
        // cai no 404
      }
      const snap = deps.snapshot();
      const ids = kvAllowedRoomIds(snap, person.rooms);
      const a = snap.agents.find((x) => x.id === id);
      if (a && ids.has(a.roomId)) return false;
      req.resume();
      sendJson(res, 404, { error: tr('agente não encontrado') });
      return true;
    }
    req.resume();
    sendJson(res, 403, { error: tr('não liberado para clientes') });
    return true;
  };

  return {
    enabled,
    users,
    gate(original, builtin, cfg) {
      if (!enabled) return original;
      const secret = loadSecret(join(deps.dataDir ?? '', 'remote-secret'));
      const sessions = new KvPersonSessions(secret, (id) => users.get(id)?.hash, Date.now, dir ? join(dir, 'revoked.json') : undefined);
      log.info(tr('   Pessoas (HABBLAUD_HUMANOS): login por pessoa na porta remota; {0} conta(s) além de {1}.', [users.size, cfg.user]));
      return createPeopleGate({ original, config: cfg, builtin, people: sessions, users, secure: !!cfg.tls, caFile: cfg.tls?.caFile, builtinName });
    },
    before(req, res, url) {
      if (!enabled) return false;
      const path = url.pathname;
      if (path !== '/api' && !path.startsWith('/api/')) return false;
      const person = kvPersonOf(req);
      if (path === `${HUMANOS_API}/me`) {
        req.resume();
        const local = !isRemoteRequest(req) && isLoopbackHost(req.headers.host);
        const me: KvMe = { enabled: true, ...(person ? { person } : {}), ...(local ? { local: true } : {}) };
        sendJson(res, 200, me);
        return true;
      }
      if (path === USERS_PATH || path.startsWith(`${USERS_PATH}/`)) {
        usersRoute(req, res, path);
        return true;
      }
      if (person && kvRestricted(person)) return clientRoute(req, res, path, person);
      return false;
    },
  };
}
