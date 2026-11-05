import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { kvRemotePty, kvRemotePtyProblem } from './remote-pty';

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe('fork Kaviski: HABBLAUD_REMOTE_PTY', () => {
  it('desligado sem a variável (comportamento original)', () => {
    expect(kvRemotePty({})).toBe(false);
    expect(kvRemotePty({ HABBLAUD_REMOTE_PTY: '0' })).toBe(false);
    expect(kvRemotePty({ HABBLAUD_REMOTE_PTY: '1' })).toBe(true);
    expect(kvRemotePty({ HABBLAUD_REMOTE_PTY: 'sim' })).toBe(true);
  });

  it('aceita a mesma origem e recusa outra', () => {
    expect(kvRemotePtyProblem(req({ host: 'office.exemplo.com.br', origin: 'https://office.exemplo.com.br' }))).toBeNull();
    expect(kvRemotePtyProblem(req({ host: 'office.exemplo.com.br' }))).toBeNull();
    expect(kvRemotePtyProblem(req({ host: 'office.exemplo.com.br', origin: 'https://mal.exemplo.com' }))).not.toBeNull();
    expect(kvRemotePtyProblem(req({ host: 'office.exemplo.com.br', origin: 'null' }))).not.toBeNull();
    expect(kvRemotePtyProblem(req({ host: 'office.exemplo.com.br', 'sec-fetch-site': 'cross-site' }))).not.toBeNull();
  });
});
