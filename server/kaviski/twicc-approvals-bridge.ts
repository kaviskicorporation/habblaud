// Fork Kaviski (KAVISKI.md): a parte do auxiliar do host (npm run codex:bridge) que leva ao escritório os pedidos das
// sessões do TwiCC (perguntas, aprovação de ferramenta e de plano) e devolve a resposta dada lá
// (kaviski/twicc-approvals.ts). O CLI do TwiCC só responde perguntas; aprovar, só quem entrou com a senha. Então o
// auxiliar entra no TwiCC como a página dele faz: POST /api/auth/login/ com a senha e o WebSocket /ws/ com o cookie.
//
// - Senha: o arquivo HABBLAUD_TWICC_PASSWORD_FILE ou ~/.habblaud/twicc-senha (fora do git, permissão 600). Sem ele, não
//   faz nada (olha de novo a cada 30 s). Nunca vai para a tela, para o log nem para o Habblaud.
// - TwiCC: HABBLAUD_TWICC_LOCAL_URL ou a porta de <TWICC_DATA_DIR ou ~/.twicc>/twicc.info.json, sempre em 127.0.0.1.
// - Pedidos: os `pending_requests` de cada sessão do Claude Code, das mensagens active_processes/process_state do
//   WebSocket (sessões ocultas no TwiCC não aparecem nelas: os pedidos delas continuam só no TwiCC).
// - A cada rodada (1,5 s) manda a lista a POST /api/host/twicc/requests e entrega as decisões que voltam como
//   `claude_code:pending_request_response` (o mesmo que a página do TwiCC manda).
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tr } from '../../shared/i18n';
import type { TwiccDecisionOut, TwiccPendingRequest } from './twicc-approvals';

export const APPROVALS_ROUND_MS = 1_500;
export const APPROVALS_IDLE_MS = 30_000;
export const APPROVALS_REFUSED_RETRY_MS = 60_000;
/** Senha recusada: não insiste (o TwiCC bloqueia depois de 5 tentativas em 5 min), a não ser que o arquivo mude. */
export const WRONG_PASSWORD_RETRY_MS = 10 * 60_000;
const RECONNECT_MS = 3_000;
const LOGIN_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Post = (path: string, body: unknown) => Promise<{ status: number; json: unknown } | null>;
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);

export function passwordFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.HABBLAUD_TWICC_PASSWORD_FILE?.trim() || join(homedir(), '.habblaud', 'twicc-senha');
}

/** Endereço local do TwiCC (sem barra no fim), ou undefined. */
export function twiccLocalUrl(env: NodeJS.ProcessEnv = process.env, read: (p: string) => string = (p) => readFileSync(p, 'utf8')): string | undefined {
  const explicit = env.HABBLAUD_TWICC_LOCAL_URL?.trim();
  if (explicit) return /^https?:\/\/[^\s/]+$/.test(explicit.replace(/\/+$/, '')) ? explicit.replace(/\/+$/, '') : undefined;
  try {
    const port = rec(JSON.parse(read(join(env.TWICC_DATA_DIR?.trim() || join(homedir(), '.twicc'), 'twicc.info.json'))))?.port;
    return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65_536 ? `http://127.0.0.1:${port}` : undefined;
  } catch {
    return undefined;
  }
}

/** Os pedidos de um processo do TwiCC (só Claude Code e sessão viva). */
export function pendingOf(proc: unknown): { session: string; requests: TwiccPendingRequest[] } | undefined {
  const p = rec(proc);
  const session = typeof p?.session_id === 'string' && UUID.test(p.session_id) ? p.session_id.toLowerCase() : undefined;
  if (!p || !session) return undefined;
  const requests: TwiccPendingRequest[] = [];
  if (p.provider === 'claude_code' && p.state !== 'dead' && Array.isArray(p.pending_requests)) {
    for (const raw of p.pending_requests) {
      const r = rec(raw);
      if (!r || typeof r.request_id !== 'string' || typeof r.request_type !== 'string' || typeof r.tool_name !== 'string') continue;
      const req: TwiccPendingRequest = { session, request_id: r.request_id, request_type: r.request_type, tool_name: r.tool_name, tool_input: rec(r.tool_input) ?? {} };
      if (typeof r.created_at === 'number') req.created_at = r.created_at;
      if (Array.isArray(r.permission_suggestions)) req.permission_suggestions = r.permission_suggestions;
      if (typeof r.auto_deny_in_seconds === 'number') req.auto_deny_in_seconds = r.auto_deny_in_seconds;
      requests.push(req);
    }
  }
  return { session, requests };
}

/**
 * Aplica uma mensagem do WebSocket do TwiCC aos pedidos por sessão. Devolve 'auth' (não entrou), 'ready' (a lista
 * inteira chegou: active_processes) ou undefined.
 */
export function applyWsMessage(pending: Map<string, TwiccPendingRequest[]>, raw: string): 'auth' | 'ready' | undefined {
  let msg: Rec | undefined;
  try {
    msg = rec(JSON.parse(raw));
  } catch {
    return undefined;
  }
  if (!msg) return undefined;
  if (msg.type === 'auth_failure') return 'auth';
  if (msg.type === 'active_processes' && Array.isArray(msg.processes)) {
    pending.clear();
    for (const proc of msg.processes) {
      const x = pendingOf(proc);
      if (x?.requests.length) pending.set(x.session, x.requests);
    }
    return 'ready';
  }
  if (msg.type === 'process_state') {
    const x = pendingOf(msg);
    if (!x) return undefined;
    if (x.requests.length) pending.set(x.session, x.requests);
    else pending.delete(x.session);
  }
  return undefined;
}

/** A mensagem do WebSocket que entrega uma decisão (a mesma da página do TwiCC). */
export function decisionMessage(d: TwiccDecisionOut): Rec {
  return { type: 'claude_code:pending_request_response', session_id: d.session, request_id: d.request_id, ...d.payload };
}

/** O cookie de sessão nos Set-Cookie do login ("nome=valor"). */
export function sessionCookie(setCookies: string[]): string | undefined {
  for (const c of setCookies) {
    const first = c.split(';')[0]?.trim();
    if (first && /sessionid=/i.test(first) && !/=$/.test(first)) return first;
  }
  return undefined;
}

type LoginResult = { cookie: string } | { error: 'wrong' | 'limited' | 'down' | 'no-password-set' };

async function login(base: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${base}/api/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
    await res.text().catch(() => '');
    if (res.status === 401) return { error: 'wrong' };
    if (res.status === 429) return { error: 'limited' };
    if (res.status === 400) return { error: 'no-password-set' };
    const cookie = res.ok ? sessionCookie(res.headers.getSetCookie()) : undefined;
    return cookie ? { cookie } : { error: 'down' };
  } catch {
    return { error: 'down' };
  }
}

function readPassword(path: string): { password: string; mtime: number } | undefined {
  try {
    const password = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    return password ? { password, mtime: statSync(path).mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

/** Laço do auxiliar (chamado pelo scripts/codex-bridge.ts). Nunca termina. */
export async function twiccApprovalsLoop(post: Post, log: (line: string) => void, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const file = passwordFile(env);
  const pending = new Map<string, TwiccPendingRequest[]>();
  let cookie: string | undefined;
  let ws: WebSocket | undefined;
  let ready = false;
  let wrongMtime: number | undefined;
  let waitUntil = 0;
  let last = '';
  const say = (state: string): void => {
    if (state !== last) log(state);
    last = state;
  };
  const close = (): void => {
    ready = false;
    pending.clear();
    try {
      ws?.close();
    } catch {
      // já fechado
    }
    ws = undefined;
  };

  const connect = (base: string, c: string): void => {
    const url = `${base.replace(/^http/, 'ws')}/ws/?subscribe=active_processes,process_state`;
    const sock = new WebSocket(url, { headers: { Cookie: c, Origin: base } } as unknown as string[]);
    ws = sock;
    sock.onmessage = (ev) => {
      const r = applyWsMessage(pending, typeof ev.data === 'string' ? ev.data : String(ev.data));
      if (r === 'ready') {
        ready = true;
        say(tr('TwiCC: os pedidos das sessões do TwiCC (perguntas e aprovações) aparecem no escritório.'));
      } else if (r === 'auth') {
        cookie = undefined;
        say(tr('TwiCC: a sessão do auxiliar expirou; entrando de novo.'));
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = undefined;
      ready = false;
      pending.clear();
      waitUntil = Date.now() + RECONNECT_MS;
    };
    sock.onerror = () => {};
  };

  for (;;) {
    let pause = APPROVALS_ROUND_MS;
    const secret = readPassword(file);
    const base = twiccLocalUrl(env);
    if (!secret) {
      close();
      cookie = undefined;
      say(tr('TwiCC: sem o arquivo da senha ({0}): pedidos das sessões do TwiCC só no TwiCC.', [file]));
      pause = APPROVALS_IDLE_MS;
    } else if (!base) {
      close();
      say(tr('TwiCC: não achei o endereço local (twicc.info.json ou HABBLAUD_TWICC_LOCAL_URL).'));
      pause = APPROVALS_IDLE_MS;
    } else if (Date.now() >= waitUntil && !ws) {
      if (!cookie && (wrongMtime === undefined || wrongMtime !== secret.mtime)) {
        const r = await login(base, secret.password);
        if ('cookie' in r) {
          cookie = r.cookie;
          wrongMtime = undefined;
        } else if (r.error === 'wrong') {
          wrongMtime = secret.mtime;
          waitUntil = Date.now() + WRONG_PASSWORD_RETRY_MS;
          say(tr('TwiCC: a senha do arquivo {0} foi recusada (confira e grave de novo).', [file]));
        } else if (r.error === 'limited') {
          waitUntil = Date.now() + 5 * 60_000;
          say(tr('TwiCC: tentativas de login demais; espero 5 min.'));
        } else if (r.error === 'no-password-set') {
          waitUntil = Date.now() + WRONG_PASSWORD_RETRY_MS;
          say(tr('TwiCC: este TwiCC não tem senha; a aprovação pelo escritório precisa dela.'));
        } else waitUntil = Date.now() + RECONNECT_MS * 5;
      }
      if (cookie && !ws) connect(base, cookie);
    }
    if (secret && base) {
      const r = await post('/api/host/twicc/requests', { connected: ready, requests: ready ? [...pending.values()].flat() : [] });
      const j = rec(r?.json);
      if (r && (r.status === 404 || r.status === 403)) {
        close();
        say(tr('TwiCC: o Habblaud não aceita os pedidos das sessões do TwiCC ({0}).', [r.status]));
        pause = APPROVALS_REFUSED_RETRY_MS;
      } else if (r?.status === 200 && j && Array.isArray(j.decisions) && ws && ready) {
        for (const raw of j.decisions) {
          const d = rec(raw) as unknown as TwiccDecisionOut | undefined;
          if (!d || typeof d.session !== 'string' || typeof d.request_id !== 'string' || !rec(d.payload)) continue;
          try {
            ws.send(JSON.stringify(decisionMessage(d)));
            log(tr('✓ resposta do escritório entregue à sessão {0}… do TwiCC', [d.session.slice(0, 8)]));
          } catch {
            // o WebSocket caiu: a decisão volta na próxima rodada
          }
        }
      }
    }
    await new Promise((ok) => setTimeout(ok, pause));
  }
}
