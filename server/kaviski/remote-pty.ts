// Fork Kaviski (KAVISKI.md): terminal interativo e editor de personagem pela porta remota (com login).
//
// Original: o terminal interativo (abrir, assumir e encerrar sessões do Claude Code), o editor de personagem e o
// renomear sala só valem pelo próprio computador, nunca pela porta remota, nem com login. Com HABBLAUD_REMOTE_PTY=1 a
// porta remota autenticada também pode — para instalações que ficam atrás de uma VPN (quem passa no login controla o
// Claude Code da máquina: é o mesmo que dar um shell). Sem a variável, o comportamento é exatamente o original.
// Continua valendo: login obrigatório (http/remote.ts), corpo JSON nos POST e Origin da mesma origem.
import type { IncomingMessage } from 'node:http';
import { tr } from '../../shared/i18n';

/** HABBLAUD_REMOTE_PTY ligado? */
export function kvRemotePty(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|sim|on)$/i.test(env.HABBLAUD_REMOTE_PTY?.trim() ?? '');
}

/**
 * Requisição remota (já autenticada) ao terminal interativo: null = liberada; texto = recusa. Confere a mesma origem
 * (Origin e Sec-Fetch-Site), como o original faz na porta local.
 */
export function kvRemotePtyProblem(req: IncomingMessage): string | null {
  const host = String(req.headers.host ?? '').trim().toLowerCase();
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    let same = false;
    try {
      same = new URL(origin).host.toLowerCase() === host;
    } catch {
      same = false;
    }
    if (!same) return tr('origem não permitida para o terminal interativo');
  }
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') return tr('origem não permitida para o terminal interativo');
  return null;
}
