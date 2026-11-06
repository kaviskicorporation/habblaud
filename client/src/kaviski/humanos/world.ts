// Fork Kaviski (KAVISKI-HUMANOS.md): as pessoas dentro do escritório (fase 1b).
//
// - O meu boneco é o "visitante" que o Sim já sabe ter (sim/visitor.ts, o mesmo da cena Visita do Habblaud World):
//   chega pelo elevador da recepção, anda com setas/WASD (Shift corre, com colisão) ou com um clique (A*), e a
//   câmera vai junto. Enquanto ando, as teclas são do boneco (a câmera continua no arrastar e na roda).
// - Os outros são "bonecos de corda": Characters desenhados pelo mesmo renderer (o `people()` do Sim é embrulhado em
//   tempo de execução), indo suavemente até a última posição que a rede trouxe.
// - Ganchos no original: client/src/world/index.ts (kvAttachWorld, clique, teclas e o kv.frame no laço) e
//   render/overlay.ts (etiqueta sempre visível com o selo da pessoa). Sem HABBLAUD_HUMANOS nada disso age.
import type { AgentInfo } from '../../../../shared/types';
import type { KvLook, KvPresencePerson, KvPresenceState, KvStatus } from '../../../../shared/kaviski-presence';
import { hash32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import { appearanceFromSeed } from '../../art';
import type { Camera } from '../../world/camera';
import { RUN_SPEED, TILE, WALK_SPEED } from '../../world/constants';
import { modalOpen, type Hit } from '../../world/input';
import { intentFrom, moveKeyOf } from '../../world/city/input';
import { Character, dirOf } from '../../world/sim/character';
import type { Sim } from '../../world/sim/sim';
import { VISITOR_ID } from '../../world/sim/visitor';
import { FREE } from '../../world/path/grid';
import { kvDecodePos, kvEncodePos, type KvBuildingGeom } from './pos';
import type { KvPresenceClient } from './presence';

const PUPPET_PREFIX = 'pessoa:';
/** Fase 3: parado a até NEAR_TILES de um agente por NEAR_MS abre a gaveta dele; afastar além de LEAVE_TILES fecha. */
const NEAR_TILES = 1.8;
const LEAVE_TILES = 3.5;
const NEAR_MS = 700;
/** Quanto tempo o agente chamado fica perto de quem chamou. */
const SUMMON_MS = 45_000;
/** Distância (px) acima da qual o boneco de corda pula em vez de andar (entrou agora, ou a rede atrasou muito). */
const SNAP_PX = 6 * TILE;

/** Selo da etiqueta de cada boneco de pessoa (o overlay pergunta com kvPersonBadge). */
const badges = new WeakMap<object, string>();

/** Gancho do overlay: o selo da etiqueta se o personagem é uma pessoa (sempre com o nome à mostra). */
export function kvPersonBadge(ch: object): string | undefined {
  return badges.get(ch);
}

export const STATUS_LABEL: Record<KvStatus, string> = {
  disponivel: tr('disponível'),
  ocupado: tr('ocupado'),
  ausente: tr('ausente'),
};

const ROLE_BADGE: Record<string, string> = { admin: tr('equipe'), equipe: tr('equipe'), cliente: tr('cliente'), visitante: tr('visitante') };

function badgeOf(p: Pick<KvPresencePerson, 'role' | 'status'>): string {
  return (p.status === 'disponivel' ? (ROLE_BADGE[p.role] ?? '') : STATUS_LABEL[p.status]).toLocaleUpperCase();
}

function infoOf(id: string, p: Pick<KvPresencePerson, 'name' | 'look'>, now: number): AgentInfo {
  return {
    id,
    kind: 'main',
    provider: 'claude',
    roomId: '',
    name: p.name,
    look: p.look.look,
    ...(p.look.parts ? { parts: p.look.parts } : {}),
    role: tr('Pessoa'),
    sessionId: id,
    account: '',
    status: 'idle',
    recent: [],
    tasks: [],
    startedAt: now,
    lastEventAt: now,
    statusSince: now,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: p.look.seed,
  };
}

function lookKey(l: KvLook): string {
  return `${l.seed}|${l.look}|${l.color ?? ''}|${JSON.stringify(l.parts ?? {})}`;
}

/** Estado das pessoas que o mundo do escritório usa (preenchido por humanos/index.ts quando HABBLAUD_HUMANOS está ligado). */
export const kvPeople: {
  client: KvPresenceClient | null;
  /** Meu boneco está no escritório (botão Andar). */
  inside: boolean;
  /** Leva a câmera até a pessoa (preenchido pelo mundo do escritório). */
  follow?: (id: string) => void;
  /** Depuração pelo console (window.habblaud.kvPeople.sim()). */
  sim?: () => Sim;
  /** A câmera do escritório (mini-mapa, "Ir para a reunião"). */
  camera?: Camera;
  /**
   * Área em que o meu boneco está (a chamada de voz dela, fase 1c): `r:<id da sala>`, `a:<área do núcleo>` ou `c`
   * (corredor); null = fora do escritório ou no elevador.
   */
  area: string | null;
  /** Onde está o boneco de uma pessoa (null = o meu): px de mundo e px de tela (CSS, relativo à janela). */
  locate?: (id: string | null) => { x: number; y: number; sx: number; sy: number; zoom: number } | null;
  /** Balão sobre o boneco de uma pessoa (null = o meu): fala do chat, cumprimento (fase 2). */
  say?: (id: string | null, icon: string, text: string, ms: number) => void;
  /** Clicaram numa pessoa no escritório: abre o cartão dela (person-card.ts). */
  onPersonClick?: (id: string, at: { x: number; y: number }) => void;
  /** Pessoas no escritório com boneco aqui (id e posição em px de mundo), para achar a mais perto. */
  around?: () => { id: string; x: number; y: number }[];
  /** Abre a conversa 1:1 com a pessoa (chat.ts kvOpenDirect). */
  openDirect?: (id: string) => void;
  /** Leva o meu boneco até perto da pessoa (A*); false se não dá (fora do escritório, pessoa sem lugar aqui). */
  goTo?: (id: string) => boolean;
  /** Um agente foi chamado por uma pessoa (fase 3): ele anda até ela e fica um pouco (null = a pessoa sou eu). */
  summon?: (agentId: string, personId: string | null, name: string) => void;
} = { client: null, inside: false, area: null };

interface Puppet {
  ch: Character;
  key: string;
  target: { x: number; y: number } | null;
  m: 0 | 1 | 2;
}

export interface KvWorldCtx {
  sim(): Sim;
  camera: Camera;
  /** O mundo é o do escritório (não a cena Visita do World). */
  office: boolean;
  /** Abre (id) ou fecha (null) a gaveta de um agente (fase 3: chegar perto abre). */
  select?: (id: string | null) => void;
  /** O agente da gaveta aberta. */
  selected?: () => string | null;
}

export interface KvWorldHooks {
  /** Clique no escritório: true = já tratado (andar até lá; clique em pessoa não seleciona nada). */
  click(hit: Hit, at: { x: number; y: number }): boolean;
  /** As teclas são do meu boneco (a câmera não usa as setas/WASD). */
  walking(): boolean;
  /** A cada quadro, depois do sim.update. */
  frame(dt: number, now: number, timelapse: boolean): void;
}

const NOOP: KvWorldHooks = { click: () => false, walking: () => false, frame: () => {} };

export function kvAttachWorld(ctx: KvWorldCtx): KvWorldHooks {
  if (!ctx.office || typeof window === 'undefined') return NOOP;
  const puppets = new Map<string, Puppet>();
  const keys = new Set<string>();
  let shift = false;
  let patched: Sim | null = null;
  let myKey = '';
  let lastSend = 0;
  let wasMoving = false;

  const active = () => !!kvPeople.client && kvPeople.inside;
  /** Fase 3: o agente de quem cheguei perto (a gaveta abriu sozinha) e desde quando estou parado perto de quem. */
  let nearOpened: string | null = null;
  let nearCandidate: { id: string; since: number } | null = null;
  /** Parei perto de um agente (até NEAR_TILES) por NEAR_MS: abre a gaveta dele; me afastei: fecha (se ainda é ele). */
  const nearAgent = (sim: Sim, v: Character, moving: boolean, t: number) => {
    if (!ctx.select) return;
    let best: Character | null = null;
    let bestD = NEAR_TILES * TILE;
    for (const ch of sim.chars.values()) {
      if (ch.leaving || ch.gone || ch.alpha < 0.5) continue;
      const d = Math.hypot(ch.x - v.x, ch.y - v.y);
      if (d <= bestD) {
        bestD = d;
        best = ch;
      }
    }
    if (nearOpened && (!best || best.id !== nearOpened)) {
      const far = sim.chars.get(nearOpened);
      if (!far || Math.hypot(far.x - v.x, far.y - v.y) > LEAVE_TILES * TILE) {
        if (ctx.selected?.() === nearOpened) ctx.select(null);
        nearOpened = null;
      }
    }
    if (!best || moving) {
      nearCandidate = null;
      return;
    }
    if (best.id === nearOpened) return;
    if (nearCandidate?.id !== best.id) nearCandidate = { id: best.id, since: t };
    else if (t - nearCandidate.since >= NEAR_MS) {
      nearOpened = best.id;
      nearCandidate = null;
      if (ctx.selected?.() !== best.id) ctx.select(best.id);
    }
  };
  kvPeople.sim = ctx.sim;
  kvPeople.camera = ctx.camera;
  kvPeople.locate = (id) => {
    const sim = ctx.sim();
    const ch = id === null ? sim.visitor : puppets.get(PUPPET_PREFIX + id)?.ch;
    if (!ch || ch.gone || ch.alpha < 0.3) return null;
    const p = ctx.camera.worldToScreen(ch.x, ch.y);
    const r = document.getElementById('world')?.getBoundingClientRect();
    return { x: ch.x, y: ch.y, sx: p.x + (r?.left ?? 0), sy: p.y + (r?.top ?? 0), zoom: ctx.camera.zoom };
  };
  kvPeople.say = (id, icon, text, ms) => {
    const sim = ctx.sim();
    const ch = id === null ? sim.visitor : puppets.get(PUPPET_PREFIX + id)?.ch;
    ch?.showBubble(icon, text, ms, Date.now());
  };
  kvPeople.summon = (agentId, personId, name) => {
    const sim = ctx.sim();
    const ag = sim.chars.get(agentId);
    const to = personId === null ? sim.visitor : puppets.get(PUPPET_PREFIX + personId)?.ch;
    if (!ag || !to || ag.leaving || ag.gone) return;
    const tile = freeTileNear(sim, Math.floor(to.x / TILE), Math.floor(to.y / TILE));
    if (!tile) return;
    sim.interrupt(ag);
    const now = Date.now();
    const status = ag.info.status;
    if (ag.atSpot) ag.queue.push({ t: 'exit' });
    ag.queue.push(
      { t: 'go', tx: tile.x, ty: tile.y },
      // fica perto da pessoa até 45 s (ou até o status do agente mudar); depois o Sim decide a volta sozinho
      { t: 'until', cond: () => ag.info.status !== status, minMs: 1500, maxMs: SUMMON_MS, pose: 'stand', dir: dirOf(to.x - tile.x * TILE, to.y - tile.y * TILE, 'down') },
    );
    ag.showBubble('🏃', tr('Indo até {0}', [name]), 4_000, now);
  };
  kvPeople.goTo = (id) => {
    const sim = ctx.sim();
    const to = puppets.get(PUPPET_PREFIX + id)?.ch;
    if (!active() || !to || !sim.visitor) return false;
    const tile = freeTileNear(sim, Math.floor(to.x / TILE), Math.floor(to.y / TILE));
    if (!tile || !sim.visitorWalkTo(tile.x, tile.y, true)) return false;
    ctx.camera.follow = VISITOR_ID;
    return true;
  };
  kvPeople.around = () => [...puppets.entries()].map(([id, p]) => ({ id: id.slice(PUPPET_PREFIX.length), x: p.ch.x, y: p.ch.y }));
  kvPeople.follow = (id) => {
    ctx.camera.follow = puppets.has(PUPPET_PREFIX + id) ? PUPPET_PREFIX + id : null;
  };

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    shift = e.shiftKey;
    if (!active()) return;
    const k = moveKeyOf(e);
    if (!k) return;
    if (down) {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (modalOpen(t) || e.ctrlKey || e.metaKey || e.altKey) return;
      keys.add(k);
      e.preventDefault();
    } else keys.delete(k);
  };
  window.addEventListener('keydown', onKey(true));
  window.addEventListener('keyup', onKey(false));
  window.addEventListener('blur', () => keys.clear());

  const geom = (sim: Sim): KvBuildingGeom => {
    const rooms = [...sim.rooms.values()].filter((r) => r.present && !r.ghost).map((r) => ({ id: r.info.id, rect: r.layout.rect, side: r.layout.side }));
    const coreEndTx = Math.max(0, ...sim.building.core.map((a) => a.rect.x + a.rect.w));
    return { rooms, coreEndTx };
  };

  /** Embrulha (uma vez por Sim: o timelapse recria o Sim) o `people()` e o `person()` para incluir os bonecos de corda. */
  const patch = (sim: Sim) => {
    if (patched === sim) return;
    patched = sim;
    const people = sim.people.bind(sim);
    const person = sim.person.bind(sim);
    sim.people = function* () {
      yield* people();
      for (const p of puppets.values()) yield p.ch;
    };
    sim.person = (id: string) => person(id) ?? puppets.get(id)?.ch;
    myKey = '';
  };

  const appearance = (look: KvLook) => ({ ...appearanceFromSeed(look.seed, { look: look.look, sub: false, parts: look.parts }), lanyard: look.color ?? '#7cc8ff' });

  /** Meu boneco: entra (visitante do Sim), troca de aparência, ou sai. */
  const syncMe = (sim: Sim, state: KvPresenceState | null, now: number, timelapse: boolean) => {
    const me = state?.people.find((p) => p.id === state.me);
    if (!active() || !me || timelapse) {
      if (sim.visitor && myKey) {
        sim.setVisitor(null, now);
        myKey = '';
      }
      return;
    }
    const key = lookKey(me.look) + me.name;
    if (!sim.visitor || myKey !== key) {
      if (sim.visitor && myKey) {
        // só trocou a roupa: troca no lugar, sem voltar ao elevador
        sim.visitor.appearance = appearance(me.look);
        sim.visitor.info = { ...sim.visitor.info, name: me.name, seed: me.look.seed, look: me.look.look, parts: me.look.parts };
      } else {
        const ch = sim.setVisitor(infoOf(VISITOR_ID, me, now), now);
        if (ch) ch.appearance = appearance(me.look);
      }
      myKey = key;
    }
    if (sim.visitor) badges.set(sim.visitor, badgeOf(me));
  };

  /** Bonecos de corda: um por pessoa com posição neste prédio. */
  const syncPuppets = (state: KvPresenceState | null, g: KvBuildingGeom, dt: number, now: number, timelapse: boolean) => {
    const seen = new Set<string>();
    if (state && !timelapse) {
      for (const p of state.people) {
        if (p.id === state.me || !p.pos) continue;
        const target = kvDecodePos(g, p.pos);
        if (!target) continue;
        const id = PUPPET_PREFIX + p.id;
        seen.add(id);
        const key = lookKey(p.look) + p.name;
        let pp = puppets.get(id);
        if (!pp || pp.key !== key) {
          const ch = new Character(infoOf(id, p, now), appearance(p.look));
          if (pp) {
            ch.x = pp.ch.x;
            ch.y = pp.ch.y;
          } else {
            ch.x = target.x;
            ch.y = target.y;
          }
          ch.dir = p.pos.d;
          pp = { ch, key, target, m: p.pos.m };
          puppets.set(id, pp);
        }
        pp.target = target;
        pp.m = p.pos.m;
        if (!pp.m) pp.ch.dir = p.pos.d;
        pp.ch.alpha = p.status === 'ausente' ? 0.55 : 1;
        badges.set(pp.ch, badgeOf(p));
      }
    }
    for (const [id, pp] of puppets) {
      if (!seen.has(id)) {
        puppets.delete(id);
        continue;
      }
      const ch = pp.ch;
      ch.animT += dt * 1000;
      const t = pp.target!;
      const dx = t.x - ch.x;
      const dy = t.y - ch.y;
      const dist = Math.hypot(dx, dy);
      if (dist > SNAP_PX) {
        ch.x = t.x;
        ch.y = t.y;
        ch.setPose('stand');
      } else if (dist > 0.5) {
        const step = Math.min(dist, (pp.m === 2 ? RUN_SPEED : WALK_SPEED) * 1.15 * dt);
        ch.x += (dx / dist) * step;
        ch.y += (dy / dist) * step;
        ch.dir = dirOf(dx, dy, ch.dir);
        ch.setPose(pp.m === 2 ? 'run' : 'walk');
      } else ch.setPose('stand');
      ch.tx = Math.floor(ch.x / TILE);
      ch.ty = Math.floor(ch.y / TILE);
      ch.updateLane(dt);
    }
  };

  return {
    click(hit, at) {
      // clicar numa pessoa abre o cartão dela (andando ou não)
      if (kvPeople.client && hit?.type === 'agent' && hit.id.startsWith(PUPPET_PREFIX)) {
        kvPeople.onPersonClick?.(hit.id.slice(PUPPET_PREFIX.length), at);
        return true;
      }
      if (!active()) return false;
      const sim = ctx.sim();
      if (hit?.type === 'agent' && hit.id === VISITOR_ID) return true;
      if (hit?.type === 'agent') return false;
      const w = ctx.camera.screenToWorld(at.x, at.y);
      if (sim.visitorWalkTo(Math.floor(w.x / TILE), Math.floor(w.y / TILE))) {
        ctx.camera.follow = VISITOR_ID;
        return true;
      }
      return false;
    },
    walking: () => active(),
    frame(dt, now, timelapse) {
      const sim = ctx.sim();
      if (!kvPeople.client) return;
      patch(sim);
      const state = kvPeople.client.state;
      syncMe(sim, state, now, timelapse);
      const g = geom(sim);
      syncPuppets(state, g, dt, now, timelapse);
      const v = sim.visitor;
      if (active() && v && !timelapse) {
        const intent = intentFrom(keys, shift);
        sim.visitorIntent = intent;
        if ((intent.dx || intent.dy) && ctx.camera.follow !== VISITOR_ID) ctx.camera.follow = VISITOR_ID;
        const moving = v.pose === 'walk' || v.pose === 'run';
        const t = Date.now();
        kvPeople.area = sim.visitorBusy ? null : areaOf(sim, g, v.x, v.y);
        nearAgent(sim, v, moving, t);
        if (!sim.visitorBusy && (moving ? t - lastSend >= 100 : wasMoving || t - lastSend > 5000)) {
          lastSend = t;
          kvPeople.client.setPos(kvEncodePos(g, v.x, v.y, v.dir, moving ? (v.pose === 'run' ? 2 : 1) : 0), kvPeople.area);
        }
        wasMoving = moving;
      } else {
        kvPeople.area = null;
        // fora do escritório (ou no timelapse): os outros não me veem (setPos ignora o repetido)
        kvPeople.client.setPos(null);
        wasMoving = false;
      }
    },
  };
}

/** Um tile livre (chão, sem móvel nem assento) ao lado de (tx, ty), para o agente chamado parar. */
function freeTileNear(sim: Sim, tx: number, ty: number): { x: number; y: number } | null {
  const grid = sim.building.grid;
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [2, 0], [-2, 0], [0, -2]] as const) {
    if (grid.get(tx + dx, ty + dy) === FREE) return { x: tx + dx, y: ty + dy };
  }
  return null;
}

/** A área do escritório em (x, y): sala de projeto, área do núcleo ou corredor. */
function areaOf(sim: Sim, g: KvBuildingGeom, x: number, y: number): string {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const inRect = (r: { x: number; y: number; w: number; h: number }) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
  const room = g.rooms.find((r) => inRect(r.rect));
  if (room) return `r:${room.id}`;
  const core = sim.building.core.find((a) => inRect(a.rect));
  return core ? `a:${core.id}` : 'c';
}

/** Semente do boneco sorteado (o editor usa). */
export function kvRandomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? hash32(String(Date.now()));
}
