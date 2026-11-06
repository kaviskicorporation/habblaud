// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): liga a planta na página (só com pessoas no escritório): a planta
// gravada (store.ts) e o editor da empresa (editor.ts) para quem pode editar.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { OfficeStore } from '../../net/store';
import type { KvPresenceClient } from '../humanos/presence';
import { kvPeople } from '../humanos/world';
import { kvSetSavedPlan, kvStartPlanEngine } from './engine';
import { kvOnPlanDoc, kvSavedPlan, kvStartPlanStore } from './store';
import { kvStartPlanEditor } from './editor';

export function kvStartPlan(me: KvMe, client: KvPresenceClient | null, store: OfficeStore | null = null): void {
  kvStartPlanStore(client);
  // motor do prédio (frente A): o prédio do mundo passa a ser a planta gravada (e o rascunho do editor)
  kvStartPlanEngine(() => kvPeople.sim?.() ?? null);
  kvSetSavedPlan(kvSavedPlan());
  kvOnPlanDoc(() => kvSetSavedPlan(kvSavedPlan()));
  // editor da empresa (frente B): botão no topo e a ação "planta" para quem pode editar
  kvStartPlanEditor(me, store);
}
