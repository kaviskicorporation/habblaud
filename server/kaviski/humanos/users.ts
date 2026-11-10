// Fork Kaviski (KAVISKI-HUMANOS.md): contas das pessoas em <dataDir>/kaviski/users.json (permissão 600).
//
// Cada conta: usuário, nome, papel, salas permitidas e o hash scrypt da senha (o mesmo formato de remote/password.ts,
// nunca a senha). A conta do HABBLAUD_REMOTE_USER não mora aqui: é a "embutida" (admin), com a senha do .env.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword, parsePasswordHash, type PasswordHash } from '../../remote/password';
import {
  KV_PASSWORD_MAX,
  KV_PASSWORD_MIN,
  KV_PEOPLE_MAX,
  kvIsRole,
  kvPersonName,
  kvRoomRules,
  kvUserName,
  type KvPerson,
  type KvRole,
} from '../../../shared/kaviski-humanos';
import { tr } from '../../../shared/i18n';
import { log } from '../../log';
import { kvMaxPessoas } from '../cloud';

export interface KvUserRecord {
  id: string;
  user: string;
  name: string;
  role: KvRole;
  rooms: string[];
  /** Cliente pode pedir tarefas aos agentes das salas dele (fase 3). */
  request?: boolean;
  /** Hash scrypt (remote/password.ts). */
  hash: string;
  createdAt: number;
  updatedAt: number;
  /** Dados livres do perfil (boneco etc., fase 1b). */
  profile?: Record<string, unknown>;
}

interface FileShape {
  version: 1;
  users: KvUserRecord[];
  /** Perfil da conta embutida (HABBLAUD_REMOTE_USER). */
  builtinProfile?: Record<string, unknown>;
}

export type KvUserResult = { ok: true; person: KvPerson } | { ok: false; status: number; error: string };

export const BUILTIN_ID = 'admin';

export function publicPerson(r: Pick<KvUserRecord, 'id' | 'user' | 'name' | 'role' | 'rooms' | 'createdAt' | 'request'>, builtin = false): KvPerson {
  return {
    id: r.id,
    user: r.user,
    name: r.name,
    role: r.role,
    rooms: [...r.rooms],
    createdAt: r.createdAt,
    ...(builtin ? { builtin: true } : {}),
    ...(r.role === 'cliente' && r.request ? { request: true } : {}),
  };
}

function validPassword(v: unknown): v is string {
  return typeof v === 'string' && v.length >= KV_PASSWORD_MIN && v.length <= KV_PASSWORD_MAX;
}

/** Quem tem perfil mas não é conta (visitantes dos convites, invites.ts). */
export interface KvGuestProfiles {
  has(id: string): boolean;
  profile(id: string): Record<string, unknown>;
  setProfile(id: string, profile: Record<string, unknown>): boolean;
}

export class KvUsers {
  private users: KvUserRecord[] = [];
  private guests: KvGuestProfiles | null = null;
  private builtinProfile: Record<string, unknown> = {};
  private readonly parsed = new Map<string, PasswordHash>();

  constructor(
    private readonly file: string | null,
    /** Usuário da conta embutida (não pode ser repetido aqui). */
    private readonly builtinUser: string | undefined,
    private readonly now: () => number = Date.now,
    private readonly hasher: (password: string) => Promise<string> = (p) => hashPassword(p),
  ) {}

  load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      const list = Array.isArray(data.users) ? data.users : [];
      this.users = list.filter(
        (u): u is KvUserRecord =>
          !!u && typeof u.id === 'string' && !!kvUserName(u.user) && kvIsRole(u.role) && typeof u.hash === 'string' && !!parsePasswordHash(u.hash),
      ).map((u) => ({ ...u, name: kvPersonName(u.name) ?? u.user, rooms: kvRoomRules(u.rooms) ?? [] }));
      this.builtinProfile = data.builtinProfile && typeof data.builtinProfile === 'object' ? data.builtinProfile : {};
    } catch (err) {
      log.warn(tr('users.json ilegível ({0}); só a conta do .env entra.', [(err as Error).message]));
    }
  }

  private save(): void {
    if (!this.file) return;
    const data: FileShape = { version: 1, users: this.users, builtinProfile: this.builtinProfile };
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  get size(): number {
    return this.users.length;
  }

  list(): KvUserRecord[] {
    return [...this.users];
  }

  get(id: string): KvUserRecord | undefined {
    return this.users.find((u) => u.id === id);
  }

  byUser(user: string): KvUserRecord | undefined {
    const u = user.trim().toLowerCase();
    return this.users.find((r) => r.user === u);
  }

  /** Hash já interpretado (guardado em memória: o login confere sem reler). */
  hashOf(r: KvUserRecord): PasswordHash | undefined {
    let h = this.parsed.get(r.hash);
    if (!h) {
      h = parsePasswordHash(r.hash);
      if (h) this.parsed.set(r.hash, h);
    }
    return h;
  }

  /** Perfis dos visitantes (fase 4): profile/setProfile valem para eles também. */
  attachGuests(g: KvGuestProfiles): void {
    this.guests = g;
  }

  profile(id: string): Record<string, unknown> {
    if (this.guests?.has(id)) return this.guests.profile(id);
    return id === BUILTIN_ID ? { ...this.builtinProfile } : { ...(this.get(id)?.profile ?? {}) };
  }

  setProfile(id: string, profile: Record<string, unknown>): boolean {
    if (this.guests?.has(id)) return this.guests.setProfile(id, profile);
    if (id === BUILTIN_ID) this.builtinProfile = profile;
    else {
      const r = this.get(id);
      if (!r) return false;
      r.profile = profile;
    }
    this.save();
    return true;
  }

  private taken(user: string): boolean {
    return (!!this.builtinUser && user === this.builtinUser.trim().toLowerCase()) || !!this.byUser(user);
  }

  async create(body: unknown): Promise<KvUserResult> {
    const b = (body ?? {}) as Record<string, unknown>;
    const user = kvUserName(b.user);
    if (!user) return { ok: false, status: 400, error: tr('usuário inválido: 2 a 32 letras minúsculas, números, ponto, hífen ou sublinhado') };
    if (this.taken(user)) return { ok: false, status: 409, error: tr('esse usuário já existe') };
    const max = kvMaxPessoas(KV_PEOPLE_MAX); // Voxtrin Cloud: o plano limita as pessoas
    if (this.users.length >= max.contas) return { ok: false, status: 400, error: tr('pessoas demais (máximo {0})', [max.total]) };
    const name = kvPersonName(b.name) ?? user;
    if (!kvIsRole(b.role)) return { ok: false, status: 400, error: tr('papel inválido (admin, equipe ou cliente)') };
    const rooms = kvRoomRules(b.rooms ?? []);
    if (!rooms) return { ok: false, status: 400, error: tr('salas inválidas: use caminhos absolutos (ex.: /home/hostadmin/projetos/Clientes/12-Rarm)') };
    if (!validPassword(b.password)) return { ok: false, status: 400, error: tr('senha precisa ter de {0} a {1} caracteres', [KV_PASSWORD_MIN, KV_PASSWORD_MAX]) };
    const t = this.now();
    const rec: KvUserRecord = { id: randomBytes(9).toString('base64url'), user, name, role: b.role, rooms, hash: await this.hasher(b.password), createdAt: t, updatedAt: t };
    if (b.request === true) rec.request = true;
    // Outra criação com o mesmo usuário pode ter terminado enquanto o scrypt rodava.
    if (this.taken(user)) return { ok: false, status: 409, error: tr('esse usuário já existe') };
    this.users.push(rec);
    this.save();
    return { ok: true, person: publicPerson(rec) };
  }

  async update(id: string, body: unknown): Promise<KvUserResult> {
    const b = (body ?? {}) as Record<string, unknown>;
    const cur = this.get(id);
    if (!cur) return { ok: false, status: 404, error: tr('pessoa não encontrada') };
    const next = { ...cur };
    if (b.name !== undefined) {
      const name = kvPersonName(b.name);
      if (!name) return { ok: false, status: 400, error: tr('nome inválido') };
      next.name = name;
    }
    if (b.role !== undefined) {
      if (!kvIsRole(b.role)) return { ok: false, status: 400, error: tr('papel inválido (admin, equipe ou cliente)') };
      next.role = b.role;
    }
    if (b.rooms !== undefined) {
      const rooms = kvRoomRules(b.rooms);
      if (!rooms) return { ok: false, status: 400, error: tr('salas inválidas: use caminhos absolutos (ex.: /home/hostadmin/projetos/Clientes/12-Rarm)') };
      next.rooms = rooms;
    }
    if (b.request !== undefined) {
      if (typeof b.request !== 'boolean') return { ok: false, status: 400, error: tr('esperado request: true ou false') };
      if (b.request) next.request = true;
      else delete next.request;
    }
    if (b.password !== undefined && b.password !== '') {
      if (!validPassword(b.password)) return { ok: false, status: 400, error: tr('senha precisa ter de {0} a {1} caracteres', [KV_PASSWORD_MIN, KV_PASSWORD_MAX]) };
      next.hash = await this.hasher(b.password);
    }
    const i = this.users.findIndex((u) => u.id === id);
    if (i < 0) return { ok: false, status: 404, error: tr('pessoa não encontrada') };
    next.updatedAt = this.now();
    this.users[i] = next;
    this.save();
    return { ok: true, person: publicPerson(next) };
  }

  remove(id: string): boolean {
    const i = this.users.findIndex((u) => u.id === id);
    if (i < 0) return false;
    this.users.splice(i, 1);
    this.save();
    return true;
  }
}
