// Fork Kaviski (KAVISKI-HUMANOS.md → "Cartão da pessoa"): as ações a mais do cartão da pessoa (grupo "Mais"), no
// registro comum (person-actions.ts). Cada uma só aparece quando o servidor a aceitaria para quem está nesta página:
// - Enviar arquivo: sobe o arquivo na Sala de Arquivos numa pasta só das duas pessoas ("Compartilhados: Ana e Bia",
//   acesso "pessoas escolhidas"; criada na primeira vez) e manda na conversa 1:1 o nome e o link (`?arquivo=<id>`).
//   Equipe e admin: sempre (a pasta é criada); cliente: só se a pasta de vocês dois já existe (cliente não cria pasta na
//   raiz); visitante: nunca (só lê). Também não para um visitante (não tem conta para entrar no acesso da pasta).
// - Arquivos compartilhados: abre essa pasta na Sala de Arquivos (quando existe).
// - Marcar reunião: abre Reuniões → Marcar já com a pessoa convidada (só quem pode marcar e só quem tem conta).
// - Ver no organograma: abre o organograma com a pessoa destacada (quando ela está nele).
// - Copiar nome.
import { kvRestricted, type KvMe } from '../../../../shared/kaviski-humanos';
import type { KvPresencePerson } from '../../../../shared/kaviski-presence';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvFiles, kvFilesLoaded, kvFilesPost, kvOnFiles, kvReloadFiles, kvUploadFile } from './files/files-api';
import { kvOpenFiles } from './files/files-dialog';
import { FILES_ICON } from './files/files-ui';
import { kvMeetings, kvOnMeetings } from './meetings-api';
import { kvOpenMeetings, MEET_ICON } from './meetings-dialog';
import { kvOnOrg, kvOrgOf } from './org-api';
import { kvOpenOrgChart } from './org-chart';
import { KV_ORG_ICONS } from './org-icons';
import { kvOpenDirect } from './chat';
import { KV_CARD_ICONS } from './person-card-icons';
import { kvFirstName, kvSharedFolder } from './person-card-model';
import { kvNotifyPersonActions, kvRegisterPersonAction } from './person-actions';
import type { KvPresenceClient } from './presence';
import { KV_ICONS } from './ui/icons';
import { kvToast } from './ui/toast';

/** A pasta só nossa (com a Sala de Arquivos carregada). */
function sharedFolder(client: KvPresenceClient, other: string) {
  const me = client.state?.me ?? '';
  return kvFilesLoaded() ? kvSharedFolder(kvFiles().folders, me, other) : undefined;
}

/** Endereço que abre o arquivo na Sala de Arquivos (files/index.ts trata o `?arquivo=`). */
function fileLink(id: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('arquivo', id);
  return u.toString();
}

/** Garante a pasta das duas pessoas (cria se for preciso e se der). Devolve o id ou o erro. */
async function ensureFolder(client: KvPresenceClient, me: KvMe, p: KvPresencePerson): Promise<{ id: string } | { error: string }> {
  if (!kvFilesLoaded()) await kvReloadFiles();
  const found = sharedFolder(client, p.id);
  if (found) return { id: found.id };
  const myId = client.state?.me;
  if (!myId || kvRestricted(me.person)) return { error: tr('Só a equipe cria a pasta compartilhada. Peça para {0} mandar um arquivo primeiro.', [kvFirstName(p.name)]) };
  const name = tr('Compartilhados: {0} e {1}', [kvFirstName(me.person?.name ?? ''), kvFirstName(p.name)]);
  const r = await kvFilesPost<{ id: string }>('/folders', { name, parent: null, access: 'pessoas', people: [myId, p.id] });
  if (!r.ok || !r.body.id) return { error: r.body.error ?? tr('Não deu para criar a pasta compartilhada.') };
  return { id: r.body.id };
}

/** Sobe os arquivos na pasta das duas pessoas e manda cada um na conversa 1:1. */
async function sendFiles(client: KvPresenceClient, me: KvMe, p: KvPresencePerson, files: File[]): Promise<void> {
  if (!files.length) return;
  const close = kvToast(files.length === 1 ? tr('Enviando {0} para {1}…', [files[0]!.name, kvFirstName(p.name)]) : tr('Enviando {0} arquivos para {1}…', [files.length, kvFirstName(p.name)]), { kind: 'info', ms: 0, key: `pc-send:${p.id}` });
  const folder = await ensureFolder(client, me, p);
  if ('error' in folder) {
    close();
    kvToast(folder.error, { kind: 'error' });
    return;
  }
  let sent = 0;
  for (const file of files) {
    const up = await kvUploadFile(file, { folder: folder.id });
    if (up.error || !up.file) {
      kvToast(up.error ?? tr('Não deu para enviar {0}.', [file.name]), { kind: 'error' });
      continue;
    }
    const err = await client.direct(p.id, tr('📎 Enviei o arquivo {0}: {1}', [up.file.name.slice(0, 120), fileLink(up.file.id)]));
    if (err) {
      kvToast(tr('{0} foi para a pasta compartilhada, mas a mensagem não foi: {1}', [up.file.name, err === 'offline' ? tr('sem conexão') : err]), { kind: 'warn' });
      continue;
    }
    sent++;
  }
  close();
  if (sent) {
    kvToast(sent === 1 ? tr('Arquivo enviado para {0}.', [kvFirstName(p.name)]) : tr('{0} arquivos enviados para {1}.', [sent, kvFirstName(p.name)]), {
      kind: 'ok',
      action: { label: tr('Abrir conversa'), run: () => kvOpenDirect(p.id) },
    });
  }
}

function pickFiles(onPick: (files: File[]) => void): void {
  const input = h('input', { type: 'file', attrs: { multiple: true, hidden: true } });
  input.addEventListener('change', () => {
    onPick([...(input.files ?? [])]);
    input.remove();
  });
  document.body.append(input);
  input.click();
  // sem escolha (cancelar) o input fica até a próxima vez: some depois de um tempo
  setTimeout(() => input.remove(), 10 * 60_000);
}

export function kvStartPersonCardMore(me: KvMe, client: KvPresenceClient): void {
  const person = me.person;
  if (!person) return;
  const visitor = person.role === 'visitante';
  const team = !kvRestricted(person);
  const isOther = (p: KvPresencePerson) => p.id !== client.state?.me;
  // o cartão redesenha quando o que decide as ações muda
  kvOnFiles(() => kvNotifyPersonActions());
  kvOnMeetings(() => kvNotifyPersonActions());
  kvOnOrg(() => kvNotifyPersonActions());

  if (!visitor) {
    kvRegisterPersonAction({
      id: 'enviar-arquivo',
      label: tr('Enviar arquivo'),
      svg: KV_CARD_ICONS.upload,
      order: 70,
      group: 'more',
      when: (p) => {
        if (!isOther(p) || p.role === 'visitante') return false;
        if (!kvFilesLoaded()) void kvReloadFiles(); // a primeira vez que o cartão abre: carrega e redesenha
        return team || !!sharedFolder(client, p.id);
      },
      run: (p) => pickFiles((files) => void sendFiles(client, me, p, files)),
    });
    kvRegisterPersonAction({
      id: 'arquivos-compartilhados',
      label: tr('Arquivos compartilhados'),
      svg: FILES_ICON,
      order: 71,
      group: 'more',
      when: (p) => isOther(p) && !!sharedFolder(client, p.id),
      run: (p) => {
        const f = sharedFolder(client, p.id);
        if (f) kvOpenFiles({ folder: f.id });
      },
    });
  }
  kvRegisterPersonAction({
    id: 'marcar-reuniao',
    label: tr('Marcar reunião'),
    svg: MEET_ICON,
    order: 72,
    group: 'more',
    when: (p) => isOther(p) && kvMeetings().canBook && !!kvMeetings().people?.some((x) => x.id === p.id),
    run: (p) => kvOpenMeetings({ tab: 'marcar', people: [p.id] }),
  });
  kvRegisterPersonAction({
    id: 'ver-organograma',
    label: tr('Ver no organograma'),
    svg: KV_ORG_ICONS.org,
    order: 80,
    group: 'more',
    when: (p) => !!kvOrgOf(p.id),
    run: (p) => kvOpenOrgChart({ focus: `u:${p.id}` }),
  });
  kvRegisterPersonAction({
    id: 'copiar-nome',
    label: tr('Copiar nome'),
    svg: KV_ICONS.copy,
    order: 90,
    group: 'more',
    keepOpen: true,
    when: () => typeof navigator !== 'undefined' && !!navigator.clipboard,
    run: (p) =>
      void navigator.clipboard.writeText(p.name).then(
        () => kvToast(tr('Nome copiado: {0}', [p.name]), { kind: 'ok', ms: 2_500 }),
        () => kvToast(tr('Não deu para copiar.'), { kind: 'error' }),
      ),
  });
}
