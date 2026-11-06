// Fork Kaviski (KAVISKI-HUMANOS.md): modo foco (pomodoro). Botão do topo (fones) → 25 ou 50 min: o status vira
// "🎧 Focado até 15h" (fonte foco; o manual vence), o botão mostra os minutos que faltam e, no fim, um som suave e um
// balão. Lembrado no navegador (recarregar a página não perde o foco).
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { kvHour } from './agenda';
import { kvAutoClear, kvAutoSet } from './auto-status';
import { kvTopButton } from './topbar';
import { kvPeople } from './world';

const KEY = 'habblaud.kv.foco';
const SOUND_KEY = 'habblaud.kv.foco.som';
const FOCUS_ICON = pixelIcon(['..####..', '.#....#.', '#......#', '#......#', '##....##', '###..###', '###..###', '.#....#.']);

interface Saved {
  until: number;
  minutes: number;
}

function load(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    return v && typeof v.until === 'number' && v.until > Date.now() ? v : null;
  } catch {
    return null;
  }
}

function store(v: Saved | null): void {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    // sem localStorage
  }
}

/** Duas notas suaves (Web Audio, sem arquivo de som). */
export function kvChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    for (const [i, freq] of [660, 880, 990].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const t = t0 + i * 0.28;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 1);
    }
    setTimeout(() => void ctx.close(), 2000);
  } catch {
    // sem áudio
  }
}

export function kvStartFocus(root?: ParentNode): void {
  let cur = load();
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  const btn = kvTopButton(FOCUS_ICON, tr('Modo foco (pomodoro)'), () => toggle(), 'kv-btn-focus', 30, root);
  if (!btn) return;
  btn.setAttribute('aria-haspopup', 'dialog');
  const left = h('span', { class: 'kv-focus__left', hidden: true });
  btn.append(left);
  const sound = h('input', { type: 'checkbox' });
  try {
    sound.checked = localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    sound.checked = true;
  }
  sound.addEventListener('change', () => {
    try {
      localStorage.setItem(SOUND_KEY, sound.checked ? '1' : '0');
    } catch {
      // sem localStorage
    }
  });
  const info = h('p', { class: 'kv-focus__info' });
  const stopBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Parar o foco'), on: { click: () => stop(false) } });
  const startBtn = (min: number) => h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('{0} min', [min]), on: { click: () => begin(min) } });
  const choices = h('div', { class: 'kv-focus__choices' }, startBtn(25), startBtn(50));
  const pop = h(
    'div',
    { class: 'kv-focus', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Modo foco') } },
    h('strong', { text: tr('Modo foco') }),
    h('p', { class: 'kv-people__hint', text: tr('Os outros veem “🎧 Focado” no seu status até o fim. No fim, um som suave.') }),
    info,
    choices,
    stopBtn,
    h('label', { class: 'kv-people__check' }, sound, h('span', { text: tr('Som no fim') })),
  );
  (document.querySelector('.ui-root') ?? document.body).append(pop);
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) pop.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) pop.hidden = true;
  });

  function toggle(): void {
    pop.hidden = !pop.hidden;
    if (pop.hidden) return;
    const r = btn!.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left - 80, window.innerWidth - 260))}px`;
    pop.style.top = `${r.bottom + 8}px`;
    paint();
  }

  function paint(): void {
    const on = !!cur && cur.until > Date.now();
    btn!.classList.toggle('is-on', on);
    left.hidden = !on;
    if (on) {
      const min = Math.max(1, Math.ceil((cur!.until - Date.now()) / 60_000));
      left.textContent = String(min);
      btn!.title = tr('Modo foco: faltam {0} min', [min]);
      info.textContent = tr('Focado até {0} (faltam {1} min).', [kvHour(cur!.until), min]);
    } else {
      btn!.title = tr('Modo foco (pomodoro)');
      info.textContent = tr('Quanto tempo?');
    }
    choices.hidden = on;
    stopBtn.hidden = !on;
  }

  function arm(): void {
    if (endTimer) clearTimeout(endTimer);
    endTimer = null;
    if (!cur) return;
    kvAutoSet('foco', { status: 'ocupado', note: `🎧 ${tr('Focado até {0}', [kvHour(cur.until)])}`, until: cur.until });
    endTimer = setTimeout(() => stop(true), Math.max(0, cur.until - Date.now()));
  }

  function begin(minutes: number): void {
    cur = { until: Date.now() + minutes * 60_000, minutes };
    store(cur);
    arm();
    paint();
    pop.hidden = true;
  }

  function stop(finished: boolean): void {
    if (endTimer) clearTimeout(endTimer);
    endTimer = null;
    const was = cur;
    cur = null;
    store(null);
    kvAutoClear('foco');
    paint();
    if (finished && was) {
      // com duas abas abertas, só uma toca e avisa
      let first = true;
      try {
        first = localStorage.getItem(`${KEY}.fim`) !== String(was.until);
        localStorage.setItem(`${KEY}.fim`, String(was.until));
      } catch {
        // sem localStorage
      }
      if (!first) return;
      if (sound.checked) kvChime();
      kvPeople.say?.(null, '🎧', tr('Fim do foco! Hora de uma pausa.'), 6_000);
      const box = h('div', { class: 'kv-toast', role: 'status' }, h('span', { class: 'kv-toast__icon', text: '🎧' }), h('span', { class: 'kv-toast__text', text: tr('Fim dos {0} min de foco. Hora de uma pausa!', [was.minutes]) }));
      const again = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Mais {0} min', [was.minutes]), on: { click: () => (box.remove(), begin(was.minutes)) } });
      const ok = h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('Ok'), on: { click: () => box.remove() } });
      box.append(again, ok);
      (document.querySelector('.ui-root') ?? document.body).append(box);
      setTimeout(() => box.remove(), 60_000);
    }
  }

  // outra aba começou/parou o foco
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    cur = load();
    if (cur) arm();
    else {
      if (endTimer) clearTimeout(endTimer);
      kvAutoClear('foco');
    }
    paint();
  });
  setInterval(paint, 20_000);
  if (cur) arm();
  paint();
}
