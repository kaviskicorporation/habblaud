// Fork Kaviski (KAVISKI-HUMANOS.md): salas próprias do escritório — a sala de cada pessoa ("Sala do Vitor"), salas de
// reunião, de descanso e outras — em <dataDir>/kaviski/rooms.json (permissão 600).
//
// GET    /api/kaviski/humanos/rooms      as salas que quem pede vê (+ o que pode criar e, para a equipe, a lista de pessoas)
// POST   /api/kaviski/humanos/rooms      cria (admin: qualquer tipo; equipe: a própria sala pessoal e salas de reunião)
// POST   /api/kaviski/humanos/rooms/:id  edita (admin ou o dono): nome, quem vê, paleta, cor, decoração
// DELETE /api/kaviski/humanos/rooms/:id  apaga (admin ou o dono)
//
// Elas NÃO entram no snapshot do Office: o Habblaud World (server/world/uplink.ts) nunca as vê, e o filtro do cliente
// fica aqui (a lista já vai filtrada; a área `r:<id>` passa por kvOwnRoomArea no kvAreaAllowed de livekit.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OfficeSnapshot } from '../../../shared/types';
import { kvAllowedRoomIds, kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import {
  KV_OWN_ROOM_KINDS,
  KV_OWN_ROOM_PREFIX,
  KV_OWN_ROOMS_MAX,
  KV_ROOM_PEOPLE_MAX,
  KV_ROOM_STYLES,
  kvCanCreateOwnRoom,
  kvCanEditOwnRoom,
  kvCanSeeOwnRoom,
  kvIsOwnRoomId,
  kvIsOwnRoomKind,
  kvOwnRoomName,
  kvParseDecor,
  type KvOwnRoom,
  type KvOwnRoomKind,
} from '../../../shared/kaviski-rooms';
import { kvColor } from '../../../shared/kaviski';
import { kvDefaultMeet, kvMeetLayoutText, kvParseMeet } from '../../../shared/kaviski-meetings';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';
import { errMsg, log } from '../../log';

interface FileShape {
  version: 1;
  rooms: KvOwnRoom[];
}

export type KvRoomResult = { ok: true; room: KvOwnRoom } | { ok: false; status: number; error: string };

export class KvRooms {
  private rooms: KvOwnRoom[] = [];
  /** Reuniões (meetings.ts): o convidado de uma reunião vê a sala dela perto do horário, mesmo sem estar na lista. */
  private guest: ((roomId: string, personId: string) => boolean) | null = null;

  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  load(): void {
    if (!this.file) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      this.rooms = (Array.isArray(data.rooms) ? data.rooms : []).filter((r) => r && kvIsOwnRoomId(r.id) && kvIsOwnRoomKind(r.kind) && typeof r.name === 'string');
      for (const r of this.rooms) {
        r.people = Array.isArray(r.people) ? r.people.filter((p) => typeof p === 'string') : [];
        r.decor = kvParseDecor(r.decor) ?? [];
        if (r.access !== 'escolhidos') r.access = 'equipe';
        if (r.kind === 'reuniao') r.meet = kvParseMeet(r.meet ?? {}) ?? kvDefaultMeet();
        else delete r.meet;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('Salas próprias: não deu para ler {0} ({1}).', [this.file, errMsg(err)]));
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.tmp`;
      const data: FileShape = { version: 1, rooms: this.rooms };
      writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      log.warn(tr('Salas próprias: não deu para gravar {0} ({1}).', [this.file, errMsg(err)]));
    }
  }

  get size(): number {
    return this.rooms.length;
  }

  list(): readonly KvOwnRoom[] {
    return this.rooms;
  }

  get(id: string): KvOwnRoom | undefined {
    return this.rooms.find((r) => r.id === id);
  }

  /** Liga a regra do convidado de reunião (meetings.ts). */
  setGuest(fn: ((roomId: string, personId: string) => boolean) | null): void {
    this.guest = fn;
  }

  /** A pessoa vê a sala: pelas regras dela ou por ser convidada de uma reunião lá agora. */
  sees(r: KvOwnRoom, person: KvPerson | undefined): boolean {
    return kvCanSeeOwnRoom(r, person) || (!!person && !!this.guest?.(r.id, person.id));
  }

  canSee(id: string, person: KvPerson | undefined): boolean {
    const r = this.get(id);
    return !!r && this.sees(r, person);
  }

  visibleTo(person: KvPerson | undefined): KvOwnRoom[] {
    return this.rooms.filter((r) => this.sees(r, person));
  }

  /** A sala pessoal de alguém. */
  personalOf(personId: string): KvOwnRoom | undefined {
    return this.rooms.find((r) => r.kind === 'pessoal' && r.owner === personId);
  }

  /**
   * Cria uma sala. `known(id)` = nome da pessoa, se ela existe (a lista de quem vê só aceita essas; o nome do dono dá o
   * nome padrão da sala pessoal, "Sala de Ana").
   */
  create(person: KvPerson, body: unknown, known: (id: string) => string | undefined): KvRoomResult {
    const b = (body ?? {}) as Record<string, unknown>;
    if (!kvIsOwnRoomKind(b.kind)) return { ok: false, status: 400, error: tr('tipo de sala inválido') };
    const kind: KvOwnRoomKind = b.kind;
    if (!kvCanCreateOwnRoom(kind, person)) return { ok: false, status: 403, error: tr('você não pode criar esse tipo de sala') };
    if (this.rooms.length >= KV_OWN_ROOMS_MAX) return { ok: false, status: 400, error: tr('salas demais (máximo {0})', [KV_OWN_ROOMS_MAX]) };
    let owner = person.id;
    if (person.role === 'admin' && typeof b.owner === 'string' && b.owner) {
      if (!known(b.owner)) return { ok: false, status: 400, error: tr('dono desconhecido') };
      owner = b.owner;
    }
    if (kind === 'pessoal' && this.personalOf(owner)) return { ok: false, status: 409, error: tr('essa pessoa já tem uma sala pessoal') };
    const t = this.now();
    const room: KvOwnRoom = {
      id: `${KV_OWN_ROOM_PREFIX}${randomBytes(8).toString('base64url').slice(0, 10)}`,
      kind,
      name: '',
      owner,
      access: 'equipe',
      people: [],
      style: Math.floor(Math.random() * KV_ROOM_STYLES),
      decor: [],
      ...(kind === 'reuniao' ? { meet: kvDefaultMeet() } : {}),
      createdAt: t,
      updatedAt: t,
    };
    const err = this.apply(room, b, known, true);
    if (err) return { ok: false, status: 400, error: err };
    if (!room.name) {
      const who = known(owner) ?? person.name;
      const meetName = room.meet ? kvMeetLayoutText(room.meet.layout).name : tr('Reunião');
      room.name = kvOwnRoomName(kind === 'pessoal' ? tr('Sala de {0}', [who]) : kind === 'reuniao' ? meetName : kind === 'descanso' ? tr('Descanso') : tr('Sala')) ?? tr('Sala');
    }
    this.rooms.push(room);
    this.save();
    return { ok: true, room };
  }

  update(person: KvPerson, id: string, body: unknown, known: (id: string) => string | undefined): KvRoomResult {
    const room = this.get(id);
    if (!room || !kvCanSeeOwnRoom(room, person)) return { ok: false, status: 404, error: tr('sala não encontrada') };
    if (!kvCanEditOwnRoom(room, person)) return { ok: false, status: 403, error: tr('só o dono da sala ou um admin muda a sala') };
    const next: KvOwnRoom = { ...room, people: [...room.people], decor: [...room.decor], ...(room.meet ? { meet: { ...room.meet, equipment: [...room.meet.equipment] } } : {}) };
    const err = this.apply(next, (body ?? {}) as Record<string, unknown>, known, false);
    if (err) return { ok: false, status: 400, error: err };
    // trocar o dono (só admin) não pode dar duas salas pessoais à mesma pessoa
    if (person.role === 'admin' && typeof (body as { owner?: unknown })?.owner === 'string') {
      const owner = (body as { owner: string }).owner;
      if (!known(owner)) return { ok: false, status: 400, error: tr('dono desconhecido') };
      if (next.kind === 'pessoal' && owner !== room.owner && this.personalOf(owner)) return { ok: false, status: 409, error: tr('essa pessoa já tem uma sala pessoal') };
      next.owner = owner;
    }
    next.updatedAt = this.now();
    Object.assign(room, next);
    this.save();
    return { ok: true, room };
  }

  remove(person: KvPerson, id: string): KvRoomResult {
    const room = this.get(id);
    if (!room || !kvCanSeeOwnRoom(room, person)) return { ok: false, status: 404, error: tr('sala não encontrada') };
    if (!kvCanEditOwnRoom(room, person)) return { ok: false, status: 403, error: tr('só o dono da sala ou um admin apaga a sala') };
    this.rooms = this.rooms.filter((r) => r !== room);
    this.save();
    return { ok: true, room };
  }

  /** Aplica os campos editáveis do corpo; devolve o erro (texto) ou null. O tipo não muda depois de criada. */
  private apply(room: KvOwnRoom, b: Record<string, unknown>, known: (id: string) => string | undefined, creating: boolean): string | null {
    if (b.name !== undefined) {
      const name = kvOwnRoomName(b.name);
      if (!name && !creating) return tr('nome inválido');
      if (name) room.name = name;
    }
    if (b.access !== undefined) {
      if (b.access !== 'equipe' && b.access !== 'escolhidos') return tr('“quem vê” inválido');
      room.access = b.access;
    }
    if (b.people !== undefined) {
      if (!Array.isArray(b.people) || b.people.length > KV_ROOM_PEOPLE_MAX) return tr('lista de pessoas inválida');
      const ids: string[] = [];
      for (const p of b.people) {
        if (typeof p !== 'string' || !known(p)) return tr('pessoa desconhecida na lista');
        if (!ids.includes(p) && p !== room.owner) ids.push(p);
      }
      room.people = ids;
    }
    if (b.style !== undefined) {
      if (typeof b.style !== 'number' || !Number.isInteger(b.style) || b.style < 0 || b.style >= KV_ROOM_STYLES) return tr('estilo inválido');
      room.style = b.style;
    }
    if (b.color !== undefined) {
      if (b.color === null || b.color === '') delete room.color;
      else {
        const c = kvColor(b.color);
        if (!c) return tr('cor inválida (use #rgb ou #rrggbb)');
        room.color = c;
      }
    }
    if (b.decor !== undefined) {
      const decor = kvParseDecor(b.decor);
      if (!decor) return tr('decoração inválida');
      room.decor = decor;
    }
    if (b.meet !== undefined && b.meet !== null) {
      if (room.kind !== 'reuniao') return tr('só a sala de reunião tem tipo, lugares e reservas');
      const meet = kvParseMeet(b.meet, room.meet);
      if (!meet) return tr('configuração da sala de reunião inválida');
      room.meet = meet;
    }
    return null;
  }
}

// ------------------------------------------------------------------ ponte para as checagens de área

let active: KvRooms | null = null;

/** Liga as salas próprias nas checagens de área (kvAreaAllowed, presença). Chamado por createHumanos. */
export function kvUseRooms(rooms: KvRooms | null): void {
  active = rooms;
}

/**
 * Para kvAreaAllowed: se `id` é de uma sala própria, o nome dela quando a pessoa a vê (ou undefined, quando não vê);
 * null quando o id não é de sala própria (a checagem segue para as salas do snapshot).
 */
export function kvOwnRoomArea(id: string, person: KvPerson): string | undefined | null {
  if (!kvIsOwnRoomId(id)) return null;
  const r = active?.get(id);
  return r && active!.sees(r, person) ? r.name : undefined;
}

/** Ids das salas próprias que a pessoa vê. */
export function kvOwnRoomIdsFor(person: KvPerson): Set<string> {
  return new Set((active?.visibleTo(person) ?? []).map((r) => r.id));
}

/** Salas liberadas para um cliente/visitante: as do snapshot pelas regras dele + as salas próprias que ele vê. */
export function kvRoomIdsFor(snap: Pick<OfficeSnapshot, 'rooms'>, person: KvPerson): Set<string> {
  const ids = kvAllowedRoomIds(snap, person.rooms);
  for (const id of kvOwnRoomIdsFor(person)) ids.add(id);
  return ids;
}

// ------------------------------------------------------------------ rota

export const ROOMS_PATH = '/api/kaviski/humanos/rooms';

export interface KvRoomsRouteDeps {
  rooms: KvRooms;
  whoIs(req: IncomingMessage): KvPerson | undefined;
  /** Pessoas que existem (para o dono e a lista de quem vê). */
  people(): KvPerson[];
  /** Avisa as páginas (evento `rooms` do fluxo de presença) que a lista mudou. */
  changed(): void;
  /** Sala apagada: some com os objetos dela (quadro, mural, links). */
  removed?(id: string): void;
  audit?(person: KvPerson, action: string, detail: string, ok: boolean): void;
}

/** Visão da sala para quem pede: com `canEdit`. A lista de pessoas só vai para quem pode editar. */
function view(r: KvOwnRoom, person: KvPerson) {
  const edit = kvCanEditOwnRoom(r, person);
  const out: KvOwnRoom & { canEdit?: boolean } = { ...r, people: edit ? [...r.people] : [], decor: [...r.decor] };
  if (edit) out.canEdit = true;
  return out;
}

export function kvRoomsRoute(req: IncomingMessage, res: ServerResponse, path: string, deps: KvRoomsRouteDeps): void {
  const method = req.method ?? 'GET';
  const person = deps.whoIs(req);
  const fail = (err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };
  if (!person) {
    req.resume();
    return sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
  }
  const known = (id: string) => deps.people().find((p) => p.id === id)?.name;
  if (path === ROOMS_PATH) {
    if (method === 'GET' || method === 'HEAD') {
      req.resume();
      const restricted = kvRestricted(person);
      return sendJson(res, 200, {
        rooms: deps.rooms.visibleTo(person).map((r) => view(r, person)),
        canCreate: KV_OWN_ROOM_KINDS.filter((k) => kvCanCreateOwnRoom(k, person) && !(k === 'pessoal' && person.role !== 'admin' && deps.rooms.personalOf(person.id))),
        mine: deps.rooms.personalOf(person.id)?.id ?? null,
        // quem pode ser escolhido (dono, lista de quem vê): só para a equipe; cliente/visitante não lista ninguém
        ...(restricted ? {} : { people: deps.people().map((p) => ({ id: p.id, name: p.name, role: p.role })) }),
      });
    }
    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    readJson(req, 16_384)
      .then((body) => {
        const r = deps.rooms.create(person, body, known);
        deps.audit?.(person, 'criar sala', r.ok ? r.room.name : String((body as { kind?: unknown })?.kind ?? ''), r.ok);
        if (!r.ok) throw new HttpError(r.status, r.error);
        log.info(tr('Salas próprias: {0} criou "{1}" ({2}).', [person.name, r.room.name, r.room.kind]));
        deps.changed();
        sendJson(res, 201, { room: view(r.room, person) });
      })
      .catch(fail);
    return;
  }
  let id: string;
  try {
    id = decodeURIComponent(path.slice(ROOMS_PATH.length + 1));
  } catch {
    req.resume();
    return sendJson(res, 400, { error: tr('id inválido') });
  }
  if (method === 'DELETE') {
    req.resume();
    const r = deps.rooms.remove(person, id);
    if (!r.ok) return sendJson(res, r.status, { error: r.error });
    deps.audit?.(person, 'apagar sala', r.room.name, true);
    deps.removed?.(id);
    deps.changed();
    return sendJson(res, 200, { ok: true });
  }
  if (method !== 'POST') {
    req.resume();
    res.setHeader('Allow', 'POST, DELETE');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  readJson(req, 16_384)
    .then((body) => {
      const r = deps.rooms.update(person, id, body, known);
      if (!r.ok) throw new HttpError(r.status, r.error);
      deps.changed();
      sendJson(res, 200, { room: view(r.room, person) });
    })
    .catch(fail);
}
