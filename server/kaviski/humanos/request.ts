// Fork Kaviski (KAVISKI-HUMANOS.md): quem fez cada requisição da porta remota (marcado pelo gate de pessoas). Módulo
// pequeno e sem dependências, para os ganchos (remote-pty.ts, index.ts) perguntarem o papel sem import circular.
import type { IncomingMessage } from 'node:http';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';

const people = new WeakMap<IncomingMessage, KvPerson>();

export function kvSetPerson(req: IncomingMessage, person: KvPerson): void {
  people.set(req, person);
}

/** A pessoa da requisição (só na porta remota com HABBLAUD_HUMANOS=1). */
export function kvPersonOf(req: IncomingMessage | undefined): KvPerson | undefined {
  return req ? people.get(req) : undefined;
}

/** A requisição é de um cliente ou visitante (que nunca age: só vê as salas dele)? */
export function kvIsCliente(req: IncomingMessage | undefined): boolean {
  return kvRestricted(kvPersonOf(req));
}

/**
 * O que a porta remota libera (HABBLAUD_REMOTE_ALLOW) para esta pessoa: cliente, nada (a não ser mensagens, quando o
 * admin liberou "pode pedir tarefas": a rota dele confere a sala do agente, humanos/index.ts); equipe e admin, o que
 * estiver liberado. Sem pessoa (humanos desligado), o original.
 */
export function kvRemoteAllows(allowed: boolean, req: IncomingMessage | undefined, feature?: string): boolean {
  if (!allowed) return false;
  const p = kvPersonOf(req);
  if (!kvRestricted(p)) return true;
  return feature === 'messages' && p?.role === 'cliente' && !!p.request;
}
