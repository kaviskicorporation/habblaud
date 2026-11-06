// Fork Kaviski (KAVISKI-HUMANOS.md): salas próprias, objetos de parede e decoração — o começo (chamado por
// humanos/index.ts quando há uma pessoa nesta página). O botão Salas fica no topo só para a equipe (cliente não cria).
import type { KvMe } from '../../../../shared/kaviski-humanos';
import { tr } from '../../../../shared/i18n';
import { pixelIcon } from '../../ui/icons';
import { kvStartObjects } from './objects';
import type { KvPresenceClient } from './presence';
import { KvRoomsDialog } from './rooms-dialog';
import { kvStartRooms } from './rooms';
import { kvTopButton } from './topbar';
import './salas.css';

const ROOMS_ICON = pixelIcon(['############', '#....#.....#', '#....#.....#', '#..........#', '#....#.....#', '######..####', '#....#.....#', '#....#.....#', '############']);

export function kvStartSalas(m: KvMe, client: KvPresenceClient): void {
  const person = m.person;
  if (!person) return;
  kvStartRooms(client);
  kvStartObjects(client, person);
  if (person.role !== 'admin' && person.role !== 'equipe') return;
  let dialog: KvRoomsDialog | null = null;
  const btn = kvTopButton(ROOMS_ICON, tr('Salas: a sua sala, reuniões e descanso'), () => void (dialog ??= new KvRoomsDialog(person)).open(), 'kv-btn-salas', 60);
  btn?.setAttribute('aria-haspopup', 'dialog');
}
