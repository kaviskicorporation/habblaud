// Fork Kaviski (KAVISKI-HUMANOS.md): liga as partes do boneco (onda Gather, W1): modo foco (focus.ts), móveis e mesa
// fixa (furniture.ts), Seguir/Teleportar/Ir até a mesa (goto.ts) e os controles de toque (touch.ts). Um só gancho no
// index.ts.
import type { OfficeStore } from '../../net/store';
import { kvStartClassic } from './classic';
import { kvSetRoomNames, kvStartFurniture } from './furniture';
import { kvStartGoto } from './goto';
import { kvStartTouch } from './touch';
import './w1.css';

export function kvStartW1(store: OfficeStore, root: ParentNode = document): { ready(warn: (text: string) => void): void } {
  // antes da lista de online: ela mostra o botão do modo foco já com o estado guardado
  kvStartClassic(true, root);
  kvSetRoomNames((id) => store.liveSnapshot?.rooms.find((r) => r.id === id)?.name);
  return {
    ready(warn) {
      kvStartFurniture(warn);
      kvStartGoto(warn);
      kvStartTouch();
    },
  };
}
