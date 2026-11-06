// Fork Kaviski (KAVISKI-HUMANOS.md): convites por link, agenda, modo foco, mini-mapa, atalhos, boas-vindas e a dica de
// quem está na sala. Ligados por humanos/index.ts (uma linha) quando HABBLAUD_HUMANOS está ligado.
import { kvRestricted, type KvMe } from '../../../../shared/kaviski-humanos';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { pixelIcon } from '../../ui/icons';
import { kvStartAgenda } from './agenda';
import { kvStartFocus } from './focus';
import { InvitesDialog } from './invites';
import { KvMinimap } from './minimap';
import { kvOpenProfile } from './online';
import { kvStartRoomHover } from './room-hover';
import { kvInjectHelp, KvShortcutsDialog } from './shortcuts';
import { kvTopButton } from './topbar';
import { kvShowWelcome, kvWelcomeSeen } from './welcome';
import './extras.css';

const INVITE_ICON = pixelIcon(['##########', '##......##', '#.#....#.#', '#..#..#..#', '#...##...#', '#........#', '##########']);

export function kvStartExtras(me: KvMe, store: OfficeStore, root: ParentNode = document): void {
  const p = me.person;
  const team = !kvRestricted(p);
  if (me.local || (p && team)) {
    let invites: InvitesDialog | null = null;
    kvTopButton(INVITE_ICON, tr('Convidar visitantes (link)'), () => void (invites ??= new InvitesDialog()).open(), 'kv-btn-invite', 35, root)?.setAttribute('aria-haspopup', 'dialog');
  }
  if (!p) return;
  const visitor = p.role === 'visitante';
  kvStartAgenda({ mine: !visitor, root });
  kvStartFocus(root);
  const tour = () =>
    kvShowWelcome({ personId: p.id, name: p.name, visitor, restricted: !team, openProfile: () => kvOpenProfile(), openKeys: () => keys.open() });
  const keys = new KvShortcutsDialog(team, tour);
  new KvMinimap(store, () => keys.open());
  kvInjectHelp(team);
  kvStartRoomHover(store);
  if (!kvWelcomeSeen(p.id)) setTimeout(tour, 1200);
  if (visitor) watchVisit();
}

/** Visitante: quando o convite vence ou é revogado, a página recarrega e o servidor mostra "a sua visita terminou". */
function watchVisit(): void {
  const check = async () => {
    try {
      const res = await fetch('/api/kaviski/humanos/me', { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 401) location.reload();
    } catch {
      // sem conexão: tenta de novo
    }
  };
  setInterval(() => void check(), 30_000);
}
