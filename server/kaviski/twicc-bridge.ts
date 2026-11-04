// Fork Kaviski (KAVISKI.md): a parte do auxiliar do host (npm run codex:bridge) que entrega as mensagens do escritório
// às sessões do TwiCC. Roda no HOST, com tsx (é onde está o CLI `twicc`). A cada 2 s pergunta ao Habblaud
// (POST /api/host/twicc/poll, ver kaviski/twicc-messages.ts); quando o Habblaud tem agentes candidatos (`want`), relê no
// máximo a cada 20 s a lista das sessões que o TwiCC está rodando (`twicc sessions --active --include-hidden`) e a manda
// na rodada seguinte (`live`). Cada mensagem vai por `twicc send-message --no-expand -- <session_id> <texto>` (sem
// shell; --no-expand: um "@@/caminho" no texto nunca vira o conteúdo de um arquivo; sem --wait-reply) e o resultado volta
// em POST /api/host/twicc/ack. O texto nunca vai para a tela nem para o log.
//
// Binário: HABBLAUD_TWICC_BIN ou `twicc` do PATH. Sem ele, ou com o recurso desligado no Habblaud (404/403), não faz nada
// (pergunta de novo a cada minuto).
import { execFile, type ExecFileException } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { tr } from '../../shared/i18n';

export const TWICC_POLL_MS = 2_000;
/** Releitura da lista de sessões vivas do TwiCC (o CLI leva ~3 s de CPU). */
export const TWICC_LIST_MS = 20_000;
export const TWICC_REFUSED_RETRY_MS = 60_000;
const LIST_TIMEOUT_MS = 30_000;
const SEND_TIMEOUT_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Post = (path: string, body: unknown) => Promise<{ status: number; json: unknown } | null>;
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);

function canExecute(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** HABBLAUD_TWICC_BIN, `twicc` do PATH ou ~/.local/bin/twicc (onde o uv o instala). */
export function findTwiccBin(env: NodeJS.ProcessEnv = process.env, isExecutable: (p: string) => boolean = canExecute): string | undefined {
  const explicit = env.HABBLAUD_TWICC_BIN?.trim();
  if (explicit) return isExecutable(explicit) ? explicit : undefined;
  const dirs = [...(env.PATH ?? '').split(delimiter), join(homedir(), '.local', 'bin')];
  for (const dir of dirs) {
    if (!dir || !isAbsolute(dir)) continue;
    const p = join(dir, 'twicc');
    if (isExecutable(p)) return p;
  }
  return undefined;
}

/** Argumentos do send-message (o "--" garante que um texto que começa com "-" nunca vira opção). */
export function sendArgs(session: string, text: string): string[] {
  return ['send-message', '--no-expand', '--', session, text];
}

export interface TwiccCli {
  /** Ids (minúsculos) das sessões que o TwiCC está rodando agora; null = não deu para ler. */
  live(): Promise<string[] | null>;
  send(session: string, text: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

function run(bin: string, args: string[], timeout: number): Promise<{ err: ExecFileException | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    try {
      execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => done({ err, stdout, stderr }));
    } catch (err) {
      done({ err: err as ExecFileException, stdout: '', stderr: '' });
    }
  });
}

/** Ids das sessões vivas na saída JSON de `twicc sessions` ({items: [{id, process: {state}}]}). */
export function liveIds(json: unknown): string[] {
  const items = rec(json)?.items;
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const it of items) {
    const r = rec(it);
    const id = r?.id;
    const state = rec(r?.process)?.state;
    if (typeof id === 'string' && UUID.test(id) && typeof state === 'string' && state !== 'dead') out.push(id.toLowerCase());
  }
  return out;
}

/** Primeira linha útil de um erro do CLI (o JSON {error} ou o stderr), cortada. */
export function cliError(stdout: string, stderr: string): string | undefined {
  for (const text of [stdout, stderr]) {
    try {
      const j = rec(JSON.parse(text));
      const e = j?.error ?? rec(j?.result)?.error;
      if (typeof e === 'string' && e.trim()) return e.trim().slice(0, 300);
      if (rec(e) && typeof rec(e)!.message === 'string') return String(rec(e)!.message).slice(0, 300);
    } catch {
      // não é JSON
    }
  }
  const line = `${stderr}\n${stdout}`.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 300) : undefined;
}

export function createTwiccCli(bin: string): TwiccCli {
  return {
    async live() {
      const r = await run(bin, ['sessions', '--active', '--include-hidden', '--limit', '500'], LIST_TIMEOUT_MS);
      if (r.err) return null;
      try {
        return liveIds(JSON.parse(r.stdout));
      } catch {
        return null;
      }
    },
    async send(session, text) {
      if (!UUID.test(session)) return { ok: false, error: tr('id de sessão do TwiCC inválido') };
      const r = await run(bin, sendArgs(session, text), SEND_TIMEOUT_MS);
      if (!r.err) return { ok: true };
      if (r.err.killed) return { ok: false, error: tr('o twicc send-message não respondeu em {0} s (a mensagem pode ter chegado mesmo assim)', [SEND_TIMEOUT_MS / 1000]) };
      if (r.err.code === 'ENOENT' || r.err.code === 'EACCES') return { ok: false, error: tr('não consegui rodar o TwiCC ({0})', [bin]) };
      if (typeof r.err.code !== 'number' && r.err.code) return { ok: false, error: tr('a mensagem tem caracteres que não dá para mandar ao TwiCC') };
      return { ok: false, error: cliError(r.stdout, r.stderr) ?? tr('o twicc send-message falhou (código {0})', [String(r.err.code ?? '?')]) };
    },
  };
}

export type TwiccRound = { state: 'down' } | { state: 'refused'; status: number } | { state: 'ok'; sent: number; want: number };

/** Estado entre as rodadas: a lista de vivas e quando foi lida. */
export interface TwiccBridgeState {
  live?: string[];
  liveAt: number;
  /** Lista nova ainda não mandada ao Habblaud. */
  fresh: boolean;
  want: number;
}

/** Uma rodada: manda a lista (se nova), entrega as mensagens na ordem e confirma cada uma. Nunca lança. */
export async function twiccRound(post: Post, cli: TwiccCli, st: TwiccBridgeState, log: (line: string) => void = () => {}, now: () => number = Date.now): Promise<TwiccRound> {
  // Releitura da lista: só quando o Habblaud tem candidatas (ou na primeira vez) e no máximo a cada TWICC_LIST_MS.
  if ((st.want > 0 || st.live === undefined) && now() - st.liveAt >= TWICC_LIST_MS) {
    st.liveAt = now();
    const ids = await cli.live();
    if (ids) {
      st.live = ids;
      st.fresh = true;
    }
  }
  const body: Rec = {};
  if (st.fresh && st.live) body.live = st.live;
  const polled = await post('/api/host/twicc/poll', body);
  if (!polled) return { state: 'down' };
  const j = rec(polled.json);
  if (polled.status !== 200 || !j || !Array.isArray(j.messages)) return { state: 'refused', status: polled.status };
  st.fresh = false;
  st.want = Array.isArray(j.want) ? j.want.length : 0;
  let sent = 0;
  for (const raw of j.messages) {
    const m = rec(raw);
    if (!m || typeof m.id !== 'string') continue;
    const session = typeof m.session === 'string' ? m.session : '';
    const text = typeof m.text === 'string' ? m.text : '';
    // Só sessões que o TwiCC está rodando (a lista mais recente): nunca retoma uma sessão morta.
    let r: { ok: true } | { ok: false; error: string };
    if (!text.trim()) r = { ok: false, error: tr('mensagem vazia') };
    else if (!st.live?.includes(session.toLowerCase())) r = { ok: false, error: tr('a sessão não está rodando no TwiCC') };
    else r = await cli.send(session, text);
    await post('/api/host/twicc/ack', { results: [{ id: m.id, ...r }] });
    sent++;
    log(r.ok ? tr('✓ mensagem entregue à sessão {0}… do TwiCC', [session.slice(0, 8)]) : tr('✗ sessão {0}… do TwiCC: {1}', [session.slice(0, 8), r.error]));
  }
  return { state: 'ok', sent, want: st.want };
}

/** Laço do auxiliar (chamado pelo scripts/codex-bridge.ts). Nunca termina; sem o `twicc`, não faz nada. */
export async function twiccLoop(post: Post, log: (line: string) => void, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const bin = findTwiccBin(env);
  if (!bin) {
    log(tr('Sem o twicc no PATH (ou HABBLAUD_TWICC_BIN): mensagens às sessões do TwiCC desligadas.'));
    return;
  }
  const cli = createTwiccCli(bin);
  const st: TwiccBridgeState = { liveAt: 0, fresh: false, want: 0 };
  let last = '';
  for (;;) {
    const r = await twiccRound(post, cli, st, log);
    const state =
      r.state === 'down'
        ? 'down'
        : r.state === 'refused'
          ? tr('TwiCC: o Habblaud não entrega mensagens às sessões do TwiCC ({0}; HABBLAUD_TWICC_MESSAGES=1 liga).', [r.status])
          : tr('TwiCC: entregando as mensagens do escritório às sessões do TwiCC com {0}.', [bin]);
    if (state !== last && state !== 'down') log(state);
    last = state;
    await new Promise((ok) => setTimeout(ok, r.state === 'refused' ? TWICC_REFUSED_RETRY_MS : TWICC_POLL_MS));
  }
}
