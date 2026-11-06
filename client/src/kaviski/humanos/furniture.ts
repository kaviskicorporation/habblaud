// Fork Kaviski (KAVISKI-HUMANOS.md): usar os móveis com o meu boneco e escolher a mesa fixa.
// - Tecla E (interact.ts): perto de um assento livre, "Sentar no sofá", "Afundar no puff"...; das máquinas e brinquedos
//   "Tomar café", "Pegar um lanche", "Lavar as mãos", "Jogar pingue-pongue", "Torcer"...; sentado, "Levantar" e as
//   alternativas (Tab): cochilar, olhar o celular, digitar (na mesa) e "Definir como minha mesa".
// - Clique num assento: menu pequeno com "Sentar aqui" e, nas cadeiras das salas, "Definir como minha mesa".
// - "Minha mesa" na janela Meu avatar (deskSection): ir até ela, usar a cadeira onde estou, tirar.
// O servidor valida a mesa (POST /api/kaviski/humanos/desk: só salas que a pessoa vê, uma cadeira por pessoa).
import { tr } from '../../../../shared/i18n';
import type { KvPos } from '../../../../shared/kaviski-presence';
import type { SpotDef, SpotKind } from '../../world/layout/types';
import { VISITOR_ID } from '../../world/sim/visitor';
import { h } from '../../ui/dom';
import { kvRegisterInteract, type KvInteractable, type KvInteractTone } from './interact';
import { DESK_OWNER } from './me';
import { KV_DESK_KINDS, KV_REACH_PX, KV_SIT_KINDS, KV_USE, nearestSpot, type KvSeatPose } from './seats';
import { kvPeople } from './world';

/** Como cada móvel aparece na barra de ações: nome, ícone e cor. */
interface UseLook {
  label: () => string;
  icon: string;
  tone: KvInteractTone;
}
const LOOK: Partial<Record<SpotKind, UseLook>> = {
  desk: { label: () => tr('Sentar à mesa'), icon: '💺', tone: 'seat' },
  stool: { label: () => tr('Sentar na banqueta'), icon: '🪑', tone: 'seat' },
  nook: { label: () => tr('Sentar na poltrona'), icon: '🛋️', tone: 'seat' },
  cafe_seat: { label: () => tr('Sentar à mesa da copa'), icon: '🪑', tone: 'seat' },
  sofa: { label: () => tr('Sentar no sofá'), icon: '🛋️', tone: 'rest' },
  armchair: { label: () => tr('Sentar na poltrona'), icon: '🛋️', tone: 'rest' },
  beanbag: { label: () => tr('Afundar no puff'), icon: '🫘', tone: 'rest' },
  bench: { label: () => tr('Sentar no banco'), icon: '🪑', tone: 'seat' },
  coffee: { label: () => tr('Tomar café'), icon: '☕', tone: 'food' },
  water: { label: () => tr('Beber água'), icon: '💧', tone: 'care' },
  snack: { label: () => tr('Pegar um lanche'), icon: '🍪', tone: 'food' },
  fridge: { label: () => tr('Abrir a geladeira'), icon: '🧃', tone: 'food' },
  sink: { label: () => tr('Lavar as mãos'), icon: '🫧', tone: 'care' },
  arcade: { label: () => tr('Jogar fliperama'), icon: '🕹️', tone: 'fun' },
  pingpong: { label: () => tr('Jogar pingue-pongue'), icon: '🏓', tone: 'fun' },
  watch: { label: () => tr('Torcer na partida'), icon: '📣', tone: 'fun' },
  shelf: { label: () => tr('Pegar um livro'), icon: '📚', tone: 'read' },
};
const USE_KINDS = Object.keys(KV_USE) as SpotKind[];

/** Sentado: as poses que dá para trocar (a que estou agora some da lista). */
const SEAT_POSES: { pose: KvSeatPose; label: () => string; icon: string; tone: KvInteractTone; desk?: boolean }[] = [
  { pose: 'type', label: () => tr('Trabalhar no computador'), icon: '⌨️', tone: 'work', desk: true },
  { pose: 'phone', label: () => tr('Olhar o celular'), icon: '📱', tone: 'link' },
  { pose: 'sleep', label: () => tr('Cochilar'), icon: '😴', tone: 'rest' },
];

type Warn = (text: string) => void;

/** Guarda (ou tira, com null) a minha mesa fixa no servidor. */
export async function kvSaveDesk(desk: KvPos | null): Promise<string | null> {
  try {
    const res = await fetch('/api/kaviski/humanos/desk', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desk }),
    });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    return b.error ?? String(res.status);
  } catch {
    return tr('Sem conexão com o Habblaud.');
  }
}

/** A cadeira pode ser mesa fixa (cadeira, banqueta ou poltrona de uma sala de projeto)? */
function deskable(s: SpotDef): boolean {
  return KV_DESK_KINDS.includes(s.kind) && !s.areaId.startsWith('core:');
}

/** O lugar está livre para mim (ou é da minha mesa, ou de um agente que não está lá)? */
function freeForMe(s: SpotDef): boolean {
  const c = kvPeople.ctl?.();
  if (!c) return false;
  const owner = c.sim.spots.ownerOf(s.id);
  if (owner === undefined || owner === VISITOR_ID) return true;
  if (owner === DESK_OWNER + (kvPeople.client?.state?.me ?? '')) return true;
  const ag = c.sim.chars.get(owner);
  return !!ag && ag.atSpot !== s.id && ![ag.step, ...ag.queue].some((st) => st?.t === 'enter' && st.spot === s.id);
}

/** Itens a mais no menu da cadeira (planta livre: "Fixar um agente aqui", fixed-agents.ts). */
export const kvSeatMenuExtras: ((s: SpotDef) => { label: string; icon?: string; run: () => void } | null)[] = [];

export function kvStartFurniture(warn: Warn): void {
  const setDesk = async (s: SpotDef) => {
    const pos = kvPeople.encode?.(s.x, s.y, s.dir);
    if (!pos || pos.k !== 'r') return warn(tr('A mesa fixa fica dentro de uma sala de projeto.'));
    const err = await kvSaveDesk(pos);
    warn(err ?? tr('Pronto: esta é a sua mesa.'));
  };
  const sit = (s: SpotDef) => {
    const c = kvPeople.ctl?.();
    if (!c) return;
    if (!c.me.sit(c.sim, s)) warn(tr('Esse lugar está ocupado.'));
  };

  // ---- tecla E
  kvRegisterInteract((me) => {
    const c = kvPeople.ctl?.();
    if (!c || !kvPeople.inside) return null;
    if (c.me.using(c.sim)) {
      const spot = c.me.seat?.spot;
      const seated = !!spot?.seated;
      const out: KvInteractable[] = [{ id: `kv-stand`, label: seated ? tr('Levantar') : tr('Parar'), icon: seated ? '🧍' : '✋', tone: 'stand', dist: 0, run: () => c.me.stand(c.sim) }];
      const now = c.me.seatPose(c.sim);
      if (spot && now) {
        // a pose de agora volta como "Só sentar"; as outras viram alternativas (Tab)
        if (now !== 'sit') out.unshift({ id: 'kv-pose:sit', label: now === 'sleep' ? tr('Acordar') : tr('Só sentar'), icon: now === 'sleep' ? '☀️' : '🙂', tone: 'seat', dist: -1, run: () => c.me.setSeatPose(c.sim, 'sit') });
        for (const p of SEAT_POSES) {
          if (p.pose === now || (p.desk && !KV_DESK_KINDS.includes(spot.kind))) continue;
          out.push({ id: `kv-pose:${p.pose}`, label: p.label(), icon: p.icon, tone: p.tone, dist: 1 + out.length, run: () => c.me.setSeatPose(c.sim, p.pose) });
        }
        if (deskable(spot) && kvPeople.client?.state?.me && !isMyDesk(spot)) out.push({ id: 'kv-desk-set', label: tr('Definir como minha mesa'), icon: '📌', tone: 'door', dist: 0.5, run: () => void setDesk(spot) });
      }
      return out;
    }
    const s = nearestSpot(c.sim.spots.all(), me.x, me.y, [...KV_SIT_KINDS, ...USE_KINDS], KV_REACH_PX, freeForMe);
    if (!s) return null;
    const look = LOOK[s.kind];
    return { id: `kv-seat:${s.id}`, label: look?.label() ?? tr('Sentar'), icon: look?.icon ?? '🪑', tone: look?.tone ?? 'seat', dist: Math.hypot(s.x - me.x, s.y - me.y), run: () => sit(s) };
  });

  // ---- clique num assento: menu
  const menu = h('div', { class: 'kv-seat-menu', hidden: true, attrs: { role: 'menu' } });
  (document.querySelector('.ui-root') ?? document.body).append(menu);
  const closeMenu = () => (menu.hidden = true);
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  kvPeople.onSeatClick = (s, at) => {
    const r = document.getElementById('world')?.getBoundingClientRect();
    const item = (icon: string, text: string, fn: () => void) =>
      h('button', { class: 'ui-btn ui-btn--sm kv-seat-menu__item', type: 'button', attrs: { role: 'menuitem' }, on: { click: () => (closeMenu(), fn()) } }, h('span', { class: 'kv-seat-menu__ico', text: icon, attrs: { 'aria-hidden': 'true' } }), h('span', { text }));
    const items = [item(LOOK[s.kind]?.icon ?? '🪑', tr('Sentar aqui'), () => sit(s))];
    if (deskable(s) && kvPeople.client?.state?.me) items.push(item('📌', tr('Definir como minha mesa'), () => void setDesk(s)));
    for (const x of kvSeatMenuExtras) for (const it of [x(s)]) if (it) items.push(item(it.icon ?? '🤖', it.label, it.run));
    menu.replaceChildren(...items);
    menu.style.left = `${Math.round((r?.left ?? 0) + at.x)}px`;
    menu.style.top = `${Math.round((r?.top ?? 0) + at.y + 8)}px`;
    menu.hidden = false;
    (menu.firstElementChild as HTMLElement | null)?.focus();
  };
}

/** O assento é a minha mesa fixa? (a posição guardada cai neste lugar) */
function isMyDesk(s: SpotDef): boolean {
  const d = kvPeople.myDesk?.pos;
  const p = kvPeople.encode?.(s.x, s.y, s.dir);
  if (!d || !p || p.k !== 'r' || p.r !== d.r) return false;
  const ny = (q: KvPos) => (q.s === 's' ? 192 - q.y : q.y);
  return Math.abs(p.x - d.x) < 8 && Math.abs(ny(p) - ny(d)) < 8;
}

/** "Minha mesa" na janela Meu avatar. */
export function kvDeskSection(warn: (text: string) => void = () => {}): HTMLElement {
  const text = h('span', { class: 'kv-desk__where' });
  const msg = h('p', { class: 'kv-desk__msg', attrs: { role: 'status' } });
  const say = (t: string) => {
    msg.textContent = t;
    warn(t);
  };
  const go = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Ir até a minha mesa'), on: { click: () => void (kvPeople.goDesk?.(null) || say(tr('A sua mesa não está neste prédio agora.'))) } });
  const here = h('button', {
    class: 'ui-btn ui-btn--sm',
    type: 'button',
    text: tr('Usar a cadeira onde estou'),
    on: {
      click: async () => {
        const c = kvPeople.ctl?.();
        const s = c && c.me.seated(c.sim) ? c.me.seat?.spot : undefined;
        if (!s || !deskable(s)) return say(tr('Sente numa cadeira de uma sala primeiro (tecla E perto dela).'));
        const pos = kvPeople.encode?.(s.x, s.y, s.dir);
        if (!pos) return;
        say((await kvSaveDesk(pos)) ?? tr('Pronto: esta é a sua mesa.'));
      },
    },
  });
  const clear = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Tirar a mesa'), on: { click: async () => say((await kvSaveDesk(null)) ?? tr('Sem mesa fixa.')) } });
  const el = h('div', { class: 'kv-desk' }, h('strong', { text: tr('Minha mesa') }), text, h('div', { class: 'kv-people__actions' }, go, here, clear), msg);
  const paint = () => {
    const d = kvPeople.myDesk;
    text.textContent = d ? tr('na sala {0}', [roomNames(d.roomId) ?? tr('sala')]) : tr('nenhuma — clique numa cadeira de uma sala e escolha "Definir como minha mesa".');
    go.disabled = !d;
    clear.disabled = !d;
  };
  setInterval(paint, 1000);
  paint();
  return el;
}

/** Nome da sala pelo snapshot desta página. */
let roomNames: (id: string) => string | undefined = () => undefined;
export function kvSetRoomNames(fn: (id: string) => string | undefined): void {
  roomNames = fn;
}
