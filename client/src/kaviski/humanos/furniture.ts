// Fork Kaviski (KAVISKI-HUMANOS.md): usar os móveis com o meu boneco e escolher a mesa fixa.
// - Tecla E (interact.ts): perto de um assento livre, "Sentar"; da máquina de café/água, do fliperama, da estante,
//   "Tomar café" etc.; sentado, "Levantar" (andar também levanta).
// - Clique num assento: menu pequeno com "Sentar aqui" e, nas cadeiras das salas, "Definir como minha mesa".
// - Sentado numa cadeira de sala que não é a minha mesa: botão flutuante "Definir como minha mesa".
// - "Minha mesa" na janela Meu boneco (deskSection): ir até ela, usar a cadeira onde estou, tirar.
// O servidor valida a mesa (POST /api/kaviski/humanos/desk: só salas que a pessoa vê, uma cadeira por pessoa).
import { tr } from '../../../../shared/i18n';
import type { KvPos } from '../../../../shared/kaviski-presence';
import type { SpotDef, SpotKind } from '../../world/layout/types';
import { VISITOR_ID } from '../../world/sim/visitor';
import { h } from '../../ui/dom';
import { kvRegisterInteract } from './interact';
import { DESK_OWNER } from './me';
import { KV_DESK_KINDS, KV_REACH_PX, KV_SIT_KINDS, KV_USE, nearestSpot } from './seats';
import { kvPeople } from './world';

const USE_LABEL: Partial<Record<SpotKind, () => string>> = {
  coffee: () => tr('Tomar café'),
  water: () => tr('Beber água'),
  arcade: () => tr('Jogar fliperama'),
  shelf: () => tr('Pegar um livro'),
};
const USE_KINDS = Object.keys(KV_USE) as SpotKind[];

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
    if (c.me.using(c.sim)) return { id: `kv-stand`, label: c.me.seat?.spot.seated ? tr('Levantar') : tr('Parar'), dist: 0, run: () => c.me.stand(c.sim) };
    const s = nearestSpot(c.sim.spots.all(), me.x, me.y, [...KV_SIT_KINDS, ...USE_KINDS], KV_REACH_PX, freeForMe);
    if (!s) return null;
    const label = USE_LABEL[s.kind]?.() ?? tr('Sentar');
    return { id: `kv-seat:${s.id}`, label, dist: Math.hypot(s.x - me.x, s.y - me.y), run: () => sit(s) };
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
    const item = (text: string, fn: () => void) => h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text, attrs: { role: 'menuitem' }, on: { click: () => (closeMenu(), fn()) } });
    const items = [item(tr('Sentar aqui'), () => sit(s))];
    if (deskable(s) && kvPeople.client?.state?.me) items.push(item(tr('Definir como minha mesa'), () => void setDesk(s)));
    menu.replaceChildren(...items);
    menu.style.left = `${Math.round((r?.left ?? 0) + at.x)}px`;
    menu.style.top = `${Math.round((r?.top ?? 0) + at.y + 8)}px`;
    menu.hidden = false;
    (menu.firstElementChild as HTMLElement | null)?.focus();
  };

  // ---- sentado numa cadeira de sala que não é a minha: "Definir como minha mesa"
  const pin = h('button', { class: 'kv-desk-pin ui-btn ui-btn--sm', type: 'button', hidden: true, text: `📌 ${tr('Definir como minha mesa')}` });
  pin.addEventListener('click', () => {
    const s = kvPeople.ctl?.()?.me.seat?.spot;
    if (s) void setDesk(s);
  });
  (document.querySelector('.ui-root') ?? document.body).append(pin);
  const tick = () => {
    requestAnimationFrame(tick);
    const c = kvPeople.ctl?.();
    const s = c && kvPeople.inside && c.me.seated(c.sim) ? c.me.seat?.spot : undefined;
    const mine = s && c ? c.sim.spots.ownerOf(s.id) === VISITOR_ID && isMyDesk(s) : false;
    const where = s ? kvPeople.locate?.(null) : null;
    if (!s || !where || !deskable(s) || mine) {
      pin.hidden = true;
      return;
    }
    pin.hidden = false;
    pin.style.left = `${Math.round(where.sx)}px`;
    pin.style.top = `${Math.round(where.sy + 10 * where.zoom)}px`;
  };
  requestAnimationFrame(tick);
}

/** O assento é a minha mesa fixa? (a posição guardada cai neste lugar) */
function isMyDesk(s: SpotDef): boolean {
  const d = kvPeople.myDesk?.pos;
  const p = kvPeople.encode?.(s.x, s.y, s.dir);
  if (!d || !p || p.k !== 'r' || p.r !== d.r) return false;
  const ny = (q: KvPos) => (q.s === 's' ? 192 - q.y : q.y);
  return Math.abs(p.x - d.x) < 8 && Math.abs(ny(p) - ny(d)) < 8;
}

/** "Minha mesa" na janela Meu boneco. */
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
