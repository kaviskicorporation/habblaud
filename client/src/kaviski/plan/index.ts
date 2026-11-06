// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): liga a planta na página (só com pessoas no escritório): a planta
// gravada (store.ts) e o editor da empresa (editor.ts) para quem pode editar.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { KvPresenceClient } from '../humanos/presence';
import { kvStartPlanStore } from './store';

export function kvStartPlan(_me: KvMe, client: KvPresenceClient | null): void {
  kvStartPlanStore(client);
}
