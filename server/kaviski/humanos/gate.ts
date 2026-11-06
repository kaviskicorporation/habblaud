// Fork Kaviski (KAVISKI-HUMANOS.md): login por pessoa na porta remota (HABBLAUD_HUMANOS=1).
//
// Fica na frente do gate original (http/remote.ts createRemoteGate):
// - POST /api/remote/login: confere primeiro a conta embutida (HABBLAUD_REMOTE_USER, emite o mesmo token "v1" do
//   original, então o cookie de quem já estava logado continua valendo) e depois as contas de users.json (token "h1"
//   com o id da pessoa, assinado com uma chave que mistura o hash da senha dela: trocar a senha derruba as sessões
//   dela). O scrypt roda sempre, com usuário existente ou não. Freio de tentativas por endereço e por usuário
//   (KvLoginLimiter): quem erra muito trava só a si mesmo, não o login de todo mundo.
// - /api/remote/logout: encerra o token (h1 ou v1).
// - /login: a tela original, com o texto "entre com seu usuário e senha".
// - Requisição com token válido: marca como remota (como o original) e guarda a pessoa (humanos/request.ts).
// - O resto (CA, ícones públicos, 401, redirecionamento) continua com o gate original.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COOKIE, kvMarkRemote, LoginThrottle, loginPage, readCookie, safeEqual, SESSION_MS, type RemoteConfig, type RemoteSessions } from '../../http/remote';
import { hashPassword, parsePasswordHash, verifyPassword, type PasswordHash } from '../../remote/password';
import { kvBrandLogin, kvKeepRoomQuery, kvSameSite } from '../remote';
import { kvFrameHeaders } from '../frame';
import { tr } from '../../../shared/i18n';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import { kvSetPerson } from './request';
import { BUILTIN_ID, publicPerson, type KvUsers } from './users';

type Gate = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;

const TOKEN_RE = /^h1\.([A-Za-z0-9_-]{8,32})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/;

/** Tokens "h1" das pessoas de users.json. */
export class KvPersonSessions {
  private readonly key: Buffer;
  private readonly revoked = new Map<string, number>();

  constructor(
    secret: Buffer,
    private readonly hashOf: (id: string) => string | undefined,
    private readonly now: () => number = Date.now,
    private readonly revokedFile?: string,
  ) {
    this.key = createHmac('sha256', secret).update('kaviski-humanos\0h1', 'utf8').digest();
    this.loadRevoked();
  }

  private sign(id: string, exp: number, hash: string): string {
    return createHmac('sha256', this.key).update(`h1.${id}.${exp}\0${hash}`, 'utf8').digest('base64url');
  }

  issue(id: string): { token: string; maxAgeS: number } | undefined {
    const hash = this.hashOf(id);
    if (!hash) return undefined;
    const exp = this.now() + SESSION_MS;
    return { token: `h1.${id}.${exp}.${this.sign(id, exp, hash)}`, maxAgeS: Math.floor(SESSION_MS / 1000) };
  }

  /** Id da pessoa do token (válido, não vencido, não encerrado e com a senha de hoje), ou undefined. */
  verify(token: string | undefined): string | undefined {
    const p = this.parse(token);
    return p && !this.revoked.has(p.sig) ? p.id : undefined;
  }

  revoke(token: string | undefined): void {
    const p = this.parse(token);
    if (!p) return;
    const now = this.now();
    for (const [sig, exp] of this.revoked) if (exp <= now) this.revoked.delete(sig);
    this.revoked.set(p.sig, p.exp);
    this.saveRevoked();
  }

  private parse(token: string | undefined): { id: string; exp: number; sig: string } | undefined {
    const m = token ? TOKEN_RE.exec(token) : null;
    if (!m) return undefined;
    const [, id, expText, sig] = m;
    const exp = Number(expText);
    if (exp <= this.now()) return undefined;
    const hash = this.hashOf(id);
    if (!hash) return undefined;
    const want = Buffer.from(this.sign(id, exp, hash));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got) ? { id, exp, sig } : undefined;
  }

  private loadRevoked(): void {
    if (!this.revokedFile) return;
    try {
      const data = JSON.parse(readFileSync(this.revokedFile, 'utf8')) as Record<string, unknown>;
      const now = this.now();
      for (const [sig, exp] of Object.entries(data)) if (typeof exp === 'number' && exp > now) this.revoked.set(sig, exp);
    } catch {
      // ninguém encerrado ainda
    }
  }

  private saveRevoked(): void {
    if (!this.revokedFile) return;
    try {
      mkdirSync(dirname(this.revokedFile), { recursive: true });
      const tmp = `${this.revokedFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.revoked)), { mode: 0o600 });
      renameSync(tmp, this.revokedFile);
    } catch {
      // segue em memória
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function readBody(req: IncomingMessage, max = 8 * 1024): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => (size > max ? fail(new Error('big')) : ok(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', fail);
  });
}

function cookie(value: string, maxAgeS: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; ${kvSameSite(secure)}; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
}

/** Tela de login do original com a marca e o texto de quem entra com a própria conta. */
export function kvPeopleLoginPage(caDownload: boolean): string {
  return kvBrandLogin(loginPage({ caDownload })).replace(
    /<p>[^<]*npm run remote:setup[^<]*<\/p>/,
    `<p>${tr('Entre com o seu usuário e a sua senha.').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`,
  );
}

export interface KvGateDeps {
  original: Gate;
  config: Pick<RemoteConfig, 'user' | 'passwordHash'>;
  /** As sessões do gate original (token v1 = conta embutida). */
  builtin: RemoteSessions;
  people: KvPersonSessions;
  users: KvUsers;
  secure: boolean;
  caFile?: string;
  /** Nome exibido da conta embutida (perfil salvo ou o usuário). */
  builtinName?: () => string;
  verify?: (password: string, hash: PasswordHash) => Promise<boolean>;
  limiter?: KvLoginLimiter;
}

/** Endereço de quem fez a requisição: o do socket ou, vindo do proxy local (Caddy), o 1º do X-Forwarded-For. */
export function kvClientIp(req: IncomingMessage): string {
  const addr = (req.socket.remoteAddress ?? '').replace(/^::ffff:/i, '');
  const loopback = addr === '::1' || /^127\./.test(addr);
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return loopback && first && first.length <= 64 ? first : addr || '?';
}

/**
 * Freio de login por endereço E por usuário (o do original é um só para todos: quem errasse muito travava o login de
 * todo mundo). Cada chave tem o seu LoginThrottle (5 falhas, depois espera dobrando até 5 min); a tentativa passa só se
 * as duas chaves deixam. Chaves paradas há mais de 1 h são esquecidas.
 */
export class KvLoginLimiter {
  private readonly keys = new Map<string, { t: LoginThrottle; used: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private get(key: string): LoginThrottle {
    const t = this.now();
    if (this.keys.size > 5000) for (const [k, v] of this.keys) if (t - v.used > 3_600_000) this.keys.delete(k);
    let e = this.keys.get(key);
    if (!e) {
      e = { t: new LoginThrottle(this.now), used: t };
      this.keys.set(key, e);
    }
    e.used = t;
    return e.t;
  }

  /** Segundos até poder tentar de novo com este endereço e este usuário. */
  retryAfter(ip: string, user: string): number {
    return Math.max(this.get(`ip:${ip}`).retryAfter(), this.get(`u:${user.trim().toLowerCase()}`).retryAfter());
  }

  /** Começa a tentativa (conta como falha nas duas chaves) ou devolve null se o freio não deixa. */
  begin(ip: string, user: string): ((ok: boolean) => void) | null {
    const a = this.get(`ip:${ip}`);
    const b = this.get(`u:${user.trim().toLowerCase()}`);
    if (a.retryAfter() > 0 || b.retryAfter() > 0) return null;
    a.begin();
    b.begin();
    return (ok) => {
      a.end(ok);
      b.end(ok);
    };
  }
}

/** Uma senha qualquer para o scrypt rodar quando o usuário não existe (mesmo tempo de resposta). */
let dummyHash: PasswordHash | undefined;
async function dummy(): Promise<PasswordHash> {
  dummyHash ??= parsePasswordHash(await hashPassword('habblaud-kaviski-nao-existe'))!;
  return dummyHash;
}

export function builtinPerson(user: string, name?: string): KvPerson {
  return { id: BUILTIN_ID, user, name: name || user, role: 'admin', rooms: [], builtin: true };
}

/** A pessoa por trás do cookie (conta embutida pelo token v1, as de users.json pelo h1). */
export function kvResolvePerson(deps: Pick<KvGateDeps, 'builtin' | 'people' | 'users' | 'config' | 'builtinName'>, token: string | undefined): KvPerson | undefined {
  if (!token) return undefined;
  if (token.startsWith('h1.')) {
    const id = deps.people.verify(token);
    const rec = id ? deps.users.get(id) : undefined;
    return rec ? publicPerson(rec) : undefined;
  }
  return deps.builtin.verify(token) ? builtinPerson(deps.config.user, deps.builtinName?.()) : undefined;
}

export function createPeopleGate(deps: KvGateDeps): Gate {
  const limiter = deps.limiter ?? new KvLoginLimiter();
  const verify = deps.verify ?? verifyPassword;
  const caAvailable = () => {
    if (!deps.caFile) return false;
    try {
      readFileSync(deps.caFile);
      return true;
    } catch {
      return false;
    }
  };

  return (req, res, url) => {
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const token = readCookie(req.headers.cookie, COOKIE);

    if (path === '/api/remote/login') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
        return true;
      }
      const ip = kvClientIp(req);
      const tooMany = (user: string) => {
        const wait = Math.max(1, limiter.retryAfter(ip, user));
        sendJson(res, 429, { error: tr('Muitas tentativas. Tente de novo em {0} s.', [wait]) }, { 'Retry-After': String(wait) });
      };
      // O corpo inteiro primeiro: só então se sabe o usuário (o freio é por endereço e por usuário).
      let end: ((ok: boolean) => void) | null = null;
      let ok = false;
      readBody(req)
        .then(async (raw) => {
          let body: { user?: unknown; password?: unknown } = {};
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            // recusa abaixo
          }
          const user = typeof body.user === 'string' ? body.user.trim().slice(0, 64) : '';
          const password = typeof body.password === 'string' ? body.password : '';
          end = limiter.begin(ip, user);
          if (!end) return tooMany(user);
          const isBuiltin = safeEqual(user, deps.config.user);
          const rec = isBuiltin ? undefined : deps.users.byUser(user);
          const hash = isBuiltin ? deps.config.passwordHash : (rec && deps.users.hashOf(rec)) ?? (await dummy());
          const okPassword = await verify(password, hash);
          if (!okPassword || (!isBuiltin && !rec)) return sendJson(res, 401, { error: tr('Usuário ou senha incorretos.') });
          const issued = isBuiltin ? deps.builtin.issue() : deps.people.issue(rec!.id);
          if (!issued) return sendJson(res, 401, { error: tr('Usuário ou senha incorretos.') });
          ok = true;
          sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(issued.token, issued.maxAgeS, deps.secure) });
        })
        .catch(() => {
          if (!res.headersSent) sendJson(res, 400, { error: tr('requisição inválida') });
        })
        .finally(() => {
          (end as ((ok: boolean) => void) | null)?.(ok);
        });
      return true;
    }

    if (path === '/api/remote/logout') {
      req.resume();
      if (method !== 'POST') sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
      else {
        if (token?.startsWith('h1.')) deps.people.revoke(token);
        else deps.builtin.revoke(token);
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0, deps.secure) });
      }
      return true;
    }

    const person = kvResolvePerson(deps, token);

    if (path === '/login') {
      req.resume();
      if (person) {
        res.writeHead(302, { Location: kvKeepRoomQuery('/', req.url), 'Cache-Control': 'no-store' });
        res.end();
      } else {
        const html = kvPeopleLoginPage(caAvailable());
        res.writeHead(200, kvFrameHeaders({
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
        }));
        res.end(html);
      }
      return true;
    }

    if (person) {
      kvMarkRemote(req);
      kvSetPerson(req, person);
      return false;
    }
    // CA, ícones públicos, 401 e redirecionamento: como no original (um token h1 inválido lá também não vale).
    return deps.original(req, res, url);
  };
}
