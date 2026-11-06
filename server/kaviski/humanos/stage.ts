// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): o palco (megafone). Uma pessoa da equipe (admin ou
// equipe; cliente e visitante nunca) fala para o andar inteiro numa chamada do LiveKit à parte, que todo mundo online
// assina só para ouvir — o cliente também ouve (é um aviso para o escritório), mas não fala.
//
// GET  /api/kaviski/humanos/stage        estado do palco (KvStageState)
// POST /api/kaviski/humanos/stage        {on: true|false}: abrir (só equipe, um palco por vez) ou fechar (quem abriu,
//                                        ou um admin) — evento `stage` do fluxo de presença para todas as páginas
// POST /api/kaviski/humanos/stage/token  token do LiveKit para a chamada do palco: `canPublish` só para quem está no
//                                        palco; os demais `canSubscribe` e mais nada
//
// Cada palco aberto é uma chamada nova (o nome sai de `since`): um token velho não serve para o palco seguinte. Quem
// abriu e saiu do escritório (fechou a página) perde o palco sozinho; e nenhum palco dura mais que STAGE_MAX_MS.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import type { KvStageState, KvStageToken } from '../../../shared/kaviski-media';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';
import { kvCallName, kvLiveKitToken, type KvLiveKitConfig } from './livekit';

export const STAGE_PATH = '/api/kaviski/humanos/stage';
export const STAGE_TOKEN_PATH = `${STAGE_PATH}/token`;
/** Palco esquecido aberto fecha sozinho. */
export const STAGE_MAX_MS = 2 * 60 * 60 * 1000;
/** Abrir e fechar: uma vez a cada este tempo por pessoa. */
const TOGGLE_MS = 1500;
const SWEEP_MS = 3000;

export type KvStageResult = { ok: true; state: KvStageState } | { ok: false; status: number; error: string };

export interface KvStageDeps {
  /** Manda o evento a todas as páginas (KvPresence.emit). */
  emit: (event: string, data: unknown, to: (viewer: KvPerson, area: string | undefined) => boolean) => void;
  /** A pessoa ainda está online (KvPresence.personOf). */
  online: (id: string) => boolean;
  /** Registro (audit.ts). */
  audit?: (person: KvPerson, action: string) => void;
  now?: () => number;
}

export class KvStage {
  private cur: { id: string; name: string; since: number } | null = null;
  private readonly last = new Map<string, number>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly deps: KvStageDeps) {
    this.now = deps.now ?? Date.now;
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  state(): KvStageState {
    const c = this.cur;
    return c ? { active: true, by: { id: c.id, name: c.name }, since: c.since } : { active: false };
  }

  /** Quem pode subir no palco: admin e equipe. */
  static canSpeak(person: KvPerson): boolean {
    return !kvRestricted(person);
  }

  /** Abre (on) ou fecha o palco. */
  set(person: KvPerson, on: unknown): KvStageResult {
    if (typeof on !== 'boolean') return { ok: false, status: 400, error: tr('palco: diga on (true ou false)') };
    if (!KvStage.canSpeak(person)) return { ok: false, status: 403, error: tr('só a equipe sobe no palco') };
    const t = this.now();
    if (t - (this.last.get(person.id) ?? -Infinity) < TOGGLE_MS) return { ok: false, status: 429, error: tr('espere um pouco') };
    const c = this.cur;
    if (on) {
      if (c && c.id !== person.id) return { ok: false, status: 409, error: tr('{0} já está no palco', [c.name]) };
      this.last.set(person.id, t);
      if (c) return { ok: true, state: this.state() };
      this.cur = { id: person.id, name: person.name, since: t };
      this.deps.audit?.(person, 'palco aberto');
    } else {
      if (!c) return { ok: true, state: this.state() };
      if (c.id !== person.id && person.role !== 'admin') return { ok: false, status: 403, error: tr('só quem abriu (ou um admin) fecha o palco') };
      this.last.set(person.id, t);
      this.cur = null;
      this.deps.audit?.(person, 'palco fechado');
    }
    this.broadcast();
    return { ok: true, state: this.state() };
  }

  /** A pessoa mudou de nome ou foi apagada (tela de Pessoas): quem perdeu o direito sai do palco. */
  refresh(person: KvPerson | undefined, id: string): void {
    if (this.cur?.id !== id) return;
    if (!person || !KvStage.canSpeak(person)) this.cur = null;
    else this.cur.name = person.name;
    this.broadcast();
  }

  /** Token para a chamada do palco (undefined: não há palco aberto). */
  token(cfg: KvLiveKitConfig, person: KvPerson): KvStageToken | undefined {
    const c = this.cur;
    if (!c) return undefined;
    const room = kvCallName(`stage:${c.since}`);
    const canPublish = c.id === person.id && KvStage.canSpeak(person);
    const token = kvLiveKitToken(cfg, person, room, Math.floor(this.now() / 1000), { canPublish, canSubscribe: true, canPublishData: false });
    return { url: cfg.url, room, token, canPublish, since: c.since };
  }

  /** Quem abriu saiu do escritório, ou o palco ficou aberto tempo demais: fecha. */
  sweep(): void {
    const c = this.cur;
    if (!c) return;
    if (this.deps.online(c.id) && this.now() - c.since < STAGE_MAX_MS) return;
    this.cur = null;
    this.broadcast();
  }

  private broadcast(): void {
    this.deps.emit('stage', this.state(), () => true);
  }
}

export interface KvStageRouteDeps {
  stage: KvStage;
  whoIs: (req: IncomingMessage) => KvPerson | undefined;
  /** Configuração do LiveKit (undefined: voz e vídeo desligados). */
  config: KvLiveKitConfig | undefined;
}

/** As rotas do palco (humanos/index.ts chama). true = a rota era do palco e já respondeu. */
export function kvStageRoute(deps: KvStageRouteDeps, req: IncomingMessage, res: ServerResponse, path: string): boolean {
  if (path !== STAGE_PATH && path !== STAGE_TOKEN_PATH) return false;
  const method = req.method ?? 'GET';
  const person = deps.whoIs(req);
  const cfg = deps.config;
  const answer = (status: number, body: unknown) => {
    req.resume();
    sendJson(res, status, body);
    return true;
  };
  if (!person) return answer(403, { error: tr('entre com a sua conta para aparecer no escritório') });
  if (!cfg) return answer(404, { error: tr('voz e vídeo desligados (falta HABBLAUD_LIVEKIT_URL, _KEY e _SECRET)') });
  if (path === STAGE_PATH && (method === 'GET' || method === 'HEAD')) return answer(200, deps.stage.state());
  if (method !== 'POST') {
    res.setHeader('Allow', path === STAGE_PATH ? 'GET, POST' : 'POST');
    return answer(405, { error: tr('método não permitido') });
  }
  if (path === STAGE_TOKEN_PATH) {
    const t = deps.stage.token(cfg, person);
    return t ? answer(200, t) : answer(404, { error: tr('nenhum palco aberto') });
  }
  readJson(req, 1024)
    .then((body) => {
      const r = deps.stage.set(person, (body as { on?: unknown } | null)?.on);
      if (!r.ok) throw new HttpError(r.status, r.error);
      sendJson(res, 200, r.state);
    })
    .catch((err) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else sendJson(res, 500, { error: tr('erro interno') });
    });
  return true;
}
