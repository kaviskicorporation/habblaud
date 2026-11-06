// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): liga os extras da voz e do vídeo (só com o LiveKit
// configurado; media.ts kvStartMedia chama): menus do microfone e da câmera, palco, grade ampliada e anel de quem fala.
import type { KvBar } from './bar';
import type { KvMedia } from './media';
import { kvAttachMediaMenus } from './media-menu';
import { KvMediaGrid } from './media-grid';
import { KvSpeaking } from './media-speak';
import { KvStageClient } from './media-stage';
import { kvPeople } from './world';
import './media.css';

export function kvStartMediaExtras(media: KvMedia, bar: KvBar): void {
  kvAttachMediaMenus(media);
  const grid = new KvMediaGrid(media, bar);
  const client = kvPeople.client;
  const stage = client ? new KvStageClient(media, bar, client) : null;
  new KvSpeaking(media, () => stage?.room ?? null);
  // depuração pelo console (window.habblaud.kvMedia)
  Object.assign((window as { habblaud?: object }).habblaud ?? {}, { kvMedia: { media, grid, stage } });
}
