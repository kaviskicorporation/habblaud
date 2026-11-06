// Fork Kaviski (KAVISKI-HUMANOS.md): as teclas das pessoas no escritório, num lugar só e fácil de editar. Aparecem na
// janela de Atalhos (botão "?" do mini-mapa) e no começo da Ajuda do Habblaud (tecla ?).
// Cada linha: [teclas, o que faz]; `only` = só para quem não é cliente/visitante.
import { tr } from '../../../../shared/i18n';

export interface KvShortcut {
  keys: string[];
  text: string;
  only?: 'team';
}

export interface KvShortcutGroup {
  title: string;
  items: KvShortcut[];
}

export const KV_SHORTCUTS: KvShortcutGroup[] = [
  {
    title: tr('Andar (com o boneco no escritório)'),
    items: [
      { keys: ['←', '↑', '→', '↓'], text: tr('Andar (também W A S D); sem o boneco, movem a câmera') },
      { keys: ['Shift'], text: tr('Correr (segurando junto com as setas)') },
      { keys: [tr('clique')], text: tr('Andar até o ponto clicado (duplo clique: correndo)') },
      { keys: ['E'], text: tr('Usar o que está perto: sentar e levantar, beber, quadro, mural…') },
      { keys: ['Esc'], text: tr('Parar de seguir alguém; fechar a janela ou a grade de vídeo aberta') },
    ],
  },
  {
    title: tr('Conversar'),
    items: [
      { keys: ['Enter'], text: tr('Abrir a conversa da área onde estou') },
      { keys: ['G'], text: tr('Cumprimentar a pessoa mais perto (roda de cumprimentos; 1–9 e 0 escolhem)') },
      { keys: ['1', '…', '9'], text: tr('Reação rápida sobre o meu boneco (com a roda fechada)') },
      { keys: [tr('clique')], text: tr('Clicar numa pessoa abre o cartão dela (mensagem, ir até, seguir…)') },
    ],
  },
  {
    title: tr('Janelas'),
    items: [
      { keys: ['N'], text: tr('Mostrar ou recolher o mini-mapa') },
      { keys: ['?'], text: tr('Ajuda do Habblaud (com estas teclas no começo)') },
      { keys: ['T'], text: tr('Terminal do agente selecionado'), only: 'team' },
      { keys: ['O'], text: tr('Visão geral do prédio') },
    ],
  },
];
