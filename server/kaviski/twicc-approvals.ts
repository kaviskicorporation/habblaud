// Fork Kaviski (KAVISKI.md): aprovar pelo escritório os pedidos das sessões que rodam no TwiCC (perguntas do
// AskUserQuestion, aprovação de ferramenta e de plano). Essas sessões rodam pelo SDK: o hook PermissionRequest do
// plugin habblaud-permissoes nunca roda nelas, e o pedido fica esperando só na página do TwiCC.
//
// Quem fala com o TwiCC é o auxiliar do host (npm run codex:bridge, server/kaviski/twicc-approvals-bridge.ts): ele entra
// no TwiCC com a senha (arquivo fora do git), acompanha os pedidos pendentes pelo WebSocket dele e, a cada rodada:
//
//   POST /api/host/twicc/requests  {connected: boolean, requests?: [{session, request_id, request_type, tool_name,
//        tool_input, created_at, permission_suggestions?, auto_deny_in_seconds?}]}
//     -> 200 {decisions: [{id, session, request_id, payload}]}
//
// Cada pedido vira um PermissionRequestInfo do agente da sessão (id "tw-..."), no mesmo cartão "pede permissão" do
// original: aprovar, recusar com motivo, "sempre permitir" (as sugestões do próprio Claude Code), responder as
// perguntas, ou deixar para o TwiCC ("Responder no terminal"). O registro original (server/permissions/registry.ts)
// não é tocado: o fork embrulha snapshot/detail/decide dele em tempo de execução, como twicc-messages.ts faz com o
// registro de mensagens; a rota /api/permissions/:id/decision (e a trava de quem pode responder) é a mesma.
// O pedido some quando o TwiCC deixa de listá-lo (respondido aqui, lá, ou o agente saiu).
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Activity, AgentInfo, PermissionAnswer, PermissionDecision, PermissionRequestInfo } from '../../shared/types';
import { describeTool } from '../../shared/activity';
import { answerSummary, ASK_TOOL, checkAnswers } from '../../shared/answers';
import { tr } from '../../shared/i18n';
import { HttpError, readJson, sendJson } from '../http/app';
import { pickSuggestions, type DecideResult } from '../permissions/registry';
import { toolView } from '../sources/terminal';

export const TWICC_REQUESTS_PATH = '/api/host/twicc/requests';
/** Decisão mandada e ainda listada pelo TwiCC depois deste tempo: manda de novo. */
export const TWICC_RESEND_MS = 10_000;
/** Sem rodada do auxiliar há este tempo: os pedidos voltam a valer só no TwiCC. */
export const TWICC_APPROVALS_STALE_MS = 15_000;
/** Sem prazo do TwiCC: o cartão mostra este (só informativo; quem decide o fim é o TwiCC). */
const DEFAULT_EXPIRY_MS = 24 * 60 * 60_000;
const MAX_REQUESTS = 64;
const MAX_MESSAGE = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Formulários de MCP (elicitation): ficam no TwiCC. */
const ELICITATION = new Set(['elicitationForm', 'elicitationUrl']);

/** O pedaço do PermissionRegistry que o fork embrulha. */
export interface KvPermissionRegistry {
  snapshot(): Map<string, PermissionRequestInfo>;
  detail(id: string): PermissionRequestInfo | undefined;
  decide(id: string, d: PermissionDecision): DecideResult;
}

/** O pedaço do Office que o fork usa. */
export interface KvApprovalsOffice {
  list(): AgentInfo[];
  markDirty(): void;
  addActivity(id: string, activity: Activity, current: boolean): void;
  noticePermission?(id: string, what: string, kind?: 'permission' | 'question'): void;
}

/** Pedido como o auxiliar manda (o process_state do TwiCC). */
export interface TwiccPendingRequest {
  session: string;
  request_id: string;
  request_type: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  created_at?: number;
  permission_suggestions?: unknown[];
  auto_deny_in_seconds?: number;
}

/** O que o auxiliar manda ao TwiCC (o resto da mensagem claude_code:pending_request_response). */
export type TwiccPayload =
  | { request_type: 'tool_approval'; decision: 'allow'; updated_permissions?: unknown[] }
  | { request_type: 'tool_approval'; decision: 'deny'; message: string }
  | { request_type: 'ask_user_question'; action: 'submit'; answers: Record<string, string> }
  | { request_type: 'ask_user_question'; action: 'cancel' };

export interface TwiccDecisionOut {
  id: string;
  session: string;
  request_id: string;
  payload: TwiccPayload;
}

interface Entry {
  info: PermissionRequestInfo;
  agentId: string;
  session: string;
  requestId: string;
  question: boolean;
  /** tool_input.questions original (as respostas voltam por posição e vão ao TwiCC pelo texto). */
  rawQuestions: unknown[];
  rawSuggestions: unknown[];
  payload?: TwiccPayload;
  sentAt?: number;
  /** "Responder no terminal": some do escritório, vale o TwiCC. */
  dismissed?: boolean;
}

export interface KvTwiccApprovals {
  route(req: IncomingMessage, res: ServerResponse): void;
  /** Rodada do auxiliar (exposta para os testes). */
  round(raw: unknown): { decisions: TwiccDecisionOut[] };
  /** Pedidos em aberto por agente (o mais antigo), para o snapshot. */
  snapshot(): Map<string, PermissionRequestInfo>;
  detail(id: string): PermissionRequestInfo | undefined;
  /** undefined = o pedido não é do TwiCC. */
  decide(id: string, d: PermissionDecision): DecideResult | undefined;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const present = (a: AgentInfo | undefined): a is AgentInfo => !!a && a.status !== 'offline' && a.status !== 'done';
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);

/** Valida a lista do auxiliar (o que não serve é pulado). */
export function parseRequests(raw: unknown): TwiccPendingRequest[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'esperado {connected, requests: [{session, request_id, request_type, tool_name, tool_input}]}');
  const out: TwiccPendingRequest[] = [];
  for (const item of raw.slice(0, MAX_REQUESTS)) {
    const r = rec(item);
    const session = str(r?.session, 64);
    const requestId = str(r?.request_id, 200);
    const type = str(r?.request_type, 64);
    const tool = str(r?.tool_name, 200);
    if (!r || !session || !UUID.test(session) || !requestId || !type || !tool) continue;
    const req: TwiccPendingRequest = { session: session.toLowerCase(), request_id: requestId, request_type: type, tool_name: tool, tool_input: rec(r.tool_input) ?? {} };
    if (typeof r.created_at === 'number' && Number.isFinite(r.created_at)) req.created_at = r.created_at;
    if (Array.isArray(r.permission_suggestions)) req.permission_suggestions = r.permission_suggestions;
    if (typeof r.auto_deny_in_seconds === 'number' && Number.isFinite(r.auto_deny_in_seconds)) req.auto_deny_in_seconds = r.auto_deny_in_seconds;
    out.push(req);
  }
  return out;
}

/**
 * Respostas do escritório (por posição) no formato da página do TwiCC: {texto da pergunta: rótulo}, com as opções de
 * uma pergunta de múltipla escolha juntas por ", " (como a página do TwiCC faz) e o texto livre no fim.
 */
export function twiccAnswers(rawQuestions: unknown[], answers: PermissionAnswer[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const a of answers) {
    const q = rec(rawQuestions[a.question]);
    const text = typeof q?.question === 'string' ? q.question : undefined;
    if (!q || !text) return undefined;
    const options = Array.isArray(q.options) ? q.options : [];
    const labels: string[] = [];
    for (const i of a.options ?? []) {
      const label = rec(options[i])?.label;
      if (typeof label !== 'string') return undefined;
      labels.push(label);
    }
    if (a.other) labels.push(a.other);
    if (!labels.length) return undefined;
    out[text] = labels.join(', ');
  }
  return out;
}

export function attachTwiccApprovals(registry: KvPermissionRegistry, office: KvApprovalsOffice, opts: { now?: () => number } = {}): KvTwiccApprovals {
  const now = opts.now ?? Date.now;
  /** Por `${session}:${request_id}`. */
  const entries = new Map<string, Entry>();
  const byId = new Map<string, Entry>();
  let seenAt: number | undefined;

  const orig = {
    snapshot: registry.snapshot.bind(registry),
    detail: registry.detail.bind(registry),
    decide: registry.decide.bind(registry),
  };

  const live = (): boolean => seenAt !== undefined && now() - seenAt < TWICC_APPROVALS_STALE_MS;
  const open = (e: Entry): boolean => !e.payload && !e.dismissed;

  const drop = (key: string, e: Entry): void => {
    entries.delete(key);
    byId.delete(e.info.id);
  };

  /** Principal presente da sessão (as sessões do TwiCC são sempre o principal: subagentes não pedem por ele). */
  const agentOf = (session: string): AgentInfo | undefined =>
    office.list().find((a) => a.kind === 'main' && present(a) && a.sessionId.toLowerCase() === session);

  const create = (r: TwiccPendingRequest, agent: AgentInfo): Entry | undefined => {
    const question = r.request_type === 'ask_user_question' && r.tool_name === ASK_TOOL;
    if (!question && r.request_type !== 'tool_approval') return undefined;
    if (ELICITATION.has(r.tool_name)) return undefined;
    const desc = describeTool(r.tool_name, r.tool_input);
    const rawQuestions = Array.isArray(r.tool_input.questions) ? r.tool_input.questions : [];
    const questions = desc.questions;
    // Pergunta: todas precisam aparecer no escritório (a resposta tem de cobrir cada uma).
    const asked = rawQuestions.filter((q) => typeof rec(q)?.question === 'string' && !!String(rec(q)!.question).trim()).length;
    if (question && (!questions?.length || questions.length !== asked)) return undefined;
    const at = now();
    const createdAt = r.created_at ? Math.min(at, Math.round(r.created_at * 1_000)) : at;
    // A sala é a pasta do projeto: os caminhos aparecem relativos a ela.
    const view = toolView(r.tool_name, r.tool_input, agent.roomId.startsWith('/') ? agent.roomId : undefined);
    const id = `tw-${at.toString(36)}-${randomBytes(9).toString('base64url')}`;
    const expiresAt = r.auto_deny_in_seconds !== undefined ? at + Math.max(0, r.auto_deny_in_seconds) * 1_000 : at + DEFAULT_EXPIRY_MS;
    const info: PermissionRequestInfo = { id, tool: r.tool_name, title: view.title, text: desc.text, icon: desc.icon, createdAt, expiresAt };
    if (agent.provider) info.provider = agent.provider;
    if (view.input) info.input = view.input;
    if (view.inputKind) info.inputKind = view.inputKind;
    const suggestions = question ? [] : pickSuggestions(r.permission_suggestions);
    if (suggestions.length) info.suggestions = suggestions;
    if (question) info.questions = questions;
    return { info, agentId: agent.id, session: r.session, requestId: r.request_id, question, rawQuestions, rawSuggestions: r.permission_suggestions ?? [] };
  };

  const round = (raw: unknown): { decisions: TwiccDecisionOut[] } => {
    const r = rec(raw);
    if (!r || typeof r.connected !== 'boolean') throw new HttpError(400, 'esperado {connected: boolean, requests?: [...]}');
    const at = now();
    seenAt = at;
    let changed = false;
    // Desconectado do TwiCC: nada é confiável, os pedidos voltam a valer só lá.
    const list = r.connected ? parseRequests(r.requests ?? []) : [];
    const keep = new Set<string>();
    for (const req of list) {
      const key = `${req.session}:${req.request_id}`;
      keep.add(key);
      if (entries.has(key)) continue;
      const agent = agentOf(req.session);
      if (!agent) continue;
      const e = create(req, agent);
      if (!e) continue;
      entries.set(key, e);
      byId.set(e.info.id, e);
      changed = true;
      office.noticePermission?.(e.agentId, e.info.title, e.question ? 'question' : 'permission');
    }
    for (const [key, e] of entries) {
      if (keep.has(key)) continue;
      if (open(e)) changed = true;
      drop(key, e);
    }
    if (changed) office.markDirty();
    const decisions: TwiccDecisionOut[] = [];
    for (const e of entries.values()) {
      if (!e.payload || (e.sentAt !== undefined && at - e.sentAt < TWICC_RESEND_MS)) continue;
      e.sentAt = at;
      decisions.push({ id: e.info.id, session: e.session, request_id: e.requestId, payload: e.payload });
    }
    return { decisions };
  };

  const snapshot = (): Map<string, PermissionRequestInfo> => {
    const out = new Map<string, PermissionRequestInfo>();
    if (!live()) return out;
    const counts = new Map<string, number>();
    const agents = new Set(office.list().filter(present).map((a) => a.id));
    for (const e of entries.values()) {
      if (!open(e) || !agents.has(e.agentId)) continue;
      counts.set(e.agentId, (counts.get(e.agentId) ?? 0) + 1);
      const prev = out.get(e.agentId);
      if (prev && prev.createdAt <= e.info.createdAt) continue;
      const { input: _input, inputKind: _kind, ...info } = e.info;
      out.set(e.agentId, info);
    }
    for (const [agentId, info] of out) {
      const n = (counts.get(agentId) ?? 1) - 1;
      if (n > 0) info.queued = n;
    }
    return out;
  };

  const detail = (id: string): PermissionRequestInfo | undefined => {
    const e = byId.get(id);
    return e && open(e) && live() ? { ...e.info } : undefined;
  };

  const activity = (e: Entry, a: Omit<Activity, 'id' | 'at' | 'tool'>, tag: string): void =>
    office.addActivity(e.agentId, { id: `${e.agentId}#${tag}:${e.info.id}`, at: now(), tool: 'PermissionRequest', ...a }, false);

  const decide = (id: string, d: PermissionDecision): DecideResult | undefined => {
    const e = byId.get(id);
    if (!e) return undefined;
    if (!live()) return 'not-found';
    if (!open(e)) return 'conflict';
    if (d.behavior === 'terminal') {
      e.dismissed = true;
      office.markDirty();
      return 'ok';
    }
    if (e.question) {
      if (d.behavior === 'allow') return 'invalid-answer';
      if (d.behavior === 'deny') {
        e.payload = { request_type: 'ask_user_question', action: 'cancel' };
        activity(e, { kind: 'wait', icon: '🚫', text: tr('Recusado no Habblaud'), detail: e.info.title }, 'perm-no');
      } else {
        const questions = e.info.questions ?? [];
        const answers = checkAnswers(questions, d.answers);
        const mapped = answers && twiccAnswers(e.rawQuestions, answers);
        if (!answers || !mapped) return 'invalid-answer';
        e.payload = { request_type: 'ask_user_question', action: 'submit', answers: mapped };
        activity(e, { kind: 'other', icon: '💬', text: tr('Respondido no Habblaud'), detail: answerSummary(questions, answers) }, 'perm-answer');
      }
    } else if (d.behavior === 'answer') return 'invalid-answer';
    else if (d.behavior === 'allow') {
      if (d.suggestion !== undefined && !e.info.suggestions?.some((s) => s.index === d.suggestion)) return 'invalid';
      const rule = d.suggestion !== undefined ? rec(e.rawSuggestions[d.suggestion]) : undefined;
      e.payload = { request_type: 'tool_approval', decision: 'allow', ...(rule ? { updated_permissions: [rule] } : {}) };
      activity(e, { kind: 'other', icon: '✅', text: rule ? tr('Aprovado no Habblaud (sempre permitir)') : tr('Aprovado no Habblaud'), detail: e.info.title }, 'perm-ok');
    } else {
      const message = d.message?.trim().slice(0, MAX_MESSAGE);
      e.payload = { request_type: 'tool_approval', decision: 'deny', message: message ? `Recusado pelo usuário no Voxtrin: ${message}` : 'Recusado pelo usuário no Voxtrin.' };
      activity(e, { kind: 'wait', icon: '🚫', text: tr('Recusado no Habblaud'), detail: message ? `${e.info.title} — ${message}` : e.info.title }, 'perm-no');
    }
    office.markDirty();
    return 'ok';
  };

  // ---------------------------------------------------------------- embrulho do registro original

  registry.snapshot = () => {
    const out = orig.snapshot();
    // Um pedido por agente no cartão: o do hook (terminal) tem a vez; o do TwiCC conta na fila.
    for (const [agentId, info] of snapshot()) {
      const mine = out.get(agentId);
      if (!mine) out.set(agentId, info);
      else mine.queued = (mine.queued ?? 0) + 1 + (info.queued ?? 0);
    }
    return out;
  };
  registry.detail = (id) => detail(id) ?? orig.detail(id);
  registry.decide = (id, d) => decide(id, d) ?? orig.decide(id, d);

  return {
    round,
    snapshot,
    detail,
    decide,
    route(req, res) {
      if ((req.method ?? 'GET') !== 'POST') {
        req.resume();
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { error: tr('método não permitido') });
      }
      readJson(req)
        .then((body) => sendJson(res, 200, round(body)))
        .catch((err) => {
          if (res.headersSent) return void res.destroy();
          if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
          else sendJson(res, 500, { error: tr('erro interno') });
        });
    },
  };
}
