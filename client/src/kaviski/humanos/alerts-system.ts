// Fork Kaviski (KAVISKI-HUMANOS.md → avisos): a notificação "do sistema" (Windows, macOS, Android) e o contador no
// ícone do app. Quem decide SE avisa é o alerts.ts; aqui só o COMO:
//
// - Com service worker (`/sw.js`, só de notificações, sem cache): `showNotification` pelo worker — vai para a Central de
//   Notificações do Windows, funciona no Chrome do celular e aceita botões (Responder, Deixar entrar...). O clique volta
//   para esta aba (foca) e roda o que a página registrou para aquela notificação.
// - Sem service worker (navegador antigo, http fora do localhost): `new Notification` (sem botões), como antes.
// - Badging API (`navigator.setAppBadge`): o número de avisos pendentes no ícone do app instalado / da barra de tarefas.
//
// Tudo isso só existe em "contexto seguro" (https ou localhost); fora dele `kvSystemSupport()` diz 'insecure'.

export interface KvSystemAction {
  id: string;
  label: string;
  run(): void;
}

export interface KvSystemNote {
  /** Também a `tag`: outra notificação com a mesma chave troca a anterior (e toca de novo: `renotify`). */
  key: string;
  title: string;
  body?: string;
  /** Fica na tela até a pessoa agir (chamada, porta, urgente). */
  sticky?: boolean;
  /** Sem o som do sistema (quando a página já tocou o dela). */
  silent?: boolean;
  /** Clique no corpo da notificação. */
  onClick?: () => void;
  /** Botões (só com service worker e no máximo o que o navegador aceitar, normalmente 2). */
  actions?: KvSystemAction[];
}

const ICON = '/assets/brand/icon-192.png';
const BADGE = '/assets/brand/favicon-32.png';
/** Quanto tempo a página lembra o que fazer no clique de uma notificação. */
const KEEP_MS = 6 * 60 * 60 * 1000;
/** Esta aba (para o service worker devolver o clique para ela). */
const PAGE = Math.random().toString(36).slice(2, 10);

const handlers = new Map<string, { at: number; onClick?: () => void; actions: Map<string, () => void> }>();
let reg: ServiceWorkerRegistration | null = null;
let regTried = false;

export type KvSystemSupport = 'ok' | 'unsupported' | 'insecure';

export function kvSystemSupport(): KvSystemSupport {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
  return typeof Notification === 'undefined' ? 'unsupported' : 'ok';
}

/** Registra o service worker de notificações (uma vez; quieto se não der). */
export function kvRegisterNotifyWorker(): void {
  if (regTried) return;
  regTried = true;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const sw = navigator.serviceWorker;
  sw.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { kv?: string; key?: string; action?: string; page?: string } | null;
    if (!d || d.kv !== 'notification-click') return;
    window.focus();
    const h = d.key ? handlers.get(d.key) : undefined;
    if (!h) return; // de outra aba (ou antiga): já focou, basta
    const run = (d.action && h.actions.get(d.action)) || h.onClick;
    try {
      run?.();
    } catch {
      // o que a página ia fazer falhou: a aba já está na frente
    }
  });
  sw.startMessages?.();
  sw.register('/sw.js', { scope: '/' })
    .then((r) => {
      reg = r;
    })
    .catch(() => {
      reg = null;
    });
}

/** Já há um service worker ativo para mostrar notificações com botões? */
export function kvHasNotifyWorker(): boolean {
  return !!reg?.active;
}

function remember(n: KvSystemNote): void {
  const t = Date.now();
  for (const [k, v] of handlers) if (t - v.at > KEEP_MS) handlers.delete(k);
  handlers.set(n.key, { at: t, onClick: n.onClick, actions: new Map((n.actions ?? []).map((a) => [a.id, a.run])) });
}

/** Mostra a notificação do sistema (quem chama já conferiu permissão e preferências). Devolve se mostrou. */
export function kvShowSystem(n: KvSystemNote): boolean {
  if (kvSystemSupport() !== 'ok' || Notification.permission !== 'granted') return false;
  const base: Record<string, unknown> = {
    body: n.body ?? '',
    tag: n.key,
    renotify: true,
    icon: ICON,
    badge: BADGE,
    lang: document.documentElement.lang || 'pt-BR',
    silent: !!n.silent,
    requireInteraction: !!n.sticky,
    timestamp: Date.now(),
  };
  const active = reg?.active;
  if (active) {
    remember(n);
    const max = (Notification as unknown as { maxActions?: number }).maxActions ?? 2;
    const actions = (n.actions ?? []).slice(0, Math.max(0, max)).map((a) => ({ action: a.id, title: a.label }));
    active.postMessage({ kv: 'show', title: n.title, options: { ...base, ...(actions.length ? { actions } : {}), data: { key: n.key, page: PAGE, url: '/' } } });
    return true;
  }
  try {
    const note = new Notification(n.title, base as NotificationOptions);
    note.onclick = () => {
      window.focus();
      n.onClick?.();
      note.close();
    };
    return true;
  } catch {
    // navegador que só notifica por service worker (Chrome no Android) e ele ainda não está pronto
    return false;
  }
}

/** Fecha a notificação de chave `key` (a pessoa já respondeu pela página). */
export function kvCloseSystem(key: string): void {
  handlers.delete(key);
  void reg
    ?.getNotifications({ tag: key })
    .then((list) => list.forEach((x) => x.close()))
    .catch(() => {});
}

/** O número no ícone do app (0 apaga). */
export function kvAppBadge(n: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) void nav.setAppBadge?.(n).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  } catch {
    // sem Badging API
  }
}

/** Pede a permissão (SÓ dentro de um clique da pessoa). */
export async function kvAskPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (kvSystemSupport() !== 'ok') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Windows? (para a dica de onde liberar as notificações no sistema). */
export function kvIsWindows(): boolean {
  return /Windows/i.test(navigator.userAgent);
}
