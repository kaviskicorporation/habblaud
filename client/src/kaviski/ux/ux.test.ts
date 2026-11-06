import { describe, expect, it } from 'vitest';
import { kvFold, kvMatchRange, kvMatchScore } from './match';
import { kvAwaySummary, kvGreeting } from './brief-model';
import { kvMergeInteract } from '../humanos/interact-model';

describe('busca rápida', () => {
  it('ignora acento e maiúscula', () => {
    expect(kvFold('Café da Manhã')).toBe('cafe da manha');
    expect(kvMatchScore('cafe', 'Tomar café')).toBeGreaterThan(0);
    expect(kvMatchScore('CAFÉ', 'tomar cafe')).toBeGreaterThan(0);
  });

  it('começo vale mais que o meio, que vale mais que letras soltas', () => {
    const start = kvMatchScore('sal', 'Sala de reunião');
    const word = kvMatchScore('reu', 'Sala de reunião');
    const mid = kvMatchScore('niã', 'Sala de reunião');
    const seq = kvMatchScore('sler', 'Sala de reunião');
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(seq);
    expect(seq).toBeGreaterThan(0);
    expect(kvMatchScore('xyz', 'Sala de reunião')).toBe(0);
    expect(kvMatchScore('caf', 'Company floor plan')).toBe(0);
    expect(kvMatchScore('cfe', 'Tomar café')).toBeGreaterThan(0);
  });

  it('todas as palavras precisam achar', () => {
    expect(kvMatchScore('ana sala', 'Ana · na sala FPF')).toBeGreaterThan(0);
    expect(kvMatchScore('ana cozinha', 'Ana · na sala FPF')).toBe(0);
  });

  it('marca o trecho no texto original', () => {
    expect(kvMatchRange('cafe', 'Tomar café')).toEqual([6, 10]);
    expect(kvMatchRange('zzz', 'Tomar café')).toBeNull();
  });
});

describe('resumo e saudação', () => {
  it('saudação pela hora', () => {
    expect(kvGreeting(new Date(2026, 0, 1, 8)).text).toBe('Bom dia');
    expect(kvGreeting(new Date(2026, 0, 1, 14)).text).toBe('Boa tarde');
    expect(kvGreeting(new Date(2026, 0, 1, 22)).text).toBe('Boa noite');
    expect(kvGreeting(new Date(2026, 0, 1, 3)).text).toBe('Boa noite');
  });

  it('o que mudou enquanto estava fora', () => {
    const before = new Map([
      ['a', 'working'],
      ['b', 'working'],
      ['c', 'idle'],
    ] as const);
    const now = [
      { id: 'a', name: 'Ana', status: 'done' },
      { id: 'b', name: 'Bia', status: 'waiting' },
      { id: 'c', name: 'Caio', status: 'idle' },
      { id: 'd', name: 'Davi', status: 'working' },
    ] as const;
    const s = kvAwaySummary(before, now);
    expect(s.finished.map((a) => a.id)).toEqual(['a']);
    expect(s.waiting.map((a) => a.id)).toEqual(['b']);
    expect(s.arrived.map((a) => a.id)).toEqual(['d']);
  });

  it('sem mudança, nada a dizer', () => {
    const s = kvAwaySummary(new Map([['a', 'working']]), [{ id: 'a', name: 'Ana', status: 'working' }]);
    expect(s.finished.length + s.waiting.length + s.arrived.length).toBe(0);
  });
});

describe('barra de ações (tecla E)', () => {
  const it0 = (id: string, dist: number) => ({ id, label: id, dist, run: () => {} });
  it('junta, tira repetidas (fica a mais perto) e ordena pela distância', () => {
    const out = kvMergeInteract([it0('b', 5), [it0('a', 1), it0('b', 2)], null, it0('c', 3)]);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('mostra no máximo o pedido', () => {
    expect(kvMergeInteract([[it0('a', 1), it0('b', 2), it0('c', 3)]], 2).map((c) => c.id)).toEqual(['a', 'b']);
  });
});
