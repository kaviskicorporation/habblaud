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
import { kvAreaAllowed, kvCallName, kvLiveKitConfig, kvLiveKitToken, kvSetAreaGuard } from './livekit';
import { KvSocial } from './social';
import { KvChat } from './chat';
import { KvDirect } from './direct';
import { KvAudit, kvShort, kvTapBody, type KvAuditEntry } from './audit';
import type { OutboxMessage } from '../../../shared/types';
import { kvParseLook, type KvLook } from '../../../shared/kaviski-presence';
import { BUILTIN_ID, KvUsers, publicPerson } from './users';
import { KvInvites } from './invites';
import { kvInvitesRoute, INVITES_PATH } from './invites-route';
import { AGENDA_PATH, AGENDA_ROOMS_PATH, KvAgenda, kvAgendaAllowPrivate, kvAgendaRoute, type KvAgendaRoom } from './agenda';
import { kvDeskOf, kvDeskRoute } from './desk';

export const HUMANOS_API = '/api/kaviski/humanos';
const USERS_PATH = `${HUMANOS_API}/users`;
const PRESENCE_PATH = `${HUMANOS_API}/presence`;
const PROFILE_PATH = `${HUMANOS_API}/profile`;
const LIVEKIT_PATH = `${HUMANOS_API}/livekit`;
const LIVEKIT_TOKEN_PATH = `${HUMANOS_API}/livekit-token`;
const CHAT_PATH = `${HUMANOS_API}/chat`;
const CONTACTS_PATH = `${HUMANOS_API}/contacts`;
const DM_PATH = `${HUMANOS_API}/dm`;
const DM_READ_PATH = `${HUMANOS_API}/dm/read`;
const SUMMON_PATH = `${HUMANOS_API}/summon`;
const AUDIT_PATH = `${HUMANOS_API}/audit`;
const DESK_PATH = `${HUMANOS_API}/desk`;
const MESSAGE_ITEM = /^\/api\/messages\/([^/]+)$/;
const PERMISSION_DECISION = /^\/api\/permissions\/([^/]+)\/decision$/;
const AGENT_ACTION = /^\/api\/agents\/([^/]+)\/(stop|takeover|character)$/;

/** O pedaço do registro de mensagens (server/messages/registry.ts) que o cliente com "pode pedir tarefas" usa. */
export interface KvMessageSender {
  send(raw: unknown): { message: OutboxMessage } | { error: 'not-found' | 'too-many' } | { error: 'unavailable'; reason: string };
  get(id: string): OutboxMessage | undefined;
}
const AGENT_DETAIL = /^\/api\/agents\/([^/]+)$/;

type Gate = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;

export interface KvHumanos {
  readonly enabled: boolean;
  readonly users: KvUsers;
  readonly presence: KvPresence;
  /** Põe o login por pessoa na frente do gate original (sem HABBLAUD_HUMANOS=1, devolve o original). */
  gate(original: Gate, builtin: RemoteSessions, cfg: RemoteConfig): Gate;
  /** Liga o registro de mensagens (cliente que pode pedir tarefas). */
  attachMessages(registry: KvMessageSender | undefined): void;
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
  /** Busca do ICS da agenda (os testes trocam; padrão: https com as travas de agenda.ts). */
  agendaFetcher?: (url: string) => Promise<string>;
}

export function createHumanos(deps: KvHumanosDeps): KvHumanos {
  const env = deps.env ?? process.env;
  const enabled = kvHumanosEnabled(env);
  const builtinUser = env.HABBLAUD_REMOTE_USER?.trim() || undefined;
  const dir = deps.dataDir ? join(deps.dataDir, 'kaviski') : null;
  const users = new KvUsers(dir ? join(dir, 'users.json') : null, builtinUser);
  if (enabled) users.load();
  const builtinName = () => kvPersonName(users.profile(BUILTIN_ID).name) ?? builtinUser ?? 'admin';
  // Convites por link (fase 4): a chave sai do remote-secret, como a do login por pessoa.
  let secret: Buffer | undefined;
  const secretOf = () => (secret ??= loadSecret(join(deps.dataDir ?? '', 'remote-secret')));
  const invites = new KvInvites(dir ? join(dir, 'invites.json') : null, secretOf);
  if (enabled) invites.load();
  users.attachGuests(invites);
  // Agenda por ICS: relida a cada 5 min (o endereço fica em agenda.json, nunca volta ao navegador).
  const agenda = new KvAgenda({ file: dir ? join(dir, 'agenda.json') : null, fetcher: deps.agendaFetcher });
  if (enabled) {
    kvAgendaAllowPrivate(isTruthy(env.HABBLAUD_AGENDA_PRIVATE?.trim()));
    agenda.load();
    agenda.start();
  }
  /** Salas que a pessoa vê, para achar a sala da reunião no texto do evento (salas próprias: acrescentar aqui). */
  const agendaRooms = (person: KvPerson): KvAgendaRoom[] => {
    const snap = deps.snapshot();
    const ids = kvRestricted(person) ? kvAllowedRoomIds(snap, person.rooms) : null;
    return snap.rooms.filter((r) => !ids || ids.has(r.id)).map((r) => ({ id: r.id, name: r.name, ...(r.path ? { path: r.path } : {}), area: `r:${r.id}` }));
  };

  const lk = enabled ? kvLiveKitConfig(env) : {};
  if (lk.warning) log.warn(tr('   Pessoas: voz e vídeo desligados ({0} inválida ou faltando).', [lk.warning]));
  else if (lk.config) log.info(tr('   Pessoas: voz e vídeo pelo LiveKit em {0}.', [lk.config.url]));

  const liveKitRoute = (req: IncomingMessage, res: ServerResponse, path: string): void => {
    const method = req.method ?? 'GET';
    const person = whoIs(req);
    if (path === LIVEKIT_PATH) {
      req.resume();
      return sendJson(res, 200, lk.config && person ? { enabled: true, url: lk.config.url } : { enabled: false });
    }
    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    if (!person) {
      req.resume();
      return sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
    }
    if (!lk.config) {
      req.resume();
      return sendJson(res, 404, { error: tr('voz e vídeo desligados (falta HABBLAUD_LIVEKIT_URL, _KEY e _SECRET)') });
    }
    const cfg = lk.config;
    readJson(req, 4096)
      .then((body) => {
        const area = (body as { area?: unknown })?.area;
        const name = kvAreaAllowed(area, person, deps.snapshot());
        if (!name) throw new HttpError(403, tr('essa chamada não é sua'));
        // a pasta de dados entra no nome: duas instâncias no mesmo LiveKit (teste e produção) nunca dividem chamada
        const room = kvCallName(`${deps.dataDir ?? ''}\u0000${String(area)}`);
        sendJson(res, 200, { url: cfg.url, room, name, token: kvLiveKitToken(cfg, person, room) });
      })
      .catch((err) => fail(res, err));
  };

  const lookOf = (id: string): KvLook | undefined => kvParseLook(users.profile(id).look);
  // W2 (social.ts): chamar, reações, salas trancadas e rodas privadas entram na presença pelos ganchos
  const presence = new KvPresence({
    snapshot: deps.snapshot,
    look: lookOf,
    desk: (id) => kvDeskOf(users.profile(id)),
    guard: (p, b) => social.postGuard(p, b),
    extra: (v, id) => social.extra(v, id),
    state: (v, snap) => social.state(v, snap),
    callArea: (id) => social.callArea(id),
    changed: (id) => social.changed(id),
  });
  const chat = new KvChat(presence, deps.snapshot, dir ? join(dir, 'chat.json') : null);
  const audit = new KvAudit(dir ? join(dir, 'audit.jsonl') : null);
  const direct = new KvDirect({
    people: () => people(),
    online: () => new Map(presence.online().map((o) => [o.person.id, o.status])),
    look: (id) => lookOf(id),
    emit: (event, data, to) => presence.emit(event, data, (viewer) => to(viewer)),
    file: dir ? join(dir, 'dm.json') : null,
  });

  /** Conversa 1:1 e contatos (direct.ts). */
  const directRoute = (req: IncomingMessage, res: ServerResponse, path: string, url: URL): void => {
    const method = req.method ?? 'GET';
    const person = whoIs(req);
    if (!person) {
      req.resume();
      return sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
    }
    const isRead = method === 'GET' || method === 'HEAD';
    if (path === CONTACTS_PATH) {
      req.resume();
      return isRead ? sendJson(res, 200, { contacts: direct.contacts(person) }) : sendJson(res, 405, { error: tr('método não permitido') });
    }
    if (path === DM_PATH && isRead) {
      req.resume();
      const list = direct.history(person, url.searchParams.get('with'));
      return list ? sendJson(res, 200, { messages: list }) : sendJson(res, 404, { error: tr('pessoa não encontrada') });
    }
    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', path === DM_PATH ? 'GET, POST' : 'POST');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    readJson(req, 8192)
      .then((body) => {
        if (path === DM_READ_PATH) {
          if (!direct.read(person, (body as { with?: unknown })?.with)) throw new HttpError(404, tr('pessoa não encontrada'));
          return sendJson(res, 200, { ok: true });
        }
        const r = direct.send(person, body);
        if (!r.ok) throw new HttpError(r.status, r.error);
        sendJson(res, 200, { message: r.message });
      })
      .catch((err) => fail(res, err));
  };
  const social = new KvSocial({ presence, snapshot: deps.snapshot, audit });
  if (enabled) kvSetAreaGuard((area, p) => social.areaGuard(area, p));
  let messages: KvMessageSender | undefined;
  const summoned = new Map<string, number>();
  // Visitante cujo convite venceu (ou foi revogado) sai do escritório mesmo com a página aberta.
  if (enabled) {
    const sweep = setInterval(() => {
      for (const o of presence.online()) if (o.person.role === 'visitante' && !invites.person(o.person.id)) presence.refresh(undefined, o.person.id);
    }, 30_000);
    sweep.unref?.();
  }

  /** Agente (e a sala dele) pelo id, se a pessoa pode vê-lo. */
  const agentFor = (person: KvPerson, id: unknown) => {
    if (typeof id !== 'string') return undefined;
    const snap = deps.snapshot();
    const a = snap.agents.find((x) => x.id === id);
    if (!a) return undefined;
    if (kvRestricted(person) && !kvAllowedRoomIds(snap, person.rooms).has(a.roomId)) return undefined;
    const room = snap.rooms.find((r) => r.id === a.roomId);
    return { id: a.id, name: a.name, room: room?.name ?? a.roomId, roomId: a.roomId };
  };
  const agentRef = (a: ReturnType<typeof agentFor>): KvAuditEntry['agent'] => (a ? { id: a.id, name: a.name, room: a.room } : undefined);

  /**
   * Registro das ações de quem não é cliente nas rotas originais (o corpo é copiado enquanto passa; a linha sai quando
   * a resposta termina). As do cliente são registradas na rota dele (clientMessage).
   */
  const tapAudit = (req: IncomingMessage, res: ServerResponse, path: string, person: KvPerson): void => {
    const method = req.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD') return;
    const parse = (body: string): Record<string, unknown> => {
      try {
        return (JSON.parse(body) as Record<string, unknown>) ?? {};
      } catch {
        return {};
      }
    };
    let action: string | undefined;
    let make: (b: Record<string, unknown>) => { agent?: KvAuditEntry['agent']; detail?: string } = () => ({});
    const snap = () => deps.snapshot();
    if (path === '/api/messages') {
      action = 'mensagem';
      make = (b) => ({ agent: agentRef(agentFor(person, b.agentId)), detail: kvShort(b.text) });
    } else if (PERMISSION_DECISION.test(path)) {
      const raw = PERMISSION_DECISION.exec(path)![1]!;
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch {
        // id cru
      }
      const who = snap().agents.find((a) => a.permission?.id === id);
      const title = who?.permission?.title;
      action = 'permissão';
      make = (b) => ({
        agent: agentRef(who ? agentFor(person, who.id) : undefined),
        detail: kvShort([typeof b.behavior === 'string' ? b.behavior : '', title ?? '', typeof b.message === 'string' ? `“${b.message}”` : ''].filter(Boolean).join(' · ')),
      });
    } else if (path === '/api/spawn') {
      action = 'novo agente';
      make = (b) => ({ detail: kvShort([typeof b.cwd === 'string' ? b.cwd : typeof b.folder === 'string' ? b.folder : '', typeof b.prompt === 'string' ? b.prompt : ''].filter(Boolean).join(' · ')) });
    } else if (path === '/api/pty') {
      action = 'terminal aberto';
      make = (b) => ({ detail: kvShort(b.cwd) });
    } else if (/^\/api\/pty\/[^/]+\/close$/.test(path)) {
      action = 'terminal fechado';
    } else if (AGENT_ACTION.test(path)) {
      const m = AGENT_ACTION.exec(path)!;
      let id = m[1]!;
      try {
        id = decodeURIComponent(id);
      } catch {
        // id cru
      }
      action = m[2] === 'stop' ? 'encerrar agente' : m[2] === 'takeover' ? 'assumir sessão' : 'personagem';
      make = (b) => ({ agent: agentRef(agentFor(person, id)), detail: kvShort(b.name) });
    } else if (path === '/api/rooms/rename') {
      action = 'renomear sala';
      make = (b) => ({ detail: kvShort(b.name) });
    }
    if (!action) return;
    const name = action;
    // o agente e o pedido de permissão podem sumir depois da resposta: o que der para saber agora
    const early = make({});
    kvTapBody(req, res, (body, status) => {
      const e = make(parse(body));
      audit.add(person, name, { agent: e.agent ?? early.agent, detail: e.detail, ok: status < 400 });
    });
  };

  /** Cliente com "pode pedir tarefas": mensagem só para agente das salas dele (o resto do cliente segue fechado). */
  const clientMessage = (req: IncomingMessage, res: ServerResponse, path: string, person: KvPerson): boolean => {
    const method = req.method ?? 'GET';
    if (!person.request || !messages) {
      req.resume();
      sendJson(res, 403, { error: tr('não liberado para clientes') });
      return true;
    }
    const reg = messages;
    if (path === '/api/messages') {
      if (method !== 'POST') {
        req.resume();
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: tr('método não permitido') });
        return true;
      }
      readJson(req)
        .then((body) => {
          const b = (body ?? {}) as Record<string, unknown>;
          const agent = agentFor(person, b.agentId);
          if (!agent) throw new HttpError(404, tr('agente não encontrado'));
          const r = reg.send({ agentId: agent.id, text: b.text });
          const ok = 'message' in r;
          audit.add(person, 'mensagem', { agent: agentRef(agent), detail: kvShort(b.text), ok });
          if (ok) return sendJson(res, 201, r.message);
          if (r.error === 'not-found') throw new HttpError(404, tr('agente desconhecido: ele já saiu do escritório?'));
          if (r.error === 'too-many') throw new HttpError(429, tr('mensagens demais esperando a entrega para este agente'));
          throw new HttpError(409, 'reason' in r ? r.reason : tr('erro interno'));
        })
        .catch((err) => fail(res, err));
      return true;
    }
    req.resume();
    let id = '';
    try {
      id = decodeURIComponent(MESSAGE_ITEM.exec(path)?.[1] ?? '');
    } catch {
      // 404 abaixo
    }
    const m = method === 'GET' || method === 'HEAD' ? reg.get(id) : undefined;
    if (m && agentFor(person, m.agentId)) sendJson(res, 200, m);
    else sendJson(res, 404, { error: tr('mensagem desconhecida') });
    return true;
  };

  /** "Chamar até mim": o agente anda até a pessoa em toda página que o vê (uma vez a cada 15 s por pessoa). */
  const summonRoute = (req: IncomingMessage, res: ServerResponse): void => {
    const person = whoIs(req);
    if ((req.method ?? 'GET') !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    if (!person || person.role === 'visitante') {
      req.resume();
      return sendJson(res, 403, { error: person ? tr('visitante não chama agentes') : tr('entre com a sua conta para aparecer no escritório') });
    }
    readJson(req, 4096)
      .then((body) => {
        if (!presence.areaOf(person.id)) throw new HttpError(409, tr('entre no escritório (Andar) para chamar um agente'));
        const agent = agentFor(person, (body as { agentId?: unknown })?.agentId);
        if (!agent) throw new HttpError(404, tr('agente não encontrado'));
        const t = Date.now();
        if (t - (summoned.get(person.id) ?? 0) < 15_000) throw new HttpError(429, tr('espere um pouco para chamar de novo'));
        summoned.set(person.id, t);
        audit.add(person, 'chamar agente', { agent: agentRef(agent), ok: true });
        const snap = deps.snapshot();
        presence.emit('summon', { agentId: agent.id, to: person.id, name: person.name, at: t }, (viewer) => !kvRestricted(viewer) || kvAllowedRoomIds(snap, viewer.rooms).has(agent.roomId));
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => fail(res, err));
  };

  const chatRoute = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
    const method = req.method ?? 'GET';
    const person = whoIs(req);
    if (!person) {
      req.resume();
      return sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
    }
    if (method === 'GET' || method === 'HEAD') {
      req.resume();
      const list = chat.list(person, url.searchParams.get('area') ?? '');
      return list ? sendJson(res, 200, { messages: list }) : sendJson(res, 403, { error: tr('essa conversa não é sua') });
    }
    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    readJson(req, 4096)
      .then((body) => {
        const r = chat.post(person, body);
        if (!r.ok) throw new HttpError(r.status, r.error);
        sendJson(res, 200, { message: r.message });
      })
      .catch((err) => fail(res, err));
  };

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
    if (path === '/api/messages' || MESSAGE_ITEM.test(path)) return clientMessage(req, res, path, person);
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
    attachMessages(registry) {
      messages = registry;
    },
    gate(original, builtin, cfg) {
      if (!enabled) return original;
      const sessions = new KvPersonSessions(secretOf(), (id) => users.get(id)?.hash, Date.now, dir ? join(dir, 'revoked.json') : undefined);
      log.info(tr('   Pessoas (HABBLAUD_HUMANOS): login por pessoa na porta remota; {0} conta(s) além de {1}.', [users.size, cfg.user]));
      return createPeopleGate({
        original, config: cfg, builtin, people: sessions, users, secure: !!cfg.tls, caFile: cfg.tls?.caFile, builtinName, invites,
        onJoin: (p) => audit.add(p, 'visitante entrou', { detail: kvShort(p.rooms.join(', ')), ok: true }),
      });
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
      if (path === SUMMON_PATH) {
        summonRoute(req, res);
        return true;
      }
      if (path === AUDIT_PATH) {
        req.resume();
        if (!isAdmin(req)) sendJson(res, 403, { error: tr('só quem é admin cuida das pessoas') });
        else sendJson(res, 200, { entries: audit.recent(300) });
        return true;
      }
      if (path === CONTACTS_PATH || path === DM_PATH || path === DM_READ_PATH) {
        directRoute(req, res, path, url);
        return true;
      }
      if (path === CHAT_PATH) {
        chatRoute(req, res, url);
        return true;
      }
      if (path === LIVEKIT_PATH || path === LIVEKIT_TOKEN_PATH) {
        liveKitRoute(req, res, path);
        return true;
      }
      if (path === PROFILE_PATH) {
        profileRoute(req, res);
        return true;
      }
      if (path === AGENDA_PATH || path === AGENDA_ROOMS_PATH) {
        kvAgendaRoute(req, res, path, {
          who: whoIs(req),
          agenda,
          roomsFor: agendaRooms,
          personById: (id) => (id === BUILTIN_ID ? builtinPerson(builtinUser ?? 'admin', builtinName()) : users.get(id) ? publicPerson(users.get(id)!) : undefined),
          audit,
        });
        return true;
      }
      if (path === INVITES_PATH || path.startsWith(`${INVITES_PATH}/`)) {
        kvInvitesRoute(req, res, path, { who: whoIs(req), invites, presence, audit, snapshot: deps.snapshot });
        return true;
      }
      if (path === DESK_PATH) {
        kvDeskRoute(req, res, whoIs(req), {
          snapshot: deps.snapshot,
          profile: (id) => users.profile(id),
          setProfile: (id, p) => users.setProfile(id, p),
          ids: () => [...(builtinUser ? [BUILTIN_ID] : []), ...users.list().map((u) => u.id)],
          touch: () => presence.touch(),
        });
        return true;
      }
      if (path.startsWith(`${HUMANOS_API}/`) && social.route(req, res, path.slice(HUMANOS_API.length + 1), whoIs(req))) return true;
      if (path === USERS_PATH || path.startsWith(`${USERS_PATH}/`)) {
        usersRoute(req, res, path);
        return true;
      }
      if (person && kvRestricted(person)) return clientRoute(req, res, path, person);
      const who = whoIs(req);
      if (who) tapAudit(req, res, path, who);
      return false;
    },
  };
}
