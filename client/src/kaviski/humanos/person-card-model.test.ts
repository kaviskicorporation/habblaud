// Fork Kaviski (KAVISKI-HUMANOS.md → "Cartão da pessoa"): as partes puras do cartão arrastável.
import { describe, expect, it } from 'vitest';
import {
  KV_CARD_STORE,
  kvCardDefaultPos,
  kvCardIsSheet,
  kvClampCard,
  kvDragCard,
  kvFirstName,
  kvLoadCardMemory,
  kvSaveCardMemory,
  kvSharedFolder,
  kvSinceText,
  kvSplitActions,
} from './person-card-model';

const view = { w: 1200, h: 800 };
const size = { w: 340, h: 420 };

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

describe('cartão da pessoa: posição', () => {
  it('limita a posição para o cartão caber na tela', () => {
    expect(kvClampCard({ x: -50, y: -10 }, size, view)).toEqual({ x: 8, y: 8 });
    expect(kvClampCard({ x: 5000, y: 5000 }, size, view)).toEqual({ x: 1200 - 340 - 8, y: 800 - 420 - 8 });
    expect(kvClampCard({ x: 100.4, y: 200.6 }, size, view)).toEqual({ x: 100, y: 201 });
  });

  it('não passa para baixo da barra do topo', () => {
    expect(kvClampCard({ x: 100, y: 0 }, size, view, 52).y).toBe(52);
    expect(kvDragCard({ x: 100, y: 100 }, { x: 0, y: 0 }, { x: 0, y: -500 }, size, view, 52).y).toBe(52);
    expect(kvCardDefaultPos({ x: 600, y: 0 }, size, view, 90).y).toBe(90);
  });

  it('cartão mais alto que a tela: o topo fica visível', () => {
    expect(kvClampCard({ x: 10, y: 300 }, { w: 340, h: 2000 }, view).y).toBe(8);
  });

  it('abre perto do clique, abaixo da barra do topo, ou no meio sem clique', () => {
    expect(kvCardDefaultPos({ x: 600, y: 300 }, size, view)).toEqual({ x: 430, y: 316 });
    expect(kvCardDefaultPos({ x: 600, y: 0 }, size, view).y).toBe(70);
    expect(kvCardDefaultPos({ x: 0, y: 790 }, size, view)).toEqual({ x: 8, y: 372 });
    expect(kvCardDefaultPos(undefined, size, view)).toEqual({ x: 430, y: 190 });
  });

  it('arrasta pelo quanto o ponteiro andou, sem sair da tela', () => {
    expect(kvDragCard({ x: 100, y: 100 }, { x: 10, y: 10 }, { x: 60, y: 30 }, size, view)).toEqual({ x: 150, y: 120 });
    expect(kvDragCard({ x: 100, y: 100 }, { x: 10, y: 10 }, { x: -900, y: -900 }, size, view)).toEqual({ x: 8, y: 8 });
  });

  it('vira folha embaixo em tela estreita', () => {
    expect(kvCardIsSheet(390)).toBe(true);
    expect(kvCardIsSheet(1024)).toBe(false);
  });
});

describe('cartão da pessoa: memória', () => {
  it('lembra a posição e o fixado; padrão apaga', () => {
    const s = memStore();
    expect(kvLoadCardMemory(s)).toEqual({ pinned: false });
    kvSaveCardMemory({ pos: { x: 12.7, y: 40 }, pinned: true }, s);
    expect(kvLoadCardMemory(s)).toEqual({ pos: { x: 13, y: 40 }, pinned: true });
    kvSaveCardMemory({ pinned: false }, s);
    expect(s.raw.has(KV_CARD_STORE)).toBe(false);
  });

  it('ignora o que não tem formato', () => {
    const s = memStore();
    s.setItem(KV_CARD_STORE, '{nao é json');
    expect(kvLoadCardMemory(s)).toEqual({ pinned: false });
    s.setItem(KV_CARD_STORE, JSON.stringify({ pos: { x: 'a', y: 3 }, pinned: 'sim' }));
    expect(kvLoadCardMemory(s)).toEqual({ pinned: false });
    expect(kvLoadCardMemory(null)).toEqual({ pinned: false });
  });
});

describe('cartão da pessoa: ações e textos', () => {
  it('separa as principais das do "Mais", respeitando o group', () => {
    const list = [{ id: 'mensagem' }, { id: 'seguir' }, { id: 'chamar' }, { id: 'x', group: 'main' as const }, { id: 'ir-ate', group: 'more' as const }];
    const r = kvSplitActions(list);
    expect(r.main.map((a) => a.id)).toEqual(['mensagem', 'chamar', 'x']);
    expect(r.more.map((a) => a.id)).toEqual(['seguir', 'ir-ate']);
  });

  it('online há X', () => {
    const now = 10 * 24 * 3600_000;
    expect(kvSinceText(now - 20_000, now)).toBe('agora mesmo');
    expect(kvSinceText(now - 5 * 60_000, now)).toBe('há 5 min');
    expect(kvSinceText(now - 120 * 60_000, now)).toBe('há 2 h');
    expect(kvSinceText(now - 80 * 60_000, now)).toBe('há 1 h 20 min');
    expect(kvSinceText(now - 26 * 3600_000, now)).toBe('há 1 dia');
    expect(kvSinceText(now - 72 * 3600_000, now)).toBe('há 3 dias');
    expect(kvSinceText(now + 5000, now)).toBe('agora mesmo');
  });

  it('primeiro nome', () => {
    expect(kvFirstName('  Ana Maria Souza ')).toBe('Ana');
    expect(kvFirstName('Bia')).toBe('Bia');
  });
});

describe('cartão da pessoa: pasta compartilhada só entre duas pessoas', () => {
  const f = (id: string, o: Partial<{ parent: string | null; access: string; people: string[]; by: string; at: number }> = {}) => ({
    id,
    parent: o.parent ?? null,
    access: o.access ?? 'pessoas',
    people: o.people ?? [],
    by: { id: o.by ?? 'eu' },
    at: o.at ?? 1,
  });

  it('acha a pasta de nós dois (quem criou conta), a mais antiga', () => {
    const list = [
      f('outra-pessoa', { people: ['eu', 'ana', 'bia'] }),
      f('equipe', { access: 'equipe', people: ['ana'] }),
      f('dentro', { parent: 'x', people: ['ana'] }),
      f('nova', { people: ['eu', 'ana'], at: 5 }),
      f('dela', { by: 'ana', people: ['eu'], at: 3 }),
    ];
    expect(kvSharedFolder(list, 'eu', 'ana')?.id).toBe('dela');
    expect(kvSharedFolder(list, 'ana', 'eu')?.id).toBe('dela');
    expect(kvSharedFolder(list, 'eu', 'bia')).toBeUndefined();
    expect(kvSharedFolder(list, 'eu', 'eu')).toBeUndefined();
  });
});
