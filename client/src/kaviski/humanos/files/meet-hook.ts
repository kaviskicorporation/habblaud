// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): o botão "Arquivos da reunião" no cartão de cada reunião
// (meetings-dialog.ts), com o número de arquivos ligados. Abre a Sala de Arquivos já na reunião (pauta, ata, enviar).
import { tr } from '../../../../../shared/i18n';
import { kvIconBtn } from '../ui/kit';
import { kvFiles, kvFilesLoaded, kvReloadFiles } from './files-api';
import { kvOpenFiles } from './files-dialog';
import { FILES_ICON } from './files-ui';

export function kvMeetFilesButton(meetingId: string, closeFirst: () => void): HTMLButtonElement {
  if (!kvFilesLoaded()) void kvReloadFiles();
  const n = kvFiles().files.filter((f) => f.meetings.some((m) => m.id === meetingId)).length;
  const label = n ? tr('Arquivos da reunião ({0})', [n]) : tr('Arquivos da reunião: pauta, ata, apresentações');
  const b = kvIconBtn(FILES_ICON, label, () => (closeFirst(), kvOpenFiles({ meeting: meetingId })), { size: 'sm', cls: n ? 'kv-meet-files has-files' : 'kv-meet-files' });
  if (n) b.dataset.count = String(n);
  return b;
}
