// Fork Kaviski (KAVISKI-HUMANOS.md, W2 → "Avisos"): avisos para quem não está olhando o Voxtrin — alguém me chamou,
// falou comigo (1:1 ou @menção), me cumprimentou, me puxou para uma conversa privada, bateu na porta da sala em que
// estou, entrou na minha sala, me convidou para uma reunião (ou ela vai começar) ou compartilhou uma pasta comigo.
//
// - Cada aviso (`kvAlert`) = som curto feito na hora (WebAudio, sem arquivo) + notificação do SISTEMA (alerts-system.ts:
//   por service worker vai para a Central de Notificações do Windows e aceita botões) + aviso na página (kvToast) com a
//   ação útil + título da aba piscando com o contador, que também aparece no ícone da aba (favicon) e no ícone do app
//   (Badging API). Voltar ao Voxtrin zera o contador.
// - A notificação do sistema sai quando o Voxtrin não está na frente: aba escondida OU janela sem foco (outra janela por
//   cima). Opção "também com o Voxtrin na frente". Liga/desliga por tipo de aviso no sino.
// - Permissão: nunca pedida sozinha. Depois do primeiro clique, um aviso na página pergunta "Ativar as notificações?"
//   (Ativar / Agora não, lembrado neste navegador); o sino também tem o botão.
// - Não perturbe: sem som e sem notificação do sistema (o aviso na página e o contador continuam, quietos).
// API estável: `kvNotify(title, body, tag, onClick?, opts?)` (como antes, opções novas no 5º parâmetro) e `kvAlert(...)`.
import type { KvChatMessage, KvDirectMessage, KvPresenceState } from '../../../../shared/kaviski-presence';
import type { KvMeetingsState } from '../../../../shared/kaviski-meetings';
import type { KvFilesState } from '../../../../shared/kaviski-files';
import { kvMentions } from '../../../../shared/kaviski-social';
import { greetingIcon, greetingLabel } from '../../../../shared/world/social-labels';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { kvAppBadge, kvAskPermission, kvCloseSystem, kvIsWindows, kvRegisterNotifyWorker, kvShowSystem, kvSystemSupport, type KvSystemAction } from './alerts-system';
import { kvAreaLabel } from './bar';
import { kvChatAudible } from './chat';
import { kvFilesLoaded, kvOnFiles, kvReloadFiles } from './files/files-api';
import { kvOnMeetings, kvMeetLabel, kvMeetRoom, kvDayStart } from './meetings-api';
import type { KvPresenceClient } from './presence';
import { kvStatusNow, kvSetStatus, kvClearStatus, kvManualStatus } from './status';
import { kvTopButton } from './topbar';
import { kvPeople } from './world';

const PREFS_KEY = 'habblaud.kv.avisos';
/** "Ativar as notificações?": 'sim' | 'nao' depois que a pessoa respondeu. */
const ASKED_KEY = 'habblaud.kv.avisos.pedido';
const BLINK_MS = 1_100;
const DAY = 86_400_000;

export type KvTone = 'ring' | 'ding' | 'knock' | 'enter';

/** Os tipos de aviso (liga/desliga no sino). */
export type KvAlertKind = 'mensagens' | 'chamadas' | 'cumprimentos' | 'porta' | 'entradas' | 'reunioes' | 'arquivos';

const KINDS: { id: KvAlertKind; label: () => string }[] = [
  { id: 'mensagens', label: () => tr('Mensagens e @menções') },
  { id: 'chamadas', label: () => tr('Chamadas e convites para conversa privada') },
  { id: 'cumprimentos', label: () => tr('Cumprimentos') },
  { id: 'porta', label: () => tr('Batidas na porta') },
  { id: 'entradas', label: () => tr('Alguém entrando na minha sala') },
  { id: 'reunioes', label: () => tr('Reuniões (convite e começo)') },
  { id: 'arquivos', label: () => tr('Pastas compartilhadas comigo') },
];

interface Prefs {
  sound: boolean;
  notify: boolean;
  /** Notificação do sistema também com o Voxtrin na frente. */
  always: boolean;
  kinds: Partial<Record<KvAlertKind, boolean>>;
}

const prefs: Prefs = { sound: true, notify: true, always: false, kinds: {} };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>);
  if (!prefs.kinds || typeof prefs.kinds !== 'object') prefs.kinds = {};
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
const kindOn = (k: KvAlertKind | undefined) => !k || prefs.kinds[k] !== false;

/** O Voxtrin não está na frente: aba escondida ou janela sem foco. */
export function kvAway(): boolean {
  return document.hidden || !document.hasFocus();
}

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

/** Toca um aviso (respeita a preferência e o não perturbe). `force` = o botão Testar. Devolve se tocou. */
export function kvPlay(tone: KvTone, force = false): boolean {
  if (!force && (!prefs.sound || dnd())) return false;
  const ac = ctx();
  if (!ac) return false;
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
  return ac.state === 'running';
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

// ------------------------------------------------------------------ notificação do sistema

export function kvNotifyState(): 'unsupported' | NotificationPermission {
  return kvSystemSupport() === 'ok' ? Notification.permission : 'unsupported';
}

export interface KvNotifyOpts {
  /** Tipo do aviso (o sino liga/desliga por tipo). */
  kind?: KvAlertKind;
  /** Fica na tela até a pessoa agir. */
  sticky?: boolean;
  /** Botões na notificação (onde o navegador aceitar). */
  actions?: KvSystemAction[];
  /** Sem o som do sistema (a página já tocou o dela). */
  silent?: boolean;
  /** Ignora "na frente", tipo e não perturbe (botão Testar). */
  force?: boolean;
}

/**
 * Notificação do sistema: com o Voxtrin fora da frente (ou sempre, se a pessoa pediu), permissão dada, preferência e
 * tipo ligados e sem não perturbe. Devolve se mostrou.
 */
export function kvNotify(title: string, body: string, tag: string, onClick?: () => void, opts: KvNotifyOpts = {}): boolean {
  if (!opts.force && (!prefs.notify || dnd() || !kindOn(opts.kind) || (!prefs.always && !kvAway()))) return false;
  if (kvNotifyState() !== 'granted') return false;
  return kvShowSystem({ key: tag, title, body, onClick, actions: opts.actions, sticky: opts.sticky, silent: opts.silent });
}

// ------------------------------------------------------------------ título e ícone da aba

let pending = 0;
let blinkText = '';
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let baseTitle = '';
let blinkOn = false;
let iconLinks: { el: HTMLLinkElement; href: string }[] | null = null;
let iconImg: HTMLImageElement | null = null;

/** Conta mais um aviso e, com o Voxtrin fora da frente, pisca o título (e o contador nos ícones). */
export function kvAttention(text: string): void {
  if (!kvAway()) return;
  pending++;
  blinkText = text;
  paintIcon();
  kvAppBadge(pending);
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
  if (pending) kvAppBadge(0);
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
  if (!document.hidden && document.hasFocus()) stopAttention();
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

/** Fecha o aviso de id `key` (se ainda está na tela) e a notificação do sistema de mesma chave. */
export function kvCloseToast(key: string): void {
  kvCloseSystem(key);
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
  const old = toasts.get(o.key);
  if (old) {
    if (old.timer) clearTimeout(old.timer);
    old.el.remove();
    toasts.delete(o.key);
  }
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

// ------------------------------------------------------------------ um aviso completo

export interface KvAlertAction {
  /** Id do botão na notificação do sistema. */
  id: string;
  label: string;
  primary?: boolean;
  run(): void;
}

export interface KvAlert {
  kind: KvAlertKind;
  /** Chave do aviso na página E da notificação do sistema (a mesma chave troca a anterior). */
  key: string;
  /** Emoji do aviso na página. */
  icon: string;
  title: string;
  body?: string;
  tone?: KvTone;
  /** Texto do título piscando na aba (padrão: o título). */
  attention?: string;
  /** Chamada/porta/urgente: notificação fica até agir, aviso com destaque. */
  urgent?: boolean;
  actions?: KvAlertAction[];
  /** Clique no corpo da notificação (padrão: a primeira ação "primary", senão só traz o Voxtrin para a frente). */
  onClick?: () => void;
  /** Aviso na página: false = não mostra (quem chama já mostra o dele); ms 0 = até fechar. */
  toast?: false | { ms?: number };
  /** Precisa de resposta (porta, chamada): o aviso na página aparece mesmo com o tipo desligado. */
  needsAnswer?: boolean;
}

/** Som + notificação do sistema + aviso na página + contador, respeitando tipo, preferências e não perturbe. */
export function kvAlert(a: KvAlert): void {
  const on = kindOn(a.kind);
  if (on) {
    const played = a.tone ? kvPlay(a.tone) : false;
    kvAttention(a.attention ?? a.title);
    const actions = (a.actions ?? []).map((x) => ({ id: x.id, label: x.label, run: () => (kvCloseToast(a.key), x.run()) }));
    const primary = a.actions?.find((x) => x.primary);
    const click = a.onClick ?? (primary ? () => (kvCloseToast(a.key), primary.run()) : undefined);
    kvNotify(a.title, a.body ?? '', a.key, click, { kind: a.kind, actions, sticky: a.urgent, silent: played });
  }
  if (a.toast === false || (!on && !a.needsAnswer)) return;
  kvToast({
    key: a.key,
    icon: a.icon,
    title: a.title,
    text: a.body,
    tone: a.urgent ? 'call' : 'info',
    ms: a.toast?.ms ?? (a.urgent ? 60_000 : 10_000),
    actions: a.actions?.map((x) => ({ label: x.label, primary: x.primary, run: x.run })),
  });
}

// ------------------------------------------------------------------ pedir a permissão, com jeito

function asked(): string | null {
  try {
    return localStorage.getItem(ASKED_KEY);
  } catch {
    return 'nao';
  }
}

function setAsked(v: 'sim' | 'nao'): void {
  try {
    localStorage.setItem(ASKED_KEY, v);
  } catch {
    // sem localStorage
  }
}

/** Depois do primeiro clique/tecla na página: um aviso pergunta se quer ativar (nunca o pedido do navegador sozinho). */
function offerPermission(onChange: () => void): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.removeEventListener('pointerdown', go, true);
    window.removeEventListener('keydown', go, true);
    setTimeout(() => {
      if (!prefs.notify || kvNotifyState() !== 'default' || asked()) return;
      kvToast({
        key: 'kv-ask-notify',
        icon: '🔔',
        title: kvIsWindows() ? tr('Ativar as notificações do Windows?') : tr('Ativar as notificações do navegador?'),
        text: tr('Assim você fica sabendo quando alguém te chama, manda mensagem, cumprimenta ou bate na porta, mesmo com o Voxtrin minimizado.'),
        ms: 0,
        actions: [
          {
            label: tr('Ativar'),
            primary: true,
            run: () =>
              void kvAskPermission().then((st) => {
                setAsked('sim');
                onChange();
                if (st === 'granted') kvShowSystem({ key: 'kv-test', title: tr('Notificações ativadas'), body: tr('É assim que os avisos do Voxtrin vão aparecer.') });
              }),
          },
          { label: tr('Agora não'), run: () => setAsked('nao') },
        ],
      });
    }, 1_500);
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
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

/** Ir até a pessoa: o meu avatar anda até ela; sem ele no escritório (ou ela sem lugar aqui), só leva a câmera. */
export function kvGoToPerson(id: string): void {
  if (!kvPeople.goTo?.(id)) kvPeople.follow?.(id);
}

function when(t: number): string {
  return new Date(t).toLocaleString([], { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Liga os avisos: 1:1, @menção, cumprimento, conversa privada, alguém entrando na minha sala, convite de reunião e
 * pasta compartilhada; chamar e bater na porta ligam em ring.ts e locks.ts, o começo da reunião em meetings.ts.
 */
export function kvStartAlerts(client: KvPresenceClient, store: OfficeStore, user?: string): void {
  const meId = () => client.state?.me ?? '';
  const openDirect = (id: string) => kvPeople.openDirect?.(id);
  kvRegisterNotifyWorker();

  client.onEvent<KvDirectMessage>('dm', (m) => {
    if (!m?.from || m.from.id === meId()) return;
    kvAlert({
      kind: 'mensagens',
      key: `dm:${m.from.id}`,
      icon: '💬',
      title: m.urgent ? tr('Urgente: {0}', [m.from.name]) : tr('Mensagem de {0}', [m.from.name]),
      body: m.text ?? '',
      tone: 'ding',
      attention: tr('💬 {0}', [m.from.name]),
      urgent: !!m.urgent,
      actions: [{ id: 'responder', label: tr('Responder'), primary: true, run: () => openDirect(m.from.id) }],
      toast: false, // o chat (chat.ts) já mostra o aviso da mensagem
    });
  });

  client.onEvent<KvChatMessage>('chat', (m) => {
    const me = client.me();
    if (!me || !m?.from || m.from.id === me.id) return;
    // cumprimento para mim (roda de cumprimentos / tecla G)
    if (m.greet && m.to?.id === me.id) {
      const label = `${greetingIcon(m.greet)} ${greetingLabel(m.greet)}`;
      kvAlert({
        kind: 'cumprimentos',
        key: `greet:${m.from.id}`,
        icon: greetingIcon(m.greet),
        title: tr('{0} te cumprimentou', [m.from.name]),
        body: label,
        tone: 'enter',
        attention: tr('👋 {0}', [m.from.name]),
        toast: { ms: 8_000 },
        actions: [
          { id: 'cumprimentar', label: tr('Cumprimentar de volta'), primary: true, run: () => void client.say({ greet: m.greet!, to: m.from.id }) },
          { id: 'ir', label: tr('Ir até'), run: () => kvGoToPerson(m.from.id) },
        ],
      });
      return;
    }
    if (!m.text) return;
    const mine = kvPeople.locate?.(null);
    const them = kvPeople.locate?.(m.from.id);
    if (!kvChatAudible(m, me.id, mine && them ? Math.hypot(mine.x - them.x, mine.y - them.y) : null)) return;
    if (!kvMentions(m.text, [me.name.split(/\s+/)[0] ?? '', me.name.replace(/\s+/g, ''), user ?? ''])) return;
    kvAlert({
      kind: 'mensagens',
      key: `mention:${m.from.id}`,
      icon: '💬',
      title: tr('{0} falou com você', [m.from.name]),
      body: m.text,
      tone: 'ding',
      attention: tr('@ {0} falou com você', [m.from.name]),
      toast: { ms: 8_000 },
      actions: [
        { id: 'responder', label: tr('Responder'), primary: true, run: () => openDirect(m.from.id) },
        { id: 'ir', label: tr('Ir até'), run: () => kvGoToPerson(m.from.id) },
      ],
    });
  });

  // alguém me puxou para uma conversa privada (bubble.ts já escreve na barra; aqui, som e notificação)
  client.onEvent<{ id: string; by: string; joined: string[] }>('bubble', (e) => {
    const me = client.me();
    if (!me || !e?.joined?.includes(me.id) || e.by === me.name) return;
    kvAlert({
      kind: 'chamadas',
      key: `bubble:${e.id}`,
      icon: '🤫',
      title: tr('{0} abriu uma conversa privada com você.', [e.by]),
      tone: 'enter',
      toast: false,
    });
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
      if (iAmThere && !kvAway()) continue; // estou vendo
      const where = kvAreaLabel(`r:${home}`, store);
      kvAlert({
        kind: 'entradas',
        key: `enter:${p.id}`,
        icon: '🚪',
        title: tr('{0} entrou na sala {1}', [p.name, where]),
        tone: 'enter',
        attention: tr('🚪 {0} entrou', [p.name]),
        toast: { ms: 6_000 },
        actions: [{ id: 'ir', label: tr('Ir até'), run: () => kvGoToPerson(p.id) }],
      });
    }
    roomOf.clear();
    for (const [k, v] of next) roomOf.set(k, v);
    primed = true;
  });

  // convite de reunião: uma reunião minha nova, marcada por outra pessoa
  let meetSeen: Set<string> | null = null;
  kvOnMeetings((s: KvMeetingsState) => {
    const now = Date.now();
    const first = !meetSeen;
    const seen = (meetSeen ??= new Set());
    for (const m of s.meetings) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      // a janela do armazém anda com os dias: o que só "apareceu" no fim dela não é convite novo
      if (first || !m.mine || m.released || m.end <= now || !m.by || m.by.id === meId() || m.start >= kvDayStart(now) + 14 * DAY) continue;
      const room = kvMeetRoom(m.room)?.name;
      kvAlert({
        kind: 'reunioes',
        key: `meet-invite:${m.series ?? m.id}`,
        icon: '📅',
        title: tr('{0} te convidou para uma reunião', [m.by.name]),
        body: [kvMeetLabel(m), when(m.start), room].filter(Boolean).join(' · '),
        tone: 'ding',
        attention: tr('📅 Convite de {0}', [m.by.name]),
        actions: [{ id: 'ver', label: tr('Ver a reunião'), primary: true, run: () => void import('./meetings-dialog').then((d) => d.kvOpenMeetings({ tab: 'minhas' })) }],
      });
    }
  });

  // pasta compartilhada comigo (acesso "pessoas escolhidas", criada ou mudada por outra pessoa)
  let folderSeen: Set<string> | null = null;
  kvOnFiles((s: KvFilesState) => {
    const first = !folderSeen;
    const seen = (folderSeen ??= new Set());
    for (const f of s.folders) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      if (first || f.access !== 'pessoas' || f.by.id === meId() || !f.people.includes(meId())) continue;
      kvAlert({
        kind: 'arquivos',
        key: `folder:${f.id}`,
        icon: '📁',
        title: tr('{0} compartilhou a pasta {1} com você', [f.by.name, f.name]),
        tone: 'ding',
        actions: [{ id: 'abrir', label: tr('Abrir a pasta'), primary: true, run: () => void import('./files/files-dialog').then((d) => d.kvOpenFiles({ folder: f.id })) }],
      });
    }
  });
  // a primeira leitura só "decora" as pastas que eu já via (o fluxo `files` relê depois)
  if (!kvFilesLoaded() && client.me()?.role !== 'visitante') void kvReloadFiles();

  const menu = new KvAlertsMenu();
  offerPermission(() => menu.refresh());
}

const BELL_ICON = pixelIcon(['....##....', '...####...', '..######..', '..######..', '..######..', '.########.', '##########', '..........', '....##....']);

/** O sino do topo: sons, notificações do sistema (permissão, testar, por tipo) e não perturbe. */
class KvAlertsMenu {
  private readonly pop: HTMLElement;
  private readonly btn: HTMLButtonElement | null;
  private readonly sound: HTMLInputElement;
  private readonly notify: HTMLInputElement;
  private readonly always: HTMLInputElement;
  private readonly kinds = new Map<KvAlertKind, HTMLInputElement>();
  private readonly allow: HTMLButtonElement;
  private readonly state: HTMLElement;
  private readonly help: HTMLElement;
  private readonly dndBtn: HTMLButtonElement;

  constructor() {
    this.sound = h('input', { type: 'checkbox', on: { change: () => ((prefs.sound = this.sound.checked), savePrefs()) } });
    this.notify = h('input', { type: 'checkbox', on: { change: () => ((prefs.notify = this.notify.checked), savePrefs(), this.paint()) } });
    this.always = h('input', { type: 'checkbox', on: { change: () => ((prefs.always = this.always.checked), savePrefs()) } });
    this.allow = h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('Permitir notificações'), on: { click: () => void this.ask() } });
    this.state = h('p', { class: 'kv-alerts__state' });
    this.help = h('p', { class: 'kv-alerts__hint kv-alerts__help' });
    this.dndBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', on: { click: () => this.toggleDnd() } });
    const testSound = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Testar o som'), on: { click: () => kvPlay('ring', true) } });
    const testNotify = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Testar notificação'), on: { click: () => void this.test() } });
    const kinds = h('div', { class: 'kv-alerts__kinds', role: 'group', attrs: { 'aria-label': tr('Avisar sobre') } });
    for (const k of KINDS) {
      const box = h('input', { type: 'checkbox', on: { change: () => ((prefs.kinds[k.id] = box.checked), savePrefs()) } });
      this.kinds.set(k.id, box);
      kinds.append(h('label', { class: 'kv-alerts__row' }, box, h('span', { text: k.label() })));
    }
    this.pop = h(
      'div',
      { class: 'kv-alerts', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Avisos') } },
      h('strong', { class: 'kv-alerts__title', text: tr('Avisos') }),
      h('p', { class: 'kv-alerts__hint', text: tr('Quando alguém te chama, fala com você, cumprimenta, bate na porta ou entra na sua sala.') }),
      h('label', { class: 'kv-alerts__row' }, this.sound, h('span', { text: tr('Sons') })),
      h('label', { class: 'kv-alerts__row' }, this.notify, h('span', { text: kvIsWindows() ? tr('Notificações do Windows') : tr('Notificações do sistema (navegador)') })),
      h('label', { class: 'kv-alerts__row' }, this.always, h('span', { text: tr('Notificar também com o Voxtrin aberto na frente') })),
      h('strong', { class: 'kv-alerts__sub', text: tr('Avisar sobre') }),
      kinds,
      h('div', { class: 'kv-alerts__row kv-alerts__btns' }, this.allow, testNotify, testSound),
      this.state,
      this.help,
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

  /** Repinta (a permissão mudou por fora: o aviso "Ativar as notificações?"). */
  refresh(): void {
    if (!this.pop.hidden) this.paint();
  }

  private toggle(open = this.pop.hidden): void {
    this.pop.hidden = !open;
    if (!open || !this.btn) return;
    this.paint();
    this.place();
  }

  /** Mede o menu já pintado: nunca sai da tela (nem pela direita nem por baixo). */
  private place(): void {
    if (!this.btn || this.pop.hidden) return;
    const r = this.btn.getBoundingClientRect();
    const w = this.pop.offsetWidth;
    const hgt = this.pop.offsetHeight;
    this.pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px`;
    this.pop.style.top = `${Math.round(Math.max(8, Math.min(r.bottom + 8, window.innerHeight - hgt - 8)))}px`;
  }

  private paint(): void {
    this.sound.checked = prefs.sound;
    this.notify.checked = prefs.notify;
    this.always.checked = prefs.always;
    this.always.disabled = !prefs.notify;
    for (const [k, box] of this.kinds) box.checked = kindOn(k);
    const sup = kvSystemSupport();
    const st = kvNotifyState();
    this.allow.hidden = st !== 'default';
    this.state.textContent =
      sup === 'insecure'
        ? tr('Notificações do sistema só funcionam no endereço com https (ou no próprio computador).')
        : st === 'unsupported'
          ? tr('Este navegador não mostra notificações.')
          : st === 'denied'
            ? tr('As notificações estão bloqueadas no navegador.')
            : st === 'granted'
              ? tr('Notificações liberadas.')
              : tr('As notificações ainda não foram liberadas.');
    const win = kvIsWindows() ? tr('No Windows: Configurações > Sistema > Notificações > ligue o seu navegador (e confira se o "Não incomodar" do Windows está desligado).') : '';
    this.help.textContent =
      st === 'denied'
        ? [tr('Para liberar: clique no cadeado da barra de endereço > Notificações > Permitir e recarregue a página.'), win].filter(Boolean).join(' ')
        : st === 'granted' && win
          ? tr('Não aparecem? {0}', [win])
          : '';
    this.help.hidden = !this.help.textContent;
    this.dndBtn.textContent = dnd() ? tr('Sair do não perturbe') : tr('🔕 Não perturbe');
    this.dndBtn.classList.toggle('is-on', dnd());
  }

  private paintBtn(): void {
    this.btn?.classList.toggle('is-dnd', dnd());
    if (!this.pop.hidden) this.paint();
  }

  private async ask(): Promise<void> {
    if (kvNotifyState() === 'default') {
      await kvAskPermission();
      setAsked('sim');
    }
    this.paint();
    this.place();
  }

  /** Uma notificação real do sistema (pede a permissão antes, se ainda não pediu). */
  private async test(): Promise<void> {
    if (kvNotifyState() === 'default') await this.ask();
    const shown =
      kvNotifyState() === 'granted' &&
      kvNotify(tr('Teste do Voxtrin'), tr('É assim que os avisos aparecem quando o Voxtrin não está na frente.'), 'kv-test', undefined, {
        force: true,
        actions: [{ id: 'ok', label: tr('Ok'), run: () => {} }],
      });
    if (!shown) {
      this.paint();
      this.state.textContent = `${this.state.textContent ?? ''} ${tr('Não deu para mostrar a notificação.')}`.trim();
      this.place();
    }
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
