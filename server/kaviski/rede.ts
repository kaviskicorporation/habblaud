// Fork Kaviski (KAVISKI.md → "Só na rede da empresa"): a porta remota (login) só atende quem vem da rede local, da VPN
// (Tailscale) ou do próprio servidor. O escritório não é publicado na internet (DNS com o IP interno, nenhuma porta
// aberta no roteador), mas isto garante no próprio app: se um dia alguém abrir uma porta ou um túnel por engano, quem
// vem de um IP público recebe 403 antes do login. Atrás do Caddy local vale o endereço que ele manda no
// X-Forwarded-For (kvClientIp).
//
// HABBLAUD_SO_REDE_LOCAL=0 desliga. HABBLAUD_REDES_PERMITIDAS="192.168.1.0/24,100.64.0.0/10" troca a lista padrão.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { tr } from '../../shared/i18n';
import { log } from '../log';
import { kvClientIp } from './humanos/gate';

/** Loopback, redes privadas (RFC 1918), Tailscale (CGNAT 100.64/10), IPv6 local (fc00::/7) e link-local. */
export const KV_REDES_PADRAO = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'];

interface Faixa {
  v: 4 | 6;
  base: bigint;
  mask: bigint;
}

function ipBig(ip: string): { v: 4 | 6; n: bigint } | null {
  const clean = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '').replace(/%.*$/, '');
  const v = isIP(clean);
  if (v === 4) return { v: 4, n: clean.split('.').reduce((a, p) => (a << 8n) + BigInt(Number(p)), 0n) };
  if (v !== 6) return null;
  // expande "::" e lê os 8 grupos (um IPv4 no fim vira dois grupos)
  let s = clean.toLowerCase();
  const m4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m4) {
    const n4 = ipBig(m4[1]!)!.n;
    s = s.slice(0, -m4[1]!.length) + `${(n4 >> 16n).toString(16)}:${(n4 & 0xffffn).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const groups = tail !== undefined ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  if (groups.length !== 8) return null;
  return { v: 6, n: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || '0', 16)), 0n) };
}

export function kvParseFaixas(list: readonly string[]): Faixa[] {
  const out: Faixa[] = [];
  for (const item of list) {
    const [addr, bitsRaw] = item.trim().split('/');
    const ip = addr ? ipBig(addr) : null;
    if (!ip) continue;
    const total = ip.v === 4 ? 32 : 128;
    const bits = bitsRaw === undefined ? total : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > total) continue;
    const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(total - bits);
    out.push({ v: ip.v, base: ip.n & mask, mask });
  }
  return out;
}

/** O endereço está numa das faixas? Endereço inválido ou vazio: não. */
export function kvIpPermitido(ip: string, faixas: readonly Faixa[]): boolean {
  const p = ipBig(ip);
  if (!p) return false;
  return faixas.some((f) => f.v === p.v && (p.n & f.mask) === f.base);
}

/**
 * Filtro da porta remota: responde 403 (e devolve true) a quem vem de fora da rede. Desligado com
 * HABBLAUD_SO_REDE_LOCAL=0.
 */
export function kvRedeLocalGuard(env: NodeJS.ProcessEnv = process.env): (req: IncomingMessage, res: ServerResponse) => boolean {
  if (env.HABBLAUD_SO_REDE_LOCAL?.trim() === '0') return () => false;
  const lista = env.HABBLAUD_REDES_PERMITIDAS?.trim() ? env.HABBLAUD_REDES_PERMITIDAS.split(',') : KV_REDES_PADRAO;
  const faixas = kvParseFaixas(lista);
  let avisos = 0;
  return (req, res) => {
    const ip = kvClientIp(req);
    if (kvIpPermitido(ip, faixas)) return false;
    if (avisos++ < 20) log.warn(tr('Acesso de fora da rede recusado: {0} {1}', [ip.slice(0, 64), (req.url ?? '').split('?')[0]!.slice(0, 80)]));
    req.resume();
    const body = tr('Este escritório só abre na rede da empresa ou pela VPN.');
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
    return true;
  };
}
