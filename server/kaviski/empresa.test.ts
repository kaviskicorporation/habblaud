import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KvEmpresa, kvEmpresaNome, kvSetEmpresaAtual } from './empresa';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'kv-empresa-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  kvSetEmpresaAtual(undefined);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('nome da empresa (Configurações › Empresa)', () => {
  it('vale o HABBLAUD_BRAND até alguém gravar um nome; vazio volta ao padrão', () => {
    const file = join(tmp(), 'kaviski', 'empresa.json');
    const e = new KvEmpresa(file, 'Kaviski Corporation');
    e.load();
    expect(e.get()).toBe('Kaviski Corporation');
    expect(e.set('  Voxtrin   Labs ')).toBe('Voxtrin Labs');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ nome: 'Voxtrin Labs' });
    const again = new KvEmpresa(file, 'Kaviski Corporation');
    again.load();
    expect(again.get()).toBe('Voxtrin Labs');
    expect(again.set('')).toBe('Kaviski Corporation');
  });

  it('limpa controles e corta no limite', () => {
    const e = new KvEmpresa(null, undefined);
    expect(e.set('A\u0000B\nC')).toBe('A B C');
    expect(e.set('x'.repeat(200))?.length).toBe(60);
    expect(e.set(42)).toBeUndefined();
  });

  it('kvEmpresaNome: a instância ligada vence; sem ela, o HABBLAUD_BRAND do env', () => {
    expect(kvEmpresaNome({ HABBLAUD_BRAND: 'Env' })).toBe('Env');
    const e = new KvEmpresa(null, undefined);
    e.set('Gravada');
    kvSetEmpresaAtual(e);
    expect(kvEmpresaNome({ HABBLAUD_BRAND: 'Env' })).toBe('Gravada');
  });
});
