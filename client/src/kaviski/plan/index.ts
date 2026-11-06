// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): liga a planta na página (só com pessoas no escritório): a planta
// gravada (store.ts) e o editor da empresa (editor.ts) para quem pode editar.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { KvPresenceClient } from '../humanos/presence';
import { kvPeople } from '../humanos/world';
import { kvSetSavedPlan, kvStartPlanEngine } from './engine';
import { kvOnPlanDoc, kvSavedPlan, kvStartPlanStore } from './store';

export function kvStartPlan(_me: KvMe, client: KvPresenceClient | null): void {
  kvStartPlanStore(client);
  // motor do prédio (frente A): o prédio do mundo passa a ser a planta gravada (e o rascunho do editor)
  kvStartPlanEngine(() => kvPeople.sim?.() ?? null);
  kvSetSavedPlan(kvSavedPlan());
  kvOnPlanDoc(() => kvSetSavedPlan(kvSavedPlan()));
}
