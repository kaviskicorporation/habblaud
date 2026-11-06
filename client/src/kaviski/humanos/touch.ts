// Fork Kaviski (KAVISKI-HUMANOS.md): celular e tablet. Com o boneco andando numa tela de toque: joystick no canto de
// baixo à esquerda (arrastar = andar; até a borda = correr) e o botão de ação à direita (a tecla E: sentar, levantar,
// tomar café...). Tocar no chão já anda (clique do mundo) e a pinça já dá zoom (world/input.ts). Os botões da barra
// do escritório ficam maiores no toque (humanos.css, `pointer: coarse`).
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvInteractNow, kvInteractTarget } from './interact';
import { kvStick } from './stick';
import { kvPeople } from './world';

/** Raio do joystick (px CSS) e a zona morta / de correr (fração do raio). */
const R = 46;
const DEAD = 0.28;
const RUN = 0.86;

/** Direção (-1/0/1 por eixo) e correr, para um arrasto (dx, dy) em px a partir do centro. Puro (touch.test.ts). */
export function kvStickIntent(dx: number, dy: number, r = R): { dx: number; dy: number; run: boolean } {
  const d = Math.hypot(dx, dy);
  if (d < r * DEAD) return { dx: 0, dy: 0, run: false };
  // 8 direções: setor de 45° em volta do ângulo
  const a = Math.atan2(dy, dx);
  const sector = Math.round(a / (Math.PI / 4));
  const dirs: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const [x, y] = dirs[((sector % 8) + 8) % 8];
  return { dx: x, dy: y, run: d >= r * RUN };
}

export function kvStartTouch(): void {
  let touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const knob = h('div', { class: 'kv-stick__knob' });
  const stick = h('div', { class: 'kv-stick', hidden: true, attrs: { role: 'application', 'aria-label': tr('Joystick: arraste para andar') } }, knob);
  const act = h('button', { class: 'kv-touch-act', type: 'button', hidden: true, attrs: { 'aria-label': tr('Interagir (E)') } });
  const actText = h('span', { class: 'kv-touch-act__label' });
  act.append(h('span', { class: 'kv-touch-act__key', text: 'E' }), actText);
  const ui = document.querySelector('.ui-root') ?? document.body;
  ui.append(stick, act);

  let pid: number | null = null;
  let cx = 0;
  let cy = 0;
  const reset = () => {
    pid = null;
    kvStick.dx = 0;
    kvStick.dy = 0;
    kvStick.run = false;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerdown', (e) => {
    if (pid !== null) return;
    pid = e.pointerId;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    stick.setPointerCapture(e.pointerId);
    move(e);
    e.preventDefault();
  });
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    Object.assign(kvStick, kvStickIntent(dx, dy));
  };
  stick.addEventListener('pointermove', move);
  stick.addEventListener('pointerup', (e) => e.pointerId === pid && reset());
  stick.addEventListener('pointercancel', (e) => e.pointerId === pid && reset());
  act.addEventListener('click', () => kvInteractNow());
  // um toque em qualquer lugar mostra os controles (notebook com tela de toque, sem `pointer: coarse`)
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') touch = true;
  }, { capture: true, passive: true });

  const tick = () => {
    requestAnimationFrame(tick);
    const show = touch && kvPeople.inside && !!kvPeople.ctl?.() && !document.querySelector('dialog[open]');
    if (stick.hidden === show) stick.hidden = !show;
    if (!show && pid !== null) reset();
    const t = show ? kvInteractTarget() : null;
    act.hidden = !show;
    act.disabled = !t;
    const label = t?.label ?? '';
    if (actText.textContent !== label) actText.textContent = label;
  };
  requestAnimationFrame(tick);
}
