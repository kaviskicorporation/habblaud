// Fork Kaviski (KAVISKI-HUMANOS.md): as partes puras do kit de interface e da tela de Pessoas.
import { describe, expect, it } from 'vitest';
import { kvFilterOptions } from './select';
import { kvGeneratePassword, kvInitials, kvPxSafe } from './kit';
import { kvRoomShort, kvValidatePerson } from '../people';

describe('kit de interface', () => {
  it('filtra opções sem acento nem caixa, também pelas palavras extras', () => {
    const opts = [
      { value: 'a', label: 'Recepção' },
      { value: 'b', label: '12-Rarm', keywords: '/home/x/Clientes/12-Rarm' },
      { value: 'c', label: 'Copa', hint: 'área comum' },
    ];
    expect(kvFilterOptions(opts, 'recepcao').map((o) => o.value)).toEqual(['a']);
    expect(kvFilterOptions(opts, 'CLIENTES').map((o) => o.value)).toEqual(['b']);
    expect(kvFilterOptions(opts, 'area').map((o) => o.value)).toEqual(['c']);
    expect(kvFilterOptions(opts, '  ')).toHaveLength(3);
  });

  it('só usa a fonte em pixel quando ela deixa ler (sem C maiúsculo nem dígitos)', () => {
    expect(kvPxSafe('Pessoas no escritório')).toBe(true);
    expect(kvPxSafe('Conversas')).toBe(false);
    expect(kvPxSafe('Sala 5')).toBe(false);
  });

  it('iniciais e senha gerada', () => {
    expect(kvInitials('Ana Souza')).toBe('AS');
    expect(kvInitials('Bruno (Cliente)')).toBe('BR');
    expect(kvInitials('x')).toBe('X');
    const pw = kvGeneratePassword();
    expect(pw).toHaveLength(14);
    expect(pw).not.toMatch(/[0O1lI]/);
  });
});

describe('formulário de Pessoas', () => {
  const ctx = { editing: false, builtin: false, taken: (u: string) => u === 'ana' };
  it('exige usuário válido e livre e senha na criação', () => {
    expect(kvValidatePerson({ user: '', name: '', password: '', role: 'cliente' }, ctx)).toMatchObject({ user: expect.any(String), password: expect.any(String) });
    expect(kvValidatePerson({ user: 'Ana!', name: '', password: 'x'.repeat(8), role: 'cliente' }, ctx).user).toBeTruthy();
    expect(kvValidatePerson({ user: 'ana', name: '', password: 'x'.repeat(8), role: 'cliente' }, ctx).user).toBeTruthy();
    expect(kvValidatePerson({ user: 'ana.rarm', name: '', password: 'curta', role: 'cliente' }, ctx).password).toBeTruthy();
    expect(kvValidatePerson({ user: 'ana.rarm', name: 'Ana', password: 'x'.repeat(8), role: 'cliente' }, ctx)).toEqual({});
  });
  it('na edição a senha em branco mantém a atual; a conta do .env não pede senha', () => {
    expect(kvValidatePerson({ user: 'ana', name: 'Ana', password: '', role: 'equipe' }, { ...ctx, editing: true })).toEqual({});
    expect(kvValidatePerson({ user: 'ana', name: '', password: '', role: 'equipe' }, { ...ctx, editing: true }).name).toBeTruthy();
    expect(kvValidatePerson({ user: 'adm', name: 'Adm', password: '', role: 'admin' }, { ...ctx, editing: true, builtin: true })).toEqual({});
  });
  it('nome curto da pasta da sala', () => {
    expect(kvRoomShort('/home/hostadmin/projetos/Clientes/12-Rarm')).toBe('Clientes/12-Rarm');
    expect(kvRoomShort('/x')).toBe('x');
  });
});
