// Fork Kaviski (KAVISKI.md): logotipo do Voxtrin (o do site, voxtrin.com) no topo e na abertura, no lugar do "Habblaud"
// em pixels do original. A imagem (assets/brand/wordmark.png) já traz o "V" do símbolo: enquanto o logotipo aparece, o
// símbolo separado do topo some (kaviski-marca.css); nas telas estreitas, em que o original esconde o nome, volta só o "V".
import { KV_PRODUTO } from '../../../shared/kaviski-marca';
import './kaviski-marca.css';

/** Proporção do wordmark.png (largura / altura), para o navegador reservar o espaço antes de a imagem chegar. */
const RATIO = 392 / 96;

export const KV_WORDMARK = `<img class="ui-wordmark kv-wordmark" src="/assets/brand/wordmark.png" alt="" width="${Math.round(24 * RATIO)}" height="24" draggable="false" decoding="async">`;

export { KV_PRODUTO };
