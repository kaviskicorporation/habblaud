// Fork Kaviski (KAVISKI-HUMANOS.md): links seguros, dias, agrupamento e salas em que estive (chat-format.ts).
import { describe, expect, it } from 'vitest';
import { kvDayLabel, kvLinkify, kvParseRooms, kvRememberRoom, kvSameGroup, kvWhen } from './chat-format';

describe('links nas conversas', () => {
  it('só http(s) e www viram link; o resto fica texto', () => {
    expect(kvLinkify('veja https://kaviski.com.br/x?a=1 agora')).toEqual([
      { t: 'text', v: 'veja ' },
      { t: 'link', v: 'https://kaviski.com.br/x?a=1', href: 'https://kaviski.com.br/x?a=1' },
      { t: 'text', v: ' agora' },
    ]);
    expect(kvLinkify('www.google.com')).toEqual([{ t: 'link', v: 'www.google.com', href: 'https://www.google.com' }]);
    expect(kvLinkify('javascript:alert(1) data:text/html,oi')).toEqual([{ t: 'text', v: 'javascript:alert(1) data:text/html,oi' }]);
    expect(kvLinkify('<img src=x onerror=1>')).toEqual([{ t: 'text', v: '<img src=x onerror=1>' }]);
  });
  it('pontuação do fim não entra no link; parêntese com par entra', () => {
    expect(kvLinkify('olha http://a.com.')[1]).toEqual({ t: 'link', v: 'http://a.com', href: 'http://a.com' });
    expect(kvLinkify('(http://a.com/x)')[1]).toMatchObject({ v: 'http://a.com/x' });
    expect(kvLinkify('https://pt.wikipedia.org/wiki/Teste_(x)')[0]).toMatchObject({ v: 'https://pt.wikipedia.org/wiki/Teste_(x)' });
  });
});

describe('datas e grupos', () => {
  const now = new Date(2026, 10, 6, 15, 0).getTime();
  it('hoje, ontem e o dia por extenso', () => {
    expect(kvDayLabel(new Date(2026, 10, 6, 9, 0).getTime(), now)).toBe('Hoje');
    expect(kvDayLabel(new Date(2026, 10, 5, 23, 59).getTime(), now)).toBe('Ontem');
    expect(kvDayLabel(new Date(2026, 10, 3, 10, 0).getTime(), now)).toMatch(/3/);
    expect(kvWhen(now - 10_000, now)).toBe('agora');
    expect(kvWhen(new Date(2026, 10, 5, 10, 0).getTime(), now)).toBe('ontem');
  });
  it('agrupa falas seguidas da mesma pessoa (até 5 min, no mesmo dia)', () => {
    const t = new Date(2026, 10, 6, 10, 0).getTime();
    expect(kvSameGroup(null, { from: 'a', at: t })).toBe(false);
    expect(kvSameGroup({ from: 'a', at: t }, { from: 'a', at: t + 60_000 })).toBe(true);
    expect(kvSameGroup({ from: 'a', at: t }, { from: 'b', at: t + 60_000 })).toBe(false);
    expect(kvSameGroup({ from: 'a', at: t }, { from: 'a', at: t + 6 * 60_000 })).toBe(false);
    const late = new Date(2026, 10, 6, 23, 58).getTime();
    expect(kvSameGroup({ from: 'a', at: late }, { from: 'a', at: late + 3 * 60_000 })).toBe(false);
  });
});

describe('salas em que estive', () => {
  it('só salas de projeto, a mais recente primeiro, sem repetir', () => {
    let l = kvRememberRoom([], 'r:a', 1);
    l = kvRememberRoom(l, 'c', 2);
    l = kvRememberRoom(l, 'r:b', 3);
    l = kvRememberRoom(l, 'r:a', 4);
    expect(l).toEqual([
      { area: 'r:a', at: 4 },
      { area: 'r:b', at: 3 },
    ]);
    expect(kvRememberRoom(Array.from({ length: 12 }, (_, i) => ({ area: `r:${i}`, at: i })), 'r:x', 99)).toHaveLength(12);
  });
  it('lê o guardado sem confiar no formato', () => {
    expect(kvParseRooms('lixo')).toEqual([]);
    expect(kvParseRooms('{"a":1}')).toEqual([]);
    expect(kvParseRooms('[{"area":"r:a","at":1},{"area":"a:core:copa","at":2},{"x":1}]')).toEqual([{ area: 'r:a', at: 1 }]);
  });
});
