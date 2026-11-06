// Fork Kaviski (KAVISKI-HUMANOS.md): registro de quem aprovou, pediu ou mexeu no quê (fase 3).
//
// Cada ação de uma pessoa nos agentes (mandar mensagem, responder permissão, abrir agente novo, terminal interativo,
// encerrar/assumir, editar personagem, renomear sala, chamar agente) vira uma linha em <dataDir>/kaviski/audit.jsonl
// (permissão 600; acima de 5 MB vira audit.jsonl.1). A tela de Pessoas (admin) mostra as últimas.
//
// Como saber o que foi pedido sem mexer nas rotas originais: o corpo JSON da requisição é copiado enquanto passa
// (`kvTapBody`: um ouvinte de `data` a mais, posto antes da rota original, que lê o mesmo corpo no mesmo instante) e a
// linha é gravada quando a resposta termina, com o código dela (deu certo ou não).
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KvPerson } from '../../../shared/kaviski-humanos';

export interface KvAuditEntry {
  at: number;
  who: { id: string; name: string; role: string };
  action: string;
  agent?: { id: string; name?: string; room?: string };
  detail?: string;
  ok: boolean;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_BODY = 64 * 1024;
const DETAIL_MAX = 300;

/** Copia o corpo (até 64 kB) enquanto a rota original o lê; `done` recebe o texto quando a resposta termina. */
export function kvTapBody(req: IncomingMessage, res: ServerResponse, done: (body: string, status: number) => void): void {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size <= MAX_BODY) chunks.push(c);
  });
  res.on('finish', () => done(size <= MAX_BODY ? Buffer.concat(chunks).toString('utf8') : '', res.statusCode));
}

export function kvShort(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s;
}

export class KvAudit {
  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  add(who: KvPerson, action: string, extra: { agent?: KvAuditEntry['agent']; detail?: string; ok: boolean }): KvAuditEntry {
    const e: KvAuditEntry = { at: this.now(), who: { id: who.id, name: who.name, role: who.role }, action, ...extra };
    if (!this.file) return e;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      if (existsSync(this.file) && statSync(this.file).size > MAX_BYTES) renameSync(this.file, `${this.file}.1`);
      appendFileSync(this.file, `${JSON.stringify(e)}\n`, { mode: 0o600 });
      chmodSync(this.file, 0o600);
    } catch {
      // sem disco: o registro desta ação se perde (a ação em si já aconteceu)
    }
    return e;
  }

  /** As últimas `n` linhas, da mais nova para a mais velha. */
  recent(n = 300): KvAuditEntry[] {
    if (!this.file || !existsSync(this.file)) return [];
    try {
      const lines = readFileSync(this.file, 'utf8').trim().split('\n').slice(-n);
      const out: KvAuditEntry[] = [];
      for (const l of lines) {
        try {
          out.push(JSON.parse(l) as KvAuditEntry);
        } catch {
          // linha quebrada
        }
      }
      return out.reverse();
    } catch {
      return [];
    }
  }
}
