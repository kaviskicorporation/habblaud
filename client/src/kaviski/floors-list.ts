// Fork Kaviski (KAVISKI.md): lista lateral "Escritório" agrupada por andar (com HABBLAUD_FLOOR_COLS).
// As salas vêm na ordem do prédio (térreo primeiro, a ordem do usuário dentro do andar) e a primeira sala de cada
// andar leva o cabeçalho do andar (número, nome, resumo vivo). Andares sem ninguém aparecem recolhidos (uma linha).
// Clicar no cabeçalho enquadra o andar no prédio (evento KV_FLOOR_EVENT, ouvido por floors-draw.ts).
import type { OfficeSnapshot } from '../../../shared/types';
import type { KvSnapshotMeta } from '../../../shared/kaviski';
import { tr } from '../../../shared/i18n';
import { kvFloorPlan, kvFloorShort, kvFloorsOn, kvSetFloorCols, type KvFloorEntry } from './floors';
import { kvFloorLabelText, kvRoomFloorLabel } from './floors-sim';
import { KV_FLOOR_EVENT } from './floors-draw';

type Snap = Pick<OfficeSnapshot, 'rooms' | 'agents' | 'meta'> | null;

interface Plan {
  floors: KvFloorEntry[];
  roomFloor: Map<string, number>;
}

let cache: { rooms: unknown; plan: Plan } | null = null;

function planOf(snap: Snap): Plan | null {
  if (!snap) return null;
  kvSetFloorCols((snap.meta as KvSnapshotMeta | undefined)?.kaviski?.floorCols);
  if (!kvFloorsOn()) return null;
  if (cache?.rooms !== snap.rooms) cache = { rooms: snap.rooms, plan: kvFloorPlan(snap.rooms, kvRoomFloorLabel) };
  return cache.plan;
}

/** Salas na ordem do prédio (estável: a ordem do usuário vale dentro do andar). Sem andares: igual. */
export function kvSortByFloor<G extends { room: { id: string } }>(groups: G[], snap: Snap): G[] {
  const plan = planOf(snap);
  if (!plan) return groups;
  const f = (g: G) => plan.roomFloor.get(g.room.id) ?? plan.floors.length;
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => f(a.g) - f(b.g) || a.i - b.i)
    .map((x) => x.g);
}

/** Resumo de um andar para o cabeçalho. */
export function kvFloorSummary(snap: NonNullable<Snap>, plan: Plan, f: number): { rooms: number; busy: number; working: number; waiting: number } {
  const ids = new Set([...plan.roomFloor].filter(([, ff]) => ff === f).map(([id]) => id));
  const busy = new Set<string>();
  let working = 0;
  let waiting = 0;
  for (const a of snap.agents) {
    if (!ids.has(a.roomId) || a.status === 'offline' || a.status === 'done') continue;
    busy.add(a.roomId);
    if (a.status === 'waiting') waiting++;
    else if (a.status === 'working' || a.status === 'shell') working++;
  }
  return { rooms: ids.size, busy: busy.size, working, waiting };
}

function head(f: number, label: string, s: ReturnType<typeof kvFloorSummary>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'kv-floorhead';
  el.dataset.floor = String(f);
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.title = tr('Enquadrar o andar no prédio');
  el.classList.toggle('is-empty', s.busy === 0);
  el.classList.toggle('is-alert', s.waiting > 0);
  const num = document.createElement('span');
  num.className = 'kv-floorhead__num';
  num.textContent = kvFloorShort(f);
  const name = document.createElement('span');
  name.className = 'kv-floorhead__name';
  name.textContent = label || (f === 0 ? tr('Térreo') : tr('{0}º andar', [f]));
  const sum = document.createElement('span');
  sum.className = 'kv-floorhead__sum';
  const bits: string[] = [];
  if (s.waiting) bits.push(s.waiting === 1 ? tr('1 precisa de você') : tr('{0} precisam de você', [s.waiting]));
  if (s.working) bits.push(tr('{0} trabalhando', [s.working]));
  if (!bits.length) bits.push(s.busy ? tr('{0} de {1} salas com alguém', [s.busy, s.rooms]) : tr('{0} salas, ninguém', [s.rooms]));
  sum.textContent = bits.join(' · ');
  el.append(num, name, sum);
  const go = () => window.dispatchEvent(new CustomEvent(KV_FLOOR_EVENT, { detail: f }));
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    go();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  });
  return el;
}

/**
 * Põe os cabeçalhos dos andares: no topo da seção da primeira sala de cada andar (com os andares vazios anteriores,
 * recolhidos) e, depois da lista, os andares vazios do fim. Sem andares: tira tudo.
 */
export function kvFloorHeads<G extends { room: { id: string } }>(list: { container: HTMLElement; get(key: string): HTMLElement | undefined }, groups: readonly G[], snap: Snap): void {
  const plan = planOf(snap);
  for (const el of list.container.querySelectorAll(':scope > * > .kv-floorheads')) el.remove();
  let tail = list.container.parentElement?.querySelector<HTMLElement>(':scope > .kv-floortail') ?? null;
  if (!plan || !snap) {
    tail?.remove();
    return;
  }
  if (!tail) {
    tail = document.createElement('div');
    tail.className = 'kv-floortail kv-floorheads';
    list.container.after(tail);
  }
  tail.replaceChildren();
  let next = 0;
  const heads = (upTo: number, into: HTMLElement) => {
    for (; next <= upTo && next < plan.floors.length; next++) into.append(head(next, kvFloorLabelText(plan.floors, next), kvFloorSummary(snap, plan, next)));
  };
  for (const g of groups) {
    const f = plan.roomFloor.get(g.room.id);
    if (f === undefined || f < next) continue;
    const section = list.get(g.room.id);
    if (!section) continue;
    const wrap = document.createElement('div');
    wrap.className = 'kv-floorheads';
    heads(f, wrap);
    section.prepend(wrap);
  }
  heads(plan.floors.length - 1, tail);
}
