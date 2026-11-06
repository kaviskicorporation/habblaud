// Fork Kaviski (KAVISKI.md): nome da empresa definido pela tela (Configurações › Empresa), gravado em
// <dataDir>/kaviski/empresa.json. Vale no título da aba ("<empresa> · Voxtrin"), na tela de login e nos convites, nas
// notificações e no Sobre. HABBLAUD_BRAND continua como o valor inicial (enquanto ninguém gravou um nome pela tela).
//   GET  /api/kaviski/empresa        {nome, padrao, pode}: quem tem acesso à página vê
//   POST /api/kaviski/empresa {nome} troca (vazio volta ao HABBLAUD_BRAND): admin ou o próprio computador
import type { IncomingMessage, ServerResponse } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { kvBrand } from '../../shared/kaviski';
import { tr } from '../../shared/i18n';
import { HttpError, readJson, sendJson } from '../http/app';
import { log } from '../log';
import { kvPersonOf } from './humanos/request';

export const EMPRESA_PATH = '/api/kaviski/empresa';

let atual: KvEmpresa | undefined;

export class KvEmpresa {
  private nome: string | undefined;

  constructor(
    private readonly file: string | null,
    /** HABBLAUD_BRAND (limpo): vale enquanto não houver nome gravado. */
    readonly padrao: string | undefined,
  ) {}

  load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { nome?: unknown };
      this.nome = kvBrand(data.nome);
    } catch (err) {
      log.warn(tr('empresa.json ilegível ({0}); vale o HABBLAUD_BRAND.', [(err as Error).message]));
    }
  }

  /** O nome em uso: o gravado pela tela, senão o HABBLAUD_BRAND. */
  get(): string | undefined {
    return this.nome ?? this.padrao;
  }

  /** Grava o nome (vazio/inválido apaga e volta ao HABBLAUD_BRAND). Devolve o nome em uso. */
  set(nome: unknown): string | undefined {
    this.nome = kvBrand(nome);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ version: 1, ...(this.nome ? { nome: this.nome } : {}) }, null, 2)}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    }
    return this.get();
  }
}

/** Liga a empresa desta instância (createKaviski). */
export function kvSetEmpresaAtual(e: KvEmpresa | undefined): void {
  atual = e;
}

/** O nome da empresa em uso (a tela de login e as páginas do servidor perguntam aqui); sem nome gravado, HABBLAUD_BRAND. */
export function kvEmpresaNome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return atual?.get() ?? kvBrand(env.HABBLAUD_BRAND);
}

/** Trata /api/kaviski/empresa. `trusted` = pelo próprio computador; pela porta remota, só a conta admin grava. */
export function kvEmpresaRoute(req: IncomingMessage, res: ServerResponse, empresa: KvEmpresa, trusted: boolean, changed: () => void): void {
  const method = req.method ?? 'GET';
  const pode = trusted || kvPersonOf(req)?.role === 'admin';
  if (method === 'GET' || method === 'HEAD') {
    req.resume();
    sendJson(res, 200, { nome: empresa.get() ?? '', padrao: empresa.padrao ?? '', pode });
    return;
  }
  if (method !== 'POST') {
    req.resume();
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: tr('método não permitido') });
    return;
  }
  if (!pode) {
    req.resume();
    sendJson(res, 403, { error: tr('só quem é admin muda o nome da empresa') });
    return;
  }
  readJson(req)
    .then((body) => {
      const nome = (body as { nome?: unknown } | null)?.nome;
      if (nome !== undefined && typeof nome !== 'string') throw new HttpError(400, tr('nome inválido'));
      const agora = empresa.set(nome ?? '');
      changed();
      sendJson(res, 200, { ok: true, nome: agora ?? '', padrao: empresa.padrao ?? '', pode });
    })
    .catch((err) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else sendJson(res, 500, { error: tr('erro interno') });
    });
}
