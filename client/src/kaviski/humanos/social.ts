// Fork Kaviski (KAVISKI-HUMANOS.md, "recursos do Gather" W2): liga, na página, o status com nota (status.ts), os
// avisos fora da aba (alerts.ts), o Chamar (ring.ts), as reações rápidas (reactions.ts), trancar a sala / bater na
// porta (locks.ts) e a roda de conversa privada (bubble.ts). Os botões novos entram na barra do topo (KvBar) e no
// sino do topo (alerts.ts); o editor da nota entra na lista de quem está online. Um gancho em humanos/index.ts.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { kvStartAlerts } from './alerts';
import type { KvBar } from './bar';
import { KvBubble } from './bubble';
import { KvLocks } from './locks';
import type { KvPresenceClient } from './presence';
import { KvReactions } from './reactions';
import { kvStartRing } from './ring';
import { KvStatusEditor, kvStartStatus, kvClearStatus, kvSetStatus, kvStatusNow } from './status';
import './social.css';

export function kvStartSocial(client: KvPresenceClient, bar: KvBar, store: OfficeStore, me: KvMe): void {
  kvStartStatus();
  // a nota do status entra logo abaixo dos botões de status da lista de online
  const statusGroup = document.querySelector('.kv-online__status');
  if (statusGroup) statusGroup.after(new KvStatusEditor().el);
  kvStartAlerts(client, store, me.person?.user);
  kvStartRing(client, bar);
  const group = h('span', { class: 'kv-dock__social', role: 'group' });
  new KvReactions(client, bar).mount(group);
  new KvLocks(client, bar, store, me).mount(group);
  new KvBubble(client, bar).mount(group);
  bar.el.insertBefore(group, bar.media.nextSibling);
  // depuração e uso pelos outros módulos sem import (ex.: o console): habblaud.kvStatus
  Object.assign((window as { habblaud?: object }).habblaud ?? {}, { kvStatus: { set: kvSetStatus, clear: kvClearStatus, now: kvStatusNow } });
}
