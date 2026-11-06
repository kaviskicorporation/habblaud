// Fork Kaviski (KAVISKI.md, "Barra do topo em grupos"): a ordem e os grupos dos botões do topo, num lugar só e fácil
// de editar (topbar-groups.ts aplica no DOM). Sem DOM além de ler classe e rótulo do botão: testado em
// topbar-model.test.ts.
//
// Cada botão: grupo, ordem dentro do grupo, nome curto (menu "Mais"), atalho de teclado (se tem) e:
// - `more`: mora sempre no menu "Mais" (pouco usado);
// - `drop`: vai para o "Mais" quando falta espaço, do menor para o maior (sem `drop`: fica sempre no topo).
// Botão que ninguém listou (versão nova do original, outro módulo) vai para o grupo "Outros", antes do Sistema.
import { tr } from '../../../shared/i18n';

export type KvTopGroupKey = 'escritorio' | 'agentes' | 'empresa' | 'outros' | 'sistema';

export interface KvTopGroup {
  key: KvTopGroupKey;
  title: () => string;
}

export const KV_TOP_GROUPS: KvTopGroup[] = [
  { key: 'escritorio', title: () => tr('Escritório') },
  { key: 'agentes', title: () => tr('Agentes e o dia') },
  { key: 'empresa', title: () => tr('Empresa') },
  { key: 'outros', title: () => tr('Outros') },
  { key: 'sistema', title: () => tr('Sistema') },
];

export interface KvTopSlot {
  /** Classe do botão (ou o rótulo exato, `label`, para os do original que não têm classe). */
  cls?: string;
  label?: () => string;
  group: KvTopGroupKey;
  order: number;
  name: () => string;
  key?: string;
  more?: boolean;
  drop?: number;
}

// Por que cada um está onde está (o Vitor pediu para decidir pelo uso):
// - no topo: o que tem atalho de teclado ou estado/contador que precisa estar à vista (Conversas com as não lidas,
//   Foco com os minutos, Avisos, Feed, Meu dia, Timelapse) e o que se usa todo dia (Pessoas, Salas, Agenda, Histórico);
// - no "Mais": o que se usa de vez em quando e não tem atalho nem contador (Convidar visitantes, Organograma, Planta da
//   empresa, Habblaud World) e o Modo clássico, que também está no menu da conta.
// `drop` (quem sai primeiro quando aperta): Histórico, Salas, Timelapse, Agenda, Pessoas, Meu dia, Foco, Feed, Mundo,
// Avisos, Novo agente, Entregas e por último Conversas. Configurações, Ajuda e o próprio "Mais" nunca saem.
export const KV_TOP_SLOTS: KvTopSlot[] = [
  { cls: 'kv-btn-chat', group: 'escritorio', order: 10, name: () => tr('Conversas'), key: 'Enter', drop: 13 },
  { cls: 'kv-btn-people', group: 'escritorio', order: 20, name: () => tr('Pessoas'), drop: 5 },
  { cls: 'kv-btn-salas', group: 'escritorio', order: 30, name: () => tr('Salas'), drop: 2 },
  { cls: 'kv-btn-agenda', group: 'escritorio', order: 40, name: () => tr('Minha agenda'), drop: 4 },
  { cls: 'kv-btn-focus', group: 'escritorio', order: 50, name: () => tr('Modo foco (pomodoro)'), drop: 7 },
  { cls: 'kv-btn-invite', group: 'escritorio', order: 60, name: () => tr('Convidar visitantes'), more: true },
  { cls: 'kv-btn-classic', group: 'escritorio', order: 70, name: () => tr('Modo clássico'), more: true },

  { cls: 'ui-btn-spawn', group: 'agentes', order: 10, name: () => tr('Novo agente'), drop: 11 },
  { cls: 'ui-btn-deliv', group: 'agentes', order: 20, name: () => tr('Entregas'), drop: 12 },
  { cls: 'ui-btn-feed', group: 'agentes', order: 30, name: () => tr('Feed de atividade'), key: ']', drop: 8 },
  { label: () => tr('Meu dia: para onde foi o tempo (M)'), group: 'agentes', order: 40, name: () => tr('Meu dia'), key: 'M', drop: 6 },
  { cls: 'ui-btn-timelapse', group: 'agentes', order: 50, name: () => tr('Timelapse do dia'), key: 'L', drop: 3 },
  { cls: 'ui-hist-btn', group: 'agentes', order: 60, name: () => tr('Histórico de sessões'), drop: 1 },
  { cls: 'ui-scene-btn', group: 'agentes', order: 70, name: () => tr('Mundo'), drop: 9 },
  { cls: 'ui-btn-world', group: 'agentes', order: 80, name: () => 'Habblaud World', more: true },

  { cls: 'kv-btn-org', group: 'empresa', order: 10, name: () => tr('Organograma'), more: true },
  { cls: 'kv-btn-plan', group: 'empresa', order: 20, name: () => tr('Planta da empresa'), more: true },

  { cls: 'kv-btn-alerts', group: 'sistema', order: 10, name: () => tr('Avisos'), drop: 10 },
  { label: () => tr('Configurações'), group: 'sistema', order: 20, name: () => tr('Configurações') },
  { label: () => tr('Ajuda (?)'), group: 'sistema', order: 30, name: () => tr('Ajuda'), key: '?' },
];

/** O lugar do botão na barra (null = desconhecido: vai para "Outros"). */
export function kvTopSlotOf(el: { classList: { contains(c: string): boolean }; getAttribute(n: string): string | null }): KvTopSlot | null {
  for (const s of KV_TOP_SLOTS) if (s.cls && el.classList.contains(s.cls)) return s;
  const label = el.getAttribute('aria-label');
  if (label) for (const s of KV_TOP_SLOTS) if (s.label && s.label() === label) return s;
  return null;
}

/** Dica do botão: o rótulo dele e o atalho, quando o rótulo ainda não diz ("Avisos: sons e notificações", "… (M)"). */
export function kvTopTip(label: string, slot: KvTopSlot | null): string {
  const text = label.trim();
  if (!slot?.key) return text;
  const k = slot.key;
  if (text.includes(`(${k})`) || text.includes(`( ${k} )`)) return text;
  return tr('{0} · atalho: {1}', [text, k]);
}

/**
 * Passos para a barra caber, na ordem: tirar um botão do topo (`drop`, o número do botão em KV_TOP_SLOTS) ou ligar uma
 * classe na raiz (`cls`, regras em topbar-groups.css). Os primeiros KV_TOP_COMFORT_STEPS são "leves": valem para dar
 * aos cartões de uso o nível médio/completo; os outros só quando nem o mínimo cabe (ou a barra quebraria a linha).
 */
export const KV_TOP_STEPS: { drop?: number; cls?: string }[] = [
  { drop: 1 }, // Histórico
  { cls: 'kv-tg-acct-mini' }, // chip da conta só com a inicial
  { cls: 'kv-tg-counters-mini' }, // sem os contadores de salas e subagentes (a lista lateral e o escritório mostram)
  { drop: 2 }, // Salas
  { cls: 'kv-tg-waiting-mini' }, // "precisam de você" só com a mão e o número
  { drop: 3 }, // Timelapse (tecla L)
  ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((drop) => ({ drop })),
];

export const KV_TOP_COMFORT_STEPS = 6;
