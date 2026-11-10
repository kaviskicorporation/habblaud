import { describe, expect, it } from 'vitest';
import { kvMaxPessoas } from './cloud';

describe('kvMaxPessoas (Voxtrin Cloud)', () => {
  it('sem a variável: o limite de sempre', () => {
    expect(kvMaxPessoas(50, {})).toEqual({ contas: 50, total: 50 });
    expect(kvMaxPessoas(50, { HABBLAUD_MAX_PESSOAS: 'x' })).toEqual({ contas: 50, total: 50 });
  });
  it('o plano conta a dona (conta do .env)', () => {
    expect(kvMaxPessoas(50, { HABBLAUD_MAX_PESSOAS: '1' })).toEqual({ contas: 0, total: 1 });
    expect(kvMaxPessoas(50, { HABBLAUD_MAX_PESSOAS: '5' })).toEqual({ contas: 4, total: 5 });
  });
  it('nunca passa do limite do código', () => {
    expect(kvMaxPessoas(10, { HABBLAUD_MAX_PESSOAS: '20' }).contas).toBe(10);
  });
});
