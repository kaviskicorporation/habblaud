import { describe, expect, it } from 'vitest';
import { KV_PRODUTO, kvProduto } from './kaviski-marca';

describe('kvProduto (fork Kaviski: nome do produto)', () => {
  it('troca Habblaud pelo nome do produto', () => {
    expect(KV_PRODUTO).toBe('Kubo');
    expect(kvProduto('O Habblaud foi atualizado.', true)).toBe('O Kubo foi atualizado.');
    expect(kvProduto('Habblaud v{0}. Habblaud', true)).toBe('Kubo v{0}. Kubo');
  });

  it('mantém o Habblaud World (serviço de terceiros) e os nomes técnicos', () => {
    expect(kvProduto('Seu prédio está aceso no Habblaud World.', true)).toBe('Seu prédio está aceso no Habblaud World.');
    expect(kvProduto('neste Habblaud (HABBLAUD_WORLD_URL) e no Habblaud World', true)).toBe('neste Kubo (HABBLAUD_WORLD_URL) e no Habblaud World');
    expect(kvProduto('~/.habblaud e npm run mod:install', true)).toBe('~/.habblaud e npm run mod:install');
  });

  it('nos testes do original fica desligado (os textos seguem iguais)', () => {
    expect(kvProduto('O Habblaud foi atualizado.')).toBe('O Habblaud foi atualizado.');
    expect(kvProduto('O Habblaud foi atualizado.', false)).toBe('O Habblaud foi atualizado.');
  });
});
