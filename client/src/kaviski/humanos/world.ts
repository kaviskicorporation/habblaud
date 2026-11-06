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
import type { KvLook, KvPos, KvPresencePerson, KvPresenceState, KvStatus } from '../../../../shared/kaviski-presence';
import { kvSeatedPose } from '../../../../shared/kaviski-desk';
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
import type { SpotDef } from '../../world/layout/types';
import { NO_INTENT } from '../../world/sim/visitor';
import { kvDecodePos, kvEncodePos, type KvBuildingGeom } from './pos';
import type { KvPresenceClient } from './presence';
import { DESK_OWNER, KvMeCtl } from './me';
import { freeTileAt, freeTileNear, KV_DESK_KINDS, KV_SIT_KINDS, seatAt } from './seats';
import { kvStick } from './stick';
import { kvDeskLabels } from './desk-labels';
import { kvShortNote } from './status-text';
import { kvPlanGeomOf } from '../plan/hooks'; // planta livre

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
  naoperturbe: tr('não perturbe'),
};

const ROLE_BADGE: Record<string, string> = { admin: tr('equipe'), equipe: tr('equipe'), cliente: tr('cliente'), visitante: tr('visitante') };

function badgeOf(p: Pick<KvPresencePerson, 'role' | 'status' | 'note'>): string {
  const base = (p.status === 'disponivel' ? (ROLE_BADGE[p.role] ?? '') : STATUS_LABEL[p.status]).toLocaleUpperCase();
  // W2: a nota do status (emoji + texto curto) no selo
  return p.note ? `${p.status === 'disponivel' ? '' : `${base} · `}${kvShortNote(p.note)}` : base;
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
  // ---- W1 (boneco, mesa, móveis): me.ts, furniture.ts, goto.ts, focus.ts, touch.ts
  /** Modo clássico: o boneco descansa no lounge e o Habblaud volta ao original (`inside` fica false). */
  resting: boolean;
  /** Minha mesa fixa (perfil `desk`), ou null. */
  myDesk: { roomId: string; pos: KvPos } | null;
  /** Quem o meu boneco está seguindo. */
  following: { id: string; name: string } | null;
  /** Chamado a cada quadro com o meu boneco no escritório (andando, não descansando). */
  onFrame: Set<(dt: number, now: number) => void>;
  /** Anda até o tile (A*); levanta antes, se preciso. */
  walkTo?: (tx: number, ty: number, run?: boolean) => boolean;
  /** Anda até ao lado de uma pessoa. */
  goNear?: (personId: string) => boolean;
  /** Anda até uma área: `r:<sala>` (perto da porta), `a:core:xxx` (o meio dela) ou `c` (corredor). */
  goArea?: (area: string) => boolean;
  /** Para de seguir / ir até / andar pelo clique. */
  stopMe?: () => void;
  /** Segue uma pessoa até eu andar ou parar (Esc). */
  followPerson?: (personId: string, name: string) => boolean;
  /** Aparece ao lado da pessoa. */
  teleportTo?: (personId: string) => boolean;
  /** Vai até a mesa fixa de alguém (null = a minha, e senta). */
  goDesk?: (personId: string | null) => boolean;
  /** px de mundo -> px de tela (CSS, relativo à janela). */
  toScreen?: (x: number, y: number) => { sx: number; sy: number; zoom: number };
  /** Posição de mundo -> KvPos deste prédio (para guardar a mesa). */
  encode?: (x: number, y: number, d: KvPos['d']) => KvPos;
  /** O controle do meu boneco e o Sim (furniture.ts). */
  ctl?: () => { sim: Sim; me: KvMeCtl } | null;
  /** Clicaram num assento (com o meu boneco ativo): furniture.ts abre o menu dele. */
  onSeatClick?: (spot: SpotDef, at: { x: number; y: number }) => void;
  /** Planta livre (frente C): clicaram no mundo em (x, y) px; true = era um item interativo (go-and-do.ts). */
  onItemClick?: (x: number, y: number) => boolean;
  /** W2: a área de voz e chat que vale para mim — `b:<id>` numa roda privada; undefined = a de `area` (bubble.ts). */
  callArea?: string | null;
  /** KvPos -> px de mundo neste prédio (null = a sala não está aqui). Planta livre: agentes fixos (fixed-agents.ts). */
  decode?: (p: KvPos) => { x: number; y: number } | null;
  /** Chamado a cada quadro com pessoas no escritório (com ou sem o meu boneco; fora do timelapse), depois das mesas. */
  onTick: Set<(sim: Sim, now: number) => void>;
} = { client: null, inside: false, area: null, resting: false, myDesk: null, following: null, onFrame: new Set(), onTick: new Set() };

interface Puppet {
  ch: Character;
  key: string;
  target: { x: number; y: number } | null;
  m: 0 | 1 | 2;
  /** Pose parada que veio pela rede (W1) e o assento em que ela senta aqui. */
  pose?: KvPos['p'];
  held?: KvPos['h'];
  seat?: SpotDef | null;
  seatKey?: string;
}

const RESTING_BADGE = () => tr('descansando').toLocaleUpperCase();

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
  /** Duplo clique (W1): true = o boneco correu até o clique (não foca nada). */
  doubleClick(hit: Hit): boolean;
}

const NOOP: KvWorldHooks = { click: () => false, walking: () => false, frame: () => {}, doubleClick: () => false };

export function kvAttachWorld(ctx: KvWorldCtx): KvWorldHooks {
  if (!ctx.office || typeof window === 'undefined') return NOOP;
  const puppets = new Map<string, Puppet>();
  const keys = new Set<string>();
  let shift = false;
  let patched: Sim | null = null;
  let myKey = '';
  let lastSend = 0;

  const active = () => !!kvPeople.client && kvPeople.inside;
  /** O boneco existe (andando ou descansando no modo clássico). */
  const present = () => !!kvPeople.client && (kvPeople.inside || kvPeople.resting);
  let geomCache: KvBuildingGeom = { rooms: [], coreEndTx: 0 };
  /** A cadeira de uma mesa fixa neste prédio. */
  const deskSpot = (sim: Sim, desk: KvPos | undefined | null): SpotDef | null => {
    if (!desk?.r) return null;
    const at = kvDecodePos(geomCache, desk);
    if (!at) return null;
    const s = seatAt(sim.spots.all(), at.x, at.y);
    return s && s.areaId === desk.r && KV_DESK_KINDS.includes(s.kind) ? s : null;
  };
  const me = new KvMeCtl(
    (sim) => deskSpot(sim, kvPeople.myDesk?.pos),
    () => kvPeople.client?.state?.me ?? null,
  );
  const wherePuppet = (id: string) => {
    const pp = puppets.get(PUPPET_PREFIX + id);
    return pp && !pp.ch.gone ? { x: pp.ch.x, y: pp.ch.y } : null;
  };
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
  kvPeople.decode = (p) => kvDecodePos(geomCache, p);
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
    const who = kvPeople.client?.state?.people.find((p) => p.id === (personId ?? kvPeople.client?.state?.me));
    // com mesa fixa, o agente vai até a mesa (W1); sem, até o boneco
    const desk = deskSpot(sim, who?.desk);
    const to = desk ?? (personId === null ? sim.visitor : puppets.get(PUPPET_PREFIX + personId)?.ch);
    if (!ag || !to || ag.leaving || ag.gone) return;
    const tile = desk ? freeTileNear(sim.building.grid, desk.tx, desk.ty, 3) : freeTileNear(sim.building.grid, Math.floor(to.x / TILE), Math.floor(to.y / TILE), 2);
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
  kvPeople.around = () => [...puppets.entries()].map(([id, p]) => ({ id: id.slice(PUPPET_PREFIX.length), x: p.ch.x, y: p.ch.y }));
  kvPeople.follow = (id) => {
    ctx.camera.follow = puppets.has(PUPPET_PREFIX + id) ? PUPPET_PREFIX + id : null;
  };
  // ---- W1: andar, seguir, teleportar, mesa
  const mine = () => (active() && ctx.sim().visitor ? ctx.sim() : null);
  const followMe = () => {
    ctx.camera.follow = VISITOR_ID;
  };
  kvPeople.ctl = () => (present() && ctx.sim().visitor ? { sim: ctx.sim(), me } : null);
  kvPeople.walkTo = (tx, ty, run = false) => {
    const sim = mine();
    if (!sim || !me.walkTo(sim, tx, ty, run)) return false;
    followMe();
    return true;
  };
  kvPeople.goNear = (id) => {
    const sim = mine();
    const t = wherePuppet(id);
    if (!sim || !t) return false;
    const tile = freeTileNear(sim.building.grid, Math.floor(t.x / TILE), Math.floor(t.y / TILE), 3);
    return !!tile && kvPeople.walkTo!(tile.x, tile.y, Math.hypot(t.x - (sim.visitor?.x ?? 0), t.y - (sim.visitor?.y ?? 0)) > 10 * TILE);
  };
  kvPeople.goTo = (id) => kvPeople.goNear!(id);
  kvPeople.goArea = (area) => {
    const sim = mine();
    if (!sim) return false;
    const grid = sim.building.grid;
    let tile: { x: number; y: number } | null = null;
    if (area === 'c') {
      const v = sim.visitor!;
      const c = sim.building.corridor.rect;
      tile = freeTileAt(grid, Math.max(c.x, Math.min(c.x + c.w - 1, v.tx)), c.y + Math.floor(c.h / 2), 4);
    } else if (area.startsWith('r:')) {
      const room = sim.rooms.get(area.slice(2));
      const d = room?.present ? room.layout.door : undefined;
      const r = room?.layout.rect;
      // um passo para dentro da porta (planta livre: porta em qualquer lado)
      if (d && r && (d.x === r.x || d.x + d.w === r.x + r.w) && d.h > d.w) tile = freeTileAt(grid, d.x === r.x ? d.x + 2 : d.x - 2, d.y + Math.floor(d.h / 2), 3);
      else if (d && r) tile = freeTileAt(grid, d.x + Math.floor(d.w / 2), d.y < r.y + r.h / 2 ? d.y + d.h + 1 : d.y - 2, 3);
      else if (r) tile = freeTileAt(grid, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), 5);
    } else if (area.startsWith('a:')) {
      const r = sim.building.core.find((a) => a.id === area.slice(2))?.rect;
      if (r) tile = freeTileAt(grid, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), 5);
    }
    return !!tile && kvPeople.walkTo!(tile.x, tile.y, true);
  };
  kvPeople.stopMe = () => {
    me.follow = null;
    const v = ctx.sim().visitor;
    if (v && !me.seat && !ctx.sim().visitorBusy && v.step?.t === 'go') {
      v.queue.length = 0;
      v.step = null;
    }
  };
  kvPeople.followPerson = (id, name) => {
    const sim = mine();
    if (!sim || !wherePuppet(id)) return false;
    me.follow = { id, name, goal: null, at: 0 };
    followMe();
    return true;
  };
  kvPeople.teleportTo = (id) => {
    const sim = mine();
    const t = wherePuppet(id);
    if (!sim || !t || !me.teleport(sim, t.x, t.y, Date.now())) return false;
    followMe();
    return true;
  };
  kvPeople.goDesk = (id) => {
    const sim = mine();
    if (!sim) return false;
    if (id === null) {
      if (!me.goDesk(sim)) return false;
      followMe();
      return true;
    }
    const s = deskSpot(sim, kvPeople.client?.state?.people.find((p) => p.id === id)?.desk);
    const tile = s ? freeTileNear(sim.building.grid, s.tx, s.ty, 3) : null;
    return !!tile && kvPeople.walkTo!(tile.x, tile.y, true);
  };
  kvPeople.toScreen = (x, y) => {
    const p = ctx.camera.worldToScreen(x, y);
    const r = document.getElementById('world')?.getBoundingClientRect();
    return { sx: p.x + (r?.left ?? 0), sy: p.y + (r?.top ?? 0), zoom: ctx.camera.zoom };
  };
  kvPeople.encode = (x, y, d) => kvEncodePos(geomCache, x, y, d, 0);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !me.follow) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || modalOpen(t)) return;
    kvPeople.stopMe?.();
  });

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
    const plan = kvPlanGeomOf(sim); // planta livre: fora das salas a posição vai absoluta
    return plan ? { rooms, coreEndTx, plan } : { rooms, coreEndTx };
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
    const mePerson = state?.people.find((p) => p.id === state.me);
    if (!present() || !mePerson || timelapse) {
      if (sim.visitor && myKey) {
        for (const id of sim.spots.reservedBy(VISITOR_ID)) sim.spots.release(id, VISITOR_ID);
        sim.setVisitor(null, now);
        myKey = '';
      }
      return;
    }
    const key = lookKey(mePerson.look) + mePerson.name;
    if (!sim.visitor || myKey !== key) {
      if (sim.visitor && myKey) {
        // só trocou a roupa: troca no lugar, sem voltar ao elevador
        sim.visitor.appearance = appearance(mePerson.look);
        sim.visitor.info = { ...sim.visitor.info, name: mePerson.name, seed: mePerson.look.seed, look: mePerson.look.look, parts: mePerson.look.parts };
      } else {
        const ch = sim.setVisitor(infoOf(VISITOR_ID, mePerson, now), now);
        if (ch) {
          ch.appearance = appearance(mePerson.look);
          me.rest = kvPeople.resting;
          me.spawned(sim, Date.now());
        }
      }
      myKey = key;
    }
    if (sim.visitor) badges.set(sim.visitor, kvPeople.resting ? RESTING_BADGE() : badgeOf(mePerson));
  };

  /** Bonecos de corda: um por pessoa com posição neste prédio. */
  const syncPuppets = (sim: Sim, state: KvPresenceState | null, g: KvBuildingGeom, dt: number, now: number, timelapse: boolean) => {
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
        pp.pose = p.pos.m ? undefined : p.pos.p;
        pp.held = p.pos.h;
        // sentado: o assento daqui mais perto da posição (o prédio de quem manda pode ser diferente)
        const sk = kvSeatedPose(pp.pose) ? `${Math.round(target.x)}|${Math.round(target.y)}|${sim.building.grid.version}` : '';
        if (sk !== pp.seatKey) {
          pp.seatKey = sk;
          const seat = sk ? seatAt(sim.spots.all(), target.x, target.y) : null;
          if (pp.seat && pp.seat.id !== seat?.id) sim.spots.release(pp.seat.id, id);
          pp.seat = seat;
        }
        if (pp.seat) {
          const owner = sim.spots.ownerOf(pp.seat.id);
          if (owner === undefined || owner.startsWith(DESK_OWNER)) {
            if (owner) sim.spots.release(pp.seat.id, owner);
            sim.spots.reserve(pp.seat.id, id);
          }
          pp.target = { x: pp.seat.x, y: pp.seat.y };
        }
        pp.ch.alpha = p.status === 'ausente' ? 0.55 : 1;
        badges.set(pp.ch, p.pos.z ? RESTING_BADGE() : badgeOf(p));
      }
    }
    for (const [id, pp] of puppets) {
      if (!seen.has(id)) {
        sim.spots.releaseAll(id);
        puppets.delete(id);
        continue;
      }
      const ch = pp.ch;
      ch.animT += dt * 1000;
      const t = pp.target!;
      const seat = pp.seat;
      if (seat && Math.hypot(t.x - ch.x, t.y - ch.y) < 1.5 * TILE) {
        // chegou ao assento: encaixa sentado (como o Sim faz com os agentes)
        ch.x = seat.x;
        ch.y = seat.y;
        ch.dir = seat.dir;
        ch.seated = true;
        ch.sortY = seat.sortY ?? null;
        ch.setPose(pp.pose ?? 'sit', pp.held ?? 'none');
        ch.tx = seat.tx;
        ch.ty = seat.ty;
        ch.updateLane(dt);
        continue;
      }
      if (ch.seated) {
        ch.seated = false;
        ch.sortY = null;
      }
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
        ch.setPose(pp.m === 2 ? 'run' : 'walk', pp.held === 'coffee' || pp.held === 'water' ? pp.held : 'none');
      } else ch.setPose(pp.pose && !kvSeatedPose(pp.pose) ? pp.pose : 'stand', pp.held ?? 'none');
      ch.tx = Math.floor(ch.x / TILE);
      ch.ty = Math.floor(ch.y / TILE);
      ch.updateLane(dt);
    }
  };

  /** Manda a minha posição (no máximo a cada 100 ms; a repetida o setPos ignora). */
  const sendMe = (sim: Sim, v: Character, g: KvBuildingGeom, t: number, resting: boolean) => {
    if (sim.visitorBusy || (t - lastSend < 100 && !me.dirty)) return;
    lastSend = t;
    me.dirty = false;
    const moving = v.pose === 'walk' || v.pose === 'run';
    const pos = kvEncodePos(g, v.x, v.y, v.dir, moving ? (v.pose === 'run' ? 2 : 1) : 0);
    Object.assign(pos, me.netPose(v), resting ? { z: 1 } : {});
    kvPeople.client!.setPos(pos, resting ? null : kvPeople.area);
  };

  /** Reserva a mesa fixa de cada pessoa online (agente nenhum a escolhe como lugar) e atualiza a minha. */
  const syncDesks = (sim: Sim, state: KvPresenceState | null) => {
    const mineP = state?.people.find((p) => p.id === state.me);
    const d = mineP?.desk;
    if ((d?.r ?? '') !== (kvPeople.myDesk?.roomId ?? '') || (d && JSON.stringify(d) !== JSON.stringify(kvPeople.myDesk?.pos))) kvPeople.myDesk = d?.r ? { roomId: d.r, pos: d } : null;
    const wanted = new Set<string>();
    const labels: { id: string; name: string; spot: SpotDef; mine: boolean }[] = [];
    for (const p of state?.people ?? []) {
      const s = deskSpot(sim, p.desk);
      if (!s) continue;
      const owner = DESK_OWNER + p.id;
      wanted.add(`${s.id}|${owner}`);
      if (sim.spots.isFree(s.id)) sim.spots.reserve(s.id, owner);
      const by = sim.spots.ownerOf(s.id);
      if (by === owner || by === undefined) labels.push({ id: p.id, name: p.name, spot: s, mine: p.id === state?.me });
    }
    // mesas que deixaram de existir (pessoa saiu, trocou de mesa): solta a reserva
    for (const s of sim.spots.all()) {
      const by = sim.spots.ownerOf(s.id);
      if (by?.startsWith(DESK_OWNER) && !wanted.has(`${s.id}|${by}`)) sim.spots.release(s.id, by);
    }
    kvDeskLabels(labels, ctx.camera.zoom, (x, y) => kvPeople.toScreen!(x, y));
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
      if (hit?.type === 'agent' && hit.id !== VISITOR_ID) return false;
      const w = ctx.camera.screenToWorld(at.x, at.y);
      // planta livre: clique num item interativo (RH, espelho...) = ir até ele e usar (go-and-do.ts)
      if (kvPeople.onItemClick?.(w.x, w.y)) return true;
      const tx = Math.floor(w.x / TILE);
      const ty = Math.floor(w.y / TILE);
      // clique num assento (mesmo atrás do meu boneco): o menu dele (sentar, minha mesa) — W1
      const seat = kvPeople.onSeatClick ? [...sim.spots.all()].find((s) => s.seated && s.tx === tx && s.ty === ty && KV_SIT_KINDS.includes(s.kind)) : undefined;
      if (seat) {
        kvPeople.onSeatClick!(seat, at);
        return true;
      }
      if (hit?.type === 'agent') return true;
      if (me.walkTo(sim, tx, ty)) {
        ctx.camera.follow = VISITOR_ID;
        return true;
      }
      return false;
    },
    doubleClick(hit) {
      if (!active() || (hit?.type === 'agent' && hit.id !== VISITOR_ID)) return false;
      return me.runLast();
    },
    walking: () => active(),
    frame(dt, now, timelapse) {
      const sim = ctx.sim();
      if (!kvPeople.client) return;
      patch(sim);
      const state = kvPeople.client.state;
      if (me.rest !== kvPeople.resting && sim.visitor) {
        me.setRest(sim, kvPeople.resting);
        if (kvPeople.resting && ctx.camera.follow === VISITOR_ID) ctx.camera.follow = null;
      }
      const g = geom(sim);
      geomCache = g;
      // as mesas antes do meu boneco: quem tem mesa já nasce sentado nela
      if (!timelapse) syncDesks(sim, state);
      if (!timelapse) for (const cb of kvPeople.onTick) cb(sim, now); // agentes fixos (fixed-agents.ts)
      syncMe(sim, state, now, timelapse);
      syncPuppets(sim, state, g, dt, now, timelapse);
      const v = sim.visitor;
      const t = Date.now();
      if (active() && v && !timelapse) {
        let intent = intentFrom(keys, shift);
        if (!intent.dx && !intent.dy && (kvStick.dx || kvStick.dy)) intent = { dx: kvStick.dx, dy: kvStick.dy, run: kvStick.run };
        intent = me.frame(sim, intent, t, wherePuppet);
        sim.visitorIntent = intent;
        if ((intent.dx || intent.dy) && ctx.camera.follow !== VISITOR_ID) ctx.camera.follow = VISITOR_ID;
        const moving = v.pose === 'walk' || v.pose === 'run';
        kvPeople.following = me.follow ? { id: me.follow.id, name: me.follow.name } : null;
        kvPeople.area = sim.visitorBusy ? null : areaOf(sim, g, v.x, v.y);
        nearAgent(sim, v, moving, t);
        sendMe(sim, v, g, t, false);
        for (const cb of kvPeople.onFrame) {
          try {
            cb(dt, now);
          } catch (err) {
            console.error('[kv] onFrame', err);
          }
        }
      } else if (kvPeople.resting && v && !timelapse) {
        // modo clássico: o boneco vai sozinho descansar; os outros o veem sentado no lounge
        sim.visitorIntent = me.frame(sim, { ...NO_INTENT }, t, wherePuppet);
        kvPeople.following = null;
        kvPeople.area = null;
        sendMe(sim, v, g, t, true);
      } else {
        kvPeople.area = null;
        kvPeople.following = null;
        // fora do escritório (ou no timelapse): os outros não me veem (setPos ignora o repetido)
        kvPeople.client.setPos(null);
      }
    },
  };
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
