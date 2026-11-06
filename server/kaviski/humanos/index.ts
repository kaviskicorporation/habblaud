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
import { KvPresence } from './presence';
import { kvParseLook, type KvLook } from '../../../shared/kaviski-presence';
import { BUILTIN_ID, KvUsers, publicPerson } from './users';

export const HUMANOS_API = '/api/kaviski/humanos';
const USERS_PATH = `${HUMANOS_API}/users`;
const PRESENCE_PATH = `${HUMANOS_API}/presence`;
const PROFILE_PATH = `${HUMANOS_API}/profile`;
const AGENT_DETAIL = /^\/api\/agents\/([^/]+)$/;

type Gate = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;

export interface KvHumanos {
  readonly enabled: boolean;
  readonly users: KvUsers;
  readonly presence: KvPresence;
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

  const lookOf = (id: string): KvLook | undefined => kvParseLook(users.profile(id).look);
  const presence = new KvPresence({ snapshot: deps.snapshot, look: lookOf });

  /** Quem é: a pessoa do login ou, pela porta local aberta no próprio computador, a conta do .env. */
  const whoIs = (req: IncomingMessage): KvPerson | undefined => {
    const p = kvPersonOf(req);
    if (p) return p;
    if (!isRemoteRequest(req) && isLoopbackHost(req.headers.host)) return builtinPerson(builtinUser ?? 'admin', builtinName());
    return undefined;
  };

  const presenceRoute = (req: IncomingMessage, res: ServerResponse): void => {
    const method = req.method ?? 'GET';
    const person = whoIs(req);
    if (!person) {
      req.resume();
      return sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
    }
    if (method === 'GET') return presence.attach(req, res, person);
    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    readJson(req, 4096)
      .then((body) => {
        const err = presence.update(person, body);
        if (err === 'offline') throw new HttpError(409, tr('abra o fluxo de presença antes'));
        if (err === 'rate') throw new HttpError(429, tr('devagar'));
        if (err) throw new HttpError(400, tr('presença inválida ({0})', [err]));
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => fail(res, err));
  };

  const profileRoute = (req: IncomingMessage, res: ServerResponse): void => {
    const method = req.method ?? 'GET';
    const person = whoIs(req);
    if (!person) {
      req.resume();
      return sendJson(res, 403, { error: tr('entre com a sua conta para ter um boneco') });
    }
    if (method === 'GET' || method === 'HEAD') {
      req.resume();
      return sendJson(res, 200, { look: lookOf(person.id) ?? null, name: person.name });
    }
    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    readJson(req, 8192)
      .then((body) => {
        const look = kvParseLook((body as { look?: unknown })?.look);
        if (!look) throw new HttpError(400, tr('boneco inválido'));
        if (!users.setProfile(person.id, { ...users.profile(person.id), look })) throw new HttpError(404, tr('pessoa não encontrada'));
        presence.touch();
        sendJson(res, 200, { look });
      })
      .catch((err) => fail(res, err));
  };

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
      presence.refresh(undefined, id);
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
        presence.refresh(r.person, id);
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
    presence,
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
        const who = person ?? (local ? whoIs(req) : undefined);
        const me: KvMe = { enabled: true, ...(who ? { person: who } : {}), ...(local ? { local: true } : {}) };
        sendJson(res, 200, me);
        return true;
      }
      if (path === PRESENCE_PATH) {
        presenceRoute(req, res);
        return true;
      }
      if (path === PROFILE_PATH) {
        profileRoute(req, res);
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
