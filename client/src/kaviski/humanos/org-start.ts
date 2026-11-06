// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre" → "Organograma e agentes fixos"): liga o organograma na página —
// carrega os dados, põe os agentes fixos nas mesas, o botão Organograma no topo, a ação "ir e fazer" 'organograma'
// (o quadro do RH e da diretoria) e os ganchos entre o organograma, a tela Pessoas e o formulário do agente fixo.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { KvOrgAgent } from '../../../../shared/kaviski-org';
import { kvRestricted } from '../../../../shared/kaviski-humanos';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { kvRegisterAction } from '../plan/api';
import { kvLoadOrg, kvOrg } from './org-api';
import { kvOpenOrgChart, kvOrgHooks, kvSetOrgStore } from './org-chart';
import { KV_ORG_ICONS } from './org-icons';
import { KvFixedAgentForm } from './fixed-agents-form';
import { kvFixedMatches, kvFixedRoomId, kvGoToFixedSeat, kvStartFixedAgents } from './fixed-agents';
import { kvOpenPeople, kvPeopleOrgHooks } from './people';
import { kvTopButton } from './topbar';
import { kvPeople } from './world';

export { kvOpenOrgChart };

export function kvStartOrg(me: KvMe, store: OfficeStore, root: ParentNode = document): void {
  kvSetOrgStore(store);
  const team = !kvRestricted(me.person);
  const admin = !!me.local || me.person?.role === 'admin';
  let form: KvFixedAgentForm | null = null;
  const edit = (a: Partial<KvOrgAgent> | null) => (form ??= new KvFixedAgentForm(store)).open(a ?? { match: 'main' });
  const byId = (id: string) => kvOrg()?.agents.find((a) => a.id === id);
  kvStartFixedAgents(store, (d) => edit(d), () => team && !!kvOrg()?.can);
  kvOrgHooks.editAgent = (id) => {
    const a = byId(id);
    if (a) edit(a);
  };
  kvOrgHooks.newAgent = () => edit(null);
  if (admin) kvOrgHooks.editPerson = (id) => kvOpenPeople('contas', id);
  kvPeopleOrgHooks.edit = (a) => edit(a);
  kvPeopleOrgHooks.goSeat = (a) => void kvGoToFixedSeat(a);
  kvPeopleOrgHooks.roomName = (id) => store.liveSnapshot?.rooms.find((r) => r.id === kvFixedRoomId(id))?.name;
  kvPeopleOrgHooks.live = (a) => {
    const sim = kvPeople.sim?.();
    const id = kvFixedMatches(sim).get(a.id);
    return id ? sim?.chars.get(id)?.info : undefined;
  };
  // botão no topo (o "Mais" leva quando não cabe) e a ação do quadro do organograma nas salas temáticas
  kvTopButton(KV_ORG_ICONS.org, tr('Organograma: pessoas e agentes de IA'), () => kvOpenOrgChart(), 'kv-btn-org', 58, root)?.setAttribute('aria-haspopup', 'dialog');
  kvRegisterAction({ key: 'organograma', label: tr('Ver o organograma'), icon: 'org', run: () => kvOpenOrgChart(), pose: 'read' });
  void kvLoadOrg();
  Object.assign((window as { habblaud?: object }).habblaud ?? {}, { kvOrg: { doc: kvOrg, open: kvOpenOrgChart } });
}
