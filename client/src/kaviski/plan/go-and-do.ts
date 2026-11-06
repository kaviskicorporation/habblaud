// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): "ir e fazer". Com o meu boneco no escritório e a
// planta ligada, cada função tem um item físico numa sala temática (themes.ts): clicar no botão do topo (ou no menu
// Mais, ou a tecla que abre a janela) faz o boneco andar — correndo, se longe — até o item mais perto, virar para ele,
// fazer a pose (mexer, ler, pentear no espelho, falar no púlpito), um brilho aparece no item e a janela abre ali.
// Clicar de novo, Esc ou andar cancela (chip "Indo até o RH… · Esc cancela"). Sem boneco, no modo clássico, sem planta
// ou sem o item: abre direto, como sempre. Shift+clique no botão também abre direto. Opção "Ir andando até o lugar"
// (lembrada no navegador; na engrenagem da sala de TI e na lista de quem está online), ligada por padrão.
// Perto de um item: tecla E (dica "E · Pessoas (RH)"); clicar no item (perto ou longe) também; passar o mouse acende
// o contorno dele.
import type { HeldItem, Pose } from '../../art/api';
import { tr } from '../../../../shared/i18n';
import { KV_THEME_KEYS, type KvThemeKey } from '../../../../shared/kaviski-plan';
import { TILE } from '../../world/constants';
import type { Step } from '../../world/sim/steps';
import { h } from '../../ui/dom';
import { kvRegisterInteract } from '../humanos/interact';
import { kvPeople } from '../humanos/world';
import { kvAction, kvActions, kvPlanWorld, type KvActionSpot } from './api';
import { KV_ACTION_DEFS, kvActionButton, kvActionDef, kvBypassing, kvRegisterThemeActions, kvWalkPref } from './themes-actions';
import { kvThemeInfo } from './themes-info';
import { kvSpotFeet } from './themes-spots';
import './themes'; // registra a mobília das salas temáticas
import './themes.css';

const PREF = 'habblaud.kv.irAndando';
/** Até quantos px (dos pés ao lugar de uso) a tecla E alcança. */
const REACH = 1.7 * TILE;
/** Longe assim (tiles), o boneco corre. */
const RUN_TILES = 9;
/** Mais longe que isto (tiles, em linha reta), o boneco aparece com um brilho perto do item e anda o resto (numa planta
 * grande, correr até o outro lado levava quase um minuto). */
const FAR_TILES = 32;

interface Pending {
  key: string;
  spot: KvActionSpot;
  finish: Step;
  done: boolean;
}

let pending: Pending | null = null;
let chip: HTMLElement | null = null;

// ------------------------------------------------------------------ preferência

function walkOn(): boolean {
  try {
    return localStorage.getItem(PREF) !== '0';
  } catch {
    return true;
  }
}

function setWalk(on: boolean): void {
  try {
    localStorage.setItem(PREF, on ? '1' : '0');
  } catch {
    // sem localStorage
  }
  syncPrefButtons();
  toastChip(on ? tr('Ir andando até o lugar: ligado') : tr('Ir andando até o lugar: desligado (as janelas abrem direto)'));
}

kvWalkPref.get = walkOn;
kvWalkPref.set = setWalk;

// ------------------------------------------------------------------ onde fica cada coisa

/** Nome da sala de um lugar (a placa da sala temática). */
function roomName(spot: KvActionSpot): string {
  const id = spot.areaId.startsWith('kv:') ? spot.areaId.slice(3) : '';
  const it = id ? kvPlanWorld.plan?.items.find((i) => i.id === id) : undefined;
  if (it?.name) return it.name;
  if (it?.kind === 'tema' && KV_THEME_KEYS.includes(it.ref as KvThemeKey)) return kvThemeInfo(it.ref as KvThemeKey).name;
  return '';
}

function actionLabel(key: string): string {
  return kvAction(key)?.label ?? kvActionDef(key)?.label() ?? key;
}

function allowed(key: string): boolean {
  const a = kvAction(key);
  return !!a && (a.allowed?.() ?? true);
}

/** Os lugares desta ação no prédio (só os que eu posso usar). */
function spotsOf(key: string): KvActionSpot[] {
  if (!kvPlanWorld.plan) return [];
  try {
    return kvPlanWorld.actionSpots().filter((s) => s.action === key);
  } catch {
    return [];
  }
}

function me(): { x: number; y: number } | null {
  const c = kvPeople.ctl?.();
  const v = c?.sim.visitor;
  return kvPeople.inside && v ? { x: v.x, y: v.y } : null;
}

function nearest(spots: KvActionSpot[], at: { x: number; y: number }): KvActionSpot | null {
  let best: KvActionSpot | null = null;
  let bd = Infinity;
  for (const s of spots) {
    const f = kvSpotFeet(s);
    const d = Math.hypot(f.x - at.x, f.y - at.y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Vale andar até o item desta ação agora? */
function canWalk(key: string): boolean {
  if (!walkOn() || !me() || kvPeople.resting) return false;
  const c = kvPeople.ctl?.();
  if (!c || c.sim.visitorBusy) return false;
  return spotsOf(key).length > 0;
}

// ------------------------------------------------------------------ fazer

function pose(key: string): { pose: Pose; held: HeldItem; ms: number } {
  switch (kvActionDef(key)?.pose ?? kvAction(key)?.pose ?? 'use') {
    case 'read':
      return { pose: 'read', held: 'papers', ms: 750 };
    case 'groom':
      return { pose: 'groom', held: 'comb', ms: 1100 };
    case 'talk':
      return { pose: 'talk', held: 'none', ms: 800 };
    case 'stand':
      return { pose: 'stand', held: 'none', ms: 450 };
    default:
      return { pose: 'use', held: 'none', ms: 650 };
  }
}

/** Abre a ação (sem andar). */
function runNow(key: string): void {
  const a = kvAction(key);
  if (!a || (a.allowed && !a.allowed())) return;
  try {
    a.run();
  } catch (e) {
    console.warn('[habblaud] ação', key, e);
  }
}

/**
 * "Ir e fazer": o boneco anda até o item da ação mais perto e, ao chegar, a ação acontece. Sem como andar: abre direto.
 * `spot` = um item escolhido (clique ou E nele).
 */
export function kvGoAndDo(key: string, opts: { direct?: boolean; spot?: KvActionSpot } = {}): void {
  if (!allowed(key)) return;
  if (pending && pending.key === key && !opts.spot) {
    cancel();
    return;
  }
  if (opts.direct || (!opts.spot && !canWalk(key))) return runNow(key);
  const at = me();
  const c = kvPeople.ctl?.();
  const v = c?.sim.visitor;
  const spot = opts.spot ?? (at ? nearest(spotsOf(key), at) : null);
  if (!at || !c || !v || !spot || c.sim.visitorBusy) return runNow(key);
  cancel();
  const feet = kvSpotFeet(spot);
  const near = Math.hypot(feet.x - at.x, feet.y - at.y) <= REACH;
  const p = pose(key);
  const finish: Step = { t: 'do', fn: () => arrive(key, spot) };
  const steps: Step[] = [
    { t: 'go', tx: spot.tx, ty: spot.ty, dir: spot.dir },
    { t: 'do', fn: () => sparkle(spot, kvAction(key)?.icon ?? '✨') },
    { t: 'act', pose: p.pose, ms: p.ms, held: p.held, dir: spot.dir },
    finish,
  ];
  if (near) c.me.stand(c.sim, steps);
  else {
    let dist = Math.hypot(feet.x - at.x, feet.y - at.y);
    if (dist > FAR_TILES * TILE && c.me.teleport(c.sim, feet.x, feet.y, Date.now())) dist = 0;
    const run = dist > RUN_TILES * TILE;
    if (!kvPeople.walkTo?.(spot.tx, spot.ty, run)) return runNow(key);
    v.queue.push(...steps);
    showChip(tr('Indo até {0}…', [roomName(spot) || actionLabel(key)]), true);
  }
  pending = { key, spot, finish, done: false };
}

function arrive(key: string, _spot: KvActionSpot): void {
  if (pending) pending.done = true;
  pending = null;
  hideChip();
  runNow(key);
}

/** Cancela a ida (Esc, clique de novo). */
export function kvCancelGoAndDo(): boolean {
  if (!pending) return false;
  cancel();
  return true;
}

function cancel(): void {
  const p = pending;
  pending = null;
  hideChip();
  if (!p || p.done) return;
  const v = kvPeople.ctl?.()?.sim.visitor;
  if (!v) return;
  const mine = v.step === p.finish || v.queue.includes(p.finish);
  if (mine) {
    v.queue.length = 0;
    if (v.step?.t === 'go' || v.step?.t === 'act' || v.step?.t === 'do') v.step = null;
  }
}

// ------------------------------------------------------------------ interface (chip, brilho, contorno)

function root(): HTMLElement {
  return (document.querySelector('.ui-root') as HTMLElement | null) ?? document.body;
}

function showChip(text: string, cancelable: boolean): void {
  if (!chip) {
    chip = h('div', { class: 'kv-gd-chip', hidden: true, attrs: { role: 'status', 'aria-live': 'polite' } });
    chip.addEventListener('click', () => cancel());
    root().append(chip);
  }
  chip.replaceChildren(h('span', { class: 'kv-gd-chip__walk', attrs: { 'aria-hidden': 'true' } }), h('span', { text }), ...(cancelable ? [h('span', { class: 'kv-gd-chip__esc', text: tr('Esc cancela') })] : []));
  chip.hidden = false;
  chip.classList.toggle('is-note', !cancelable);
}

let chipTimer = 0;
function toastChip(text: string): void {
  showChip(text, false);
  clearTimeout(chipTimer);
  chipTimer = window.setTimeout(() => !pending && hideChip(), 2600);
}

function hideChip(): void {
  if (chip) chip.hidden = true;
}

/** Brilho e o ícone da ação subindo do item (segue a câmera por ~1,2 s). */
function sparkle(spot: KvActionSpot, icon: string): void {
  const el = h('div', { class: 'kv-gd-spark', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'kv-gd-spark__icon', text: icon }));
  root().append(el);
  const box = spot.box ?? { x: spot.x - 8, y: spot.y - 8, w: 16, h: 16 };
  const t0 = performance.now();
  const step = () => {
    const s = kvPeople.toScreen?.(box.x + box.w / 2, box.y + box.h / 2);
    if (s) {
      el.style.left = `${Math.round(s.sx)}px`;
      el.style.top = `${Math.round(s.sy)}px`;
    }
    if (performance.now() - t0 < 1300) requestAnimationFrame(step);
    else el.remove();
  };
  step();
}

let outline: HTMLElement | null = null;
let hover: KvActionSpot | null = null;

function drawOutline(): void {
  if (!outline) {
    outline = h('div', { class: 'kv-gd-outline', hidden: true, attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'kv-gd-outline__label' }));
    root().append(outline);
  }
  const s = hover;
  const box = s?.box;
  const a = s && box ? kvPeople.toScreen?.(box.x, box.y) : null;
  const b = s && box ? kvPeople.toScreen?.(box.x + box.w, box.y + box.h) : null;
  if (!s || !a || !b) {
    outline.hidden = true;
    return;
  }
  outline.hidden = false;
  outline.style.left = `${Math.round(a.sx) - 3}px`;
  outline.style.top = `${Math.round(a.sy) - 3}px`;
  outline.style.width = `${Math.round(b.sx - a.sx) + 6}px`;
  outline.style.height = `${Math.round(b.sy - a.sy) + 6}px`;
  const room = roomName(s);
  const text = `${kvAction(s.action)?.icon ?? ''} ${actionLabel(s.action)}${room ? ` · ${room}` : ''}`;
  const lab = outline.firstElementChild as HTMLElement;
  if (lab.textContent !== text) lab.textContent = text;
}

/** O item interativo (que eu posso usar) sob o ponto (px de mundo). */
function itemAt(x: number, y: number): KvActionSpot | null {
  if (!kvPlanWorld.plan || !kvPeople.inside) return null;
  let best: KvActionSpot | null = null;
  let area = Infinity;
  for (const s of safeSpots()) {
    const b = s.box;
    if (!b || x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue;
    if (b.w * b.h < area && allowed(s.action)) {
      area = b.w * b.h;
      best = s;
    }
  }
  return best;
}

function safeSpots(): KvActionSpot[] {
  try {
    return kvPlanWorld.actionSpots();
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ ligar

/** Embrulha os botões das ações: o clique passa pelo "ir e fazer" (Shift abre direto). */
function bindButtons(): void {
  for (const d of KV_ACTION_DEFS) {
    if (!d.button) continue;
    const el = kvActionButton(d);
    if (!el || el.dataset.kvGd) continue;
    el.dataset.kvGd = d.key;
    el.addEventListener(
      'click',
      (e) => {
        if (kvBypassing() || (e as MouseEvent).shiftKey) return;
        // botão já ligado/aberto (conversa aberta, foco ligado...): o clique fecha, direto, sem andar
        const on = el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.classList.contains('is-on');
        if ((on || !canWalk(d.key)) && !(pending && pending.key === d.key)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        kvGoAndDo(d.key);
      },
      { capture: true },
    );
  }
}

/** O botão "Ir andando até o lugar" na lista de quem está online (ao lado de Meu boneco). */
const prefButtons = new Set<HTMLButtonElement>();
function syncPrefButtons(): void {
  for (const b of prefButtons) {
    const on = walkOn();
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('is-on', on);
    b.textContent = on ? tr('🚶 Ir andando: ligado') : tr('🚶 Ir andando: desligado');
  }
}

function injectPref(): void {
  const box = document.querySelector('.kv-ol__actions');
  if (!box || box.querySelector('.kv-gd-pref')) return;
  const b = h('button', {
    class: 'ui-btn ui-btn--sm kv-gd-pref',
    type: 'button',
    title: tr('Clicar num botão do topo leva o seu boneco andando até o lugar da função (Shift+clique abre direto)'),
    on: { click: () => setWalk(!walkOn()) },
  });
  prefButtons.add(b);
  box.append(b);
  syncPrefButtons();
}

let started = false;

/** Liga o "ir e fazer" (uma vez, com as pessoas no escritório). */
export function kvStartGoAndDo(): void {
  if (started) return;
  started = true;
  kvRegisterThemeActions();
  // as frentes D e B registram 'organograma' e 'planta' depois: os botões aparecem aos poucos
  bindButtons();
  injectPref();
  setInterval(() => {
    bindButtons();
    injectPref();
  }, 1500);

  // teclas que abrem janelas (L, M, ?) passam pelo "ir e fazer"; Esc cancela a ida
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        kvCancelGoAndDo();
        return;
      }
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.shiftKey && e.key !== '?') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest?.('dialog[open], [role="dialog"]'))) return;
      const d = KV_ACTION_DEFS.find((x) => x.keys?.includes(e.key));
      if (!d || !allowed(d.key) || !canWalk(d.key)) return;
      e.preventDefault();
      e.stopPropagation();
      kvGoAndDo(d.key);
    },
    true,
  );

  // tecla E perto de um item
  kvRegisterInteract((at) => {
    if (!kvPlanWorld.plan) return null;
    let best: KvActionSpot | null = null;
    let bd = REACH;
    for (const s of safeSpots()) {
      const f = kvSpotFeet(s);
      const d = Math.hypot(f.x - at.x, f.y - at.y);
      if (d <= bd && allowed(s.action)) {
        bd = d;
        best = s;
      }
    }
    if (!best) return null;
    const s = best;
    const room = roomName(s);
    return { id: `kv-gd:${s.action}:${s.tx},${s.ty}`, label: room ? `${actionLabel(s.action)} (${room})` : actionLabel(s.action), dist: bd, run: () => kvGoAndDo(s.action, { spot: s }) };
  });

  // clicar num item: o boneco vai até ele e usa
  kvPeople.onItemClick = (x, y) => {
    const s = itemAt(x, y);
    if (!s) return false;
    kvGoAndDo(s.action, { spot: s });
    return true;
  };

  // passar o mouse: contorno aceso e o nome
  const canvas = document.getElementById('world');
  let raf = 0;
  const loop = () => {
    drawOutline();
    raf = hover ? requestAnimationFrame(loop) : 0;
  };
  canvas?.addEventListener('pointermove', (e) => {
    const cam = kvPeople.camera;
    if (!cam || e.pointerType === 'touch') return;
    const r = canvas.getBoundingClientRect();
    const w = cam.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    const s = itemAt(w.x, w.y);
    if (s !== hover) {
      hover = s;
      canvas.classList.toggle('kv-gd-hover', !!s);
      if (!raf) loop();
    }
  });
  canvas?.addEventListener('pointerleave', () => {
    hover = null;
    canvas.classList.remove('kv-gd-hover');
  });

  // andar com as setas/clique cancela: a ida sumiu da fila do boneco
  kvPeople.onFrame.add(() => {
    const p = pending;
    if (!p || p.done) return;
    const v = kvPeople.ctl?.()?.sim.visitor;
    if (!v || (v.step !== p.finish && !v.queue.includes(p.finish))) {
      pending = null;
      hideChip();
    }
  });
  Object.assign((window as { habblaud?: object }).habblaud ?? {}, { kvGoAndDo, kvPlanWorld, kvActions });
}
