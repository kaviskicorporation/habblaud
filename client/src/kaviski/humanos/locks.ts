// Fork Kaviski (KAVISKI-HUMANOS.md, W2): trancar a sala e bater na porta.
//
// - Quem é da equipe (ou admin) e está numa sala (de projeto ou própria) tranca pelo botão de cadeado da barra do topo.
//   A lista de quem pode entrar é quem estava dentro na hora, mais quem for deixado entrar. Qualquer um da lista
//   destranca; quando o último da lista sai, a sala destranca sozinha (servidor, social.ts).
// - Trancada: um cadeado na porta; quem não está na lista não passa da porta (o boneco volta para fora) e, perto dela,
//   a tecla E vira "Bater na porta". Quem está dentro recebe "Fulano quer entrar" com Deixar entrar / Recusar.
// - Quem decide de verdade é o servidor: posição, chat e voz (token do LiveKit) de quem está fora são recusados.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import { kvRestricted } from '../../../../shared/kaviski-humanos';
import type { KvKnockAnswer, KvKnockEvent, KvLockInfo } from '../../../../shared/kaviski-social';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { TILE } from '../../world/constants';
import type { Sim } from '../../world/sim/sim';
import { kvAttention, kvCloseToast, kvNotify, kvPlay, kvToast } from './alerts';
import { kvAreaLabel, type KvBar } from './bar';
import { kvRegisterInteract } from './interact';
import { kvEachFrame, kvWorldToScreen } from './overlay';
import type { KvPresenceClient } from './presence';
import { kvSocialPost } from './social-api';
import { kvPeople } from './world';

/** Até esta distância (tiles) da porta, a tecla E bate. */
const KNOCK_TILES = 2.6;

type Rect = { x: number; y: number; w: number; h: number };

interface RoomGeom {
  rect: Rect;
  door: Rect;
  /** Centro da porta (px de mundo). */
  cx: number;
  cy: number;
  /** Um tile do lado de fora, em frente à porta (px de mundo, centro). */
  out: { x: number; y: number };
}

/** Retângulo e porta de uma sala no prédio desta página (salas de projeto e próprias estão no Sim). */
function geomOf(sim: Sim, roomId: string): RoomGeom | null {
  const room = sim.rooms.get(roomId);
  const lay = room?.layout;
  if (!room || !lay?.door || !room.present) return null;
  const d = lay.door;
  const north = lay.side !== 'south';
  // salas do lado norte abrem para baixo (porta na parede de baixo); as do sul, para cima
  const outTy = north ? d.y + d.h : d.y - 1;
  return { rect: lay.rect, door: d, cx: (d.x + d.w / 2) * TILE, cy: (d.y + d.h / 2) * TILE, out: { x: (d.x + d.w / 2) * TILE, y: (outTy + 0.6) * TILE } };
}

const inRect = (r: Rect, tx: number, ty: number) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;

export class KvLocks {
  readonly btn: HTMLButtonElement;
  private locks: KvLockInfo[] = [];
  private readonly pads = new Map<string, HTMLElement>();
  private readonly layer: HTMLElement;
  private lastGood: { x: number; y: number } | null = null;
  private warnedAt = 0;

  constructor(
    private readonly client: KvPresenceClient,
    private readonly bar: KvBar,
    private readonly store: OfficeStore,
    private readonly me: KvMe,
  ) {
    this.btn = h('button', { class: 'ui-icon-btn kv-dock__btn kv-dock__plain kv-lock-btn', type: 'button', hidden: true, on: { click: () => void this.toggleLock() } });
    this.layer = h('div', { class: 'kv-lock-layer', attrs: { 'aria-hidden': 'true' } });
    document.body.append(this.layer);
    client.on((s) => {
      this.locks = s.locks ?? [];
      this.syncPads();
      this.paint();
    });
    client.onEvent<KvKnockEvent>('knock', (e) => this.onKnock(e));
    client.onEvent<KvKnockAnswer>('knock-answer', (a) => this.onAnswer(a));
    kvRegisterInteract((me) => this.knockTarget(me));
    // o "desfazer o passo" roda logo depois da simulação, antes do desenho (gancho por quadro do W1)
    kvPeople.onFrame.add(() => this.block());
    kvEachFrame(() => this.placePads());
    setInterval(() => this.paint(), 500);
  }

  mount(into: HTMLElement): void {
    into.append(this.btn);
  }

  private sim(): Sim | null {
    try {
      return kvPeople.sim?.() ?? null;
    } catch {
      return null;
    }
  }

  private lockOf(area: string | null | undefined): KvLockInfo | undefined {
    return area ? this.locks.find((l) => l.area === area) : undefined;
  }

  /** O botão: aparece numa sala; cliente só vê para destrancar (não tranca). */
  private paint(): void {
    const area = kvPeople.inside ? kvPeople.area : null;
    const room = area?.startsWith('r:') ? area : null;
    const lock = this.lockOf(room);
    const canLock = !!room && !kvRestricted(this.me.person);
    this.btn.hidden = !room || (!lock && !canLock) || (!!lock && !lock.in);
    const label = lock ? tr('Destrancar a sala (trancada por {0})', [lock.by]) : tr('Trancar a sala: só quem está aqui entra');
    this.btn.textContent = lock ? '🔒' : '🔓';
    this.btn.title = label;
    this.btn.setAttribute('aria-label', label);
    this.btn.setAttribute('aria-pressed', String(!!lock));
    this.btn.classList.toggle('is-on', !!lock);
  }

  private async toggleLock(): Promise<void> {
    const area = kvPeople.area;
    const lock = this.lockOf(area);
    const r = await kvSocialPost('lock', lock ? { on: false, area } : { on: true });
    if (!r.ok) return this.bar.warn(r.error);
    this.bar.warn(lock ? tr('Sala destrancada.') : tr('Sala trancada: quem chegar vai bater na porta.'));
  }

  // ---------------------------------------------------------------- cadeados

  private syncPads(): void {
    const want = new Set(this.locks.map((l) => l.area));
    for (const [area, el] of this.pads) {
      if (!want.has(area)) {
        el.remove();
        this.pads.delete(area);
      }
    }
    for (const l of this.locks) {
      let el = this.pads.get(l.area);
      if (!el) {
        el = h('span', { class: 'kv-lock-pad', text: '🔒' });
        this.layer.append(el);
        this.pads.set(l.area, el);
      }
      el.classList.toggle('is-in', l.in);
      el.title = tr('Trancada por {0}', [l.by]);
    }
  }

  private placePads(): void {
    const sim = this.pads.size && kvPeople.inside ? this.sim() : null;
    for (const [area, el] of this.pads) {
      const g = sim ? geomOf(sim, area.slice(2)) : null;
      const at = g ? kvWorldToScreen(g.cx, g.cy) : null;
      el.hidden = !at;
      if (at) {
        el.style.fontSize = `${Math.round(Math.max(12, Math.min(26, 7 * at.zoom)))}px`;
        el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
      }
    }
  }

  // ---------------------------------------------------------------- o boneco não passa da porta

  /** As salas trancadas em que eu não posso entrar. */
  private closed(): string[] {
    return this.locks.filter((l) => !l.in).map((l) => l.area.slice(2));
  }

  private block(): void {
    if (!kvPeople.inside) return;
    const ids = this.closed();
    const sim = ids.length ? this.sim() : null;
    const v = sim?.visitor;
    if (!sim || !v || v.gone) {
      this.lastGood = null;
      return;
    }
    const tx = Math.floor(v.x / TILE);
    const ty = Math.floor(v.y / TILE);
    for (const id of ids) {
      const g = geomOf(sim, id);
      if (!g || !inRect(g.rect, tx, ty)) continue;
      // entrou: volta para onde estava (ou para a frente da porta) e para de andar
      kvPeople.stopMe?.();
      v.queue.length = 0;
      v.step = null;
      const back = this.lastGood && !inRect(g.rect, Math.floor(this.lastGood.x / TILE), Math.floor(this.lastGood.y / TILE)) ? this.lastGood : g.out;
      v.x = back.x;
      v.y = back.y;
      v.tx = Math.floor(back.x / TILE);
      v.ty = Math.floor(back.y / TILE);
      v.setPose('stand');
      const t = Date.now();
      if (t - this.warnedAt > 4_000) {
        this.warnedAt = t;
        this.bar.warn(tr('Sala trancada: aperte E para bater na porta.'));
      }
      return;
    }
    this.lastGood = { x: v.x, y: v.y };
  }

  // ---------------------------------------------------------------- bater na porta

  private knockTarget(me: { x: number; y: number }) {
    const ids = this.closed();
    const sim = ids.length ? this.sim() : null;
    if (!sim) return null;
    let best: { id: string; dist: number } | null = null;
    for (const id of ids) {
      const g = geomOf(sim, id);
      if (!g) continue;
      const dist = Math.hypot(g.cx - me.x, g.cy - me.y);
      if (dist <= KNOCK_TILES * TILE && (!best || dist < best.dist)) best = { id, dist };
    }
    if (!best) return null;
    const area = `r:${best.id}`;
    return { id: `knock:${area}`, label: tr('Bater na porta'), dist: best.dist, run: () => void this.knock(area) };
  }

  private async knock(area: string): Promise<void> {
    kvPlay('knock', true);
    const r = await kvSocialPost('knock', { area });
    this.bar.warn(r.ok ? tr('Você bateu na porta de {0}. Espere alguém abrir…', [kvAreaLabel(area, this.store)]) : r.error);
  }

  private onKnock(e: KvKnockEvent): void {
    if (!e?.from) return;
    const name = e.from.name;
    kvPlay('knock');
    kvAttention(tr('🚪 {0} quer entrar', [name]));
    kvNotify(tr('{0} quer entrar', [name]), kvAreaLabel(e.area, this.store), `knock:${e.from.id}`);
    const answer = (allow: boolean) => void kvSocialPost('knock/answer', { area: e.area, who: e.from.id, allow }).then((r) => !r.ok && this.bar.warn(r.error));
    kvToast({
      key: `knock:${e.from.id}`,
      icon: '🚪',
      tone: 'call',
      title: tr('{0} quer entrar', [name]),
      text: tr('Bateu na porta de {0}.', [kvAreaLabel(e.area, this.store)]),
      ms: 60_000,
      actions: [
        { label: tr('Deixar entrar'), primary: true, run: () => answer(true) },
        { label: tr('Recusar'), run: () => answer(false) },
      ],
    });
  }

  private onAnswer(a: KvKnockAnswer): void {
    if (!a) return;
    if (a.who !== this.client.state?.me) {
      // alguém de dentro já respondeu
      kvCloseToast(`knock:${a.who}`);
      return;
    }
    const where = kvAreaLabel(a.area, this.store);
    if (a.allow) {
      kvPlay('enter');
      kvToast({ key: `knock-ok:${a.area}`, icon: '🔓', title: tr('{0} deixou você entrar em {1}.', [a.by, where]), ms: 6_000 });
    } else kvToast({ key: `knock-ok:${a.area}`, icon: '🔒', title: tr('{0} não deixou entrar agora.', [a.by]), ms: 6_000 });
  }
}
