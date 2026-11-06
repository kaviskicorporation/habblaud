// Fork Kaviski (KAVISKI-HUMANOS.md, W2): avisos para quem não está olhando a aba — alguém me chamou, falou comigo
// (1:1 ou @menção no chat da área), bateu na porta da sala em que estou ou entrou na minha sala.
//
// - Som curto feito na hora (WebAudio, sem arquivo), notificação do navegador (Notification API; a permissão só é pedida
//   pelo botão "Permitir notificações", nunca ao abrir a página) e o título da aba piscando com o contador, que também
//   aparece no ícone da aba (favicon). Voltar à aba zera tudo.
// - Avisos na própria página (canto da tela) com botões (kvToast).
// - Preferências (sons, notificações) lembradas neste navegador; botão de sino no topo.
// - Não perturbe: sem som e sem notificação (o aviso na página e o contador continuam, quietos).
import type { KvChatMessage, KvDirectMessage, KvPresenceState } from '../../../../shared/kaviski-presence';
import { kvMentions } from '../../../../shared/kaviski-social';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { kvAreaLabel } from './bar';
import { kvChatAudible } from './chat';
import type { KvPresenceClient } from './presence';
import { kvStatusNow, kvSetStatus, kvClearStatus, kvManualStatus } from './status';
import { kvTopButton } from './topbar';
import { kvPeople } from './world';

const PREFS_KEY = 'habblaud.kv.avisos';
const BLINK_MS = 1_100;

export type KvTone = 'ring' | 'ding' | 'knock' | 'enter';

interface Prefs {
  sound: boolean;
  notify: boolean;
}

const prefs: Prefs = { sound: true, notify: true };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>);
} catch {
  // sem preferências
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // sem localStorage
  }
}

const dnd = () => kvStatusNow().status === 'naoperturbe';

// ------------------------------------------------------------------ som

let audio: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (audio) return audio;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    audio = new AC();
  } catch {
    audio = null;
  }
  return audio;
}

/** Uma nota: frequência, início (s, relativo), duração, forma e volume. */
function note(ac: AudioContext, t0: number, freq: number, at: number, dur: number, type: OscillatorType, vol: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0 + at);
  gain.gain.setValueAtTime(0.0001, t0 + at);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0 + at);
  osc.stop(t0 + at + dur + 0.05);
}

/** Toca um aviso (respeita a preferência e o não perturbe). `force` = o botão Testar. */
export function kvPlay(tone: KvTone, force = false): void {
  if (!force && (!prefs.sound || dnd())) return;
  const ac = ctx();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume().catch(() => {});
  const t = ac.currentTime + 0.02;
  if (tone === 'ring') {
    // "trim-trim" duas vezes
    for (const base of [0, 0.9]) {
      for (let i = 0; i < 4; i++) note(ac, t, i % 2 ? 660 : 880, base + i * 0.09, 0.12, 'sine', 0.18);
    }
  } else if (tone === 'ding') {
    note(ac, t, 1046.5, 0, 0.45, 'sine', 0.16);
    note(ac, t, 1568, 0.07, 0.35, 'sine', 0.08);
  } else if (tone === 'knock') {
    // toc-toc-toc
    for (const at of [0, 0.16, 0.32]) note(ac, t, 170, at, 0.09, 'triangle', 0.5);
  } else {
    note(ac, t, 660, 0, 0.25, 'sine', 0.1);
    note(ac, t, 880, 0.12, 0.3, 'sine', 0.1);
  }
}

// O navegador só deixa tocar depois de um gesto: o primeiro clique/tecla destrava o áudio.
for (const ev of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(
    ev,
    () => {
      const ac = ctx();
      if (ac?.state === 'suspended') void ac.resume().catch(() => {});
    },
    { capture: true, passive: true },
  );
}

// ------------------------------------------------------------------ notificação do navegador

export function kvNotifyState(): 'unsupported' | NotificationPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Notificação do navegador (só com a aba escondida, permissão dada, preferência ligada e sem não perturbe). */
export function kvNotify(title: string, body: string, tag: string, onClick?: () => void): void {
  if (!document.hidden || !prefs.notify || dnd() || kvNotifyState() !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/assets/brand/favicon-32.png' });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // alguns navegadores só notificam por service worker: fica o título piscando
  }
}

// ------------------------------------------------------------------ título e ícone da aba

let pending = 0;
let blinkText = '';
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let baseTitle = '';
let blinkOn = false;
let iconLinks: { el: HTMLLinkElement; href: string }[] | null = null;
let iconImg: HTMLImageElement | null = null;

/** Conta mais um aviso e, com a aba escondida, pisca o título (e o contador no ícone). */
export function kvAttention(text: string): void {
  if (!document.hidden) return;
  pending++;
  blinkText = text;
  paintIcon();
  if (blinkTimer) return;
  baseTitle = document.title;
  blinkTimer = setInterval(() => {
    // o título de base pode ter mudado (contador de agentes esperando): acompanha
    if (!blinkOn && document.title !== baseTitle) baseTitle = document.title;
    blinkOn = !blinkOn;
    document.title = blinkOn ? `(${pending}) ${blinkText}` : baseTitle;
  }, BLINK_MS);
}

function stopAttention(): void {
  pending = 0;
  if (blinkTimer) clearInterval(blinkTimer);
  blinkTimer = null;
  if (blinkOn) document.title = baseTitle;
  blinkOn = false;
  for (const l of iconLinks ?? []) l.el.href = l.href;
}

function paintIcon(): void {
  iconLinks ??= [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((el) => ({ el, href: el.href }));
  if (!iconLinks.length) return;
  const draw = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    if (!g) return;
    if (iconImg?.complete && iconImg.naturalWidth) g.drawImage(iconImg, 0, 0, 32, 32);
    g.fillStyle = '#e5484d';
    g.beginPath();
    g.arc(22, 10, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(pending > 9 ? '9+' : String(pending), 22, 11);
    const url = c.toDataURL('image/png');
    for (const l of iconLinks ?? []) l.el.href = url;
  };
  if (!iconImg) {
    iconImg = new Image();
    iconImg.onload = draw;
    iconImg.src = iconLinks[0]!.href;
  }
  draw();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) stopAttention();
});
window.addEventListener('focus', () => stopAttention());

// ------------------------------------------------------------------ avisos na página

export interface KvToastAction {
  label: string;
  primary?: boolean;
  run(): void;
}

let stack: HTMLElement | null = null;
const toasts = new Map<string, { el: HTMLElement; timer: ReturnType<typeof setTimeout> | null }>();

/** Fecha o aviso de id `key` (se ainda está na tela). */
export function kvCloseToast(key: string): void {
  const t = toasts.get(key);
  if (!t) return;
  if (t.timer) clearTimeout(t.timer);
  t.el.remove();
  toasts.delete(key);
}

/** Aviso no canto da tela, com botões; `key` igual troca o anterior. Some em `ms` (0 = só fechando). */
export function kvToast(o: { key: string; icon: string; title: string; text?: string; actions?: KvToastAction[]; ms?: number; tone?: 'info' | 'call' }): void {
  stack ??= (() => {
    const el = h('div', { class: 'kv-toasts', attrs: { 'aria-live': 'assertive' } });
    (document.querySelector('.ui-root') ?? document.body).append(el);
    return el;
  })();
  kvCloseToast(o.key);
  const close = h('button', { class: 'ui-icon-btn ui-icon-btn--sm kv-toast__close', type: 'button', text: '×', title: tr('Fechar'), attrs: { 'aria-label': tr('Fechar') }, on: { click: () => kvCloseToast(o.key) } });
  const el = h(
    'div',
    { class: `kv-toast kv-toast--${o.tone ?? 'info'}`, role: 'alert' },
    h('span', { class: 'kv-toast__icon', text: o.icon, attrs: { 'aria-hidden': 'true' } }),
    h(
      'div',
      { class: 'kv-toast__body' },
      h('strong', { class: 'kv-toast__title', text: o.title }),
      o.text ? h('span', { class: 'kv-toast__text', text: o.text }) : null,
      o.actions?.length
        ? h(
            'div',
            { class: 'kv-toast__actions' },
            ...o.actions.map((a) =>
              h('button', {
                class: `ui-btn ui-btn--sm${a.primary ? ' ui-btn--primary' : ''}`,
                type: 'button',
                text: a.label,
                on: {
                  click: () => {
                    kvCloseToast(o.key);
                    a.run();
                  },
                },
              }),
            ),
          )
        : null,
    ),
    close,
  );
  stack.append(el);
  const ms = o.ms ?? 12_000;
  toasts.set(o.key, { el, timer: ms ? setTimeout(() => kvCloseToast(o.key), ms) : null });
}

// ------------------------------------------------------------------ o que avisa

/** A "minha sala": a da minha mesa fixa, a minha sala própria ou, sem elas, a sala em que estou. */
function homeRoom(): string | null {
  const k = kvPeople as { myRoom?: () => string | null };
  const desk = kvPeople.myDesk?.roomId;
  if (desk) return desk;
  const own = typeof k.myRoom === 'function' ? k.myRoom() : null;
  if (own) return own;
  return kvPeople.area?.startsWith('r:') ? kvPeople.area.slice(2) : null;
}

/** Liga os avisos: 1:1, @menção, alguém entrando na minha sala; o resto (chamar, bater na porta) liga em ring.ts e locks.ts. */
export function kvStartAlerts(client: KvPresenceClient, store: OfficeStore, user?: string): void {
  const meId = () => client.state?.me ?? '';
  const openDirect = (id: string) => kvPeople.openDirect?.(id);

  client.onEvent<KvDirectMessage>('dm', (m) => {
    if (!m?.from || m.from.id === meId()) return;
    kvPlay('ding');
    kvAttention(tr('💬 {0}', [m.from.name]));
    kvNotify(m.urgent ? tr('Urgente: {0}', [m.from.name]) : tr('Mensagem de {0}', [m.from.name]), m.text ?? '', `dm:${m.from.id}`, () => openDirect(m.from.id));
  });

  client.onEvent<KvChatMessage>('chat', (m) => {
    const me = client.me();
    if (!me || !m.text || m.from.id === me.id) return;
    const mine = kvPeople.locate?.(null);
    const them = kvPeople.locate?.(m.from.id);
    if (!kvChatAudible(m, me.id, mine && them ? Math.hypot(mine.x - them.x, mine.y - them.y) : null)) return;
    if (!kvMentions(m.text, [me.name.split(/\s+/)[0] ?? '', me.name.replace(/\s+/g, ''), user ?? ''])) return;
    kvPlay('ding');
    kvAttention(tr('@ {0} falou com você', [m.from.name]));
    kvNotify(tr('{0} falou com você', [m.from.name]), m.text, `mention:${m.id}`);
    if (!document.hidden) kvToast({ key: `mention:${m.from.id}`, icon: '💬', title: tr('{0} falou com você', [m.from.name]), text: m.text, ms: 8_000 });
  });

  // alguém entrou na minha sala (veja homeRoom)
  const roomOf = new Map<string, string | null>();
  let primed = false;
  client.on((s: KvPresenceState) => {
    const home = homeRoom();
    const next = new Map<string, string | null>();
    for (const p of s.people) {
      if (p.id === s.me) continue;
      const room = p.pos?.k === 'r' ? (p.pos.r ?? null) : null;
      next.set(p.id, room);
      const before = roomOf.get(p.id);
      if (!primed || !home || room !== home || before === undefined || before === home) continue;
      const iAmThere = kvPeople.area === `r:${home}`;
      if (iAmThere && !document.hidden) continue; // estou vendo
      const where = kvAreaLabel(`r:${home}`, store);
      kvPlay('enter');
      kvAttention(tr('🚪 {0} entrou', [p.name]));
      kvNotify(tr('{0} entrou na sala {1}', [p.name, where]), '', `enter:${p.id}`);
      if (!document.hidden) kvToast({ key: `enter:${p.id}`, icon: '🚪', title: tr('{0} entrou na sala {1}', [p.name, where]), ms: 6_000 });
    }
    roomOf.clear();
    for (const [k, v] of next) roomOf.set(k, v);
    primed = true;
  });

  new KvAlertsMenu();
}

const BELL_ICON = pixelIcon(['....##....', '...####...', '..######..', '..######..', '..######..', '.########.', '##########', '..........', '....##....']);

/** O sino do topo: sons, notificações do navegador (com o botão que pede permissão) e não perturbe. */
class KvAlertsMenu {
  private readonly pop: HTMLElement;
  private readonly btn: HTMLButtonElement | null;
  private readonly sound: HTMLInputElement;
  private readonly notify: HTMLInputElement;
  private readonly allow: HTMLButtonElement;
  private readonly state: HTMLElement;
  private readonly dndBtn: HTMLButtonElement;

  constructor() {
    this.sound = h('input', { type: 'checkbox', on: { change: () => ((prefs.sound = this.sound.checked), savePrefs()) } });
    this.notify = h('input', { type: 'checkbox', on: { change: () => ((prefs.notify = this.notify.checked), savePrefs(), this.paint()) } });
    this.allow = h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('Permitir notificações'), on: { click: () => void this.ask() } });
    this.state = h('p', { class: 'kv-alerts__state' });
    this.dndBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', on: { click: () => this.toggleDnd() } });
    const test = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Testar o som'), on: { click: () => kvPlay('ring', true) } });
    this.pop = h(
      'div',
      { class: 'kv-alerts', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Avisos') } },
      h('strong', { class: 'kv-alerts__title', text: tr('Avisos') }),
      h('p', { class: 'kv-alerts__hint', text: tr('Quando alguém te chama, fala com você, bate na porta ou entra na sua sala.') }),
      h('label', { class: 'kv-alerts__row' }, this.sound, h('span', { text: tr('Sons') })),
      h('label', { class: 'kv-alerts__row' }, this.notify, h('span', { text: tr('Notificações do navegador (com a aba escondida)') })),
      h('div', { class: 'kv-alerts__row' }, this.allow, test),
      this.state,
      this.dndBtn,
    );
    (document.querySelector('.ui-root') ?? document.body).append(this.pop);
    this.btn = kvTopButton(BELL_ICON, tr('Avisos: sons e notificações'), () => this.toggle(), 'kv-btn-alerts', 60);
    this.btn?.setAttribute('aria-haspopup', 'dialog');
    document.addEventListener('pointerdown', (e) => {
      if (!this.pop.hidden && !this.pop.contains(e.target as Node) && !this.btn?.contains(e.target as Node)) this.toggle(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.pop.hidden) this.toggle(false);
    });
    setInterval(() => this.paintBtn(), 1000);
    this.paintBtn();
  }

  private toggle(open = this.pop.hidden): void {
    this.pop.hidden = !open;
    if (!open || !this.btn) return;
    const r = this.btn.getBoundingClientRect();
    this.pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 300)))}px`;
    this.pop.style.top = `${Math.round(r.bottom + 8)}px`;
    this.paint();
  }

  private paint(): void {
    this.sound.checked = prefs.sound;
    this.notify.checked = prefs.notify;
    const st = kvNotifyState();
    this.allow.hidden = st !== 'default';
    this.state.textContent =
      st === 'unsupported'
        ? tr('Este navegador não mostra notificações.')
        : st === 'denied'
          ? tr('As notificações estão bloqueadas no navegador (libere no cadeado da barra de endereço).')
          : st === 'granted'
            ? tr('Notificações liberadas.')
            : tr('As notificações ainda não foram liberadas.');
    this.dndBtn.textContent = dnd() ? tr('Sair do não perturbe') : tr('🔕 Não perturbe');
    this.dndBtn.classList.toggle('is-on', dnd());
  }

  private paintBtn(): void {
    this.btn?.classList.toggle('is-dnd', dnd());
    if (!this.pop.hidden) this.paint();
  }

  private async ask(): Promise<void> {
    if (kvNotifyState() !== 'default') return this.paint();
    try {
      await Notification.requestPermission();
    } catch {
      // navegador antigo
    }
    this.paint();
  }

  private toggleDnd(): void {
    if (dnd()) {
      const m = kvManualStatus();
      if (m?.status === 'naoperturbe') kvSetStatus({ status: 'disponivel' });
      else kvClearStatus('manual');
    } else kvSetStatus({ status: 'naoperturbe' });
    this.paint();
  }
}
