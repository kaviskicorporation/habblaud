// Fork Kaviski (KAVISKI.md): ponto único de ligação das personalizações do servidor.
//
// - estilo por sala (cor/grupo do cliente, sala fixa, nome): GET|POST /api/rooms/style, só pelo próprio computador
//   (mesma trava de /api/rooms/rename), persistido em <dataDir>/room-styles.json e posto no snapshot em
//   RoomInfo.kaviski; as salas fixas vazias entram no snapshot (kaviski/pinned.ts);
// - HABBLAUD_TWICC_URL: vai no snapshot em meta.kaviski.twiccUrl (o cliente monta "Abrir no TwiCC");
// - nome da empresa (Configurações › Empresa, kaviski/empresa.ts; HABBLAUD_BRAND é o valor inicial) em meta.kaviski.brand
//   (título da aba, Sobre, notificações) e na tela de login (kaviski/remote.ts);
// - HABBLAUD_TWICC_MESSAGES=1: mensagens às sessões do TwiCC pelo auxiliar do host (kaviski/twicc-messages.ts);
// - pedidos das sessões do TwiCC (perguntas, aprovações) respondidos pelo escritório (kaviski/twicc-approvals.ts;
//   HABBLAUD_TWICC_APPROVALS=0 desliga);
// - HABBLAUD_FRAME_ANCESTORS: ver kaviski/frame.ts.
// Sem variáveis e sem estilos gravados, o snapshot sai idêntico ao original.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { OfficeSnapshot } from '../../shared/types';
import { kvBrand, kvPathKey, kvTwiccBase, type KvMeta, type KvSnapshotMeta } from '../../shared/kaviski';
import { tr } from '../../shared/i18n';
import { log } from '../log';
import { HttpError, readJson, sendJson } from '../http/app';
import { parseRoomStyles, RoomStyles } from './room-styles';
import { EMPRESA_PATH, KvEmpresa, kvEmpresaRoute, kvSetEmpresaAtual } from './empresa';
import { kvDecorateRooms } from './pinned';
import { kvOnPlanPinned, kvPlanPinned } from './humanos/plan';
import { isTruthy } from '../config';
import { attachTwiccApprovals, TWICC_REQUESTS_PATH, type KvApprovalsOffice, type KvPermissionRegistry, type KvTwiccApprovals } from './twicc-approvals';
import { attachTwiccMessages, TWICC_ACK_PATH, TWICC_POLL_PATH, type KvMessageRegistry, type KvTwiccMessages, type KvTwiccOffice } from './twicc-messages';

export const ROOM_STYLE_PATH = '/api/rooms/style';

/** O pedaço do Office que o fork usa (ver attach). */
export interface KvOffice {
  commit(): { snapshot: OfficeSnapshot; changed: boolean };
  markDirty(): void;
}

/** Trava da rota de estilo, decidida em http/app.ts (a mesma de /api/rooms/rename). */
export interface KvRouteAccess {
  /** Recurso ligado (bind local: ServerConfig.terminal). */
  enabled: boolean;
  /** Pelo próprio computador (porta local com Host local; nunca pela porta remota). */
  trusted: boolean;
  /** O auxiliar do host (a mesma trava de /api/host/*: trusted e, fora do Docker, conexão do loopback). */
  host?: boolean;
}

export interface Kaviski {
  readonly styles: RoomStyles;
  readonly twiccUrl?: string;
  readonly brand?: string;
  /** Mensagens às sessões do TwiCC (só com HABBLAUD_TWICC_MESSAGES=1 e depois de attachMessages). */
  twicc?: KvTwiccMessages;
  /** Liga a entrega às sessões do TwiCC no registro de mensagens (nada sem HABBLAUD_TWICC_MESSAGES=1). */
  attachMessages(registry: KvMessageRegistry | undefined, office: KvTwiccOffice): void;
  /** Pedidos das sessões do TwiCC no cartão de permissão (só depois de attachApprovals). */
  approvals?: KvTwiccApprovals;
  /** Liga os pedidos das sessões do TwiCC no registro de permissões (nada sem ele ou com HABBLAUD_TWICC_APPROVALS=0). */
  attachApprovals(registry: KvPermissionRegistry | undefined, office: KvApprovalsOffice): void;
  /** Põe estilos e o meta do fork em cada snapshot novo do Office (e re-emite quando os estilos mudam). */
  attach(office: KvOffice): void;
  /** Acrescenta os campos do fork a um snapshot (no lugar). */
  decorate(snap: OfficeSnapshot): void;
  /** Trata /api/rooms/style; devolve false para outras rotas. */
  route(req: IncomingMessage, res: ServerResponse, path: string, access: KvRouteAccess): boolean;
}

export function createKaviski(opts: { dataDir: string | null; env?: NodeJS.ProcessEnv; roomAlias?: (path: string) => string | undefined; now?: () => number }): Kaviski {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const empresa = new KvEmpresa(opts.dataDir ? join(opts.dataDir, 'kaviski', 'empresa.json') : null, kvBrand(env.HABBLAUD_BRAND));
  empresa.load();
  kvSetEmpresaAtual(empresa);
  const startedAt = now();
  const styles = new RoomStyles(opts.dataDir ? join(opts.dataDir, 'room-styles.json') : null);
  styles.load();
  const rawTwicc = env.HABBLAUD_TWICC_URL?.trim();
  const twiccUrl = kvTwiccBase(rawTwicc);
  if (rawTwicc && !twiccUrl) log.warn(tr('HABBLAUD_TWICC_URL inválida ({0}): o botão "Abrir no TwiCC" fica desligado.', [rawTwicc]));
  let office: KvOffice | undefined;

  const decorate = (snap: OfficeSnapshot): void => {
    // salas fixas da planta livre (humanos/plan.ts) juntas com as `pinned` do mapa (o mapa vence: cor, grupo, nome)
    const planPinned = kvPlanPinned();
    if (styles.size || planPinned.length) {
      const hidden = new Set(styles.entries().filter(([, e]) => e.hidden).map(([k]) => k));
      if (hidden.size) {
        // Salas escondidas: some a sala e todo agente dela (principal e subagentes), como se não existissem.
        snap.rooms = snap.rooms.filter((r) => !hidden.has(kvPathKey(r.path ?? r.id)));
        snap.agents = snap.agents.filter((a) => !hidden.has(kvPathKey(a.roomId)));
      }
      const entries = styles.entries().filter(([, e]) => !e.hidden);
      const keys = new Set(entries.map(([k]) => k));
      for (const [k, e] of planPinned) {
        if (hidden.has(k)) continue;
        if (!keys.has(k)) entries.push([k, e]);
        else {
          const i = entries.findIndex(([x]) => x === k);
          if (!entries[i][1].pinned) entries[i] = [k, { ...entries[i][1], pinned: true, path: entries[i][1].path ?? e.path }];
        }
      }
      snap.rooms = kvDecorateRooms(snap.rooms, entries, { alias: opts.roomAlias, createdAt: startedAt });
    }
    const brand = empresa.get();
    if (twiccUrl || brand) {
      const meta: KvMeta = {};
      if (twiccUrl) meta.twiccUrl = twiccUrl;
      if (brand) meta.brand = brand;
      (snap.meta as KvSnapshotMeta).kaviski = meta;
    }
  };

  const route = (req: IncomingMessage, res: ServerResponse, path: string, access: KvRouteAccess): boolean => {
    if (path === TWICC_POLL_PATH || path === TWICC_ACK_PATH) {
      if (!kv.twicc) {
        req.resume();
        sendJson(res, 404, { error: tr('mensagens às sessões do TwiCC desligadas (HABBLAUD_TWICC_MESSAGES=1 liga)') });
      } else if (!access.host) {
        req.resume();
        sendJson(res, 403, { error: tr('rota só do auxiliar do host (npm run codex:bridge)') });
      } else kv.twicc.route(req, res, path);
      return true;
    }
    if (path === TWICC_REQUESTS_PATH) {
      if (!kv.approvals) {
        req.resume();
        sendJson(res, 404, { error: tr('pedidos das sessões do TwiCC desligados (precisa do Habblaud só pelo próprio computador; HABBLAUD_TWICC_APPROVALS=0 desliga)') });
      } else if (!access.host) {
        req.resume();
        sendJson(res, 403, { error: tr('rota só do auxiliar do host (npm run codex:bridge)') });
      } else kv.approvals.route(req, res);
      return true;
    }
    if (path === EMPRESA_PATH) {
      kvEmpresaRoute(req, res, empresa, access.trusted, () => office?.markDirty());
      return true;
    }
    if (path !== ROOM_STYLE_PATH) return false;
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { error: tr('método não permitido') });
    } else if (!access.enabled) {
      req.resume();
      sendJson(res, 403, { error: tr('cores das salas desligadas: só funcionam com o Habblaud acessível apenas pelo próprio computador') });
    } else if (!access.trusted) {
      req.resume();
      sendJson(res, 403, { error: tr('cores das salas só pelo próprio computador (http://localhost)') });
    } else if (method !== 'POST') {
      req.resume();
      sendJson(res, 200, { rooms: styles.all() });
    } else {
      readJson(req)
        .then((body) => {
          const r = parseRoomStyles(body);
          if ('error' in r) throw new HttpError(400, r.error);
          styles.replace(r.rooms);
          office?.markDirty();
          sendJson(res, 200, { ok: true, rooms: styles.all() });
        })
        .catch((err) => {
          if (res.headersSent) return void res.destroy();
          if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
          else sendJson(res, 500, { error: tr('erro interno') });
        });
    }
    return true;
  };

  const kv: Kaviski = {
    styles,
    twiccUrl,
    get brand() {
      return empresa.get();
    },
    decorate,
    route,
    attachMessages(registry, o) {
      if (!registry || !isTruthy(env.HABBLAUD_TWICC_MESSAGES?.trim())) return;
      kv.twicc = attachTwiccMessages(registry, o, { now });
    },
    attachApprovals(registry, o) {
      if (!registry || env.HABBLAUD_TWICC_APPROVALS?.trim() === '0') return;
      kv.approvals = attachTwiccApprovals(registry, o, { now });
    },
    attach(o) {
      office = o;
      // Embrulha o commit do Office: cada snapshot novo sai com os campos do fork (o mesmo objeto é reaproveitado
      // enquanto nada muda, então decorar só os novos basta). Zero linhas mexidas em model/office.ts.
      const commit = o.commit.bind(o);
      o.commit = () => {
        const r = commit();
        if (r.changed) decorate(r.snapshot);
        return r;
      };
      kvOnPlanPinned(() => o.markDirty());
      if (styles.size || twiccUrl || empresa.get() || kvPlanPinned().length) o.markDirty();
    },
  };
  return kv;
}
