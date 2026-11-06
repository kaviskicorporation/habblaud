import { describe, expect, it } from 'vitest';
import type { Activity, AgentInfo, PermissionDecision, PermissionRequestInfo } from '../../shared/types';
import type { DecideResult } from '../permissions/registry';
import { attachTwiccApprovals, twiccAnswers, TWICC_APPROVALS_STALE_MS, TWICC_RESEND_MS, type KvPermissionRegistry } from './twicc-approvals';
import { applyWsMessage, decisionMessage, pendingOf, sessionCookie, twiccLocalUrl } from './twicc-approvals-bridge';
import type { TwiccPendingRequest } from './twicc-approvals';

const SESSION = '8a967c96-8aee-47dd-a2fa-5aa9839d134f';

function setup() {
  let t = 1_000_000;
  const agents: AgentInfo[] = [{ id: '.claude:1', kind: 'main', status: 'waiting', sessionId: SESSION, roomId: '/proj', name: 'Yuri' } as unknown as AgentInfo];
  const acts: Activity[] = [];
  let dirty = 0;
  const notices: string[] = [];
  const office = {
    list: () => agents,
    markDirty: () => void dirty++,
    addActivity: (_id: string, a: Activity) => void acts.push(a),
    noticePermission: (_id: string, what: string) => void notices.push(what),
  };
  const hookInfo = new Map<string, PermissionRequestInfo>();
  const registry: KvPermissionRegistry = {
    snapshot: () => new Map(hookInfo),
    detail: () => undefined,
    decide: (): DecideResult => 'not-found',
  };
  const kv = attachTwiccApprovals(registry, office, { now: () => t });
  return { kv, registry, acts, notices, hookInfo, agents, tick: (ms: number) => (t += ms), dirty: () => dirty };
}

const bash: Omit<TwiccPendingRequest, 'session'> = {
  request_id: 'r1',
  request_type: 'tool_approval',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  created_at: 999,
  permission_suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }] }],
};
const ask: Omit<TwiccPendingRequest, 'session'> = {
  request_id: 'q1',
  request_type: 'ask_user_question',
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Qual cor?', header: 'Cor', multiSelect: false, options: [{ label: 'Azul' }, { label: 'Verde' }] }] },
};

describe('pedidos das sessões do TwiCC', () => {
  it('põe a aprovação no agente e manda a decisão (com "sempre permitir") ao auxiliar', () => {
    const s = setup();
    expect(s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }] })).toEqual({ decisions: [] });
    const info = s.registry.snapshot().get('.claude:1')!;
    expect(info.id).toMatch(/^tw-/);
    expect(info.title).toContain('npm test');
    expect(info.suggestions?.[0].index).toBe(0);
    expect(info.input).toBeUndefined();
    expect(s.registry.detail(info.id)?.input).toContain('npm test');
    expect(s.notices).toHaveLength(1);
    expect(s.registry.decide(info.id, { behavior: 'allow', suggestion: 0 })).toBe('ok');
    expect(s.registry.decide(info.id, { behavior: 'deny' })).toBe('conflict');
    expect(s.registry.snapshot().size).toBe(0);
    const out = s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }] }).decisions;
    expect(out).toHaveLength(1);
    expect(out[0].payload).toEqual({ request_type: 'tool_approval', decision: 'allow', updated_permissions: [bash.permission_suggestions![0]] });
    // ainda listado: só manda de novo depois do prazo
    expect(s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }] }).decisions).toHaveLength(0);
    s.tick(TWICC_RESEND_MS);
    expect(s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }] }).decisions).toHaveLength(1);
    // o TwiCC deixou de listar: acabou
    expect(s.kv.round({ connected: true, requests: [] }).decisions).toHaveLength(0);
    expect(s.registry.detail(info.id)).toBeUndefined();
    expect(s.acts.map((a) => a.text)).toEqual(['Aprovado no Habblaud (sempre permitir)']);
  });

  it('recusa com motivo e devolve ao TwiCC ("Responder no terminal")', () => {
    const s = setup();
    s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }, { session: SESSION, ...bash, request_id: 'r2', created_at: 1_000 }] });
    const first = s.registry.snapshot().get('.claude:1')!;
    expect(first.queued).toBe(1);
    expect(s.registry.decide(first.id, { behavior: 'deny', message: 'agora não' })).toBe('ok');
    const second = s.registry.snapshot().get('.claude:1')!;
    expect(second.id).not.toBe(first.id);
    expect(s.registry.decide(second.id, { behavior: 'terminal' })).toBe('ok');
    expect(s.registry.snapshot().size).toBe(0);
    const out = s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }, { session: SESSION, ...bash, request_id: 'r2' }] }).decisions;
    expect(out.map((d) => d.payload)).toEqual([{ request_type: 'tool_approval', decision: 'deny', message: 'Recusado pelo usuário no Habblaud: agora não' }]);
  });

  it('responde perguntas pelo texto (e recusa vira "cancel")', () => {
    const s = setup();
    s.kv.round({ connected: true, requests: [{ session: SESSION, ...ask }] });
    const info = s.registry.snapshot().get('.claude:1')!;
    expect(info.questions?.[0].question).toBe('Qual cor?');
    expect(s.registry.decide(info.id, { behavior: 'allow' })).toBe('invalid-answer');
    expect(s.registry.decide(info.id, { behavior: 'answer', answers: [{ question: 0, options: [1] }] } as PermissionDecision)).toBe('ok');
    const out = s.kv.round({ connected: true, requests: [{ session: SESSION, ...ask }] }).decisions;
    expect(out[0].payload).toEqual({ request_type: 'ask_user_question', action: 'submit', answers: { 'Qual cor?': 'Verde' } });

    const s2 = setup();
    s2.kv.round({ connected: true, requests: [{ session: SESSION, ...ask }] });
    const id = s2.registry.snapshot().get('.claude:1')!.id;
    expect(s2.registry.decide(id, { behavior: 'deny' })).toBe('ok');
    expect(s2.kv.round({ connected: true, requests: [{ session: SESSION, ...ask }] }).decisions[0].payload).toEqual({ request_type: 'ask_user_question', action: 'cancel' });
  });

  it('ignora sessão sem agente, formulários de MCP e tudo quando desconectado ou sem auxiliar', () => {
    const s = setup();
    s.kv.round({ connected: true, requests: [{ session: '11111111-1111-1111-1111-111111111111', ...bash }, { session: SESSION, ...bash, tool_name: 'elicitationForm' }] });
    expect(s.registry.snapshot().size).toBe(0);
    s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }] });
    expect(s.registry.snapshot().size).toBe(1);
    s.tick(TWICC_APPROVALS_STALE_MS);
    expect(s.registry.snapshot().size).toBe(0);
    s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }] });
    expect(s.registry.snapshot().size).toBe(1);
    s.kv.round({ connected: false });
    expect(s.registry.snapshot().size).toBe(0);
  });

  it('pedido do hook (terminal) tem a vez; o do TwiCC conta na fila', () => {
    const s = setup();
    s.hookInfo.set('.claude:1', { id: 'p-1', tool: 'Bash', title: 'Bash(ls)', text: '', icon: '', createdAt: 1, expiresAt: 2 });
    s.kv.round({ connected: true, requests: [{ session: SESSION, ...bash }] });
    const info = s.registry.snapshot().get('.claude:1')!;
    expect(info.id).toBe('p-1');
    expect(info.queued).toBe(1);
  });

  it('twiccAnswers junta múltipla escolha e texto livre', () => {
    const qs = [{ question: 'Quais?', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }];
    expect(twiccAnswers(qs, [{ question: 0, options: [0, 2], other: 'D' }])).toEqual({ 'Quais?': 'A, C, D' });
    expect(twiccAnswers(qs, [{ question: 0, options: [7] }])).toBeUndefined();
  });
});

describe('auxiliar: WebSocket do TwiCC', () => {
  it('lê active_processes e process_state', () => {
    const m = new Map<string, TwiccPendingRequest[]>();
    const proc = { session_id: SESSION.toUpperCase(), provider: 'claude_code', state: 'assistant_turn', pending_requests: [{ request_id: 'r1', request_type: 'tool_approval', tool_name: 'Bash', tool_input: { command: 'ls' }, created_at: 5 }] };
    expect(applyWsMessage(m, JSON.stringify({ type: 'active_processes', processes: [proc, { session_id: 'x' }] }))).toBe('ready');
    expect(m.get(SESSION)?.[0].request_id).toBe('r1');
    applyWsMessage(m, JSON.stringify({ type: 'process_state', ...proc, pending_requests: undefined }));
    expect(m.size).toBe(0);
    expect(pendingOf({ ...proc, provider: 'codex' })?.requests).toEqual([]);
    expect(applyWsMessage(m, '{"type": "auth_failure"}')).toBe('auth');
    expect(applyWsMessage(m, 'não é json')).toBeUndefined();
  });

  it('monta a resposta, acha o cookie e o endereço', () => {
    expect(decisionMessage({ id: 'tw-1', session: SESSION, request_id: 'r1', payload: { request_type: 'tool_approval', decision: 'allow' } })).toEqual({
      type: 'claude_code:pending_request_response',
      session_id: SESSION,
      request_id: 'r1',
      request_type: 'tool_approval',
      decision: 'allow',
    });
    expect(sessionCookie(['csrftoken=a; Path=/', 'twicc_sessionid=xyz; HttpOnly; Path=/'])).toBe('twicc_sessionid=xyz');
    expect(sessionCookie(['twicc_sessionid=; Max-Age=0'])).toBeUndefined();
    expect(twiccLocalUrl({}, () => '{"port": 3500}')).toBe('http://127.0.0.1:3500');
    expect(twiccLocalUrl({ HABBLAUD_TWICC_LOCAL_URL: 'http://127.0.0.1:9/' }, () => '')).toBe('http://127.0.0.1:9');
    expect(twiccLocalUrl({}, () => 'x')).toBeUndefined();
  });
});
