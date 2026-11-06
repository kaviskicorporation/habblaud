// Fork Kaviski (KAVISKI-HUMANOS.md): convites por link e visitantes sem conta (fase 4).
//
// - Convites em <dataDir>/kaviski/invites.json (permissão 600): quem convidou, validade, uso único ou várias pessoas,
//   salas liberadas, revogado ou não, e os visitantes que entraram por ele (nome e perfil: boneco etc.).
// - Link: /convite/<id>.<assinatura> — a assinatura é um HMAC do id com a chave do remote-secret (a mesma de onde o
//   gate.ts tira a dele; nenhum segredo novo). Sem a assinatura certa o link não abre.
// - Entrar: a página do link pede o nome; POST /api/kaviski/humanos/invite/join {token, name} cria o visitante e
//   devolve o cookie "g1.<visitante>.<validade>.<assinatura>" (validade = fim do convite; a assinatura mistura o id do
//   convite). Cada requisição confere de novo o convite: vencido ou revogado, o cookie deixa de valer na hora.
// - Freio de tentativas (KvLoginLimiter, por endereço e por convite) no link e na entrada.
// - Rotas da tela de convites (admin e equipe): GET|POST /api/kaviski/humanos/invites e DELETE .../invites/:id.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getLocale, tr } from '../../../shared/i18n';
import { kvPersonName, kvRoomRules, type KvPerson } from '../../../shared/kaviski-humanos';
import { KV_INVITE_MAX_USES, KV_INVITE_TTLS, KV_INVITES_MAX, kvIsInviteTtl, type KvInviteInfo, type KvInviteState } from '../../../shared/kaviski-invites';
import { log } from '../../log';

interface InviteRec {
  id: string;
  label?: string;
  by: { id: string; name: string };
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  rooms: string[];
  revokedAt?: number;
}

interface VisitorRec {
  id: string;
  invite: string;
  name: string;
  joinedAt: number;
  profile?: Record<string, unknown>;
}

interface FileShape {
  version: 1;
  invites: InviteRec[];
  visitors: VisitorRec[];
}

export type KvInviteResult = { ok: true; invite: KvInviteInfo } | { ok: false; status: number; error: string };
export type KvJoinResult = { ok: true; person: KvPerson; token: string; maxAgeS: number; rooms: string[] } | { ok: false; status: number; error: string };

const LINK_RE = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
const SESSION_RE = /^g1\.(v_[A-Za-z0-9_-]{12})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/;
/** Convite vencido/revogado há mais que isto some da lista (e do arquivo). */
const FORGET_MS = 7 * 24 * 60 * 60 * 1000;
const LABEL_MAX = 60;

export const INVITE_PAGE = '/convite/';
export const INVITE_JOIN_PATH = '/api/kaviski/humanos/invite/join';

export function kvIsVisitorId(id: string): boolean {
  return /^v_[A-Za-z0-9_-]{12}$/.test(id);
}

export class KvInvites {
  private invites: InviteRec[] = [];
  private visitors: VisitorRec[] = [];
  private keyCache: { link: Buffer; session: Buffer } | null = null;

  constructor(
    private readonly file: string | null,
    /** O remote-secret (lido só quando precisa). */
    private readonly secret: () => Buffer,
    private readonly now: () => number = Date.now,
  ) {}

  private get keys(): { link: Buffer; session: Buffer } {
    if (!this.keyCache) {
      const s = this.secret();
      this.keyCache = {
        link: createHmac('sha256', s).update('kaviski-humanos\0convite', 'utf8').digest(),
        session: createHmac('sha256', s).update('kaviski-humanos\0g1', 'utf8').digest(),
      };
    }
    return this.keyCache;
  }

  load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      this.invites = (Array.isArray(data.invites) ? data.invites : []).filter(
        (i): i is InviteRec => !!i && typeof i.id === 'string' && /^[A-Za-z0-9_-]{16}$/.test(i.id) && typeof i.expiresAt === 'number' && Array.isArray(i.rooms),
      ).map((i) => ({ ...i, rooms: kvRoomRules(i.rooms) ?? [] }));
      const ids = new Set(this.invites.map((i) => i.id));
      this.visitors = (Array.isArray(data.visitors) ? data.visitors : []).filter(
        (v): v is VisitorRec => !!v && typeof v.id === 'string' && kvIsVisitorId(v.id) && ids.has(v.invite) && !!kvPersonName(v.name),
      );
      this.prune();
    } catch (err) {
      log.warn(tr('invites.json ilegível ({0}); nenhum convite vale.', [(err as Error).message]));
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      const data: FileShape = { version: 1, invites: this.invites, visitors: this.visitors };
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    } catch (err) {
      log.warn(tr('Não deu para gravar os convites ({0}).', [(err as Error).message]));
    }
  }

  /** Esquece convites vencidos ou revogados há mais de 7 dias (e os visitantes deles). */
  private prune(): void {
    const t = this.now();
    const keep = this.invites.filter((i) => t - Math.min(i.expiresAt, i.revokedAt ?? Infinity) < FORGET_MS);
    if (keep.length === this.invites.length) return;
    const ids = new Set(keep.map((i) => i.id));
    this.invites = keep;
    this.visitors = this.visitors.filter((v) => ids.has(v.invite));
  }

  private stateOf(i: InviteRec): KvInviteState {
    if (i.revokedAt) return 'revogado';
    if (i.expiresAt <= this.now()) return 'vencido';
    if (i.uses >= i.maxUses) return 'esgotado';
    return 'ativo';
  }

  /** O convite ainda segura quem já entrou (não revogado nem vencido; esgotado continua valendo para eles). */
  private holds(i: InviteRec | undefined): i is InviteRec {
    return !!i && !i.revokedAt && i.expiresAt > this.now();
  }

  private sigLink(id: string): string {
    return createHmac('sha256', this.keys.link).update(id, 'utf8').digest('base64url');
  }

  private sigSession(vid: string, exp: number, invite: string): string {
    return createHmac('sha256', this.keys.session).update(`g1.${vid}.${exp}\0${invite}`, 'utf8').digest('base64url');
  }

  /** Token do link (o que vai depois de /convite/). */
  linkToken(id: string): string {
    return `${id}.${this.sigLink(id)}`;
  }

  private info(i: InviteRec): KvInviteInfo {
    const state = this.stateOf(i);
    return {
      id: i.id,
      ...(i.label ? { label: i.label } : {}),
      by: { ...i.by },
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      maxUses: i.maxUses,
      uses: i.uses,
      rooms: [...i.rooms],
      state,
      ...(state === 'ativo' ? { link: `${INVITE_PAGE}${this.linkToken(i.id)}` } : {}),
      visitors: this.visitors.filter((v) => v.invite === i.id).map((v) => ({ id: v.id, name: v.name, joinedAt: v.joinedAt })),
    };
  }

  list(): KvInviteInfo[] {
    this.prune();
    return [...this.invites].sort((a, b) => b.createdAt - a.createdAt).map((i) => this.info(i));
  }

  create(by: KvPerson, body: unknown): KvInviteResult {
    const b = (body ?? {}) as Record<string, unknown>;
    if (!kvIsInviteTtl(b.ttl)) return { ok: false, status: 400, error: tr('validade inválida (1h, 1d ou 7d)') };
    const maxUses = b.maxUses === undefined ? 1 : b.maxUses;
    if (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > KV_INVITE_MAX_USES) {
      return { ok: false, status: 400, error: tr('número de pessoas inválido (1 a {0})', [KV_INVITE_MAX_USES]) };
    }
    const rooms = kvRoomRules(b.rooms ?? []);
    if (!rooms) return { ok: false, status: 400, error: tr('salas inválidas: use caminhos absolutos (ex.: /home/hostadmin/projetos/Clientes/12-Rarm)') };
    let label: string | undefined;
    if (b.label !== undefined && b.label !== '') {
      label = kvPersonName(typeof b.label === 'string' ? b.label.slice(0, LABEL_MAX) : undefined);
      if (!label) return { ok: false, status: 400, error: tr('descrição inválida') };
    }
    this.prune();
    if (this.invites.length >= KV_INVITES_MAX) return { ok: false, status: 400, error: tr('convites demais (máximo {0}): revogue os antigos', [KV_INVITES_MAX]) };
    const t = this.now();
    const rec: InviteRec = {
      id: randomBytes(12).toString('base64url'),
      ...(label ? { label } : {}),
      by: { id: by.id, name: by.name },
      createdAt: t,
      expiresAt: t + KV_INVITE_TTLS[b.ttl],
      maxUses,
      uses: 0,
      rooms,
    };
    this.invites.push(rec);
    this.save();
    return { ok: true, invite: this.info(rec) };
  }

  /** Revoga: devolve os ids dos visitantes dele (para derrubar quem está online) ou undefined se não existe. */
  revoke(id: string): { invite: KvInviteInfo; visitors: string[] } | undefined {
    const i = this.invites.find((x) => x.id === id);
    if (!i) return undefined;
    if (!i.revokedAt) {
      i.revokedAt = this.now();
      this.save();
    }
    return { invite: this.info(i), visitors: this.visitors.filter((v) => v.invite === id).map((v) => v.id) };
  }

  /** O convite do link, se a assinatura confere; e o motivo, se não dá mais para entrar por ele. */
  open(token: string | undefined): { invite?: InviteRec; problem?: 'invalido' | KvInviteState } {
    const m = token ? LINK_RE.exec(token) : null;
    if (!m) return { problem: 'invalido' };
    const want = Buffer.from(this.sigLink(m[1]!));
    const got = Buffer.from(m[2]!);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return { problem: 'invalido' };
    const invite = this.invites.find((i) => i.id === m[1]);
    if (!invite) return { problem: 'invalido' };
    const state = this.stateOf(invite);
    return state === 'ativo' ? { invite } : { invite, problem: state };
  }

  /** Entra pelo link com um nome: cria o visitante e a sessão dele. */
  join(token: unknown, name: unknown): KvJoinResult {
    const { invite, problem } = this.open(typeof token === 'string' ? token : undefined);
    if (!invite || problem) return { ok: false, status: problem === 'invalido' || !invite ? 404 : 410, error: kvInviteProblemText(problem ?? 'invalido') };
    const clean = kvPersonName(name);
    if (!clean) return { ok: false, status: 400, error: tr('Escreva o seu nome.') };
    const vid = `v_${randomBytes(9).toString('base64url')}`;
    const t = this.now();
    invite.uses++;
    this.visitors.push({ id: vid, invite: invite.id, name: clean, joinedAt: t });
    this.save();
    const exp = invite.expiresAt;
    return {
      ok: true,
      person: this.personOf(this.visitors[this.visitors.length - 1]!, invite),
      token: `g1.${vid}.${exp}.${this.sigSession(vid, exp, invite.id)}`,
      maxAgeS: Math.max(1, Math.floor((exp - t) / 1000)),
      rooms: [...invite.rooms],
    };
  }

  private personOf(v: VisitorRec, i: InviteRec): KvPerson {
    return { id: v.id, user: 'visitante', name: v.name, role: 'visitante', rooms: [...i.rooms], createdAt: v.joinedAt, until: i.expiresAt };
  }

  /** A pessoa do cookie de visitante (convite ainda valendo), ou undefined. */
  verify(token: string | undefined): KvPerson | undefined {
    const m = token ? SESSION_RE.exec(token) : null;
    if (!m) return undefined;
    const [, vid, expText, sig] = m;
    const exp = Number(expText);
    if (exp <= this.now()) return undefined;
    const v = this.visitors.find((x) => x.id === vid);
    if (!v) return undefined;
    const i = this.invites.find((x) => x.id === v.invite);
    if (!this.holds(i) || exp !== i.expiresAt) return undefined;
    const want = Buffer.from(this.sigSession(vid!, exp, i.id));
    const got = Buffer.from(sig!);
    return want.length === got.length && timingSafeEqual(want, got) ? this.personOf(v, i) : undefined;
  }

  /** É um visitante conhecido (o perfil mora aqui, não no users.json)? */
  has(id: string): boolean {
    return kvIsVisitorId(id) && this.visitors.some((v) => v.id === id);
  }

  /** Visitante online com o convite ainda valendo. */
  person(id: string): KvPerson | undefined {
    const v = this.visitors.find((x) => x.id === id);
    const i = v && this.invites.find((x) => x.id === v.invite);
    return v && this.holds(i) ? this.personOf(v, i) : undefined;
  }

  profile(id: string): Record<string, unknown> {
    return { ...(this.visitors.find((v) => v.id === id)?.profile ?? {}) };
  }

  setProfile(id: string, profile: Record<string, unknown>): boolean {
    const v = this.visitors.find((x) => x.id === id);
    if (!v) return false;
    v.profile = profile;
    this.save();
    return true;
  }
}

export function kvInviteProblemText(p: 'invalido' | KvInviteState): string {
  if (p === 'vencido') return tr('Este convite venceu.');
  if (p === 'revogado') return tr('Este convite foi encerrado por quem convidou.');
  if (p === 'esgotado') return tr('Este convite já foi usado.');
  return tr('Convite não encontrado: confira o link.');
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Página do link: pede o nome e entra (ou explica por que não dá). Mesmo visual da tela de login (o kvBrandLogin troca
 * o título e o <h1> pela marca).
 */
export function kvInvitePage(opts: { token?: string; problem?: string; label?: string; by?: string; until?: number; loggedAs?: string; ended?: boolean }): string {
  const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  const when = opts.until ? new Date(opts.until).toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '';
  const intro = opts.ended
    ? tr('A sua visita terminou: o convite venceu ou foi encerrado. Peça um link novo a quem convidou.')
    : opts.problem
      ? opts.problem
      : opts.by
        ? tr('{0} convidou você para o escritório virtual. Escreva o seu nome para entrar.', [opts.by])
        : tr('Você foi convidado para o escritório virtual. Escreva o seu nome para entrar.');
  const form = opts.token && !opts.problem && !opts.ended
    ? `<label for="n">${esc(tr('Seu nome'))}</label>
  <input id="n" name="name" maxlength="40" autocomplete="name" required autofocus>
  <button id="b" type="submit">${esc(tr('Entrar como visitante'))}</button>
  <div id="err" role="alert"></div>
  ${opts.label ? `<p class="small">${esc(opts.label)}</p>` : ''}
  ${when ? `<p class="small">${esc(tr('Convite válido até {0}.', [when]))}</p>` : ''}
  ${opts.loggedAs ? `<p class="small">${esc(tr('Você já entrou neste navegador como {0}: entrar como visitante troca essa sessão.', [opts.loggedAs]))} <a href="/">${esc(tr('Voltar ao escritório'))}</a></p>` : ''}`
    : `<p class="small"><a href="/login">${esc(tr('Tenho uma conta: entrar com usuário e senha'))}</a></p>`;
  return `<!doctype html>
<html lang="${getLocale()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${esc(tr('Habblaud · convite'))}</title>
<meta name="apple-mobile-web-app-title" content="Habblaud">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14161f; color: #e8e6df;
         font: 16px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 16px; }
  form { width: 100%; max-width: 380px; background: #1e2130; border: 2px solid #3a3f58; border-radius: 10px; padding: 24px; }
  h1 { margin: 0 0 4px; font-size: 22px; color: #f4c95d; }
  p { margin: 0 0 16px; color: #9aa0b8; font-size: 13px; }
  p.small { margin: 14px 0 0; font-size: 12px; }
  a { color: #f4c95d; }
  .tag { display: inline-block; margin: 0 0 14px; padding: 2px 8px; border-radius: 4px; background: #6b4fa3; color: #fff; font-size: 11px; letter-spacing: .08em; }
  label { display: block; font-size: 13px; color: #9aa0b8; margin: 12px 0 6px; }
  input { width: 100%; padding: 12px; font: inherit; color: inherit; background: #14161f; border: 2px solid #3a3f58; border-radius: 6px; }
  input:focus { outline: none; border-color: #f4c95d; }
  button { width: 100%; margin-top: 20px; padding: 12px; font: inherit; font-weight: 700; color: #14161f; background: #f4c95d;
           border: 0; border-radius: 6px; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  #err { min-height: 20px; margin-top: 12px; color: #ff8a80; font-size: 13px; }
</style>
</head>
<body>
<form id="f" autocomplete="on">
  <h1>Habblaud</h1>
  <div class="tag">${esc(tr('VISITANTE'))}</div>
  <p>${esc(intro)}</p>
  ${form}
</form>
${opts.token && !opts.problem && !opts.ended ? `<script>
  const f = document.getElementById('f'), b = document.getElementById('b'), err = document.getElementById('err');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    b.disabled = true; err.textContent = '';
    try {
      const r = await fetch(${js(INVITE_JOIN_PATH)}, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ token: ${js(opts.token)}, name: document.getElementById('n').value }) });
      const body = await r.json().catch(() => ({}));
      if (r.ok) { location.replace(body.go || '/'); return; }
      err.textContent = body.error || ${js(tr('Não deu para entrar.'))};
    } catch { err.textContent = ${js(tr('Sem conexão com o Habblaud.'))}; }
    b.disabled = false;
  });
</script>` : ''}
</body>
</html>
`;
}
