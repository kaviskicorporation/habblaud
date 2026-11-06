// Fork Kaviski (KAVISKI.md, "Detalhes de UX"): os detalhes que fazem o escritório parecer pensado para quem usa —
// Busca rápida (Ctrl+K), saudação do dia, resumo de quando você volta e botões que respondem ao toque.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { OfficeStore } from '../../net/store';
import { kvStartBrief } from './brief';
import { kvStartSpotlight } from './spotlight';
import './ux.css';

export function kvStartUx(store: OfficeStore, me: KvMe, root: ParentNode = document): void {
  kvStartSpotlight(store, me, root);
  kvStartBrief(store, me);
}
