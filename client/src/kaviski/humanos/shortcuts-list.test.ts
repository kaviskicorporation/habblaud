import { describe, expect, it } from 'vitest';
import { KV_SHORTCUTS, kvAddShortcuts, kvKeyName, kvKeyParts, kvShortcutHit } from './shortcuts-list';

describe('atalhos', () => {
  it('nomes das teclas', () => {
    expect(kvKeyName('ArrowLeft')).toBe('←');
    expect(kvKeyName('e')).toBe('E');
    expect(kvKeyName(' ')).toBe('Espaço');
    expect(kvKeyName('Escape')).toBe('Esc');
    expect(kvKeyParts('Ctrl+Shift+Z')).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(kvKeyParts('+')).toEqual(['+']);
  });
  it('experimente: tecla, combinação, faixa e modificadora', () => {
    expect(kvShortcutHit({ keys: ['E'], text: '' }, { key: 'e' })).toBe(true);
    expect(kvShortcutHit({ keys: ['E'], text: '' }, { key: 'e', ctrlKey: true })).toBe(false);
    expect(kvShortcutHit({ keys: ['Ctrl+Z'], text: '' }, { key: 'z', ctrlKey: true })).toBe(true);
    expect(kvShortcutHit({ keys: ['Ctrl+Z'], text: '' }, { key: 'z' })).toBe(false);
    expect(kvShortcutHit({ keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], text: '' }, { key: 'Z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(kvShortcutHit({ keys: ['1', '9'], range: true, text: '' }, { key: '5' })).toBe(true);
    expect(kvShortcutHit({ keys: ['1', '9'], range: true, text: '' }, { key: '0' })).toBe(false);
    expect(kvShortcutHit({ keys: ['Shift'], text: '' }, { key: 'Shift', shiftKey: true })).toBe(true);
    expect(kvShortcutHit({ keys: ['?'], text: '' }, { key: '?', shiftKey: true })).toBe(true);
    expect(kvShortcutHit({ keys: [{ m: 'clique' }], text: '' }, { key: 'c' })).toBe(false);
    expect(kvShortcutHit({ keys: ['←', '↑', '→', '↓'], text: '' }, { key: 'ArrowDown' })).toBe(true);
  });
  it('acrescentar: grupo novo, sem repetir', () => {
    const before = KV_SHORTCUTS.length;
    kvAddShortcuts('teste', [{ keys: ['X'], text: 'x' }], { title: 'Teste', color: '#ff0000' });
    kvAddShortcuts('teste', [{ keys: ['X'], text: 'x' }]);
    expect(KV_SHORTCUTS.length).toBe(before + 1);
    expect(KV_SHORTCUTS.at(-1)!.items).toHaveLength(1);
  });
});
