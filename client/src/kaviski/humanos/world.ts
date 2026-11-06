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
import { kvDecodePos, kvEncodePos, type KvBuildingGeom } from './pos';
import type { KvPresenceClient } from './presence';

const PUPPET_PREFIX = 'pessoa:';
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

const ROLE_BADGE: Record<string, string> = { admin: tr('equipe'), equipe: tr('equipe'), cliente: tr('cliente') };

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
} = { client: null, inside: false };

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
  kvPeople.sim = ctx.sim;
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
      if (!active()) return false;
      const sim = ctx.sim();
      if (hit?.type === 'agent' && (hit.id === VISITOR_ID || hit.id.startsWith(PUPPET_PREFIX))) return true;
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
        if (!sim.visitorBusy && (moving ? t - lastSend >= 100 : wasMoving || t - lastSend > 5000)) {
          lastSend = t;
          kvPeople.client.setPos(kvEncodePos(g, v.x, v.y, v.dir, moving ? (v.pose === 'run' ? 2 : 1) : 0));
        }
        wasMoving = moving;
      } else {
        // fora do escritório (ou no timelapse): os outros não me veem (setPos ignora o repetido)
        kvPeople.client.setPos(null);
        wasMoving = false;
      }
    },
  };
}

/** Semente do boneco sorteado (o editor usa). */
export function kvRandomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? hash32(String(Date.now()));
}
