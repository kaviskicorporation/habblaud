// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre" → "Organograma e agentes fixos"): agentes de IA fixos no
// escritório — a mesa marcada de cada um.
//
// A cada quadro (kvPeople.onTick, sem reescrever o sim.ts): para cada agente fixo com cadeira, acha a cadeira neste
// prédio (posição relativa à sala, KvPos, como a mesa fixa das pessoas) e o agente ao vivo que bate com a regra
// (kvMatchFixedAgents). Achou: a cadeira é reservada com o id dele e vira o `homeSpot` (o Sim leva o agente até lá
// sozinho). Não achou: a cadeira fica reservada com `kvfixed:<id>` (nenhum outro agente senta) e mostra a plaquinha
// "mesa de <nome>". Mesa fixa de pessoa e o meu boneco vencem (o agente não toma a cadeira de ninguém).
// A aparência opcional do agente fixo entra pelo `sim.agentPatches` (semente e peças).
//
// Também: "Fixar um agente aqui" no menu da cadeira (furniture.ts) e o modo "escolher a cadeira" do formulário.
import type { KvPos } from '../../../../shared/kaviski-presence';
import { kvMatchFixedAgents, type KvLiveAgent, type KvOrgAgent } from '../../../../shared/kaviski-org';
import { kvPathKey } from '../../../../shared/kaviski';
import { tr } from '../../../../shared/i18n';
import type { AgentInfo } from '../../../../shared/types';
import type { OfficeStore } from '../../net/store';
import type { Sim } from '../../world/sim/sim';
import type { SpotDef } from '../../world/layout/types';
import { TILE } from '../../world/constants';
import { VISITOR_ID } from '../../world/sim/visitor';
import { h } from '../../ui/dom';
import { kvLoadOrg, kvOrg } from './org-api';
import { kvPeople } from './world';
import { DESK_OWNER } from './me';
import { KV_DESK_KINDS, seatAt } from './seats';
import { kvSeatMenuExtras } from './furniture';
import './org.css';

export const FIXED_OWNER = 'kvfixed:';
/** Abaixo deste zoom as plaquinhas somem (como as de "mesa de Fulano"). */
const MIN_ZOOM = 0.7;

let store: OfficeStore | null = null;

/** O id da sala neste snapshot para a referência guardada (o contrato guarda o caminho em minúsculas). */
export function kvFixedRoomId(ref: string): string {
  if (!ref.startsWith('/')) return ref;
  const key = kvPathKey(ref);
  return store?.liveSnapshot?.rooms.find((r) => r.id === ref || kvPathKey(r.id) === key)?.id ?? ref;
}

/** A cadeira de um agente fixo neste prédio. */
export function kvFixedSeat(sim: Sim, a: KvOrgAgent): SpotDef | null {
  if (!a.seat) return null;
  const room = kvFixedRoomId(a.room);
  const pos: KvPos = { k: 'r', r: room, x: a.seat.x, y: a.seat.y, s: a.seatSide ?? 'n', d: 'down', m: 0 };
  const at = kvPeople.decode?.(pos);
  if (!at) return null;
  const s = seatAt(sim.spots.all(), at.x, at.y);
  return s && s.areaId === room && KV_DESK_KINDS.includes(s.kind) ? s : null;
}

/** Quem está sentado em cada agente fixo agora (fixo → agente ao vivo). */
export function kvFixedMatches(sim: Sim | undefined): Map<string, string> {
  const doc = kvOrg();
  if (!doc || !sim) return new Map();
  const live: KvLiveAgent[] = [];
  for (const ch of sim.chars.values()) {
    if (ch.gone || ch.leaving || ch.id === VISITOR_ID || ch.id.startsWith('pessoa:')) continue;
    const a = ch.info as AgentInfo;
    live.push({ id: a.id, roomId: ch.roomId, name: a.name, kind: a.kind, ...(a.provider ? { provider: a.provider } : {}), ...(a.parentId ? { parentId: a.parentId } : {}), ...(a.title ? { title: a.title } : {}) });
  }
  return kvMatchFixedAgents(doc.agents, live);
}

// ------------------------------------------------------------------ plaquinhas "mesa de <agente>"

let labelRoot: HTMLElement | null = null;
const labels = new Map<string, HTMLElement>();

function paintLabels(list: { id: string; name: string; spot: SpotDef }[]): void {
  if (!labelRoot) {
    labelRoot = h('div', { class: 'kv-desk-labels kv-fixed-labels', attrs: { 'aria-hidden': 'true' } });
    (document.querySelector('.ui-root') ?? document.body).append(labelRoot);
  }
  const zoom = kvPeople.camera?.zoom ?? 1;
  const seen = new Set<string>();
  /** Plaquinhas já postas neste quadro: a vizinha desce uma linha em vez de cobrir a outra. */
  const placed: { x: number; y: number; w: number }[] = [];
  if (zoom >= MIN_ZOOM && kvPeople.toScreen) {
    for (const d of [...list].sort((a, b) => a.spot.x - b.spot.x || a.spot.y - b.spot.y)) {
      const p = kvPeople.toScreen(d.spot.x, d.spot.y);
      if (p.sx < -80 || p.sy < -40 || p.sx > window.innerWidth + 80 || p.sy > window.innerHeight + 40) continue;
      seen.add(d.id);
      let el = labels.get(d.id);
      if (!el) {
        el = h('span', { class: 'kv-desk-label is-ai' });
        labels.set(d.id, el);
        labelRoot.append(el);
      }
      const text = tr('mesa de {0}', [d.name]);
      if (el.textContent !== text) el.textContent = text;
      const w = el.offsetWidth || 90;
      let y = p.sy + 4 * zoom;
      while (placed.some((q) => Math.abs(q.x - p.sx) < (q.w + w) / 2 + 4 && Math.abs(q.y - y) < 16)) y += 17;
      placed.push({ x: p.sx, y, w });
      el.style.transform = `translate(${Math.round(p.sx)}px, ${Math.round(y)}px) translate(-50%, 0)`;
    }
  }
  for (const [id, el] of labels) {
    if (seen.has(id)) continue;
    el.remove();
    labels.delete(id);
  }
}

// ------------------------------------------------------------------ a cada quadro

function tick(sim: Sim): void {
  const doc = kvOrg();
  const agents = doc?.agents ?? [];
  const match = kvFixedMatches(sim);
  const wanted = new Set<string>();
  const empty: { id: string; name: string; spot: SpotDef }[] = [];
  const patched = new Set<string>();
  for (const a of agents) {
    const spot = kvFixedSeat(sim, a);
    const liveId = match.get(a.id);
    const ch = liveId ? sim.chars.get(liveId) : undefined;
    if (ch && a.look) {
      const want: Partial<AgentInfo> = { seed: a.look.seed, ...(a.look.look ? { look: a.look.look } : {}), ...(a.look.parts ? { parts: a.look.parts as AgentInfo['parts'] } : {}) };
      const cur = sim.agentPatches.get(ch.id);
      if (!cur || cur.seed !== want.seed || cur.look !== (want.look ?? cur.look) || JSON.stringify(cur.parts) !== JSON.stringify(want.parts)) {
        sim.agentPatches.set(ch.id, { ...cur, ...want });
        if (store?.liveSnapshot) sim.applySnapshot(store.liveSnapshot, Date.now());
      }
      patched.add(ch.id);
    }
    if (!spot) continue;
    const owner = sim.spots.ownerOf(spot.id);
    const mine = FIXED_OWNER + a.id;
    if (!ch) {
      // sem agente: a cadeira fica guardada com a plaquinha (se ninguém mais está nela)
      if (owner === undefined) sim.spots.reserve(spot.id, mine);
      if (sim.spots.ownerOf(spot.id) === mine) {
        wanted.add(`${spot.id}|${mine}`);
        empty.push({ id: a.id, name: a.name, spot });
      }
      continue;
    }
    if (ch.homeSpot === spot.id && owner === ch.id) continue;
    // pessoa (mesa fixa ou sentada) vence: o agente usa outra cadeira
    if (owner === VISITOR_ID || owner?.startsWith(DESK_OWNER) || owner?.startsWith('pessoa:')) continue;
    if (owner === mine) sim.spots.release(spot.id, mine);
    else if (owner && owner !== ch.id) {
      const other = sim.chars.get(owner);
      sim.spots.release(spot.id, owner);
      if (other) {
        if (other.homeSpot === spot.id) other.homeSpot = null;
        other.tempSpots = other.tempSpots.filter((x) => x !== spot.id);
        if (other.atSpot === spot.id || [other.step, ...other.queue].some((st) => st?.t === 'enter' && st.spot === spot.id)) sim.interrupt(other);
      }
    }
    if (ch.homeSpot && ch.homeSpot !== spot.id) sim.spots.release(ch.homeSpot, ch.id);
    if (sim.spots.reserve(spot.id, ch.id)) {
      ch.homeSpot = spot.id;
      // parado em outro lugar: o Sim pensa de novo e vai para a mesa certa
      if (!ch.step && !ch.queue.length && ch.atSpot !== spot.id) sim.interrupt(ch);
    }
  }
  // reservas "kvfixed:" que não valem mais (agente apagado, cadeira trocada)
  for (const s of sim.spots.all()) {
    const by = sim.spots.ownerOf(s.id);
    if (by?.startsWith(FIXED_OWNER) && !wanted.has(`${s.id}|${by}`)) sim.spots.release(s.id, by);
  }
  // aparência tirada do agente fixo: volta à do snapshot
  for (const id of [...sim.agentPatches.keys()]) {
    if (fixedPatched.has(id) && !patched.has(id)) {
      sim.agentPatches.delete(id);
      if (store?.liveSnapshot) sim.applySnapshot(store.liveSnapshot, Date.now());
    }
  }
  fixedPatched = patched;
  paintLabels(empty);
}
let fixedPatched = new Set<string>();

// ------------------------------------------------------------------ escolher a cadeira

/** A cadeira pode ser de um agente fixo? (cadeira, banqueta ou poltrona dentro de uma sala) */
export function kvFixable(s: SpotDef): boolean {
  return KV_DESK_KINDS.includes(s.kind) && !s.areaId.startsWith('core:');
}

/** A cadeira como cadeira de agente fixo (sala, posição relativa e lado). */
export function kvSeatOf(s: SpotDef): { room: string; seat: { x: number; y: number }; seatSide: 'n' | 's' } | null {
  const p = kvPeople.encode?.(s.x, s.y, s.dir);
  if (!p || p.k !== 'r' || !p.r) return null;
  return { room: p.r, seat: { x: Math.round(p.x), y: Math.round(p.y) }, seatSide: p.s === 's' ? 's' : 'n' };
}

let picking: { done: (s: SpotDef | null) => void } | null = null;

/**
 * Espera um clique numa cadeira de sala (com ou sem o meu boneco). Esc ou clique fora de cadeira cancela.
 * Mostra uma faixa com a instrução no alto.
 */
export function kvPickSeat(): Promise<SpotDef | null> {
  picking?.done(null);
  const canvas = document.getElementById('world');
  const sim = kvPeople.sim?.();
  if (!canvas || !sim || !kvPeople.camera) return Promise.resolve(null);
  return new Promise((resolve) => {
    const bar = h('div', { class: 'kv-fixed-pick', attrs: { role: 'status' } }, h('span', { text: tr('Clique numa cadeira de uma sala para a mesa do agente.') }), h('kbd', { class: 'kv-sc-key is-wide', text: 'Esc' }), h('span', { text: tr('cancela') }));
    (document.querySelector('.ui-root') ?? document.body).append(bar);
    document.documentElement.classList.add('kv-picking-seat');
    const finish = (s: SpotDef | null) => {
      canvas.removeEventListener('click', onClick, true);
      canvas.removeEventListener('pointermove', onMove);
      document.removeEventListener('keydown', onKey, true);
      bar.remove();
      document.documentElement.classList.remove('kv-picking-seat');
      picking = null;
      resolve(s);
    };
    const seatUnder = (e: MouseEvent): SpotDef | null => {
      const r = canvas.getBoundingClientRect();
      const w = kvPeople.camera!.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      const tx = Math.floor(w.x / TILE);
      const ty = Math.floor(w.y / TILE);
      return [...sim.spots.all()].find((s) => s.seated && s.tx === tx && s.ty === ty && kvFixable(s)) ?? null;
    };
    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      finish(seatUnder(e));
    };
    const onMove = (e: PointerEvent) => canvas.classList.toggle('kv-seat-hover', !!seatUnder(e));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish(null);
    };
    canvas.addEventListener('click', onClick, true);
    canvas.addEventListener('pointermove', onMove);
    document.addEventListener('keydown', onKey, true);
    picking = { done: finish };
  });
}

/** Leva a câmera até a mesa de um agente fixo. */
export function kvGoToFixedSeat(a: KvOrgAgent): boolean {
  const sim = kvPeople.sim?.();
  const s = sim ? kvFixedSeat(sim, a) : null;
  if (!s || !kvPeople.camera) return false;
  kvPeople.camera.follow = null;
  const w = (window as { habblaud?: { world?: { select(sel: { type: 'room'; id: string }, o?: { focus?: boolean }): void } } }).habblaud?.world;
  w?.select({ type: 'room', id: s.areaId }, { focus: true });
  return true;
}

// ------------------------------------------------------------------ início

export function kvStartFixedAgents(s: OfficeStore, edit: (draft: Partial<KvOrgAgent>) => void, canEdit: () => boolean): void {
  store = s;
  void kvLoadOrg();
  kvPeople.onTick.add((sim) => {
    try {
      tick(sim);
    } catch (err) {
      console.error('[kv] agentes fixos', err);
    }
  });
  // menu da cadeira: "Fixar um agente aqui" / "Mesa de <agente>: editar"
  kvSeatMenuExtras.push((spot) => {
    if (!canEdit() || !kvFixable(spot)) return null;
    const sim = kvPeople.sim?.();
    const taken = sim ? kvOrg()?.agents.find((a) => kvFixedSeat(sim, a)?.id === spot.id) : undefined;
    if (taken) return { label: tr('Mesa de {0}: editar o agente', [taken.name]), run: () => edit(taken) };
    const seat = kvSeatOf(spot);
    if (!seat) return null;
    return { label: `🤖 ${tr('Fixar um agente aqui')}`, run: () => edit({ ...seat, match: 'main' }) };
  });
}
