// Fork Kaviski (KAVISKI-HUMANOS.md): as teclas das pessoas no escritório, num lugar só e fácil de editar. Aparecem na
// janela de Atalhos (botão "?" do mini-mapa, shortcuts.ts) e no começo da Ajuda do Habblaud (tecla ?).
//
// Cada grupo tem cor e ícone (desenhado em shortcuts.ts). Cada atalho: as teclas e o que faz. Uma tecla é um texto
// ("E", "Ctrl+Z", "←") — `+` junta teclas apertadas juntas — ou `{ m: 'clique' }` para o mouse/toque. Várias teclas na
// lista = alternativas ("ou"); `range: true` = de uma a outra ("1 … 9"). `only: 'team'` = só para quem não é
// cliente/visitante.
//
// Outros módulos acrescentam as suas com `kvAddShortcuts('editor', [...])` (o grupo nasce se não existir) e a janela
// se redesenha sozinha.
import { tr } from '../../../../shared/i18n';

export type KvKey = string | { m: string };

export interface KvShortcut {
  keys: KvKey[];
  text: string;
  only?: 'team';
  /** As duas teclas são as pontas de uma faixa (1 … 9). */
  range?: boolean;
}

export type KvShortcutGroupKey = 'andar' | 'conversar' | 'usar' | 'camera' | 'janelas' | 'editor' | (string & {});

export interface KvShortcutGroup {
  key: KvShortcutGroupKey;
  title: string;
  /** Cor do grupo (#rrggbb). */
  color: string;
  /** Ícone em pixel (nome em SHORTCUT_ICONS de shortcuts.ts). */
  icon: string;
  /** Só para a equipe (o grupo todo). */
  only?: 'team';
  items: KvShortcut[];
}

const clique = () => ({ m: tr('clique') });

export const KV_SHORTCUTS: KvShortcutGroup[] = [
  {
    key: 'andar',
    title: tr('Andar'),
    color: '#4fd18b',
    icon: 'feet',
    items: [
      { keys: ['←', '↑', '→', '↓'], text: tr('Andar com o boneco; sem o boneco, movem a câmera') },
      { keys: ['W', 'A', 'S', 'D'], text: tr('Andar (o mesmo que as setas)') },
      { keys: ['Shift'], text: tr('Correr (segurando junto com as setas)') },
      { keys: [clique()], text: tr('Andar até o ponto clicado') },
      { keys: [{ m: tr('duplo clique') }], text: tr('Correr até o ponto') },
      { keys: ['Esc'], text: tr('Parar de seguir alguém ou de ir até um item') },
    ],
  },
  {
    key: 'conversar',
    title: tr('Conversar'),
    color: '#7cc8ff',
    icon: 'chat',
    items: [
      { keys: ['Enter'], text: tr('Abrir a conversa da área onde estou') },
      { keys: ['G'], text: tr('Cumprimentar a pessoa mais perto (1–9 e 0 escolhem na roda)') },
      { keys: ['1', '9'], range: true, text: tr('Reação rápida sobre o meu boneco (com a roda fechada)') },
      { keys: [{ m: tr('clique numa pessoa') }], text: tr('Abrir o cartão dela: mensagem, ir até, seguir, chamar…') },
    ],
  },
  {
    key: 'usar',
    title: tr('Usar coisas'),
    color: '#ffb547',
    icon: 'hand',
    items: [
      { keys: ['E'], text: tr('Usar o que está perto: sentar, café, quadro, mural, itens das salas temáticas') },
      { keys: ['E'], text: tr('Sentado: levantar (andar também levanta)') },
      { keys: [{ m: tr('clique num item') }], text: tr('Usar o item, com o boneco perto dele') },
      { keys: [{ m: tr('clique numa cadeira') }], text: tr('Sentar, minha mesa ou fixar um agente de IA nela') },
      { keys: ['Shift+' + tr('clique')], text: tr('Num botão do topo: abrir direto, sem o boneco andar até a sala') },
    ],
  },
  {
    key: 'camera',
    title: tr('Câmera'),
    color: '#c58cff',
    icon: 'camera',
    items: [
      { keys: [{ m: tr('arrastar') }], text: tr('Mover a câmera pelo escritório') },
      { keys: [{ m: tr('roda') }, { m: tr('pinça') }], text: tr('Aproximar e afastar') },
      { keys: ['O'], text: tr('Visão geral do prédio') },
      { keys: ['N'], text: tr('Mostrar ou recolher o mini-mapa') },
    ],
  },
  {
    key: 'janelas',
    title: tr('Janelas'),
    color: '#ff8a4c',
    icon: 'window',
    items: [
      { keys: ['?'], text: tr('Ajuda do Habblaud (com estas teclas no começo)') },
      { keys: ['T'], text: tr('Terminal do agente selecionado'), only: 'team' },
      { keys: ['L'], text: tr('Timelapse do dia'), only: 'team' },
      { keys: ['M'], text: tr('Meu dia: para onde foi o tempo'), only: 'team' },
      { keys: ['Esc'], text: tr('Fechar a janela, o cartão ou a grade de vídeo aberta') },
    ],
  },
  {
    key: 'editor',
    title: tr('Editor da empresa'),
    color: '#35c7d6',
    icon: 'ruler',
    only: 'team',
    items: [
      { keys: [{ m: tr('arrastar') }], text: tr('Mover a sala, corredor ou área (encaixa na grade)') },
      { keys: ['Shift+' + tr('arrastar')], text: tr('Mover sem o ímã da grade') },
      { keys: ['←', '↑', '→', '↓'], text: tr('Mover o item escolhido 1 quadradinho (com Shift: 4)') },
      { keys: ['Delete', 'Backspace'], text: tr('Apagar o item escolhido') },
      { keys: ['Ctrl+D'], text: tr('Duplicar') },
      { keys: ['Ctrl+Z'], text: tr('Desfazer') },
      { keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], text: tr('Refazer') },
      { keys: ['Espaço+' + tr('arrastar'), { m: tr('botão do meio') }], text: tr('Mover a câmera no editor') },
      { keys: ['L'], text: tr('Travar ou destravar o item') },
      { keys: ['F'], text: tr('Marcar como sala fixa') },
      { keys: ['Enter', { m: tr('duplo clique') }], text: tr('Editar o item') },
      { keys: ['Ctrl+S'], text: tr('Gravar a planta') },
      { keys: ['Esc'], text: tr('Soltar a seleção ou sair do editor') },
    ],
  },
];

const listeners = new Set<() => void>();

/**
 * Acrescenta atalhos a um grupo (o grupo nasce com `def` se não existir; sem `def`, nasce cinza no fim). Repetidos
 * (mesmas teclas e texto) são ignorados.
 */
export function kvAddShortcuts(group: KvShortcutGroupKey, items: KvShortcut[], def?: Partial<Omit<KvShortcutGroup, 'key' | 'items'>>): void {
  let g = KV_SHORTCUTS.find((x) => x.key === group);
  if (!g) {
    g = { key: group, title: def?.title ?? group, color: def?.color ?? '#9aa4b8', icon: def?.icon ?? 'key', ...(def?.only ? { only: def.only } : {}), items: [] };
    KV_SHORTCUTS.push(g);
  }
  const sig = (s: KvShortcut) => JSON.stringify([s.keys, s.text]);
  for (const it of items) if (!g.items.some((x) => sig(x) === sig(it))) g.items.push(it);
  for (const cb of listeners) cb();
}

export function kvOnShortcuts(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowUp: '↑', ArrowRight: '→', ArrowDown: '↓' };
const NAMES: Record<string, string> = { Escape: 'Esc', ' ': 'Espaço', Spacebar: 'Espaço', Control: 'Ctrl', Del: 'Delete' };

/** O nome da tecla apertada como aparece na lista ("ArrowLeft" → "←", "e" → "E", " " → "Espaço"). */
export function kvKeyName(key: string): string {
  if (ARROWS[key]) return ARROWS[key]!;
  if (NAMES[key]) return NAMES[key]!;
  return key.length === 1 ? key.toLocaleUpperCase() : key;
}

/** As partes de uma tecla combinada ("Ctrl+Shift+Z" → ["Ctrl", "Shift", "Z"]; "+" sozinho continua "+"). */
export function kvKeyParts(k: string): string[] {
  if (k === '+') return ['+'];
  return k.split('+').filter(Boolean);
}

const MODS = new Set(['Ctrl', 'Shift', 'Alt']);

/** A tecla apertada (com Ctrl/Shift/Alt) bate com o atalho? Puro, para o "experimente" e para testar. */
export function kvShortcutHit(s: KvShortcut, e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): boolean {
  const name = kvKeyName(e.key);
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const keys = s.keys.filter((k): k is string => typeof k === 'string');
  if (s.range && keys.length === 2) {
    const [a, b] = keys as [string, string];
    return name.length === 1 && name >= a && name <= b && !ctrl;
  }
  return keys.some((k) => {
    const parts = kvKeyParts(k);
    const main = parts.filter((p) => !MODS.has(p));
    const mods = parts.filter((p) => MODS.has(p));
    // só a tecla modificadora (Shift: correr)
    if (!main.length) return mods.length === 1 && mods[0] === name;
    if (main.length !== 1 || main[0] !== name) return false;
    if (mods.includes('Ctrl') !== ctrl) return false;
    if (mods.includes('Alt') !== !!e.altKey) return false;
    // Shift só conta quando o atalho pede (o "?" já vem com Shift)
    return !mods.includes('Shift') || !!e.shiftKey;
  });
}
