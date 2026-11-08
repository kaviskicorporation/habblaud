// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): acesso por pasta, envio, versões, documentos, ligação com
// reuniões (inclusive a privada), lixeira e a rota HTTP (conteúdo numa sandbox).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import type { KvMeeting } from '../../../shared/kaviski-meetings';
import { kvCleanFileName, kvCleanTags, kvFileKind, kvFileSize, kvMarkdown, kvUniqueName, type KvFilesState } from '../../../shared/kaviski-files';
import { setQuiet } from '../../log';
import { tempDir } from '../../test/fixtures';
import { KvFiles, kvFilesRoute } from './files';

setQuiet(true);

const person = (id: string, role: KvPerson['role']): KvPerson => ({ id, user: id, name: id.toUpperCase(), role, rooms: [] });
const adm = person('adm', 'admin');
const bia = person('bia', 'equipe');
const ana = person('ana', 'equipe');
const rarm = person('rarm', 'cliente');
const vis = person('vis', 'visitante');
const b64 = (s: string) => Buffer.from(s).toString('base64');

const meetings: Record<string, KvMeeting> = {
  m1: { id: 'm1', room: 'r', title: 'Kickoff', start: 1000, end: 2000, by: { id: 'bia', name: 'BIA' }, people: ['rarm'], private: false, createdAt: 0, updatedAt: 0 },
  m2: { id: 'm2', room: 'r', title: 'Salários', start: 1000, end: 2000, by: { id: 'adm', name: 'ADM' }, people: ['bia'], private: true, createdAt: 0, updatedAt: 0 },
};

function make(dir: string | null = null) {
  let t = 1_000_000;
  const fs = new KvFiles({ dir, now: () => (t += 1000), meeting: (id) => meetings[id], people: () => [adm, bia, ana, rarm].map((p) => ({ id: p.id, name: p.name, role: p.role })) });
  return fs;
}

const ok = <T>(r: { ok: true; value: T } | { ok: false; status: number; error: string }): T => {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.value;
};

describe('contrato puro', () => {
  it('nomes, etiquetas, tipos e tamanhos', () => {
    expect(kvCleanFileName('  a/b\\c.pdf ')).toBe('a b c.pdf');
    expect(kvCleanFileName('..')).toBeUndefined();
    expect(kvCleanFileName(`${'x'.repeat(200)}.docx`)!.endsWith('.docx')).toBe(true);
    expect(kvCleanTags(['#Contrato', 'contrato', ' RH ', 3])).toEqual(['contrato', 'rh']);
    expect(kvFileKind('a.PDF')).toBe('pdf');
    expect(kvFileKind('x', 'image/png')).toBe('imagem');
    expect(kvFileKind('ata.md', '', 'doc')).toBe('doc');
    expect(kvFileSize(1536)).toBe('1,5 KB');
    expect(kvUniqueName('Ata.md', ['ata.md', 'Ata (2).md'])).toBe('Ata (3).md');
  });

  it('markdown escapa o HTML e só aceita links http/https/mailto', () => {
    const html = kvMarkdown('# Oi <b>\n- [x] feito\n- item **forte**\n\n[x](javascript:alert(1)) [ok](https://a.b)\n```\n<script>\n```');
    expect(html).toContain('<h1>Oi &lt;b&gt;</h1>');
    expect(html).toContain('is-done');
    expect(html).toContain('<strong>forte</strong>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="https://a.b"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('KvFiles', () => {
  it('pastas: equipe, todos e pessoas; o cliente só vê o que é dele', () => {
    const fs = make();
    const eq = ok(fs.createFolder(bia, { name: 'Interno' }));
    const all = ok(fs.createFolder(bia, { name: 'Clientes', access: 'todos' }));
    const ppl = ok(fs.createFolder(adm, { name: 'RH', access: 'pessoas', people: ['ana'] }));
    const inside = ok(fs.createFolder(bia, { name: 'Sub', parent: eq.id, access: 'todos' }));
    const names = (p: KvPerson) => fs.state(p).folders.map((f) => f.name).sort();
    expect(names(bia)).toEqual(['Clientes', 'Interno', 'Sub']); // RH: só ana e admin
    expect(names(ana)).toEqual(['Clientes', 'Interno', 'RH', 'Sub']);
    expect(names(rarm)).toEqual(['Clientes']); // Sub é "todos", mas está dentro de uma pasta da equipe
    expect(names(vis)).toEqual([]);
    expect(fs.createFolder(rarm, { name: 'X' }).ok).toBe(false); // cliente não cria na raiz
    expect(ok(fs.createFolder(rarm, { name: 'Do cliente', parent: all.id })).access).toBe('todos');
    expect(fs.updateFolder(bia, ppl.id, { name: 'y' }).ok).toBe(false);
    expect(fs.updateFolder(bia, eq.id, { parent: inside.id }).ok).toBe(false); // dentro dela mesma
  });

  it('envio, nova versão, voltar versão e o espaço usado', () => {
    const fs = make();
    const f = ok(fs.upload(bia, { name: 'proposta.pdf', folder: null, data: b64('v1') }));
    expect(f.mime).toBe('application/pdf');
    expect(fs.state(rarm).files).toHaveLength(0); // raiz é da equipe
    ok(fs.upload(ana, { name: 'proposta-final.pdf', replace: f.id, data: b64('versao2') }));
    expect(f.version).toBe(2);
    expect(f.versions[0]).toMatchObject({ n: 1, size: 2 });
    ok(fs.revert(bia, f.id, { version: 1 }));
    expect(f.version).toBe(3);
    expect(fs.readText(f.blob)).toBe('v1');
    expect(fs.used()).toBe(2 + 7 + 2);
    expect(fs.upload(vis, { name: 'a.txt', data: b64('x') }).ok).toBe(false);
    expect(f.name).toBe('proposta.pdf'); // voltar a versão volta o nome dela
    const dup = ok(fs.upload(bia, { name: 'proposta.pdf', data: b64('z') }));
    expect(dup.name).toBe('proposta (2).pdf');
  });

  it('documento: cria com .md, salva (sem versão a cada tecla) e só a equipe/autor muda', () => {
    const fs = make();
    const d = ok(fs.createDoc(bia, { name: 'Ata', text: '# Ata' }));
    expect(d.name).toBe('Ata.md');
    ok(fs.update(bia, d.id, { text: '# Ata\n- um' }));
    expect(d.version).toBe(2);
    ok(fs.update(bia, d.id, { text: '# Ata\n- um\n- dois' })); // mesma pessoa logo em seguida: mesma versão
    expect(d.version).toBe(2);
    ok(fs.update(ana, d.id, { text: 'outra' }));
    expect(d.version).toBe(3);
    expect(fs.update(rarm, d.id, { text: 'x' }).ok).toBe(false);
  });

  it('reunião: quem é da reunião vê o arquivo; privada mostra o título só para quem é dela', () => {
    const fs = make();
    const all = ok(fs.createFolder(adm, { name: 'Diretoria', access: 'pessoas', people: [] }));
    const f = ok(fs.upload(adm, { name: 'pauta.txt', folder: all.id, data: b64('p'), meeting: 'm1' }));
    expect(fs.state(rarm).files.map((x) => x.id)).toEqual([f.id]); // rarm é convidado do m1
    expect(fs.state(ana).files).toHaveLength(0);
    const g = ok(fs.upload(bia, { name: 'folha.xlsx', data: b64('x') }));
    ok(fs.link(bia, g.id, { meeting: 'm2' })); // bia é convidada da privada
    expect(fs.state(bia).files.find((x) => x.id === g.id)!.meetings[0]!.title).toBe('Salários');
    expect(fs.state(ana).files.find((x) => x.id === g.id)!.meetings[0]!.title).toBe('Reunião privada');
    expect(fs.link(ana, g.id, { meeting: 'm2' }).ok).toBe(true); // já ligada: nada muda
    const h = ok(fs.upload(ana, { name: 'x.txt', data: b64('x') }));
    expect(fs.link(ana, h.id, { meeting: 'm2' }).ok).toBe(false); // ana não é da privada
    expect(fs.upload(rarm, { name: 'y.txt', data: b64('y'), folder: null, meeting: 'm1' }).ok).toBe(false); // raiz
  });

  it('lixeira: restaura, apaga de vez só da lixeira e some sozinha depois de 30 dias', () => {
    let t = 0;
    const fs = new KvFiles({ dir: null, now: () => t });
    const f = ok(fs.upload(bia, { name: 'a.txt', data: b64('a') }));
    expect(fs.purge(bia, f.id).ok).toBe(false);
    ok(fs.trash(ana, f.id, true));
    expect(fs.state(bia).trash).toHaveLength(1);
    expect(fs.purge(ana, f.id).ok).toBe(false); // ana não enviou nem é admin
    ok(fs.trash(bia, f.id, false));
    ok(fs.trash(bia, f.id, true));
    t += 31 * 86_400_000;
    fs.sweep();
    expect(fs.get(f.id)).toBeUndefined();
  });

  it('grava no disco e relê', () => {
    const dir = join(tempDir().dir, 'files');
    const fs = make(dir);
    const fd = ok(fs.createFolder(bia, { name: 'P' }));
    const f = ok(fs.upload(bia, { name: 'a.txt', folder: fd.id, data: b64('olá') }));
    expect(readdirSync(join(dir, 'blobs'))).toHaveLength(1);
    const again = make(dir);
    again.load();
    expect(again.readText(again.get(f.id)!.blob)).toBe('olá');
    ok(again.trash(bia, f.id, true));
    ok(again.purge(bia, f.id));
    expect(existsSync(join(dir, 'blobs', f.blob))).toBe(false);
  });
});

describe('rota', () => {
  let server: http.Server | null = null;
  afterEach(() => server?.close());

  async function start(fs: KvFiles, who: KvPerson | undefined) {
    server = http.createServer((req, res) => kvFilesRoute(req, res, new URL(req.url!, 'http://x'), { files: fs, whoIs: () => who }));
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/kaviski/humanos/files`;
  }

  it('envia, lista e devolve o conteúdo (HTML vira texto puro numa sandbox)', async () => {
    const fs = make();
    const base = await start(fs, bia);
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const r = await post('/upload', { name: 'x.html', data: b64('<script>alert(1)</script>') });
    expect(r.status).toBe(201);
    const { file } = (await r.json()) as { file: { id: string } };
    const st = (await (await fetch(base)).json()) as KvFilesState;
    expect(st.files.map((f) => f.name)).toEqual(['x.html']);
    const raw = await fetch(`${base}/${file.id}/raw`);
    expect(raw.headers.get('content-type')).toBe('application/octet-stream');
    expect(raw.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(raw.headers.get('content-security-policy')).toContain('sandbox');
    expect(await raw.text()).toBe('<script>alert(1)</script>');
    expect((await fetch(`${base}/nada/raw`)).status).toBe(404);
    expect((await post('/nada/trash', {})).status).toBe(404);
  });

  it('sem conta: 403', async () => {
    const base = await start(make(), undefined);
    expect((await fetch(base)).status).toBe(403);
  });
});
