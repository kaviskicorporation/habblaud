// Fork Kaviski (KAVISKI.md): logotipo "Kubo" em pixels no topo e na abertura, no lugar do "Habblaud" do original.
// Mesma fonte bitmap e mesma sombra de 1 px (gerado com a fonte de scripts/assets/pixelart.py, como o original):
// c = "Ku" (creme), t = "bo" (azul das janelas acesas da logo), s = sombra.
import { KV_PRODUTO } from '../../../shared/kaviski-marca';
import { pixelIcon } from '../ui/icons';

export const KV_WORDMARK_ROWS = [
  'c...c.......t..........',
  'c..cs.......t..........',
  'c.cs..c...c.tttt...ttt.',
  'ccs...c...c.tssst.tssst',
  'csc...c...c.t...t.t...t',
  'c.sc..c...c.t...t.t...t',
  'c..sc.scccc.tttts.sttts',
  's...s..ssss.ssss...sss.',
] as const;

export const KV_WORDMARK = pixelIcon(KV_WORDMARK_ROWS, { s: 'rgba(6, 8, 14, 0.62)', c: '#f4f1ea', t: '#7cc8ff' }, 'ui-wordmark');

export { KV_PRODUTO };
