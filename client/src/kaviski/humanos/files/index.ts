// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): liga a Sala de Arquivos nesta página — o botão no topo (grupo
// Escritório; o "ir e fazer" leva o avatar até o balcão da sala de arquivos), o fluxo `files` da presença e o link
// direto `?arquivo=<id>` (o "Copiar link" dos detalhes).
import type { KvMe } from '../../../../../shared/kaviski-humanos';
import { tr } from '../../../../../shared/i18n';
import type { KvPresenceClient } from '../presence';
import { kvTopButton } from '../topbar';
import { kvFiles, kvReloadFiles, kvStartFilesStore } from './files-api';
import { kvOpenFiles } from './files-dialog';
import { FILES_ICON } from './files-ui';

export { kvOpenFiles };

export function kvStartFiles(m: KvMe, client: KvPresenceClient, root: ParentNode = document): void {
  if (!m.person || m.person.role === 'visitante') return;
  kvStartFilesStore(client);
  const btn = kvTopButton(FILES_ICON, tr('Sala de Arquivos'), () => kvOpenFiles(), 'kv-btn-files', 27, root);
  btn?.setAttribute('aria-haspopup', 'dialog');
  const url = new URL(location.href);
  const id = url.searchParams.get('arquivo');
  if (id) {
    url.searchParams.delete('arquivo');
    history.replaceState(history.state, '', url.toString());
    void kvReloadFiles().then(() => {
      const f = [...kvFiles().files, ...kvFiles().trash].find((x) => x.id === id);
      kvOpenFiles(f ? { folder: f.folder, file: f.id } : {});
    });
  }
}
