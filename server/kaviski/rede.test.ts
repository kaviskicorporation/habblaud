// Fork Kaviski (KAVISKI.md → "Só na rede da empresa"): faixas de IP, o X-Forwarded-For do Caddy e o 403.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { KV_REDES_PADRAO, kvIpPermitido, kvParseFaixas, kvRedeLocalGuard } from './rede';

setQuiet(true);
const padrao = kvParseFaixas(KV_REDES_PADRAO);

function req(addr: string, xff?: string): IncomingMessage {
  return { socket: { remoteAddress: addr }, headers: xff ? { 'x-forwarded-for': xff } : {}, url: '/login', resume() {} } as unknown as IncomingMessage;
}
function res() {
  const r = { status: 0, body: '', writeHead(s: number) { r.status = s; return r; }, end(b?: string) { r.body = b ?? ''; } };
  return r;
}

describe('só na rede da empresa', () => {
  it('rede local, VPN e o próprio servidor passam; IP público não', () => {
    for (const ip of ['192.168.1.50', '::ffff:192.168.1.7', '127.0.0.1', '::1', '100.101.102.103', '10.1.2.3', '172.18.0.4', 'fd7a:115c:a1e0::1', 'fe80::1%eth0']) expect(kvIpPermitido(ip, padrao), ip).toBe(true);
    for (const ip of ['8.8.8.8', '200.150.1.2', '::ffff:177.10.0.1', '2804:14c::1', '172.32.0.1', '100.128.0.1', '', 'lixo']) expect(kvIpPermitido(ip, padrao), ip).toBe(false);
  });

  it('atrás do Caddy local vale o X-Forwarded-For; fora dele, o socket', () => {
    const g = kvRedeLocalGuard({});
    let r = res();
    expect(g(req('127.0.0.1', '203.0.113.9'), r as unknown as ServerResponse)).toBe(true);
    expect(r.status).toBe(403);
    expect(g(req('127.0.0.1', '192.168.1.20'), res() as unknown as ServerResponse)).toBe(false);
    r = res();
    expect(g(req('203.0.113.9', '192.168.1.20'), r as unknown as ServerResponse)).toBe(true); // IP público não escolhe o próprio XFF
  });

  it('lista própria e desligar', () => {
    const g = kvRedeLocalGuard({ HABBLAUD_REDES_PERMITIDAS: '192.168.1.0/24' });
    expect(g(req('10.0.0.1'), res() as unknown as ServerResponse)).toBe(true);
    expect(g(req('192.168.1.9'), res() as unknown as ServerResponse)).toBe(false);
    expect(kvRedeLocalGuard({ HABBLAUD_SO_REDE_LOCAL: '0' })(req('8.8.8.8'), res() as unknown as ServerResponse)).toBe(false);
  });
});
