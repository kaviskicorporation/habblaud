// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): o que cada vista mostra, a busca, o caminho e a ata.
import { describe, expect, it } from 'vitest';
import type { KvFileView, KvFolderView } from '../../../../../shared/kaviski-files';
import { kvAtaTemplate, kvByMeeting, kvFolderCount, kvFolderPath, kvSubfolders, kvVisibleFiles, type KvFilesQuery } from './files-model';

const who = { id: 'bia', name: 'Bia' };
const folder = (id: string, parent: string | null, name = id): KvFolderView => ({ id, name, parent, access: 'equipe', people: [], by: who, at: 0, canEdit: true });
const file = (id: string, o: Partial<KvFileView> = {}): KvFileView => ({
  id,
  name: `${id}.pdf`,
  folder: null,
  type: 'arquivo',
  kind: 'pdf',
  mime: 'application/pdf',
  size: 10,
  version: 1,
  versions: [],
  by: who,
  at: 0,
  updated: 0,
  updatedBy: who,
  tags: [],
  meetings: [],
  star: false,
  canEdit: true,
  ...o,
});

const folders = [folder('a', null, 'Comercial'), folder('b', 'a', 'Propostas'), folder('c', null, 'RH')];
const files = [
  file('x', { folder: 'a', updated: 3 }),
  file('y', { folder: 'b', name: 'Proposta Ação.docx', kind: 'documento', tags: ['cliente'], star: true }),
  file('z', { folder: null, kind: 'imagem', name: 'logo.png', by: { id: 'ana', name: 'Ana' }, meetings: [{ id: 'm1', title: 'Kickoff', start: 5 }] }),
  file('w', { folder: 'sumiu' }), // pasta que não vejo: aparece na raiz
];
const q = (o: Partial<KvFilesQuery>): KvFilesQuery => ({ nav: 'pasta', folder: null, text: '', kind: 'todos', sort: 'nome', me: 'bia', ...o });
const ids = (l: KvFileView[]) => l.map((f) => f.id).sort();

describe('Sala de Arquivos: vistas', () => {
  it('pasta, busca (sem acento, nas de dentro), favoritos, meus, documentos e reuniões', () => {
    const s = { files, trash: [], folders };
    expect(ids(kvVisibleFiles(s, q({})))).toEqual(['w', 'z']);
    expect(ids(kvVisibleFiles(s, q({ folder: 'a' })))).toEqual(['x']);
    expect(ids(kvVisibleFiles(s, q({ folder: 'a', text: 'acao' })))).toEqual(['y']);
    expect(ids(kvVisibleFiles(s, q({ text: 'kickoff' })))).toEqual(['z']);
    expect(ids(kvVisibleFiles(s, q({ nav: 'favoritos' })))).toEqual(['y']);
    expect(ids(kvVisibleFiles(s, q({ nav: 'meus' })))).toEqual(['w', 'x', 'y']);
    expect(ids(kvVisibleFiles(s, q({ nav: 'docs' })))).toEqual(['y']);
    expect(ids(kvVisibleFiles(s, q({ nav: 'reunioes' })))).toEqual(['z']);
    expect(ids(kvVisibleFiles(s, q({ kind: 'imagens', text: '' , nav: 'recentes' })))).toEqual(['z']);
  });

  it('caminho, subpastas, contagem e agrupamento por reunião', () => {
    expect(kvFolderPath('b', folders).map((f) => f.name)).toEqual(['Comercial', 'Propostas']);
    expect(kvSubfolders(null, folders).map((f) => f.id)).toEqual(['a', 'c']);
    expect(kvFolderCount('a', { files, folders })).toBe(2);
    expect(kvByMeeting(files)).toMatchObject([{ id: 'm1', title: 'Kickoff', files: [{ id: 'z' }] }]);
  });

  it('a ata traz a pauta, os participantes e as seções', () => {
    const L = { ata: 'Ata', date: 'Data', room: 'Sala', by: 'Organizador', people: 'Participantes', agenda: 'Pauta', notes: 'Anotações', decisions: 'Decisões', next: 'Próximos passos', who: 'quem', until: 'até' };
    const md = kvAtaTemplate({ title: 'Kickoff', when: '8 nov', room: 'Cabine', by: 'Bia', people: ['Ana'], note: 'Escopo\nPrazo' }, L);
    expect(md).toContain('# Ata: Kickoff');
    expect(md).toContain('- [ ] Ana');
    expect(md).toContain('- Escopo\n- Prazo');
    expect(md).toContain('## Próximos passos');
  });
});
