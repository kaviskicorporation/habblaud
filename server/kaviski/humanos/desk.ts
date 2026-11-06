// Fork Kaviski (KAVISKI-HUMANOS.md): a mesa fixa da pessoa (`profile.desk` no users.json).
//
// GET  /api/kaviski/humanos/desk   {desk: KvPos | null}
// POST /api/kaviski/humanos/desk   {desk: KvPos | null}: escolhe (ou tira, com null) a cadeira de uma sala.
//
// Regras (no servidor): só cadeira dentro de uma sala de projeto que a pessoa pode ver (cliente: as salas dele), a sala
// precisa existir agora, e duas pessoas não ficam com a mesma cadeira. Os outros recebem a mesa pela presença
// (KvPresencePerson.desk, filtrada por sala como a posição).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OfficeSnapshot } from '../../../shared/types';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { tr } from '../../../shared/i18n';
import { kvParsePos, type KvPos } from '../../../shared/kaviski-presence';
import { kvParseDesk, kvSameDesk } from '../../../shared/kaviski-desk';
import { HttpError, readJson, sendJson } from '../../http/app';
import { kvAreaAllowed } from './livekit';

export interface KvDeskDeps {
  snapshot: () => OfficeSnapshot;
  /** Perfil livre de uma pessoa (users.ts). */
  profile: (id: string) => Record<string, unknown>;
  setProfile: (id: string, profile: Record<string, unknown>) => boolean;
  /** Ids de todas as contas (para conferir se a cadeira já é de alguém). */
  ids: () => string[];
  /** Avisar a presença (a mesa vai junto da pessoa). */
  touch: () => void;
}

/** A mesa guardada no perfil, limpa (undefined = sem mesa). */
export function kvDeskOf(profile: Record<string, unknown>): KvPos | undefined {
  return profile.desk === undefined ? undefined : kvParseDesk(profile.desk, kvParsePos);
}

/** Confere a mesa pedida. Devolve o erro (status e texto) ou a mesa limpa (null = tirar). */
export function kvCheckDesk(raw: unknown, person: KvPerson, deps: Pick<KvDeskDeps, 'snapshot' | 'profile' | 'ids'>): { ok: true; desk: KvPos | null } | { ok: false; status: number; error: string } {
  if (raw === null) return { ok: true, desk: null };
  if ((person.role as string) === 'visitante') return { ok: false, status: 403, error: tr('visitante não tem mesa fixa') };
  const desk = kvParseDesk(raw, kvParsePos);
  if (!desk) return { ok: false, status: 400, error: tr('mesa inválida (escolha uma cadeira dentro de uma sala)') };
  if (!kvAreaAllowed(`r:${desk.r}`, person, deps.snapshot())) return { ok: false, status: 403, error: tr('essa sala não é sua') };
  for (const id of deps.ids()) {
    if (id === person.id) continue;
    if (kvSameDesk(kvDeskOf(deps.profile(id)), desk)) return { ok: false, status: 409, error: tr('essa mesa já é de outra pessoa') };
  }
  return { ok: true, desk };
}

export function kvDeskRoute(req: IncomingMessage, res: ServerResponse, person: KvPerson | undefined, deps: KvDeskDeps): void {
  const method = req.method ?? 'GET';
  const fail = (err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };
  if (!person) {
    req.resume();
    return sendJson(res, 403, { error: tr('entre com a sua conta para ter uma mesa') });
  }
  if (method === 'GET' || method === 'HEAD') {
    req.resume();
    return sendJson(res, 200, { desk: kvDeskOf(deps.profile(person.id)) ?? null });
  }
  if (method !== 'POST') {
    req.resume();
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  readJson(req, 4096)
    .then((body) => {
      const r = kvCheckDesk((body as { desk?: unknown })?.desk ?? null, person, deps);
      if (!r.ok) throw new HttpError(r.status, r.error);
      const profile = deps.profile(person.id);
      if (r.desk) profile.desk = r.desk;
      else delete profile.desk;
      if (!deps.setProfile(person.id, profile)) throw new HttpError(404, tr('pessoa não encontrada'));
      deps.touch();
      sendJson(res, 200, { desk: r.desk });
    })
    .catch(fail);
}
