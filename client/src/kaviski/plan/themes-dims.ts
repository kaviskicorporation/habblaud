// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): medidas dos itens em pixel art das salas temáticas
// (variantes `kv-*`, desenhadas em themes-sprites.ts). Puro. Cada item usa um móvel do catálogo original como
// "suporte" (`carrier`: dá o footprint e se bloqueia a passagem); `w` é a largura real em tiles (itens de parede podem
// ser mais largos que o suporte) e `rise` quanto o desenho sobe acima do footprint (px; caixa do contorno).
import type { FurnitureKind } from '../../art/api';

export interface KvSpriteDims {
  carrier: FurnitureKind;
  w: number;
  h: number;
  rise: number;
  mount: 'floor' | 'wall';
}

const F = (carrier: FurnitureKind, w: number, h: number, rise: number): KvSpriteDims => ({ carrier, w, h, rise, mount: 'floor' });
const Wl = (carrier: FurnitureKind, w: number): KvSpriteDims => ({ carrier, w, h: 0, rise: 0, mount: 'wall' });

export const KV_SPRITES = {
  // ---- chão
  'kv-hr-desk': F('reception_desk', 3, 1, 18),
  'kv-invite-desk': F('coffee_table', 2, 1, 8),
  'kv-mailbox': F('filing_cabinet', 1, 1, 12),
  'kv-podium': F('filing_cabinet', 1, 1, 18),
  'kv-model': F('meeting_table', 3, 2, 12),
  'kv-drafting': F('coffee_table', 2, 1, 22),
  'kv-terminal': F('filing_cabinet', 1, 1, 14),
  'kv-rack': F('filing_cabinet', 1, 1, 20),
  'kv-av-desk': F('coffee_table', 2, 1, 20),
  'kv-cubbies': F('bookshelf', 2, 1, 20),
  'kv-phone': F('filing_cabinet', 1, 1, 6),
  'kv-hammock': F('reception_desk', 3, 1, 14),
  'kv-info': F('filing_cabinet', 1, 1, 18),
  'kv-telescope': F('filing_cabinet', 1, 1, 14),
  'kv-timer': F('filing_cabinet', 1, 1, 12),
  'kv-clothes': F('bookshelf', 2, 1, 20),
  'kv-stand-mirror': F('filing_cabinet', 1, 1, 22),
  'kv-archive': F('filing_cabinet', 1, 1, 10),
  'kv-easel-org': F('filing_cabinet', 1, 1, 22),
  'kv-easel-cal': F('filing_cabinet', 1, 1, 22),
  'kv-easel-chart': F('filing_cabinet', 1, 1, 22),
  // ---- parede
  'kv-orgchart': Wl('shelf_wall', 3),
  'kv-orgchart-big': Wl('shelf_wall', 4),
  'kv-orgchart-small': Wl('shelf_wall', 2),
  'kv-presence': Wl('shelf_wall', 2),
  'kv-map': Wl('shelf_wall', 3),
  'kv-calendar': Wl('shelf_wall', 2),
  'kv-chart': Wl('shelf_wall', 3),
  'kv-bigtv': Wl('tv', 3),
  'kv-bell': Wl('clock', 1),
  'kv-keys': Wl('shelf_wall', 2),
  'kv-vanity': Wl('mirror', 1),
  'kv-blueprint': Wl('shelf_wall', 2),
  'kv-av-panel': Wl('shelf_wall', 2),
  'kv-gear': Wl('clock', 1),
} as const satisfies Record<string, KvSpriteDims>;

export type KvSpriteKey = keyof typeof KV_SPRITES;

/** Medidas de um item nosso (undefined: não é `kv-*`). */
export function kvSpriteDims(variant: string | undefined): KvSpriteDims | undefined {
  return variant && variant.startsWith('kv-') ? (KV_SPRITES as Record<string, KvSpriteDims>)[variant] : undefined;
}
