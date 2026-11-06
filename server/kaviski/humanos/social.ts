// Fork Kaviski (KAVISKI-HUMANOS.md, "recursos do Gather" W2): chamar uma pessoa, reações rápidas, salas trancadas
// (bater na porta) e rodas de conversa privada. Tudo vai pelo fluxo de presença (eventos e campos a mais do `people`);
// quem recebe o quê é decidido aqui, no servidor.
//
// POST /api/kaviski/humanos/ring    {to}            chama (cutuca) alguém online que eu vejo. Quem está em "não
//                                                   perturbe" não recebe: 409 com {dnd: true}. 1 a cada 15 s para a
//                                                   mesma pessoa e 6 por minuto.
// POST /api/kaviski/humanos/react   {emoji}         reação rápida sobre o meu boneco (evento `react`, só a quem vê o
//                                                   meu boneco); ✋ levanta/baixa a mão (fica no `people`). Também
//                                   {hand: bool}    8 a cada 5 s.
// POST /api/kaviski/humanos/lock    {on, area?, veil?} tranca (on) a sala em que estou: a lista de quem pode entrar é
//                                                   quem está dentro agora. Só equipe/admin trancam; qualquer um da lista
//                                                   destranca. Destranca sozinha quando ninguém da lista está dentro.
//                                                   `veil` (sala privada): quem está fora também não vê quem está dentro.
//                                                   Reunião privada (meetings.ts) tranca e cobre a sala sozinha enquanto
//                                                   acontece, com a lista = organizador + convidados (+ quem deixarem entrar).
// POST /api/kaviski/humanos/knock   {area}          bate na porta (evento `knock` a quem está dentro). 1 a cada 8 s.
// POST /api/kaviski/humanos/knock/answer {area, who, allow}  quem está dentro deixa entrar (entra na lista) ou recusa.
// POST /api/kaviski/humanos/bubble  {action: 'start', near: [ids]}  abre uma roda privada com quem está perto (mesma
//                                   área aberta, até ~3 tiles); {action: 'add', who}; {action: 'leave'}.
//
// Sala trancada: o servidor recusa a posição dentro dela (presença), a área (chat) e o token do LiveKit de quem não está
// na lista (o guarda do kvAreaAllowed). Roda privada `b:<id>`: chat e token só para os membros; sair da área da roda
// tira a pessoa dela; com menos de 2, a roda acaba.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { OfficeSnapshot } from '../../../shared/types';
import { kvRestricted, type KvPerson } from '../../../shared/kaviski-humanos';
import { kvParsePos, type KvPos, type KvPresencePerson, type KvPresenceState } from '../../../shared/kaviski-presence';
import {
  KV_BUBBLE_MAX,
  KV_BUBBLE_TILES,
  KV_HAND,
  KV_TILE_PX,
  kvIsOpenArea,
  kvIsReaction,
  type KvKnockAnswer,
  type KvKnockEvent,
  type KvLockInfo,
  type KvReactEvent,
  type KvRingEvent,
} from '../../../shared/kaviski-social';
import { tr } from '../../../shared/i18n';
import { HttpError, readJson, sendJson } from '../../http/app';
import type { KvAudit } from './audit';
import { kvAreaAllowed } from './livekit';
import type { KvPresence } from './presence';

export const SOCIAL_PATHS = ['ring', 'react', 'lock', 'knock', 'knock/answer', 'bubble'] as const;

const RING_SAME_MS = 15_000;
const RING_PER_MIN = 6;
const REACT_MAX = 8;
const REACT_WINDOW_MS = 5_000;
const KNOCK_MS = 8_000;
/** Folga (tiles) na conferência de "está perto" do servidor (a página já escolheu quem está a até KV_BUBBLE_TILES). */
const BUBBLE_SLACK = 1.5;

interface Lock {
  area: string;
  by: { id: string; name: string };
  members: Set<string>;
  /** Quem bateu e ainda não teve resposta. */
  knocks: Map<string, number>;
  at: number;
  /** Sala privada: a posição de quem está dentro não vai a quem está fora (presença). */
  veil?: boolean;
  /** Reunião privada dona da tranca (meetings.ts): não destranca quando a sala esvazia, só quando a reunião acaba. */
  meeting?: { id: string; until: number; title: string; people: Set<string> };
}

/** Reunião privada acontecendo (meetings.ts → syncMeetingLocks). */
export interface KvMeetingLock {
  id: string;
  area: string;
  by: { id: string; name: string };
  /** Organizador + convidados. */
  members: string[];
  until: number;
  title: string;
}

interface Bubble {
  id: string;
  area: string;
  members: Set<string>;
  at: number;
}

export type KvSocialResult = { ok: true; data?: Record<string, unknown> } | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

const bad = (status: number, error: string, extra?: Record<string, unknown>): KvSocialResult => ({ ok: false, status, error, ...(extra ? { extra } : {}) });

export interface KvSocialDeps {
  presence: KvPresence;
  snapshot: () => OfficeSnapshot;
  audit?: KvAudit;
  now?: () => number;
  /** Alguém da lista destrancou a sala de uma reunião privada: a reunião deixa de ser privada (meetings.ts). */
  unlockMeeting?: (id: string, person: KvPerson) => void;
}

export class KvSocial {
  private readonly locks = new Map<string, Lock>();
  private readonly bubbles = new Map<string, Bubble>();
  /** Pessoa → roda privada em que está. */
  private readonly memberOf = new Map<string, string>();
  private readonly hands = new Set<string>();
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;
  /** Ligado enquanto se confere a regra normal da sala (sem a tranca), para quem bate na porta. */
  private bypass = false;

  constructor(private readonly deps: KvSocialDeps) {
    this.now = deps.now ?? Date.now;
  }

  private get presence(): KvPresence {
    return this.deps.presence;
  }

  // ------------------------------------------------------------------ ganchos (presença e kvAreaAllowed)

  /** Guarda do kvAreaAllowed: roda privada só para membros; sala trancada só para quem está na lista. */
  areaGuard(area: string, person: KvPerson): string | null | undefined {
    if (this.bypass) return undefined;
    if (area.startsWith('b:')) {
      const b = this.bubbles.get(area.slice(2));
      return b?.members.has(person.id) ? tr('conversa privada') : null;
    }
    const lock = this.locks.get(area);
    if (lock && !lock.members.has(person.id)) return null;
    return undefined;
  }

  /** Guarda do POST de presença: posição dentro de sala trancada (de quem não está na lista) não entra. */
  postGuard(person: KvPerson, body: Record<string, unknown>): string | null {
    if ('pos' in body) {
      const pos = kvParsePos(body.pos);
      if (pos?.k === 'r' && pos.r) {
        const lock = this.locks.get(`r:${pos.r}`);
        if (lock && !lock.members.has(person.id)) return 'locked';
      }
    }
    // a roda privada vem do servidor, nunca da página
    if (typeof body.area === 'string' && body.area.startsWith('b:')) return 'area';
    return null;
  }

  /** Campos a mais de cada pessoa no `people`. */
  extra(viewer: KvPerson, id: string): Partial<KvPresencePerson> {
    const bubble = this.memberOf.get(id);
    const hidden = viewer.id !== id && this.veiled(this.presence.areaOf(id), viewer.id);
    return { ...(this.hands.has(id) && !hidden ? { hand: true } : {}), ...(bubble ? { bubble } : {}), ...(hidden ? { meet: true } : {}) };
  }

  /** `area` é uma sala privada (coberta) e `viewerId` não está na lista: não vê quem está lá dentro. */
  veiled(area: string | undefined, viewerId: string): boolean {
    if (!area) return false;
    const l = this.locks.get(area);
    return !!l?.veil && !l.members.has(viewerId);
  }

  /**
   * As reuniões privadas acontecendo agora (meetings.ts, a cada mudança e a cada poucos segundos): cada uma tranca e
   * cobre a sala dela. Uma tranca comum que já estava lá vira a da reunião (quem estava na lista continua). Reunião que
   * acabou (ou deixou de ser privada) destranca a sala.
   */
  syncMeetingLocks(list: readonly KvMeetingLock[]): void {
    let changed = false;
    const want = new Map(list.map((m) => [m.area, m]));
    for (const l of [...this.locks.values()]) {
      if (!l.meeting) continue;
      const m = want.get(l.area);
      if (!m || m.id !== l.meeting.id) {
        this.locks.delete(l.area);
        changed = true;
      }
    }
    for (const m of list) {
      let l = this.locks.get(m.area);
      if (!l) {
        l = { area: m.area, by: m.by, members: new Set(), knocks: new Map(), at: this.now() };
        this.locks.set(m.area, l);
        changed = true;
      }
      const people = new Set(m.members);
      const before = `${l.veil}|${l.meeting?.id}|${l.meeting?.until}|${l.meeting?.title}|${[...l.members].sort().join(',')}`;
      // quem saiu da lista de convidados (edição da reunião) sai da lista, a não ser que tenham deixado entrar
      if (l.meeting) for (const id of l.meeting.people) if (!people.has(id)) l.members.delete(id);
      for (const id of people) l.members.add(id);
      l.veil = true;
      l.by = m.by;
      l.meeting = { id: m.id, until: m.until, title: m.title, people };
      if (before !== `${l.veil}|${l.meeting.id}|${l.meeting.until}|${l.meeting.title}|${[...l.members].sort().join(',')}`) changed = true;
    }
    if (changed) this.presence.touch();
  }

  /** Salas trancadas que esta página vê. */
  state(viewer: KvPerson, snap: OfficeSnapshot): Partial<KvPresenceState> {
    if (!this.locks.size) return {};
    const locks: KvLockInfo[] = [];
    for (const l of this.locks.values()) {
      if (!this.baseAllowed(l.area, viewer, snap)) continue;
      const inside = l.members.has(viewer.id);
      locks.push({
        area: l.area,
        by: l.by.name,
        n: l.members.size,
        in: inside,
        ...(l.veil ? { veil: true } : {}),
        ...(l.meeting ? { meeting: l.meeting.id, until: l.meeting.until, ...(inside ? { title: l.meeting.title } : {}) } : {}),
      });
    }
    return locks.length ? { locks } : {};
  }

  callArea(id: string): string | undefined {
    const b = this.memberOf.get(id);
    return b ? `b:${b}` : undefined;
  }

  /** A pessoa mudou de lugar ou saiu: roda (saiu da área dela) e tranca (ninguém da lista dentro). */
  changed(id: string): void {
    const online = !!this.presence.personOf(id);
    const bid = this.memberOf.get(id);
    if (bid) {
      const b = this.bubbles.get(bid);
      if (!b || !online || this.presence.areaOf(id) !== b.area) this.leaveBubble(id);
    }
    for (const l of [...this.locks.values()]) {
      if (l.meeting) continue; // a da reunião só acaba com a reunião
      if (l.members.has(id) && ![...l.members].some((m) => this.presence.areaOf(m) === l.area)) {
        this.locks.delete(l.area);
        this.presence.touch();
      }
    }
    if (!online && this.hands.delete(id)) this.presence.touch();
  }

  // ------------------------------------------------------------------ ações

  ring(person: KvPerson, b: Record<string, unknown>): KvSocialResult {
    if (!this.presence.personOf(person.id)) return bad(409, tr('abra o fluxo de presença antes'));
    const to = typeof b.to === 'string' ? b.to : '';
    if (!to || to === person.id) return bad(400, tr('chamar quem?'));
    const target = this.presence.personOf(to);
    if (!target || !this.sees(person, to)) return bad(404, tr('essa pessoa não está online'));
    if (this.presence.statusOf(to) === 'naoperturbe') return bad(409, tr('{0} está em não perturbe', [target.name]), { dnd: true });
    const t = this.now();
    if (!this.take(`ring:${person.id}:${to}`, 1, RING_SAME_MS, t)) return bad(429, tr('espere um pouco para chamar {0} de novo', [target.name]));
    if (!this.take(`ring:${person.id}`, RING_PER_MIN, 60_000, t)) return bad(429, tr('chamadas demais: espere um minuto'));
    const ev: KvRingEvent = { id: randomBytes(6).toString('base64url'), at: t, from: { id: person.id, name: person.name, role: person.role } };
    this.presence.emit('ring', ev, (viewer) => viewer.id === to);
    this.deps.audit?.add(person, 'chamar pessoa', { detail: target.name, ok: true });
    return { ok: true };
  }

  react(person: KvPerson, b: Record<string, unknown>): KvSocialResult {
    if (!this.presence.posOf(person.id)) return bad(409, tr('entre no escritório (Andar) para reagir'));
    const t = this.now();
    if (!this.take(`react:${person.id}`, REACT_MAX, REACT_WINDOW_MS, t)) return bad(429, tr('devagar com as reações'));
    if ('hand' in b || b.emoji === KV_HAND) {
      const up = 'hand' in b ? b.hand === true : !this.hands.has(person.id);
      if (up) this.hands.add(person.id);
      else this.hands.delete(person.id);
      this.presence.touch();
      return { ok: true, data: { hand: up } };
    }
    if (!kvIsReaction(b.emoji)) return bad(400, tr('reação inválida'));
    const ev: KvReactEvent = { id: randomBytes(6).toString('base64url'), at: t, who: person.id, emoji: b.emoji };
    const snap = this.deps.snapshot();
    this.presence.emit('react', ev, (viewer) => viewer.id === person.id || !!this.presence.visibleTo(viewer, snap).find((p) => p.id === person.id)?.pos);
    return { ok: true };
  }

  lock(person: KvPerson, b: Record<string, unknown>): KvSocialResult {
    const here = this.presence.areaOf(person.id);
    const snap = this.deps.snapshot();
    if (b.on === false) {
      const area = typeof b.area === 'string' ? b.area : here;
      const l = area ? this.locks.get(area) : undefined;
      if (!l) return { ok: true };
      if (!l.members.has(person.id)) return bad(403, tr('só quem está na sala destranca'));
      this.locks.delete(l.area);
      if (l.meeting) this.deps.unlockMeeting?.(l.meeting.id, person);
      this.deps.audit?.add(person, 'destrancar sala', { detail: kvAreaAllowed(l.area, person, snap), ok: true });
      this.presence.touch();
      return { ok: true };
    }
    if (kvRestricted(person)) return bad(403, tr('só a equipe tranca salas'));
    if (!here || !here.startsWith('r:')) return bad(409, tr('entre numa sala para trancá-la'));
    const veil = b.veil === true;
    const had = this.locks.get(here);
    if (had) {
      // já trancada: pode passar a privada (cobrir), nunca deixar de ser por aqui
      if (veil && !had.veil && had.members.has(person.id)) {
        had.veil = true;
        this.presence.touch();
      }
      return { ok: true };
    }
    const members = new Set(this.presence.online().filter((o) => o.area === here).map((o) => o.person.id));
    members.add(person.id);
    this.locks.set(here, { area: here, by: { id: person.id, name: person.name }, members, knocks: new Map(), at: this.now(), ...(veil ? { veil: true } : {}) });
    this.deps.audit?.add(person, 'trancar sala', { detail: kvAreaAllowed(here, person, snap), ok: true });
    this.presence.touch();
    return { ok: true };
  }

  knock(person: KvPerson, b: Record<string, unknown>): KvSocialResult {
    if (!this.presence.personOf(person.id)) return bad(409, tr('abra o fluxo de presença antes'));
    const area = typeof b.area === 'string' ? b.area : '';
    const l = this.locks.get(area);
    if (!l) return bad(409, tr('a sala não está trancada: pode entrar'));
    if (l.members.has(person.id)) return bad(409, tr('você já pode entrar'));
    if (!this.baseAllowed(area, person, this.deps.snapshot())) return bad(403, tr('essa sala não é sua'));
    const t = this.now();
    if (!this.take(`knock:${person.id}:${area}`, 1, KNOCK_MS, t)) return bad(429, tr('espere um pouco para bater de novo'));
    l.knocks.set(person.id, t);
    const ev: KvKnockEvent = { id: randomBytes(6).toString('base64url'), at: t, area, from: { id: person.id, name: person.name, role: person.role } };
    const inside = [...l.members].filter((m) => this.presence.areaOf(m) === area);
    this.presence.emit('knock', ev, (viewer) => inside.includes(viewer.id));
    return { ok: true, data: { inside: inside.length } };
  }

  answer(person: KvPerson, b: Record<string, unknown>): KvSocialResult {
    const area = typeof b.area === 'string' ? b.area : '';
    const l = this.locks.get(area);
    if (!l) return bad(409, tr('a sala não está mais trancada'));
    if (!l.members.has(person.id) || this.presence.areaOf(person.id) !== area) return bad(403, tr('só quem está na sala responde'));
    const who = typeof b.who === 'string' ? b.who : '';
    if (!l.knocks.has(who)) return bad(404, tr('ninguém bateu (ou já responderam)'));
    l.knocks.delete(who);
    const allow = b.allow === true;
    if (allow) l.members.add(who);
    const ans: KvKnockAnswer = { area, who, allow, by: person.name };
    this.presence.emit('knock-answer', ans, (viewer) => viewer.id === who || (l.members.has(viewer.id) && this.presence.areaOf(viewer.id) === area));
    const name = this.presence.personOf(who)?.name;
    this.deps.audit?.add(person, allow ? 'deixar entrar' : 'recusar entrada', { detail: [name, kvAreaAllowed(area, person, this.deps.snapshot())].filter(Boolean).join(' · '), ok: true });
    this.presence.touch();
    return { ok: true };
  }

  bubble(person: KvPerson, b: Record<string, unknown>): KvSocialResult {
    const action = b.action;
    if (action === 'leave') {
      this.leaveBubble(person.id);
      return { ok: true };
    }
    const area = this.presence.areaOf(person.id);
    if (!kvIsOpenArea(area)) return bad(409, tr('a conversa privada é para as áreas abertas (núcleo e corredor)'));
    const snap = this.deps.snapshot();
    if (action === 'add') {
      const bid = this.memberOf.get(person.id);
      const bub = bid ? this.bubbles.get(bid) : undefined;
      if (!bub) return bad(409, tr('você não está numa conversa privada'));
      const who = typeof b.who === 'string' ? b.who : '';
      if (!this.joinable(person, who, area!, snap)) return bad(409, tr('essa pessoa não está perto ou já está em outra conversa'));
      if (bub.members.size >= KV_BUBBLE_MAX) return bad(409, tr('a conversa privada está cheia'));
      bub.members.add(who);
      this.memberOf.set(who, bub.id);
      this.presence.emit('bubble', { id: bub.id, by: person.name, joined: [who] }, (viewer) => bub.members.has(viewer.id));
      this.presence.touch();
      return { ok: true, data: { id: bub.id } };
    }
    if (action !== 'start') return bad(400, tr('ação inválida'));
    const near = Array.isArray(b.near) ? b.near.filter((x): x is string => typeof x === 'string').slice(0, 40) : [];
    const mine = this.presence.posOf(person.id);
    const picked = near.filter((id, i) => near.indexOf(id) === i && this.joinable(person, id, area!, snap) && close(mine, this.presence.posOf(id)));
    if (!picked.length) return bad(409, tr('ninguém perto para a conversa privada'));
    this.leaveBubble(person.id);
    const id = randomBytes(6).toString('base64url');
    const bub: Bubble = { id, area: area!, members: new Set([person.id, ...picked.slice(0, KV_BUBBLE_MAX - 1)]), at: this.now() };
    this.bubbles.set(id, bub);
    for (const m of bub.members) this.memberOf.set(m, id);
    this.presence.emit('bubble', { id, by: person.name, joined: [...bub.members] }, (viewer) => bub.members.has(viewer.id));
    this.presence.touch();
    return { ok: true, data: { id, members: [...bub.members] } };
  }

  // ------------------------------------------------------------------ rotas

  /** As rotas desta frente. true = era uma delas (já respondida). */
  route(req: IncomingMessage, res: ServerResponse, sub: string, person: KvPerson | undefined): boolean {
    if (!(SOCIAL_PATHS as readonly string[]).includes(sub)) return false;
    if ((req.method ?? 'GET') !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: tr('método não permitido') });
      return true;
    }
    if (!person) {
      req.resume();
      sendJson(res, 403, { error: tr('entre com a sua conta para aparecer no escritório') });
      return true;
    }
    readJson(req, 4096)
      .then((body) => {
        const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const r =
          sub === 'ring'
            ? this.ring(person, b)
            : sub === 'react'
              ? this.react(person, b)
              : sub === 'lock'
                ? this.lock(person, b)
                : sub === 'knock'
                  ? this.knock(person, b)
                  : sub === 'knock/answer'
                    ? this.answer(person, b)
                    : this.bubble(person, b);
        if (!r.ok) return sendJson(res, r.status, { error: r.error, ...r.extra });
        sendJson(res, 200, { ok: true, ...r.data });
      })
      .catch((err) => {
        if (res.headersSent) return void res.destroy();
        if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
        else sendJson(res, 500, { error: tr('erro interno') });
      });
    return true;
  }

  // ------------------------------------------------------------------ apoio

  /** `viewer` vê a pessoa `id` na lista de online (a mesma regra da presença). */
  private sees(viewer: KvPerson, id: string): boolean {
    return this.presence.visibleTo(viewer, this.deps.snapshot()).some((p) => p.id === id);
  }

  /** Pode entrar na roda de `person`: online, mesma área, eu a vejo, e ainda sem roda. */
  private joinable(person: KvPerson, id: string, area: string, _snap: OfficeSnapshot): boolean {
    return !!id && id !== person.id && !!this.presence.personOf(id) && this.presence.areaOf(id) === area && !this.memberOf.has(id) && this.sees(person, id);
  }

  /** A regra normal da sala (sem a tranca). */
  private baseAllowed(area: string, person: KvPerson, snap: OfficeSnapshot): boolean {
    this.bypass = true;
    try {
      return !!kvAreaAllowed(area, person, snap);
    } finally {
      this.bypass = false;
    }
  }

  private leaveBubble(id: string): void {
    const bid = this.memberOf.get(id);
    if (!bid) return;
    this.memberOf.delete(id);
    const b = this.bubbles.get(bid);
    if (b) {
      b.members.delete(id);
      if (b.members.size < 2) {
        for (const m of b.members) this.memberOf.delete(m);
        this.bubbles.delete(bid);
      }
    }
    this.presence.touch();
  }

  /** Limite por chave: no máximo `max` em `windowMs`. */
  private take(key: string, max: number, windowMs: number, t: number): boolean {
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 2000) for (const [k, v] of this.hits) if (!v.length || t - v[v.length - 1]! > 120_000) this.hits.delete(k);
    return true;
  }
}

/** As duas posições estão perto (para a roda)? Só dá para comparar no mesmo referencial; senão, vale a área igual. */
function close(a: KvPos | undefined, b: KvPos | undefined): boolean {
  if (!a || !b) return false;
  const same = a.k === b.k && (a.k === 'a' || a.r === b.r);
  if (!same) return true;
  return Math.hypot(a.x - b.x, a.y - b.y) <= (KV_BUBBLE_TILES + BUBBLE_SLACK) * KV_TILE_PX;
}
