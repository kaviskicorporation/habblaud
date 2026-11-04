// Fork Kaviski (KAVISKI.md): deixa o Habblaud abrir dentro do painel Browser do TwiCC (um <iframe>).
//
// HABBLAUD_FRAME_ANCESTORS = origens separadas por espaço (ex.: "http://192.168.1.220:3500 http://localhost:3500").
// Definida: as respostas que mandariam X-Frame-Options passam a mandar `Content-Security-Policy: frame-ancestors 'self'
// <origens>` (e nenhum X-Frame-Options). Ausente ou sem nenhuma origem válida: os cabeçalhos ficam como no original.
import { log } from '../log';
import { tr } from '../../shared/i18n';

/** Origem aceita: http(s)://host[:porta], sem caminho (host com letras, números, ponto, hífen ou IPv6 entre colchetes). */
const ORIGIN = /^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** Origens válidas de HABBLAUD_FRAME_ANCESTORS (inválidas são ignoradas, com aviso). */
export function parseFrameAncestors(raw: string | undefined, warn: (bad: string) => void = () => {}): string[] {
  const out: string[] = [];
  for (const t of (raw ?? '').split(/[\s,]+/)) {
    const v = t.trim().replace(/\/+$/, '');
    if (!v) continue;
    if (ORIGIN.test(v)) {
      if (!out.includes(v.toLowerCase())) out.push(v.toLowerCase());
    } else warn(t);
  }
  return out;
}

let cache: { raw: string | undefined; value: string | undefined } | null = null;

/** Diretiva `frame-ancestors ...` em uso (lida do ambiente uma vez por valor), ou undefined se desligado. */
export function frameAncestorsDirective(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.HABBLAUD_FRAME_ANCESTORS;
  if (cache && cache.raw === raw) return cache.value;
  const list = parseFrameAncestors(raw, (bad) => log.warnOnce(`kv-frame:${bad}`, tr('HABBLAUD_FRAME_ANCESTORS: origem ignorada ({0})', [bad])));
  cache = { raw, value: list.length ? `frame-ancestors 'self' ${list.join(' ')}` : undefined };
  return cache.value;
}

/**
 * Ajusta os cabeçalhos de uma resposta que hoje manda X-Frame-Options: com HABBLAUD_FRAME_ANCESTORS, troca por
 * frame-ancestors (somado a uma Content-Security-Policy que já exista). Sem a variável devolve o mesmo objeto, intacto.
 */
export function kvFrameHeaders<T extends Record<string, string | number | string[]>>(headers: T, env: NodeJS.ProcessEnv = process.env): T {
  const directive = frameAncestorsDirective(env);
  if (!directive) return headers;
  const out: Record<string, string | number | string[]> = {};
  let csp: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (key === 'x-frame-options') continue;
    if (key === 'content-security-policy') csp = String(v);
    else out[k] = v;
  }
  out['Content-Security-Policy'] = csp ? `${csp.replace(/;\s*$/, '')}; ${directive}` : directive;
  return out as T;
}
