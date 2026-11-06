// Fork Kaviski (KAVISKI-HUMANOS.md): rotas da tela de convites (fase 4). Só admin e equipe (o cliente e o visitante
// nunca convidam).
//
// GET    /api/kaviski/humanos/invites      {invites, rooms, base?}  lista (com o link dos ativos) e as salas que dá para liberar
// POST   /api/kaviski/humanos/invites      {ttl: '1h'|'1d'|'7d', maxUses?: 1..50, rooms?: [caminhos], label?}
// DELETE /api/kaviski/humanos/invites/:id  revoga: quem entrou por ele sai na hora (o fluxo de presença fecha e o cookie
//                                          deixa de valer)
// `base` = HABBLAUD_PUBLIC_URL (ex.: https://escritorio.kaviski.com.br), para o link sair certo mesmo quando a tela é
// aberta pela porta local; sem ela a página usa o próprio endereço.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OfficeSnapshot } from '../../../shared/types';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';
import type { KvAudit } from './audit';
import { kvShort } from './audit';
import type { KvInvites } from './invites';
import type { KvPresence } from './presence';

export const INVITES_PATH = '/api/kaviski/humanos/invites';

export interface KvInvitesRouteDeps {
  who: KvPerson | undefined;
  invites: KvInvites;
  presence: Pick<KvPresence, 'refresh'>;
  audit: KvAudit;
  snapshot: () => OfficeSnapshot;
  env?: NodeJS.ProcessEnv;
}

/** Endereço público do escritório (HABBLAUD_PUBLIC_URL), só se for http(s) sem caminho estranho. */
export function kvPublicUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env.HABBLAUD_PUBLIC_URL?.trim().replace(/\/+$/, '');
  return v && /^https?:\/\/[^\s/?#]+$/i.test(v) ? v : undefined;
}

export function kvInvitesRoute(req: IncomingMessage, res: ServerResponse, path: string, deps: KvInvitesRouteDeps): void {
  const method = req.method ?? 'GET';
  const who = deps.who;
  const fail = (err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };
  if (!who || kvRestricted(who)) {
    req.resume();
    return sendJson(res, 403, { error: tr('só a equipe convida visitantes') });
  }
  if (path === INVITES_PATH) {
    if (method === 'GET' || method === 'HEAD') {
      req.resume();
      const rooms = deps.snapshot().rooms.filter((r) => r.path?.startsWith('/')).map((r) => ({ path: r.path, name: r.name }));
      const base = kvPublicUrl(deps.env);
      return sendJson(res, 200, { invites: deps.invites.list(), rooms, ...(base ? { base } : {}) });
    }
    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    readJson(req, 64 * 1024)
      .then((body) => {
        const r = deps.invites.create(who, body);
        if (!r.ok) throw new HttpError(r.status, r.error);
        const i = r.invite;
        deps.audit.add(who, 'convite criado', { detail: kvShort([i.label ?? '', `${i.maxUses}×`, i.rooms.join(', ') || tr('só áreas comuns')].filter(Boolean).join(' · ')), ok: true });
        sendJson(res, 201, { invite: i });
      })
      .catch(fail);
    return;
  }
  req.resume();
  let id = '';
  try {
    id = decodeURIComponent(path.slice(INVITES_PATH.length + 1));
  } catch {
    return sendJson(res, 400, { error: tr('id inválido') });
  }
  if (method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  const r = deps.invites.revoke(id);
  if (!r) return sendJson(res, 404, { error: tr('convite não encontrado') });
  for (const v of r.visitors) deps.presence.refresh(undefined, v);
  deps.audit.add(who, 'convite revogado', { detail: kvShort([r.invite.label ?? r.invite.id, tr('{0} visitante(s)', [r.visitors.length])].join(' · ')), ok: true });
  sendJson(res, 200, { invite: r.invite });
}
