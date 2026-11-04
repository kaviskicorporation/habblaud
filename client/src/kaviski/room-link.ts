// Fork Kaviski (KAVISKI.md): link direto para a sala. `/?sala=<caminho da pasta do projeto>` (ou `?room=`) seleciona a
// sala e leva a câmera até ela assim que ela aparece no escritório; se ainda não existe, espera até WAIT_MS pelos
// snapshots seguintes. Sem o parâmetro, não faz nada. Usado como URL do painel Browser de cada projeto no TwiCC.
import { kvFindRoom, kvRoomParam } from '../../../shared/kaviski';
import type { OfficeStore } from '../net/store';
import type { WorldApi } from '../world/api';

const WAIT_MS = 15_000;
/** O mundo monta a sala no quadro seguinte ao snapshot; a segunda passada pega a câmera já com a área livre certa. */
const FOCUS_DELAYS = [250, 1200];

export function kvStartRoomLink(search: string, store: OfficeStore, world: WorldApi): void {
  const want = kvRoomParam(search);
  if (!want) return;
  const until = Date.now() + WAIT_MS;
  let done = false;
  let off: (() => void) | null = null;
  const tryFocus = (): void => {
    if (done) return;
    if (Date.now() > until) return finish();
    const room = kvFindRoom(store.liveSnapshot?.rooms ?? [], want);
    if (!room) return;
    done = true;
    finish();
    for (const ms of FOCUS_DELAYS) setTimeout(() => world.select({ type: 'room', id: room.id }, { focus: true }), ms);
  };
  const finish = (): void => {
    off?.();
    off = null;
  };
  off = store.on('snapshot', tryFocus);
  tryFocus();
  // desiste mesmo sem snapshot novo
  setTimeout(finish, WAIT_MS + 50);
}
