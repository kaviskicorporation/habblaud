// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): o catálogo das salas temáticas — nome, ícone em pixel
// colorido, cor da placa, cor do piso (miniaturas), descrição, tamanhos e as ações "ir e fazer" de cada uma. O editor
// da planta (frente B) usa na paleta; as salas (themes.ts) e o "ir e fazer" (go-and-do.ts) usam o resto.
// Funções (e não constantes) porque o tr() precisa rodar depois de o idioma carregar.
import { tr } from '../../../../shared/i18n';
import { KV_THEME_KEYS, type KvThemeKey } from '../../../../shared/kaviski-plan';
import { pixelIcon } from '../../ui/icons';

export interface KvThemeInfo {
  key: KvThemeKey;
  /** Nome padrão da placa. */
  name: string;
  /** Uma linha: para que serve. */
  desc: string;
  /** Ícone em pixel colorido (svg, 2 px de tela por pixel). */
  icon: string;
  /** Cor da placa e do destaque (#rrggbb). */
  color: string;
  /** Cor do piso (miniatura do editor). */
  floor: string;
  /** Tamanho sugerido ao arrastar da paleta (tiles) e o mínimo. */
  size: { w: number; h: number };
  min: { w: number; h: number };
  /** As ações "ir e fazer" que têm item nesta sala (chaves de kvRegisterAction). */
  actions: readonly string[];
}

const K = '#2b2540';
const W = '#ffffff';

/** Ícones: letras = cores (k contorno, w branco, o resto por ícone). */
const ICON: Record<KvThemeKey, { rows: string[]; pal: Record<string, string> }> = {
  rh: {
    rows: ['...kkkk...', '.kkkyykkk.', '.kwwwwwwk.', '.kwwppwwk.', '.kwppppwk.', '.kwwppwwk.', '.kwwwwwwk.', '.kwbbbbwk.', '.kwwwwwwk.', '.kkkkkkkk.'],
    pal: { k: K, w: W, y: '#f2c14e', p: '#f08a3c', b: '#3f7fd8' },
  },
  diretoria: {
    rows: ['....yyy....', '....yyy....', '.....k.....', '.kkkkkkkkk.', '.k...k...k.', 'bbb.ggg.ppp', 'bbb.ggg.ppp'],
    pal: { k: K, y: '#f2c14e', b: '#3f7fd8', g: '#4cae6a', p: '#8d66cf' },
  },
  reuniao: {
    rows: ['..k....k..', 'rrrrrrrrrr', 'rrrrrrrrrr', 'wwwwwwwwww', 'wkwkwkwkww', 'wwwwwwwwww', 'wkwkwbbkww', 'wwwwwbbwww', 'wwwwwwwwww', 'kkkkkkkkkk'],
    pal: { k: K, w: W, r: '#e05a5a', b: '#3f7fd8' },
  },
  recepcao: {
    rows: ['....kk....', '....yy....', '...yyyy...', '..yyyywy..', '.yyyyyywy.', '.yyyyyyyy.', 'kkkkkkkkkk', 'bbbbbbbbbb'],
    pal: { k: K, y: '#e0b030', w: '#fff3a3', b: '#7a5a45' },
  },
  provador: {
    rows: ['..kkkkkk.y', '.kcccwcck.', '.kccwccck.', '.kcwcccck.', '.kcccccck.', '.kcccccck.', '..kkkkkk..', '....kk....', '..pppppp..'],
    pal: { k: K, c: '#a8d4ee', w: W, y: '#f2c14e', p: '#e47aa8' },
  },
  foco: {
    rows: ['....gg....', '...g.gg...', '..rrrrrr..', '.rrwrrrrr.', 'rrwrrrrrrr', 'rrrrrrrrrr', 'rrrrrkrrrr', '.rrrrkrrr.', '..rrrrrr..'],
    pal: { k: K, g: '#4cae6a', r: '#e05a5a', w: '#ffc9c9' },
  },
  auditorio: {
    rows: ['.......oo.', '.....oooo.', 'kk.oooooo.', 'kkkoooooow', 'kkkooooooo', 'kk.oooooo.', '.....oooo.', '..k....oo.', '..k.......'],
    pal: { k: K, o: '#d94a4a', w: '#ffd8a8' },
  },
  agentes: {
    rows: ['....y.....', '....k.....', '.kkkkkkkk.', '.kttttttk.', '.ktwttwtk.', '.kttttttk.', '.ktkkkktk.', '.kttttttk.', '.kkkkkkkk.'],
    pal: { k: K, t: '#2fb3b0', w: W, y: '#f2c14e' },
  },
  ti: {
    rows: ['....ss....', '.ss.ss.ss.', '.ssssssss.', '..sswwss..', 'sssw..wsss', 'sssw..wsss', '..sswwss..', '.ssssssss.', '.ss.ss.ss.', '....ss....'],
    pal: { s: '#5b6f99', w: '#c9d6ee' },
  },
  arquitetura: {
    rows: ['....kk....', '...kbbk...', '..kbbbbk..', '.kbbbbbbk.', 'kkkkkkkkkk', '.kwwbbwwk.', '.kwwbbwwk.', '.kbbbbbbk.', '.kkkkkkkk.'],
    pal: { k: K, b: '#5aa9e6', w: '#fff3a3' },
  },
  correio: {
    rows: ['..kkkkk.r.', '.kbbbbbkrr', 'kbbbbbbbkr', 'kbbwwwbbk.', 'kbbbbbbbk.', 'kkkkkkkkk.', '....k.....', '....k.....', '..kkkkk...'],
    pal: { k: K, b: '#c0603a', w: W, r: '#e05a5a' },
  },
  descanso: {
    rows: ['.llllllll.', 'llllllllll', 'llwlllllyl', 'lwwwlllyly', 'llwlllllyl', 'llllllllll', '.ll....ll.'],
    pal: { l: '#7fae2c', w: W, y: '#f2c14e' },
  },
};

const DATA: Record<KvThemeKey, { color: string; floor: string; size: [number, number]; actions: string[] }> = {
  rh: { color: '#f08a3c', floor: '#f3dccb', size: [16, 12], actions: ['pessoas', 'organograma', 'registro', 'convites'] },
  diretoria: { color: '#8d66cf', floor: '#c9a27c', size: [16, 12], actions: ['organograma', 'visao'] },
  reuniao: { color: '#3f7fd8', floor: '#d7e2f2', size: [14, 10], actions: ['agenda'] },
  recepcao: { color: '#e0b030', floor: '#efe9dc', size: [18, 12], actions: ['convites', 'presenca', 'mapa', 'ajuda'] },
  provador: { color: '#e47aa8', floor: '#f6dce8', size: [10, 9], actions: ['boneco'] },
  foco: { color: '#4cae6a', floor: '#d8ecd6', size: [14, 10], actions: ['foco'] },
  auditorio: { color: '#d94a4a', floor: '#b98a68', size: [20, 14], actions: ['palco'] },
  agentes: { color: '#2fb3b0', floor: '#d3ecec', size: [18, 12], actions: ['novo-agente', 'timelapse', 'meu-dia', 'historico', 'feed'] },
  ti: { color: '#5b6f99', floor: '#d9dde6', size: [14, 10], actions: ['avisos', 'atalhos', 'voz', 'config', 'ir-andando'] },
  arquitetura: { color: '#5aa9e6', floor: '#dcebf6', size: [14, 10], actions: ['planta', 'salas'] },
  correio: { color: '#c0603a', floor: '#eedbcf', size: [12, 9], actions: ['conversas', 'entregas'] },
  descanso: { color: '#7fae2c', floor: '#c49a6c', size: [16, 12], actions: ['classico'] },
};

function texts(key: KvThemeKey): { name: string; desc: string } {
  switch (key) {
    case 'rh':
      return { name: tr('RH'), desc: tr('Pessoas: contas, convites e registro; organograma na parede') };
    case 'diretoria':
      return { name: tr('Diretoria'), desc: tr('Organograma grande e a luneta da visão geral do prédio') };
    case 'reuniao':
      return { name: tr('Sala de reunião'), desc: tr('Mesa grande, telão e o calendário da agenda') };
    case 'recepcao':
      return { name: tr('Recepção de visitantes'), desc: tr('Balcão de convites, quadro de presença, mapa e informações') };
    case 'provador':
      return { name: tr('Provador'), desc: tr('Espelho para trocar a aparência do boneco e o crachá') };
    case 'foco':
      return { name: tr('Cabines de foco'), desc: tr('Cabines silenciosas com o relógio do pomodoro') };
    case 'auditorio':
      return { name: tr('Auditório'), desc: tr('Palco com púlpito: falar para o andar inteiro') };
    case 'agentes':
      return { name: tr('Central dos agentes'), desc: tr('Novo agente no terminal, timelapse na TV, meu dia e histórico') };
    case 'ti':
      return { name: tr('TI e ajustes'), desc: tr('Avisos, atalhos, voz e vídeo e configurações') };
    case 'arquitetura':
      return { name: tr('Arquitetura'), desc: tr('A maquete da empresa: editar a planta e as salas') };
    case 'correio':
      return { name: tr('Correio'), desc: tr('Caixa de correio das conversas e o escaninho das entregas') };
    case 'descanso':
      return { name: tr('Sala de descanso'), desc: tr('Rede para o modo clássico, fliperama e sofás') };
  }
}

const icons = new Map<KvThemeKey, string>();

export function kvThemeIcon(key: KvThemeKey): string {
  let s = icons.get(key);
  if (!s) icons.set(key, (s = pixelIcon(ICON[key].rows, ICON[key].pal, 'ui-px-icon kv-theme-icon')));
  return s;
}

export function kvThemeInfo(key: KvThemeKey): KvThemeInfo {
  const d = DATA[key];
  return { key, ...texts(key), icon: kvThemeIcon(key), color: d.color, floor: d.floor, size: { w: d.size[0], h: d.size[1] }, min: { w: 8, h: 8 }, actions: d.actions };
}

export function kvThemeInfos(): KvThemeInfo[] {
  return KV_THEME_KEYS.map(kvThemeInfo);
}

/** A cor de uma sala temática (sem tr: dá para usar no layout). */
export function kvThemeColor(key: KvThemeKey): string {
  return DATA[key].color;
}

/** As ações de cada sala, sem tr (layout e testes). */
export function kvThemeActions(key: KvThemeKey): readonly string[] {
  return DATA[key].actions;
}
