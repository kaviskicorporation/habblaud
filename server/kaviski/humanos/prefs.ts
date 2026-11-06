// Fork Kaviski (KAVISKI-HUMANOS.md → "ir e fazer"): preferências da própria pessoa (`profile.prefs` no users.json,
// em <dataDir>/kaviski/).
//
// GET  /api/kaviski/humanos/prefs   {prefs: KvPersonPrefs}
// POST /api/kaviski/humanos/prefs   {prefs: Partial<KvPersonPrefs>}  junta com as guardadas; devolve as completas.
//
// Só quem tem conta (ou o acesso local, que é o admin embutido); cada um só lê e grava as suas. Chave desconhecida é
// ignorada; chave conhecida com valor errado recusa o pedido (400).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { tr } from '../../../shared/i18n';
import { kvParsePrefs, kvPrefsOf, type KvPersonPrefs } from '../../../shared/kaviski-prefs';
import { HttpError, readJson, sendJson } from '../../http/app';

export interface KvPrefsDeps {
  profile: (id: string) => Record<string, unknown>;
  setProfile: (id: string, profile: Record<string, unknown>) => boolean;
}

/** Junta o pedido às preferências guardadas e grava. `null` = pedido inválido; `false` = pessoa não encontrada. */
export function kvSavePrefs(id: string, raw: unknown, deps: KvPrefsDeps): KvPersonPrefs | null | false {
  const patch = kvParsePrefs(raw);
  if (!patch) return null;
  const profile = deps.profile(id);
  const prefs = { ...kvPrefsOf(profile.prefs), ...patch };
  if (!deps.setProfile(id, { ...profile, prefs })) return false;
  return prefs;
}

export function kvPrefsRoute(req: IncomingMessage, res: ServerResponse, person: KvPerson | undefined, deps: KvPrefsDeps): void {
  const method = req.method ?? 'GET';
  if (!person) {
    req.resume();
    return sendJson(res, 403, { error: tr('entre com a sua conta para salvar as preferências') });
  }
  if (method === 'GET' || method === 'HEAD') {
    req.resume();
    return sendJson(res, 200, { prefs: kvPrefsOf(deps.profile(person.id).prefs) });
  }
  if (method !== 'POST') {
    req.resume();
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  readJson(req, 2048)
    .then((body) => {
      const saved = kvSavePrefs(person.id, (body as { prefs?: unknown } | null)?.prefs, deps);
      if (saved === null) throw new HttpError(400, tr('preferência inválida'));
      if (saved === false) throw new HttpError(404, tr('pessoa não encontrada'));
      sendJson(res, 200, { prefs: saved });
    })
    .catch((err) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else sendJson(res, 500, { error: tr('erro interno') });
    });
}
