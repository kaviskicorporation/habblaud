// Fork Kaviski (KAVISKI-HUMANOS.md): o que o meu boneco faz além de andar — sentar e levantar, usar a máquina de
// café/água, jogar fliperama, ler na estante, seguir alguém, teleportar, descansar no lounge (modo clássico) e ir para a
// minha mesa fixa. O boneco é o visitante do Sim (sim/visitor.ts): para ele os assentos contam como parede no passo
// livre do teclado, então sentar e levantar vão pela fila de passos (go/enter/exit do Sim) e, enquanto ele está
// sentado ou levantando, o teclado não chega ao Sim (a primeira tecla levanta). O lugar fica reservado no
// SpotRegistry com o id do visitante: agente nenhum senta em cima.
import type { KvHeld, KvPose } from '../../../../shared/kaviski-desk';
import type { SpotDef } from '../../world/layout/types';
import { TILE } from '../../world/constants';
import type { Character } from '../../world/sim/character';
import type { Sim } from '../../world/sim/sim';
import type { Step } from '../../world/sim/steps';
import { canStand, NO_INTENT, VISITOR_ID, type VisitorIntent } from '../../world/sim/visitor';
import { followNeedsRepath, freeTileAt, freeTileNear, KV_LOUNGE, KV_USE, restSeat, type KvSeatPose, type KvUseDef } from './seats';

/** Dono de reserva da mesa fixa de uma pessoa (agente nenhum a escolhe como lugar). */
export const DESK_OWNER = 'kvdesk:';
/** Quanto tempo bebendo antes de largar o copo. */
const DRINK_MS = 4200;
/** Teleporte: quanto tempo o boneco leva para aparecer. */
const FADE_MS = 350;

interface Seat {
  spot: SpotDef;
  /** O passo que segura o boneco ali. */
  hold: Step;
  /** Os passos até lá (nenhum deles na fila = acabou ou foi trocado). */
  steps: Step[];
  use?: KvUseDef;
  rest?: boolean;
}

const pathBuf: number[] = [];

/**
 * O destino de um passo a pé, se dá para chegar lá: o tile tem de estar dentro do prédio (a grama em volta fica fora
 * da grade) e ter caminho desde (sx, sy). O passo `go` do Sim, sem caminho, teletransporta o boneco "para não travar":
 * por isso clicar na grama levava o boneco para fora do prédio. null = não anda.
 */
export function kvReachable(sim: Sim, sx: number, sy: number, tx: number, ty: number): { x: number; y: number } | null {
  const grid = sim.building.grid;
  if (!grid.inside(tx, ty)) return null;
  const to = grid.nearestWalkable(tx, ty, 3);
  const from = grid.nearestWalkable(sx, sy, 6);
  if (!to || !from) return null;
  pathBuf.length = 0;
  return sim.finder.find(from.x, from.y, to.x, to.y, pathBuf) ? to : null;
}

export interface KvFollow {
  id: string;
  name: string;
  goal: { x: number; y: number } | null;
  at: number;
}

export class KvMeCtl {
  seat: Seat | null = null;
  follow: KvFollow | null = null;
  rest = false;
  /** Levantando (os passos exit + go): o teclado espera. */
  private standing: Step[] = [];
  /** Para onde voltar ao sair do modo clássico (sem mesa). */
  private backTo: { x: number; y: number } | null = null;
  /** Acabei de entrar: ir para a mesa assim que ela existir neste prédio. */
  pendingDesk = 0;
  /** Mandar a posição já (teleporte, sentou, levantou). */
  dirty = false;
  private fadeFrom = 0;
  /** O último clique no chão (duplo clique = correr). */
  private lastWalk: { at: number; step: Step } | null = null;

  constructor(
    /** A minha mesa neste prédio (o spot da cadeira), se tenho. */
    private readonly deskSpot: (sim: Sim) => SpotDef | null,
    /** Meu id de pessoa (dono da reserva da minha mesa). */
    private readonly myId: () => string | null,
  ) {}

  /** O que a pose do meu boneco diz aos outros (KvPos.p/h). */
  netPose(v: Character): { p?: KvPose; h?: KvHeld } {
    if (v.pose === 'walk' || v.pose === 'run' || v.pose === 'stand') return v.held === 'coffee' || v.held === 'water' ? { h: v.held } : {};
    const out: { p?: KvPose; h?: KvHeld } = { p: v.pose as KvPose };
    if (v.held !== 'none') out.h = v.held as KvHeld;
    return out;
  }

  /** Estou usando o lugar (sentado ou na máquina), não só indo para lá. */
  using(sim: Sim): boolean {
    const v = sim.visitor;
    const seat = this.seat;
    if (!v || !seat) return false;
    return seat.spot.seated ? v.atSpot === seat.spot.id : v.step !== seat.steps[0] && !v.queue.includes(seat.steps[0]);
  }

  /** Estou sentado (encaixado no assento). */
  seated(sim: Sim): boolean {
    const v = sim.visitor;
    return !!v && !!this.seat && v.atSpot === this.seat.spot.id && v.seated;
  }

  // ------------------------------------------------------------------ reservas

  /**
   * Fica com o lugar (reserva com o id do visitante). A reserva da minha própria mesa sai; a de um agente que não está
   * nem indo para lá também (`force`: até a de um agente sentado — ele levanta e procura outro lugar). Outra pessoa: não.
   */
  claim(sim: Sim, spot: SpotDef, force = false): boolean {
    const owner = sim.spots.ownerOf(spot.id);
    if (owner === undefined || owner === VISITOR_ID) return sim.spots.reserve(spot.id, VISITOR_ID);
    if (owner === DESK_OWNER + this.myId()) {
      sim.spots.release(spot.id, owner);
      return sim.spots.reserve(spot.id, VISITOR_ID);
    }
    const ag = sim.chars.get(owner);
    if (!ag) return false;
    const using = ag.atSpot === spot.id || [ag.step, ...ag.queue].some((s) => s?.t === 'enter' && s.spot === spot.id);
    if (using && !force) return false;
    sim.spots.release(spot.id, owner);
    if (ag.homeSpot === spot.id) ag.homeSpot = null;
    ag.tempSpots = ag.tempSpots.filter((id) => id !== spot.id);
    if (using) sim.interrupt(ag);
    return sim.spots.reserve(spot.id, VISITOR_ID);
  }

  private release(sim: Sim): void {
    if (this.seat) sim.spots.release(this.seat.spot.id, VISITOR_ID);
    this.seat = null;
  }

  // ------------------------------------------------------------------ ações

  /** Senta no assento (ou usa a máquina). false = ocupado ou sem boneco. */
  sit(sim: Sim, spot: SpotDef, opts: { rest?: boolean; force?: boolean } = {}): boolean {
    const v = sim.visitor;
    if (!v || sim.visitorBusy) return false;
    if (this.seat?.spot.id === spot.id) return true;
    if (!this.claim(sim, spot, opts.force)) return false;
    const steps = this.leaveSteps(sim, v);
    this.release(sim);
    sim.spots.reserve(spot.id, VISITOR_ID);
    const use = spot.seated ? undefined : KV_USE[spot.kind];
    const seat: Seat = { spot, hold: { t: 'until', cond: () => this.seat !== seat, minMs: 0, maxMs: 1e12 }, steps: [], use, rest: opts.rest };
    const lead = steps.length;
    if (spot.seated) {
      steps.push({ t: 'go', tx: spot.tx, ty: spot.ty }, { t: 'enter', spot: spot.id }, seat.hold);
    } else {
      steps.push({ t: 'go', tx: spot.tx, ty: spot.ty, fx: spot.x, fy: spot.y, dir: spot.dir });
      if (use?.useMs) steps.push({ t: 'act', pose: 'use', ms: use.useMs, machine: spot.furnitureId });
      const ms = use?.pose === 'drink' ? DRINK_MS : use?.ms; // fork Kaviski: usos com tempo (lanche, pia)
      if (use && ms) {
        seat.hold = { t: 'until', cond: () => this.seat !== seat, minMs: ms, maxMs: ms, pose: use.pose, held: use.held };
        steps.push(seat.hold, { t: 'do', fn: () => this.seat === seat && this.release(sim) });
      } else {
        seat.hold = { t: 'until', cond: () => this.seat !== seat, minMs: 0, maxMs: 1e12, pose: use?.pose ?? 'stand', held: use?.held ?? 'none' };
        steps.push(seat.hold);
      }
    }
    seat.steps = steps.slice(lead);
    this.seat = seat;
    this.follow = null;
    v.queue.length = 0;
    v.step = null;
    sim.visitorIntent = { ...NO_INTENT };
    v.queue.push(...steps);
    this.dirty = true;
    return true;
  }

  /** Pose de quem está sentado agora (o que a tecla E oferece trocar). */
  seatPose(sim: Sim): KvSeatPose | null {
    const v = sim.visitor;
    if (!v || !this.seated(sim)) return null;
    if (v.pose === 'sleep') return 'sleep';
    if (v.pose === 'type') return 'type';
    return v.held === 'phone' ? 'phone' : 'sit';
  }

  /** Sentado: cochilar, olhar o celular, digitar ou só sentar. false = não estou sentado. */
  setSeatPose(sim: Sim, pose: KvSeatPose): boolean {
    const v = sim.visitor;
    const hold = this.seat?.hold;
    if (!v || !hold || hold.t !== 'until' || !this.seated(sim)) return false;
    hold.pose = pose === 'phone' ? 'sit' : pose;
    hold.held = pose === 'phone' ? 'phone' : 'none';
    v.setPose(hold.pose, hold.held);
    this.dirty = true;
    return true;
  }

  /** Levanta (se estiver sentado/usando algo) e, depois, faz `then`. */
  stand(sim: Sim, then: Step[] = []): void {
    const v = sim.visitor;
    if (!v) return;
    const steps = this.leaveSteps(sim, v);
    this.release(sim);
    v.queue.length = 0;
    v.step = null;
    sim.visitorIntent = { ...NO_INTENT };
    v.queue.push(...steps, ...then);
    this.standing = steps;
    this.dirty = true;
  }

  /** Passos para sair do lugar atual até um chão livre (vazio se já está em pé num lugar bom). */
  private leaveSteps(sim: Sim, v: Character): Step[] {
    const grid = sim.building.grid;
    const steps: Step[] = [];
    if (v.atSpot) {
      steps.push({ t: 'exit' });
      const s = sim.spots.get(v.atSpot);
      const tile = s ? freeTileNear(grid, s.tx, s.ty) : null;
      if (tile) steps.push({ t: 'go', tx: tile.x, ty: tile.y });
    } else if (!canStand(grid, v.x, v.y)) {
      const tile = freeTileAt(grid, v.tx, v.ty);
      if (tile) steps.push({ t: 'go', tx: tile.x, ty: tile.y });
    }
    return steps;
  }

  /** Anda até o tile (levanta antes, se preciso). Fora do prédio ou sem caminho: não anda (nem teleporta). */
  walkTo(sim: Sim, tx: number, ty: number, run = false, keepFollow = false): boolean {
    const v = sim.visitor;
    if (!v || sim.visitorBusy) return false;
    const to = kvReachable(sim, v.tx, v.ty, tx, ty);
    if (!to) return false;
    if (!keepFollow) this.follow = null;
    const go: Step = { t: 'go', tx: to.x, ty: to.y, run };
    if (this.seat || v.atSpot || !canStand(sim.building.grid, v.x, v.y)) this.stand(sim, [go]);
    else {
      v.queue.length = 0;
      v.step = null;
      // o Sim ainda tem a direção do quadro anterior (tecla recém-solta): sem isto ela apagaria este caminho
      sim.visitorIntent = { ...NO_INTENT };
      v.queue.push(go);
    }
    this.lastWalk = { at: performance.now(), step: go };
    return true;
  }

  /** Duplo clique: o caminho do último clique vira corrida. */
  runLast(): boolean {
    const w = this.lastWalk;
    if (!w || performance.now() - w.at > 700 || w.step.t !== 'go') return false;
    w.step.run = true;
    return true;
  }

  /** Aparece ao lado de (x, y) px, com um efeito curto. */
  teleport(sim: Sim, x: number, y: number, now: number): boolean {
    const v = sim.visitor;
    if (!v || sim.visitorBusy) return false;
    const tile = freeTileNear(sim.building.grid, Math.floor(x / TILE), Math.floor(y / TILE), 5);
    if (!tile) return false;
    this.release(sim);
    this.follow = null;
    v.queue.length = 0;
    v.step = null;
    sim.visitorIntent = { ...NO_INTENT };
    v.atSpot = null;
    v.seated = false;
    v.sortY = null;
    v.placeAtTile(tile.x, tile.y);
    v.setPose('stand');
    v.alpha = 0;
    this.fadeFrom = now;
    v.showBubble('✨', '', 900, now);
    this.dirty = true;
    return true;
  }

  /** Entra direto sentado no lugar (sem o elevador): ao nascer com mesa, ou descansando. */
  placeSeated(sim: Sim, spot: SpotDef, now: number, rest = false): boolean {
    const v = sim.visitor;
    if (!v || !this.claim(sim, spot)) return false;
    for (const e of sim.elevators) e.release(v.id, now);
    this.release(sim);
    sim.spots.reserve(spot.id, VISITOR_ID);
    v.queue.length = 0;
    v.step = null;
    sim.visitorIntent = { ...NO_INTENT };
    v.inside = false;
    v.arriving = false;
    v.leaving = false;
    v.hiddenUntil = 0;
    v.tx = spot.tx;
    v.ty = spot.ty;
    v.x = spot.x;
    v.y = spot.y;
    v.dir = spot.dir;
    v.atSpot = spot.id;
    v.seated = !!spot.seated;
    v.sortY = spot.sortY ?? null;
    v.setPose(spot.seated ? 'sit' : 'stand');
    v.alpha = 0;
    this.fadeFrom = now;
    const hold: Step = { t: 'until', cond: () => this.seat !== seat, minMs: 0, maxMs: 1e12 };
    const seat: Seat = { spot, hold, steps: [hold], rest };
    this.seat = seat;
    v.queue.push(seat.hold);
    this.dirty = true;
    return true;
  }

  /** O boneco acabou de nascer (no elevador): descansando ou com mesa, já aparece sentado. */
  spawned(sim: Sim, now: number): void {
    this.seat = null;
    this.standing = [];
    this.follow = null;
    if (this.rest) {
      const s = restSeat(sim.spots.all(), (x) => sim.spots.isFree(x.id, VISITOR_ID));
      if (s && this.placeSeated(sim, s, now, true)) return;
    }
    const desk = this.deskSpot(sim);
    if (desk && !this.rest && this.placeSeated(sim, desk, now)) return;
    // a sala da mesa ainda não chegou (ou a cadeira está ocupada): sai do elevador e vai para lá
    this.pendingDesk = this.rest ? 0 : now + 15_000;
  }

  /** Vai para a minha mesa (e senta). */
  goDesk(sim: Sim): boolean {
    const desk = this.deskSpot(sim);
    return !!desk && this.sit(sim, desk, { force: true });
  }

  /** Liga/desliga o descanso (modo clássico): vai sentar no lounge; ao voltar, mesa ou onde estava. */
  setRest(sim: Sim, on: boolean): void {
    if (this.rest === on) return;
    const v = sim.visitor;
    // no elevador: tenta de novo no próximo quadro
    if (!v || sim.visitorBusy) return;
    this.rest = on;
    if (on) {
      this.backTo = this.seat ? null : { x: v.tx, y: v.ty };
      this.follow = null;
      const s = restSeat(sim.spots.all(), (x) => sim.spots.isFree(x.id, VISITOR_ID), { tx: v.tx, ty: v.ty });
      if (s) this.sit(sim, s, { rest: true });
      else {
        // lounge lotado: em pé no meio dele
        const r = sim.building.core.find((a) => a.id === KV_LOUNGE)?.rect;
        const t = r ? freeTileAt(sim.building.grid, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), 5) : null;
        if (t) this.walkTo(sim, t.x, t.y);
      }
      return;
    }
    if (this.goDesk(sim)) return;
    const back = this.backTo;
    this.backTo = null;
    if (back) this.walkTo(sim, back.x, back.y);
    else this.stand(sim);
  }

  // ------------------------------------------------------------------ a cada quadro

  /**
   * Antes de o Sim andar (o intento do teclado/joystick já calculado): sentado ou levantando, o teclado não passa;
   * sentado e apertou uma direção, levanta. Também: seguir alguém, fim do teleporte, lugar que sumiu.
   */
  frame(sim: Sim, intent: VisitorIntent, now: number, where: (id: string) => { x: number; y: number } | null): VisitorIntent {
    const v = sim.visitor;
    if (!v) return intent;
    if (this.fadeFrom && v.alpha < 1) {
      v.alpha = Math.min(1, (now - this.fadeFrom) / FADE_MS);
      if (v.alpha >= 1) this.fadeFrom = 0;
    }
    const pressed = !!(intent.dx || intent.dy);
    if (this.standing.length) {
      if (this.standing.some((s) => v.step === s || v.queue.includes(s))) return { ...NO_INTENT };
      this.standing = [];
    }
    const seat = this.seat;
    if (seat) {
      const gone = !sim.spots.get(seat.spot.id);
      const live = seat.steps.some((s) => v.step === s || v.queue.includes(s));
      if (gone) {
        // o prédio mudou e o lugar sumiu: em pé no chão livre mais perto
        this.release(sim);
        v.atSpot = null;
        v.seated = false;
        v.sortY = null;
        const t = freeTileAt(sim.building.grid, Math.floor(v.x / TILE), Math.floor(v.y / TILE), 6);
        if (t) v.placeAtTile(t.x, t.y);
        v.queue.length = 0;
        v.step = null;
      } else if (!live) this.release(sim);
    }
    if (pressed) {
      this.follow = null;
      this.pendingDesk = 0;
      if (this.seat || v.atSpot) {
        if (this.rest) return { ...NO_INTENT };
        this.stand(sim);
        return { ...NO_INTENT };
      }
      if (!canStand(sim.building.grid, v.x, v.y)) {
        const t = freeTileAt(sim.building.grid, v.tx, v.ty);
        if (t) v.placeAtTile(t.x, t.y);
      }
      return intent;
    }
    if (this.pendingDesk && !sim.visitorBusy) {
      if (now > this.pendingDesk) this.pendingDesk = 0;
      else if (this.deskSpot(sim)) {
        this.pendingDesk = 0;
        this.goDesk(sim);
      }
    }
    const f = this.follow;
    if (f && !sim.visitorBusy && now >= f.at) {
      f.at = now + 400;
      const t = where(f.id);
      if (!t) this.follow = null;
      else if (followNeedsRepath(t, f.goal)) {
        const g = freeTileNear(sim.building.grid, Math.floor(t.x / TILE), Math.floor(t.y / TILE), 3);
        if (g) {
          const far = Math.hypot(g.x - v.tx, g.y - v.ty) > 8;
          f.goal = g;
          this.walkTo(sim, g.x, g.y, far, true);
        }
      }
    }
    return intent;
  }
}
