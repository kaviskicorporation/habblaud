// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): o mapa de TODAS as funções do Habblaud com pessoas e o
// lugar físico de cada uma (a sala temática e o item). Cada função vira uma ação "ir e fazer" (`kvRegisterAction`):
// `run` abre a janela de sempre — quase sempre clicando o próprio botão (do topo, do menu Mais ou da barra), sem
// reescrever os módulos de quem fez cada um. `button` diz qual botão é a função (o go-and-do embrulha o clique dele).
//
//   ação          | onde (sala → item)                              | o que abre
//   pessoas       | RH → balcão com a ficha                         | Pessoas (contas)
//   registro      | RH → arquivo                                    | Pessoas → Registro
//   convites      | RH → mesa dos convites; Recepção → balcão       | Convidar visitantes
//   organograma   | RH → quadro; Diretoria → organograma grande     | organograma (frente D registra)
//   visao         | Diretoria → luneta                              | Visão geral do prédio (O)
//   agenda        | Reunião → calendário                            | Minha agenda
//   presenca      | Recepção → quadro de presença                   | Quem está online e o meu status
//   mapa          | Recepção → mapa na parede                       | mini-mapa (N)
//   ajuda         | Recepção → totem de informações                 | Ajuda (?)
//   boneco        | Provador → espelhos                             | Meu boneco
//   foco          | Foco → relógio do pomodoro                      | Modo foco (pomodoro)
//   palco         | Auditório → púlpito                             | Palco (megafone)
//   novo-agente   | Agentes → terminal                              | Novo agente
//   timelapse     | Agentes → TV grande                             | Timelapse (L)
//   meu-dia       | Agentes → painel                                | Meu dia (M)
//   historico     | Agentes → estante                               | Histórico de sessões
//   feed          | Agentes → impressora                            | Feed de atividade
//   avisos        | TI → sino                                       | Avisos: sons e notificações
//   atalhos       | TI → pôster das teclas                          | Atalhos
//   voz           | TI → bancada de voz e vídeo                     | ajustes do microfone (com o LiveKit)
//   config        | TI → rack                                       | Configurações
//   ir-andando    | TI → engrenagem                                 | liga/desliga "ir andando até o lugar"
//   planta        | Arquitetura → maquete, planta na parede         | editor da planta (frente B registra)
//   salas         | Arquitetura → prancheta                         | Salas (as próprias)
//   conversas     | Correio → caixa de correio, telefone            | Conversas
//   entregas      | Correio → escaninho                             | Entregas dos agentes
//   classico      | Descanso → rede                                 | Modo clássico
import { tr } from '../../../../shared/i18n';
import { kvAction, kvRegisterAction, type KvAction } from './api';
import { kvOpenProfile } from '../humanos/online';
import { kvPeople } from '../humanos/world';

export interface KvActionDef {
  key: string;
  label: () => string;
  icon: string;
  /** O botão que já faz isto (seletor CSS); o clique nele passa pelo "ir e fazer". */
  button?: string;
  /** Só este botão, entre os que batem com o seletor (ex.: pelo nome). */
  match?: (el: HTMLElement) => boolean;
  /** Abre sem botão (quando não há). */
  open?: () => void;
  /** Teclas que também abrem (passam pelo "ir e fazer"). */
  keys?: string[];
  /** Quem pode, quando não há botão para conferir. */
  can?: () => boolean;
  /** Pose usando o item. */
  pose?: 'use' | 'read' | 'stand' | 'groom' | 'talk';
}

const label = (el: Element, text: string) => (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '') === text;

/** Os botões guardados (os que vão para o menu Mais saem do documento, mas continuam os mesmos). */
const seen = new Map<string, HTMLElement>();

export function kvActionButton(def: KvActionDef): HTMLElement | null {
  if (!def.button) return null;
  const now = [...document.querySelectorAll<HTMLElement>(def.button)].find((e) => !def.match || def.match(e));
  if (now) {
    seen.set(def.key, now);
    return now;
  }
  // fora do documento = guardado no menu Mais (topfit.ts): continua o mesmo botão
  return seen.get(def.key) ?? null;
}

/** O botão está à mão (não escondido para este papel). */
export function kvButtonUsable(el: HTMLElement | null): boolean {
  if (!el || el.hidden) return false;
  if (el.isConnected && el.closest('[hidden]')) return false;
  return true;
}

/** Abre a aba Registro da tela de Pessoas (clica no botão e depois na aba). */
function openPeopleTab(tab: string): void {
  const btn = document.querySelector<HTMLElement>('.kv-btn-people') ?? seen.get('pessoas');
  if (!btn) return;
  kvClickBypass(btn);
  let tries = 0;
  const t = setInterval(() => {
    const tabBtn = [...document.querySelectorAll<HTMLElement>('dialog[open] .kv-ui-tabs [role="tab"], dialog[open] .kv-ui-tabs button')].find((b) => b.textContent?.trim() === tab);
    if (tabBtn || ++tries > 20) {
      clearInterval(t);
      tabBtn?.click();
    }
  }, 50);
}

let bypass = false;

/** Clica no botão sem passar pelo "ir e fazer" (é o `run` das ações). */
export function kvClickBypass(el: HTMLElement): void {
  bypass = true;
  try {
    el.click();
  } finally {
    bypass = false;
  }
}

export function kvBypassing(): boolean {
  return bypass;
}

/** O liga/desliga do "ir andando até o lugar" (go-and-do.ts preenche). */
export const kvWalkPref = { get: () => true, set: (_on: boolean) => {} };

export const KV_ACTION_DEFS: KvActionDef[] = [
  { key: 'pessoas', label: () => tr('Pessoas'), icon: '👥', button: '.kv-btn-people', pose: 'read' },
  { key: 'registro', label: () => tr('Registro'), icon: '🗄️', open: () => openPeopleTab(tr('Registro')), can: () => !!document.querySelector('.kv-btn-people') || !!seen.get('pessoas'), pose: 'read' },
  { key: 'convites', label: () => tr('Convidar visitantes'), icon: '✉️', button: '.kv-btn-invite', pose: 'use' },
  { key: 'visao', label: () => tr('Visão geral do prédio'), icon: '🔭', button: '.ui-topbar button', match: (el) => label(el, tr('Visão geral (O)')), pose: 'use' },
  { key: 'agenda', label: () => tr('Minha agenda'), icon: '📅', button: '.kv-btn-agenda', pose: 'read' },
  { key: 'presenca', label: () => tr('Quem está online'), icon: '🟢', button: '.kv-me', pose: 'read' },
  {
    key: 'mapa',
    label: () => tr('Mini-mapa'),
    icon: '🗺️',
    open: () => {
      const t = document.querySelector<HTMLElement>('.kv-map__title');
      if (t && t.getAttribute('aria-expanded') !== 'true') t.click();
    },
    can: () => !!document.querySelector('.kv-map__title'),
    pose: 'read',
  },
  { key: 'ajuda', label: () => tr('Ajuda'), icon: '❓', button: '.ui-topbar button', match: (el) => label(el, tr('Ajuda (?)')), keys: ['?'], pose: 'use' },
  { key: 'boneco', label: () => tr('Meu boneco'), icon: '🪞', open: () => kvOpenProfile(), can: () => !!kvPeople.client, pose: 'groom' },
  { key: 'foco', label: () => tr('Modo foco (pomodoro)'), icon: '🍅', button: '.kv-btn-focus', pose: 'use' },
  { key: 'palco', label: () => tr('Palco (megafone)'), icon: '📢', button: '.kv-dock__stage', pose: 'talk' },
  { key: 'novo-agente', label: () => tr('Novo agente'), icon: '🤖', button: '.ui-btn-spawn', pose: 'use' },
  { key: 'timelapse', label: () => tr('Timelapse do dia'), icon: '📺', button: '.ui-btn-timelapse', keys: ['l', 'L'], pose: 'stand' },
  { key: 'meu-dia', label: () => tr('Meu dia'), icon: '📊', button: '.ui-topbar button', match: (el) => label(el, tr('Meu dia: para onde foi o tempo (M)')), keys: ['m', 'M'], pose: 'read' },
  { key: 'historico', label: () => tr('Histórico de sessões'), icon: '📚', button: '.ui-hist-btn', pose: 'read' },
  { key: 'feed', label: () => tr('Feed de atividade'), icon: '📰', button: '.ui-btn-feed', pose: 'use' },
  { key: 'avisos', label: () => tr('Avisos'), icon: '🔔', button: '.kv-btn-alerts', pose: 'use' },
  { key: 'atalhos', label: () => tr('Atalhos'), icon: '⌨️', open: () => document.querySelector<HTMLDialogElement>('dialog.kv-keys:not([open])')?.showModal(), can: () => !!document.querySelector('dialog.kv-keys'), pose: 'read' },
  { key: 'voz', label: () => tr('Ajustes de voz e vídeo'), icon: '🎧', button: '.kv-dock__caret', pose: 'use' },
  { key: 'config', label: () => tr('Configurações'), icon: '⚙️', button: '.ui-topbar button', match: (el) => label(el, tr('Configurações')), pose: 'use' },
  {
    key: 'ir-andando',
    label: () => tr('Ir andando até o lugar'),
    icon: '🚶',
    open: () => kvWalkPref.set(!kvWalkPref.get()),
    pose: 'use',
  },
  { key: 'salas', label: () => tr('Salas'), icon: '🚪', button: '.kv-btn-salas', pose: 'read' },
  { key: 'conversas', label: () => tr('Conversas'), icon: '💬', button: '.kv-btn-chat', pose: 'use' },
  { key: 'entregas', label: () => tr('Entregas'), icon: '📦', button: '.ui-btn-deliv', pose: 'use' },
  { key: 'classico', label: () => tr('Modo clássico (descansar)'), icon: '🌙', button: '.kv-btn-classic', pose: 'stand' },
];

const DEFS = new Map(KV_ACTION_DEFS.map((d) => [d.key, d]));

export function kvActionDef(key: string): KvActionDef | undefined {
  return DEFS.get(key);
}

/** Registra as ações que ninguém registrou ainda (organograma e planta são das frentes D e B). */
export function kvRegisterThemeActions(): void {
  for (const d of KV_ACTION_DEFS) {
    if (kvAction(d.key)) continue;
    const a: KvAction = {
      key: d.key,
      get label() {
        return d.label();
      },
      icon: d.icon,
      pose: d.pose === 'read' || d.pose === 'stand' ? d.pose : 'use',
      run: () => {
        const el = kvActionButton(d);
        if (el && kvButtonUsable(el)) kvClickBypass(el);
        else d.open?.();
      },
      allowed: () => (d.button ? kvButtonUsable(kvActionButton(d)) : (d.can?.() ?? true)),
    };
    kvRegisterAction(a);
  }
}
