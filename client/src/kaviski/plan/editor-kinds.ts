// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): nome, cor e ícone em pixel de cada tipo de item da planta (a paleta
// e o desenho do editor usam). As salas temáticas vêm do catálogo da frente C (themes-info.ts).
import { tr } from '../../../../shared/i18n';
import { KV_THEME_KEYS, type KvCoreRef, type KvPlanItem, type KvPlanKind, type KvThemeKey } from '../../../../shared/kaviski-plan';
import { pixelIcon } from '../../ui/icons';
import { kvThemeIcon, kvThemeInfo } from './themes-info';

const K = '#2b2540';
const W = '#ffffff';

const icon = (rows: string[], pal: Record<string, string>) => pixelIcon(rows, pal, 'ui-px-icon kv-plan-icon');

/** Ícones em pixel coloridos dos tipos (svg). */
export const KV_PLAN_ICONS = {
  projeto: () => icon(['kkkk......', 'kyyyk.....', 'kyyyykkkkk', 'kyyyyyyyyk', 'kbbbbbbbbk', 'kbbbbbbbbk', 'kbbbbbbbbk', 'kbbbbbbbbk', 'kkkkkkkkkk'], { k: K, y: '#f2c14e', b: '#3f7fd8' }),
  propria: () => icon(['.kkkkkkkk.', '.kppppppk.', '.kppppppk.', '.kppppppk.', '.kpppyypk.', '.kppppppk.', '.kppppppk.', '.kppppppk.', 'kkkkkkkkkk'], { k: K, p: '#8d66cf', y: '#f2c14e' }),
  vaga: () => icon(['kk.kk.kk.k', 'k........k', '....gg....', 'k...gg...k', '..gggggg..', 'k.gggggg.k', '....gg....', 'k...gg...k', 'kk.kk.kk.k'], { k: '#9aa6b8', g: '#7fd17f' }),
  corredor: () => icon(['..........', 'wwwwwwwwww', 'w..k......', 'w.kk......', 'wkkkkkkkkw', 'w.kk......', 'w..k......', 'wwwwwwwwww', '..........'], { k: '#dfe6f2', w: '#8e9bb0' }),
  jardim: () => icon(['...gggg...', '..gggggg..', '.gggLgggg.', '.ggggggLg.', '..gggggg..', '....bb....', '....bb....', '.yy.bb.ff.', 'dddddddddd'], { g: '#4cae6a', L: '#8fdc7a', b: '#7a5a45', y: '#f2c14e', f: '#e47aa8', d: '#3d7a3d' }),
  recepcao: () => icon(['kkkkkkkkkk', 'kssskksssk', 'ksyskksysk', 'kssskksssk', 'kssskksssk', 'kssskksssk', 'kssskksssk', 'kssskksssk', 'kkkkkkkkkk'], { k: K, s: '#b8c4d6', y: '#f2c14e' }),
  copa: () => icon(['..w..w....', '...w..w...', '..w..w....', 'kkkkkkkk..', 'kcccccckkk', 'kcccccck.k', 'kcccccckkk', '.kcccck...', '..kkkk....'], { k: K, w: '#dfe6f2', c: '#b65f3a' }),
  lounge: () => icon(['..........', '.kkkkkkkk.', 'kooooooook', 'kooooooook', 'kkooookkok', 'kooooooook', 'kkkkkkkkkk', '.k......k.'], { k: K, o: '#e07a5f' }),
  banheiros: () => icon(['..kk..kk..', '..kk..kk..', '..........', '.kkkk.kkk.', '.kbbk.kpk.', '.kbbk.kpk.', '..kk..kpk.', '..kk..kpk.', '..kk...k..'], { k: K, b: '#3f7fd8', p: '#e47aa8' }),
  fixa: () => icon(['..kkkk..', '.krrrrk.', 'krrwrrrk', 'krrrrrrk', '.krrrrk.', '..kkkk..', '...kk...', '...kk...', '....k...'], { k: K, r: '#e05a5a', w: W }),
  trava: () => icon(['..kkkk..', '.k....k.', '.k....k.', 'kkkkkkkk', 'kyyyyyyk', 'kyykkyyk', 'kyykkyyk', 'kyyyyyyk', 'kkkkkkkk'], { k: K, y: '#f2c14e' }),
  aviso: () => icon(['....kk....', '...kyyk...', '...kyyk...', '..kyykyk..', '..kyykyk..', '.kyyykyyk.', '.kyyyyyyk.', 'kyyyykyyyk', 'kkkkkkkkkk'], { k: K, y: '#ffd34d' }),
  planta: () => icon(['kkkkkkkkkk', 'kbbbbkbbbk', 'kbwwbkbwbk', 'kbbbbbbwbk', 'kkkbkkkkbk', 'kbbbbbbbbk', 'kbwbbbwwbk', 'kbbbbbbbbk', 'kkkkkkkkkk'], { k: '#dfe6f2', b: '#2f6fbf', w: '#9fd0ff' }),
  regua: () => icon(['k.........', 'kk........', 'kwk.......', 'kwwk......', 'kkwwk.....', 'kwwwwk....', 'kkwwwwk...', 'kwwwwwwk..', 'kkkkkkkkk.'], { k: '#f2c14e', w: '#2b2540' }),
  modelos: () => icon(['kkkk.kkkk.', 'kbbk.kggk.', 'kbbk.kggk.', 'kkkk.kkkk.', '..........', 'kkkk.kkkk.', 'kppk.kyyk.', 'kppk.kyyk.', 'kkkk.kkkk.'], { k: '#dfe6f2', b: '#3f7fd8', g: '#4cae6a', p: '#8d66cf', y: '#f2c14e' }),
  relogio: () => icon(['..kkkkk...', '.k.....k..', 'k...k...k.', 'k...k...k.', 'k...kkk.k.', 'k.......k.', '.k.....k..', '..kkkkk...'], { k: '#dfe6f2' }),
  faixa: () => icon(['k.........', 'kgggg.....', 'kggggg....', 'kgggggg...', 'kgggggg...', 'kggggg....', 'kgggg.....', 'k.........', 'k.........'], { k: '#dfe6f2', g: '#4cae6a' }),
};

const cache = new Map<string, string>();
function once(key: string, make: () => string): string {
  let s = cache.get(key);
  if (!s) cache.set(key, (s = make()));
  return s;
}

/** Cor de cada tipo (o tema usa a do catálogo). */
export function kvKindColor(kind: KvPlanKind, ref?: string): string {
  switch (kind) {
    case 'projeto':
      return '#3f7fd8';
    case 'propria':
      return '#8d66cf';
    case 'tema':
      return KV_THEME_KEYS.includes(ref as KvThemeKey) ? kvThemeInfo(ref as KvThemeKey).color : '#5aa9e6';
    case 'nucleo':
      return ref === 'copa' ? '#b65f3a' : ref === 'lounge' ? '#e07a5f' : ref === 'banheiros' ? '#6fa3b8' : '#e0b030';
    case 'corredor':
      return '#8e9bb0';
    case 'jardim':
      return '#4cae6a';
    case 'vaga':
      return '#9aa6b8';
  }
}

export function kvCoreName(ref: string | undefined): string {
  switch (ref as KvCoreRef) {
    case 'recepcao':
      return tr('Recepção');
    case 'copa':
      return tr('Copa');
    case 'lounge':
      return tr('Lounge');
    case 'banheiros':
      return tr('Banheiros');
    default:
      return tr('Área comum');
  }
}

export function kvKindLabel(kind: KvPlanKind): string {
  switch (kind) {
    case 'projeto':
      return tr('Sala de projeto');
    case 'propria':
      return tr('Sala própria');
    case 'tema':
      return tr('Sala temática');
    case 'nucleo':
      return tr('Área comum');
    case 'corredor':
      return tr('Corredor');
    case 'jardim':
      return tr('Jardim');
    case 'vaga':
      return tr('Vaga');
  }
}

/** Ícone (svg) de um item. */
export function kvItemIcon(it: Pick<KvPlanItem, 'kind' | 'ref'>): string {
  if (it.kind === 'tema' && KV_THEME_KEYS.includes(it.ref as KvThemeKey)) return kvThemeIcon(it.ref as KvThemeKey);
  if (it.kind === 'nucleo') {
    const r = (it.ref ?? 'recepcao') as KvCoreRef;
    return once(`n:${r}`, KV_PLAN_ICONS[r] ?? KV_PLAN_ICONS.recepcao);
  }
  return once(it.kind, KV_PLAN_ICONS[it.kind as 'projeto']);
}

export function kvIcon(key: keyof typeof KV_PLAN_ICONS): string {
  return once(`i:${key}`, KV_PLAN_ICONS[key]);
}

/**
 * Nome que aparece no item: o da placa; senão o da sala (projeto: `names(ref)`; própria: `own(ref)`), o do tema ou o do
 * núcleo; vaga numerada pela ordem.
 */
export function kvItemName(it: KvPlanItem, lookup: { project?: (ref: string) => string | undefined; own?: (id: string) => string | undefined } = {}): string {
  if (it.name) return it.name;
  switch (it.kind) {
    case 'projeto':
      return (it.ref && lookup.project?.(it.ref)) || (it.ref ? it.ref.split('/').filter(Boolean).pop() ?? it.ref : tr('Sala de projeto'));
    case 'propria':
      return (it.ref && lookup.own?.(it.ref)) || tr('Sala própria');
    case 'tema':
      return KV_THEME_KEYS.includes(it.ref as KvThemeKey) ? kvThemeInfo(it.ref as KvThemeKey).name : tr('Sala temática');
    case 'nucleo':
      return kvCoreName(it.ref);
    case 'vaga':
      return tr('Vaga {0}', [(it.order ?? 0) + 1]);
    default:
      return kvKindLabel(it.kind);
  }
}

/** Uma imagem pronta de um svg (para o canvas), em cache. */
const images = new Map<string, HTMLImageElement>();
export function kvSvgImage(svg: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  let img = images.get(svg);
  if (!img) {
    img = new Image();
    const sized = svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
    images.set(svg, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}
