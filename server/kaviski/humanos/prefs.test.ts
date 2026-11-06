// Fork Kaviski (KAVISKI-HUMANOS.md → "ir e fazer"): preferências por pessoa (prefs.ts, shared/kaviski-prefs.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KV_PREFS_DEFAULT, KV_PREFS_PATH, kvParsePrefs, kvPrefsOf } from '../../../shared/kaviski-prefs';
import { kvSavePrefs } from './prefs';
import { closeAll, json, login, start } from './test-harness';

afterEach(closeAll);

describe('preferências: formato', () => {
  it('só as chaves conhecidas, com o tipo certo', () => {
    expect(kvParsePrefs({ abrirAoChegar: true, outra: 1 })).toEqual({ abrirAoChegar: true });
    expect(kvParsePrefs({})).toEqual({});
    expect(kvParsePrefs({ abrirAoChegar: 'sim' })).toBeUndefined();
    expect(kvParsePrefs(null)).toBeUndefined();
    expect(kvParsePrefs([true])).toBeUndefined();
    expect(kvParsePrefs('x')).toBeUndefined();
  });
  it('o padrão é abrir na hora', () => {
    expect(KV_PREFS_DEFAULT.abrirAoChegar).toBe(false);
    expect(kvPrefsOf(undefined)).toEqual({ abrirAoChegar: false });
    expect(kvPrefsOf({ abrirAoChegar: 3 })).toEqual({ abrirAoChegar: false });
    expect(kvPrefsOf({ abrirAoChegar: true })).toEqual({ abrirAoChegar: true });
  });
  it('gravar junta com o perfil sem apagar o resto', () => {
    const profiles = new Map<string, Record<string, unknown>>([['u1', { look: { x: 1 }, desk: 'd' }]]);
    const deps = {
      profile: (id: string) => ({ ...(profiles.get(id) ?? {}) }),
      setProfile: (id: string, p: Record<string, unknown>) => (profiles.has(id) ? (profiles.set(id, p), true) : false),
    };
    expect(kvSavePrefs('u1', { abrirAoChegar: true }, deps)).toEqual({ abrirAoChegar: true });
    expect(profiles.get('u1')).toEqual({ look: { x: 1 }, desk: 'd', prefs: { abrirAoChegar: true } });
    expect(kvSavePrefs('u1', {}, deps)).toEqual({ abrirAoChegar: true });
    expect(kvSavePrefs('u1', { abrirAoChegar: 0 }, deps)).toBeNull();
    expect(kvSavePrefs('ninguem', { abrirAoChegar: true }, deps)).toBe(false);
  });
});

describe('preferências: rota', () => {
  it('cada pessoa lê e grava as suas; sem login, recusa', async () => {
    const h = await start();
    const admin = await login(h, 'kavisvi', 'senha-do-admin');
    const r = await fetch(`${h.base}/api/kaviski/humanos/users`, {
      method: 'POST',
      headers: { ...json, cookie: admin },
      body: JSON.stringify({ user: 'ana', role: 'equipe', password: 'senha-da-ana' }),
    });
    expect(r.ok).toBe(true);
    const ana = await login(h, 'ana', 'senha-da-ana');

    const get = async (cookie: string) => (await (await fetch(`${h.base}${KV_PREFS_PATH}`, { headers: { cookie } })).json()) as { prefs: unknown };
    expect((await get(ana)).prefs).toEqual({ abrirAoChegar: false });

    const post = (cookie: string, body: unknown) => fetch(`${h.base}${KV_PREFS_PATH}`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify(body) });
    const ok = await post(ana, { prefs: { abrirAoChegar: true } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ prefs: { abrirAoChegar: true } });
    expect((await get(ana)).prefs).toEqual({ abrirAoChegar: true });
    // a do admin continua no padrão
    expect((await get(admin)).prefs).toEqual({ abrirAoChegar: false });

    expect((await post(ana, { prefs: { abrirAoChegar: 'sim' } })).status).toBe(400);
    expect((await post(ana, { prefs: 'x' })).status).toBe(400);
    expect((await fetch(`${h.base}${KV_PREFS_PATH}`, { method: 'DELETE', headers: { ...json, cookie: ana } })).status).toBe(405);

    // fica no users.json, no perfil da pessoa
    const file = JSON.parse(readFileSync(join(h.dataDir, 'kaviski', 'users.json'), 'utf8')) as { users: { user: string; profile?: { prefs?: unknown } }[] };
    expect(file.users.find((u) => u.user === 'ana')?.profile?.prefs).toEqual({ abrirAoChegar: true });

    // sem login pela porta remota: não chega na rota
    expect((await fetch(`${h.base}${KV_PREFS_PATH}`)).ok).toBe(false);
    // acesso local (sem login) é o admin embutido
    expect(((await (await fetch(`${h.localBase}${KV_PREFS_PATH}`)).json()) as { prefs: unknown }).prefs).toEqual({ abrirAoChegar: false });
  });
});
