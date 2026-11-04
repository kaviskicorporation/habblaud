import { describe, expect, it } from 'vitest';
import { kvColor, kvFindRoom, kvGroup, kvProjectId, kvRoomParam, kvTextOn, kvTwiccBase, kvTwiccSessionUrl } from './kaviski';

const BASE = 'http://192.168.1.220:3500';
const SID = '79c4a4d2-306e-40f9-b437-62c5c6ab3bc1';
const CWD = '/home/hostadmin/projetos/Server/01-Server/01.Geral';

describe('URL do TwiCC', () => {
  it('base: só http(s), sem barra no fim', () => {
    expect(kvTwiccBase('http://192.168.1.220:3500/')).toBe(BASE);
    expect(kvTwiccBase('https://twicc.lan/sub/')).toBe('https://twicc.lan/sub');
    expect(kvTwiccBase('javascript:alert(1)')).toBeUndefined();
    expect(kvTwiccBase('http://u:p@x')).toBeUndefined();
    expect(kvTwiccBase('')).toBeUndefined();
  });

  it('id do projeto = cwd com o que não é letra/número trocado por "-"', () => {
    expect(kvProjectId(CWD)).toBe('-home-hostadmin-projetos-Server-01-Server-01-Geral');
    expect(kvProjectId('/home/x/Clientes/00-Vitor_Kaviski/11.Otimiza_Hub/')).toBe('-home-x-Clientes-00-Vitor-Kaviski-11-Otimiza-Hub');
    expect(kvProjectId('/demo/loja')).toBeUndefined();
    expect(kvProjectId('relativo')).toBeUndefined();
    expect(kvProjectId(`/${'a'.repeat(250)}`)).toBeUndefined();
  });

  it('sessão do Claude Code (principal e sub) e do Codex (só principal)', () => {
    const want = `${BASE}/project/-home-hostadmin-projetos-Server-01-Server-01-Geral/session/${SID}`;
    expect(kvTwiccSessionUrl(BASE, { kind: 'main', cwd: CWD, sessionId: SID })).toBe(want);
    expect(kvTwiccSessionUrl(BASE, { kind: 'sub', cwd: CWD, sessionId: SID })).toBe(want);
    expect(kvTwiccSessionUrl(`${BASE}/`, { provider: 'codex', kind: 'main', cwd: CWD, sessionId: SID.toUpperCase() })).toBe(want);
    expect(kvTwiccSessionUrl(BASE, { provider: 'codex', kind: 'sub', cwd: CWD, sessionId: SID })).toBeUndefined();
  });

  it('histórico: usa o projectDir do Claude Code quando falta o cwd (no Codex, não)', () => {
    expect(kvTwiccSessionUrl(BASE, { projectDir: '-home-x-app', sessionId: SID })).toBe(`${BASE}/project/-home-x-app/session/${SID}`);
    expect(kvTwiccSessionUrl(BASE, { provider: 'codex', projectDir: '-home-x-app', sessionId: SID })).toBeUndefined();
    expect(kvTwiccSessionUrl(BASE, { projectDir: '../../etc', sessionId: SID })).toBeUndefined();
  });

  it('sem base, id fora do formato (demo) ou sem projeto: nada', () => {
    expect(kvTwiccSessionUrl(undefined, { cwd: CWD, sessionId: SID })).toBeUndefined();
    expect(kvTwiccSessionUrl(BASE, { cwd: CWD, sessionId: 'demo:1' })).toBeUndefined();
    expect(kvTwiccSessionUrl(BASE, { cwd: CWD, sessionId: '../x' })).toBeUndefined();
    expect(kvTwiccSessionUrl(BASE, { sessionId: SID })).toBeUndefined();
  });
});

describe('estilo e sala pela URL', () => {
  it('cores, grupos e contraste', () => {
    expect(kvColor('#ABC')).toBe('#aabbcc');
    expect(kvColor(' #a1B2c3 ')).toBe('#a1b2c3');
    expect(kvColor('red')).toBeUndefined();
    expect(kvColor('#abcd')).toBeUndefined();
    expect(kvGroup('  a\u0000b   c ')).toBe('a b c');
    expect(kvGroup('   ')).toBeUndefined();
    expect(kvTextOn('#ffffff')).toBe('#14181f');
    expect(kvTextOn('#ffe14d')).toBe('#14181f');
    expect(kvTextOn('#1f3a93')).toBe('#ffffff');
  });

  it('?sala= / ?room= e a busca da sala pelo caminho', () => {
    expect(kvRoomParam('?sala=%2Fhome%2Fx%2F01.Site')).toBe('/home/x/01.Site');
    expect(kvRoomParam('?room=/p/a')).toBe('/p/a');
    expect(kvRoomParam('?x=1')).toBeUndefined();
    const rooms = [
      { id: '/home/x/01.Site', path: '/home/x/01.Site' },
      { id: '/home/x/02.App', path: '/home/x/02.App/' },
    ];
    expect(kvFindRoom(rooms, '/home/x/02.app')?.id).toBe('/home/x/02.App');
    expect(kvFindRoom(rooms, '/home/x/01.Site/')?.id).toBe('/home/x/01.Site');
    expect(kvFindRoom(rooms, '/home/x/03')).toBeUndefined();
  });
});
