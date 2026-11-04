// Fork Kaviski (KAVISKI.md): mensagens pelo escritório às sessões que rodam no TwiCC (interface web do Claude Code e do
// Codex). Essas sessões rodam pelo SDK, sem terminal: o plugin habblaud-mensagens nunca fica presente nelas. Aqui a
// mensagem vai pelo auxiliar do host (npm run codex:bridge, server/kaviski/twicc-bridge.ts), que roda
// `twicc send-message --no-expand <session_id> <texto>`.
//
// Ligado com HABBLAUD_TWICC_MESSAGES=1 (e as mensagens pelo escritório ligadas). O servidor (no Docker) não enxerga o
// TwiCC: quem diz quais sessões o TwiCC está rodando é o auxiliar, em cada rodada:
//
//   POST /api/host/twicc/poll  {live?: string[]}   -> 200 {messages: [{id, session, text}], want: string[]}
//        `live` = ids das sessões que o TwiCC roda agora (process.state != dead), mandado quando o auxiliar relê a
//        lista; `want` = sessões de agentes principais presentes que não recebem mensagens de outro jeito (o auxiliar só
//        consulta o TwiCC quando há alguma);
//   POST /api/host/twicc/ack   {results: [{id, ok, error?}]} -> 200 {ok: true}
//
// Só sessões que o TwiCC está RODANDO recebem: uma sessão morta no TwiCC pode estar aberta num terminal, e o
// send-message a retomaria num segundo processo. O registro original (server/messages/registry.ts) não é tocado: o
// fork embrulha send/get/canMessage/reachable dele em tempo de execução (como kaviski.attach faz com o Office). Mesmos
// estados (queued → sent → delivered/failed), prazos e limites; a atividade "Mensagem pelo Habblaud" entra no agente
// quando o auxiliar confirma.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Activity, AgentInfo, OutboxMessage } from '../../shared/types';
import { describeMessage } from '../../shared/messages';
import { truncate } from '../../shared/activity';
import { tr } from '../../shared/i18n';
import { HttpError, readJson, sendJson } from '../http/app';
import { InvalidRequest, MAX_OPEN, parseSend, type SendResult } from '../messages/registry';

export const TWICC_POLL_PATH = '/api/host/twicc/poll';
export const TWICC_ACK_PATH = '/api/host/twicc/ack';
/** Auxiliar visto há até este tempo: está no ar. */
export const TWICC_BRIDGE_MS = 15_000;
/** Lista de sessões vivas do TwiCC vale este tempo (o auxiliar relê a cada ~20 s quando há candidatas). */
export const TWICC_LIVE_MS = 90_000;
export const TWICC_QUEUED_TIMEOUT_MS = 60_000;
/** O send-message do TwiCC pode demorar (retoma o processo do agente). */
export const TWICC_SENT_TIMEOUT_MS = 60_000;
export const TWICC_KEEP_MS = 10 * 60_000;
const BATCH = 5;
const ERROR_MAX = 300;
const IDS_MAX = 2_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ERR_TWICC_NOT_FETCHED = tr('o auxiliar do host não buscou a mensagem: o npm run codex:bridge está rodando?');
export const ERR_TWICC_NOT_CONFIRMED = tr('o auxiliar do host não confirmou a entrega ao TwiCC');
export const ERR_TWICC_REFUSED = tr('o TwiCC não aceitou a mensagem');
export const ERR_TWICC_GONE = tr('o agente saiu do escritório');
export const ERR_TWICC_CHANGED = tr('a conversa do agente mudou (/clear ou /resume) antes da entrega');

/** O pedaço do MessageRegistry que o fork embrulha. */
export interface KvMessageRegistry {
  send(raw: unknown): SendResult;
  get(id: string): OutboxMessage | undefined;
  canMessage(agentId: string): boolean;
  reachable(): Set<string>;
}

/** O pedaço do Office que o fork usa. */
export interface KvTwiccOffice {
  get(id: string): AgentInfo | undefined;
  list(): AgentInfo[];
  markDirty(): void;
  addActivity(id: string, activity: Activity, current: boolean): void;
}

export interface KvTwiccMessages {
  /** Trata /api/host/twicc/poll e /ack (a trava já foi conferida). */
  route(req: IncomingMessage, res: ServerResponse, path: string): void;
  /** O agente recebe pelo TwiCC agora. */
  reachable(agentId: string): boolean;
  /** Rodada do auxiliar (exposta para os testes). */
  poll(raw: unknown): { messages: { id: string; session: string; text: string }[]; want: string[] };
  ack(raw: unknown): void;
  tick(): void;
  stop(): void;
}

interface Entry {
  msg: OutboxMessage;
  text: string;
  activity: ReturnType<typeof describeMessage>;
  /** Sessão do agente quando a mensagem foi mandada (id do TwiCC). */
  target: string;
  sentAt?: number;
  late?: boolean;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const present = (a: AgentInfo | undefined): a is AgentInfo => !!a && a.status !== 'offline' && a.status !== 'done';
const isFinal = (e: Entry) => e.msg.status === 'delivered' || e.msg.status === 'failed';

export interface TwiccMessagesOptions {
  now?: () => number;
  tickMs?: number;
}

/** Embrulha o registro de mensagens: as sessões vivas do TwiCC passam a receber pelo auxiliar do host. */
export function attachTwiccMessages(registry: KvMessageRegistry, office: KvTwiccOffice, opts: TwiccMessagesOptions = {}): KvTwiccMessages {
  const now = opts.now ?? Date.now;
  const messages = new Map<string, Entry>();
  let live = new Set<string>();
  let liveAt: number | undefined;
  let bridgeAt: number | undefined;
  let seq = 0;
  let lastReach = '';

  const orig = {
    send: registry.send.bind(registry),
    get: registry.get.bind(registry),
    canMessage: registry.canMessage.bind(registry),
    reachable: registry.reachable.bind(registry),
  };

  const up = (): boolean => bridgeAt !== undefined && now() - bridgeAt < TWICC_BRIDGE_MS && liveAt !== undefined && now() - liveAt < TWICC_LIVE_MS;

  const reachable = (agentId: string): boolean => {
    if (!up()) return false;
    const a = office.get(agentId);
    return present(a) && a.kind === 'main' && UUID.test(a.sessionId) && live.has(a.sessionId.toLowerCase());
  };

  /** Agentes que recebem pelo TwiCC agora (para o snapshot). */
  const reachSet = (): Set<string> => {
    const out = new Set<string>();
    if (!up()) return out;
    for (const a of office.list()) if (reachable(a.id)) out.add(a.id);
    return out;
  };

  /** A presença mudou: o snapshot é refeito (canMessage). */
  const checkReach = (): void => {
    const sig = [...reachSet()].sort().join(',');
    if (sig === lastReach) return;
    lastReach = sig;
    office.markDirty();
  };

  const finish = (e: Entry, status: 'delivered' | 'failed', at: number, error?: string): void => {
    e.msg.status = status;
    e.msg.updatedAt = at;
    delete e.late;
    if (status === 'delivered') {
      delete e.msg.error;
      office.addActivity(e.msg.agentId, { id: `${e.msg.agentId}#msg:${e.msg.id}`, at, ...e.activity }, false);
    } else e.msg.error = error;
    e.text = '';
  };

  // ---------------------------------------------------------------- embrulho do registro original

  registry.canMessage = (agentId) => reachable(agentId) || orig.canMessage(agentId);
  registry.reachable = () => {
    const out = orig.reachable();
    for (const id of reachSet()) out.add(id);
    return out;
  };
  registry.get = (id) => {
    const e = messages.get(id);
    return e ? { ...e.msg } : orig.get(id);
  };
  registry.send = (raw) => {
    const { agentId, text } = parseSend(raw);
    // Sessão viva no TwiCC: vai por ele (é o processo que roda a sessão), também no Codex.
    if (!reachable(agentId)) return orig.send(raw);
    const a = office.get(agentId)!;
    let open = 0;
    for (const e of messages.values()) if (e.msg.agentId === agentId && !isFinal(e)) open++;
    if (open >= MAX_OPEN) return { error: 'too-many' };
    const at = now();
    const id = `m-${at.toString(36)}-kv${++seq}-${randomBytes(9).toString('base64url')}`;
    const entry: Entry = { msg: { id, agentId, status: 'queued', createdAt: at, updatedAt: at }, text, activity: describeMessage(text), target: a.sessionId.toLowerCase() };
    messages.set(id, entry);
    return { message: { ...entry.msg } };
  };

  // ---------------------------------------------------------------- rodadas do auxiliar

  const poll = (raw: unknown): { messages: { id: string; session: string; text: string }[]; want: string[] } => {
    const r = rec(raw);
    if (!r) throw new InvalidRequest(tr('esperado um objeto JSON ({})'));
    const at = now();
    bridgeAt = at;
    if (r.live !== undefined) {
      if (!Array.isArray(r.live)) throw new InvalidRequest('esperado {live: ["<session_id>", ...]}');
      live = new Set(r.live.slice(0, IDS_MAX).filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase()));
      liveAt = at;
    }
    checkReach();
    const out: { id: string; session: string; text: string }[] = [];
    const busy = new Set<string>();
    for (const e of messages.values()) if (e.msg.status === 'sent') busy.add(e.msg.agentId);
    for (const e of messages.values()) {
      if (out.length >= BATCH) break;
      if (e.msg.status !== 'queued' || busy.has(e.msg.agentId)) continue;
      const a = office.get(e.msg.agentId);
      if (!present(a)) {
        finish(e, 'failed', at, ERR_TWICC_GONE);
        continue;
      }
      if (a.sessionId.toLowerCase() !== e.target) {
        finish(e, 'failed', at, ERR_TWICC_CHANGED);
        continue;
      }
      busy.add(e.msg.agentId);
      e.msg.status = 'sent';
      e.msg.updatedAt = at;
      e.sentAt = at;
      out.push({ id: e.msg.id, session: e.target, text: e.text });
    }
    // Candidatas: principais presentes, com id de sessão (UUID), menos as do Claude Code com o plugin conectado (essas
    // recebem pela caixa de entrada; o Codex entra sempre: no TwiCC a sessão dele vai pelo send-message).
    const want: string[] = [];
    for (const a of office.list()) {
      if (a.kind !== 'main' || !present(a) || !UUID.test(a.sessionId)) continue;
      if (a.provider !== 'codex' && !live.has(a.sessionId.toLowerCase()) && orig.canMessage(a.id)) continue;
      want.push(a.sessionId.toLowerCase());
    }
    return { messages: out, want: [...new Set(want)] };
  };

  const ack = (raw: unknown): void => {
    const r = rec(raw);
    if (!r || !Array.isArray(r.results)) throw new InvalidRequest('esperado {results: [{id, ok, error?}]}');
    const at = now();
    bridgeAt = at;
    for (const item of r.results.slice(0, 50)) {
      const x = rec(item);
      const e = typeof x?.id === 'string' ? messages.get(x.id) : undefined;
      if (!x || !e || typeof x.ok !== 'boolean') continue;
      if (e.msg.status !== 'sent' && !(e.msg.status === 'failed' && e.late)) continue;
      if (x.ok) finish(e, 'delivered', at);
      else finish(e, 'failed', at, typeof x.error === 'string' && x.error.trim() ? truncate(x.error, ERROR_MAX) : ERR_TWICC_REFUSED);
    }
  };

  const tick = (): void => {
    const at = now();
    for (const [id, e] of messages) {
      if (isFinal(e)) {
        if (at - e.msg.updatedAt >= TWICC_KEEP_MS) messages.delete(id);
        continue;
      }
      const a = office.get(e.msg.agentId);
      if (!present(a)) finish(e, 'failed', at, ERR_TWICC_GONE);
      else if (e.msg.status === 'queued' && at - e.msg.createdAt >= TWICC_QUEUED_TIMEOUT_MS) finish(e, 'failed', at, ERR_TWICC_NOT_FETCHED);
      else if (e.msg.status === 'sent' && at - (e.sentAt ?? at) >= TWICC_SENT_TIMEOUT_MS) {
        finish(e, 'failed', at, ERR_TWICC_NOT_CONFIRMED);
        e.late = true;
      }
    }
    checkReach();
  };

  const timer = setInterval(() => {
    try {
      tick();
    } catch {
      // o relógio nunca derruba o servidor
    }
  }, opts.tickMs ?? 1_000);
  timer.unref?.();

  const fail = (res: ServerResponse, err: unknown): void => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else if (err instanceof InvalidRequest) sendJson(res, 400, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };

  return {
    reachable,
    poll,
    ack,
    tick,
    stop: () => clearInterval(timer),
    route(req, res, path) {
      if ((req.method ?? 'GET') !== 'POST') {
        req.resume();
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { error: tr('método não permitido') });
      }
      readJson(req)
        .then((body) => {
          if (path === TWICC_POLL_PATH) sendJson(res, 200, poll(body));
          else {
            ack(body);
            sendJson(res, 200, { ok: true });
          }
        })
        .catch((err) => fail(res, err));
    },
  };
}
