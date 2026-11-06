// Fork Kaviski (KAVISKI-HUMANOS.md → "ir e fazer"): janela aberta/fechada (go-and-do-model.ts) e as preferências da
// pessoa na página (humanos/prefs.ts).
import { describe, expect, it } from 'vitest';
import { KvOpenWatch } from './go-and-do-model';
import { KV_PREFS_LOCAL, KvPrefsStore } from '../humanos/prefs';

describe('KvOpenWatch', () => {
  it('a janela nova abre e depois fecha', () => {
    const w = new KvOpenWatch(new Set(['velha']), 0);
    expect(w.update(10, ['velha'], null)).toBe('unknown');
    expect(w.update(300, ['velha', 'pessoas'], null)).toBe('open');
    expect(w.update(5000, ['velha', 'pessoas'], null)).toBe('open');
    expect(w.update(6000, ['velha'], null)).toBe('closed');
  });
  it('janela que aparece tarde (depois da folga) não conta como a da ação', () => {
    const w = new KvOpenWatch(new Set<string>(), 0, 1500);
    expect(w.update(3000, ['cartao'], null)).toBe('unknown');
    expect(w.update(3100, [], null)).toBe('unknown');
  });
  it('a janela redesenhada (outro elemento) continua aberta', () => {
    const w = new KvOpenWatch(new Set<string>(), 0);
    expect(w.update(100, ['a'], null)).toBe('open');
    expect(w.update(4000, ['b'], null)).toBe('open');
    expect(w.update(4100, [], null)).toBe('closed');
  });
  it('pelo botão: ligou e desligou', () => {
    const w = new KvOpenWatch(new Set<string>(), 0);
    expect(w.update(10, [], false)).toBe('unknown');
    expect(w.update(20, [], true)).toBe('open');
    expect(w.update(9000, [], true)).toBe('open');
    expect(w.update(9100, [], false)).toBe('closed');
  });
});

function memory(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('KvPrefsStore', () => {
  it('sem conta: padrão desligado e salvo no navegador', async () => {
    const storage = memory();
    const s = new KvPrefsStore({ fetch: async () => reply(403, { error: 'x' }), storage });
    await s.load();
    expect(s.inAccount).toBe(false);
    expect(s.get().abrirAoChegar).toBe(false);
    expect(await s.set({ abrirAoChegar: true })).toBe(true);
    expect(JSON.parse(storage.data.get(KV_PREFS_LOCAL)!)).toEqual({ abrirAoChegar: true });
    expect(new KvPrefsStore({ fetch: async () => reply(403, {}), storage }).get().abrirAoChegar).toBe(true);
  });
  it('com conta: lê e grava no servidor', async () => {
    const calls: { method: string; body?: string }[] = [];
    let saved = { abrirAoChegar: true };
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined });
      if (init?.method === 'POST') saved = { ...saved, ...(JSON.parse(init.body as string).prefs as object) };
      return reply(200, { prefs: saved });
    }) as typeof fetch;
    const storage = memory();
    const s = new KvPrefsStore({ fetch: fetchImpl, storage });
    const seen: boolean[] = [];
    s.on((p) => seen.push(p.abrirAoChegar));
    await s.load();
    expect(s.inAccount).toBe(true);
    expect(s.get().abrirAoChegar).toBe(true);
    expect(await s.set({ abrirAoChegar: false })).toBe(true);
    expect(calls.at(-1)).toEqual({ method: 'POST', body: JSON.stringify({ prefs: { abrirAoChegar: false } }) });
    expect(s.get().abrirAoChegar).toBe(false);
    expect(seen).toEqual([true, false, false]);
    expect(storage.data.size).toBe(0);
  });
  it('a conta recusou: vale nesta página e fica no navegador', async () => {
    let n = 0;
    const s = new KvPrefsStore({ fetch: (async () => (n++ === 0 ? reply(200, { prefs: {} }) : reply(500, {}))) as typeof fetch, storage: memory() });
    await s.load();
    expect(await s.set({ abrirAoChegar: true })).toBe(false);
    expect(s.get().abrirAoChegar).toBe(true);
  });
  it('valor inválido não muda nada', async () => {
    const s = new KvPrefsStore({ fetch: async () => reply(403, {}), storage: memory() });
    expect(await s.set({ abrirAoChegar: 'sim' as unknown as boolean })).toBe(false);
    expect(s.get().abrirAoChegar).toBe(false);
  });
});
