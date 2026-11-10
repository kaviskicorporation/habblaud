// Fork Kaviski (KAVISKI-HUMANOS.md): rotas da tela de convites (fase 4). Só admin e equipe (o cliente e o visitante
// nunca convidam).
//
// GET    /api/kaviski/humanos/invites      {invites, rooms, own, themes, base?}  lista (com o link dos ativos, os
//                                          visitantes online e onde estão) e o que dá para liberar: salas de projeto,
//                                          salas próprias (com o tipo) e as salas temáticas da planta
// POST   /api/kaviski/humanos/invites      {ttl: '1h'|'1d'|'7d' | expiresAt, maxUses?: 1..50, rooms?: [caminhos], label?,
//                                          own?: [kvsala-...], meetings?, blocked?: [temas], voice?, chat?}
// PATCH  /api/kaviski/humanos/invites/:id  edita (os mesmos campos, todos opcionais; validade: extend '1h'|'1d'|'7d' ou
//                                          expiresAt exato, até 30 dias a partir de agora). Os visitantes online
//                                          recebem o acesso novo na hora (`edited`, index.ts)
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
import type { KvInviteEditResult, KvInvites } from './invites';
import type { KvOwnRoomKind } from '../../../shared/kaviski-rooms';
import type { KvPresence } from './presence';

export const INVITES_PATH = '/api/kaviski/humanos/invites';

export interface KvInvitesRouteDeps {
  who: KvPerson | undefined;
  invites: KvInvites;
  presence: Pick<KvPresence, 'refresh'>;
  audit: KvAudit;
  snapshot: () => OfficeSnapshot;
  env?: NodeJS.ProcessEnv;
  /** Salas próprias que quem pede vê (para liberar no convite). */
  ownRooms?: (who: KvPerson) => { id: string; name: string; kind: KvOwnRoomKind }[];
  /** Salas temáticas da planta (chave e nome da placa, se tiver). */
  themes?: () => { key: string; name?: string }[];
  /** Área de quem está online (id -> área; ausente = offline). */
  online?: () => Map<string, string | undefined>;
  /** Convite editado: leva o acesso novo a quem já entrou (presença, snapshot, planta). */
  edited?: (r: Extract<KvInviteEditResult, { ok: true }>) => void;
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
      const rooms = deps.snapshot().rooms.filter((r) => r.path?.startsWith('/')).map((r) => ({ id: r.id, path: r.path, name: r.name }));
      const base = kvPublicUrl(deps.env);
      const online = deps.online?.() ?? new Map<string, string | undefined>();
      const invites = deps.invites.list().map((i) => ({
        ...i,
        visitors: i.visitors.map((v) => (online.has(v.id) ? { ...v, online: true, ...(online.get(v.id) ? { area: online.get(v.id) } : {}) } : v)),
      }));
      return sendJson(res, 200, { invites, rooms, own: deps.ownRooms?.(who) ?? [], themes: deps.themes?.() ?? [], ...(base ? { base } : {}) });
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
        deps.audit.add(who, 'convite criado', { detail: kvShort([i.label ?? '', `${i.maxUses}×`, i.rooms.join(', ') || tr('só áreas comuns'), accessText(i.access)].filter(Boolean).join(' · ')), ok: true });
        sendJson(res, 201, { invite: i });
      })
      .catch(fail);
    return;
  }
  let id = '';
  try {
    id = decodeURIComponent(path.slice(INVITES_PATH.length + 1));
  } catch {
    req.resume();
    return sendJson(res, 400, { error: tr('id inválido') });
  }
  if (method === 'PATCH') {
    readJson(req, 64 * 1024)
      .then((body) => {
        const r = deps.invites.update(id, body);
        if (!r.ok) throw new HttpError(r.status, r.error);
        if (r.changes.length) {
          deps.edited?.(r);
          deps.audit.add(who, 'convite editado', { detail: kvShort([r.invite.label ?? r.invite.id, r.changes.join(', '), tr('{0} visitante(s)', [r.visitors.length])].join(' · ')), ok: true });
        }
        sendJson(res, 200, { invite: r.invite });
      })
      .catch(fail);
    return;
  }
  req.resume();
  if (method !== 'DELETE') {
    res.setHeader('Allow', 'PATCH, DELETE');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  const r = deps.invites.revoke(id);
  if (!r) return sendJson(res, 404, { error: tr('convite não encontrado') });
  for (const v of r.visitors) deps.presence.refresh(undefined, v);
  deps.audit.add(who, 'convite revogado', { detail: kvShort([r.invite.label ?? r.invite.id, tr('{0} visitante(s)', [r.visitors.length])].join(' · ')), ok: true });
  sendJson(res, 200, { invite: r.invite });
}

/** Resumo do acesso para o registro. */
function accessText(a: { own: string[]; meetings: boolean; blocked: string[]; voice: boolean; chat: boolean }): string {
  return [
    a.meetings ? tr('todas as salas de reunião') : '',
    a.own.length ? tr('{0} sala(s) própria(s)', [a.own.length]) : '',
    a.blocked.length ? tr('bloqueadas: {0}', [a.blocked.join(', ')]) : '',
    a.voice ? '' : tr('sem voz'),
    a.chat ? '' : tr('sem chat'),
  ].filter(Boolean).join(' · ');
}
