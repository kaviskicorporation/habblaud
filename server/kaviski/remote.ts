// Fork Kaviski (KAVISKI.md): na porta remota (com login), o link direto para a sala (`/?sala=<caminho>` ou `?room=`)
// sobrevive à ida pela tela de login: o redirecionamento leva só esse parâmetro adiante (nunca outro) e a página de
// login volta para `/` com ele. Sem `sala`/`room` na URL, o destino é exatamente o original.
import { KV_PATH_MAX } from '../../shared/kaviski';
import { frameAncestorsDirective } from './frame';

/** `target` ("/login" ou "/") com o `?sala=` (ou `?room=`) de `reqUrl`, se houver. */
export function kvKeepRoomQuery(target: string, reqUrl: string | undefined): string {
  let params: URLSearchParams;
  try {
    params = new URL(reqUrl ?? '/', 'http://x').searchParams;
  } catch {
    return target;
  }
  for (const key of ['sala', 'room']) {
    const v = params.get(key);
    if (v && v.length <= KV_PATH_MAX) return `${target}?${key}=${encodeURIComponent(v)}`;
  }
  return target;
}

/**
 * Atributo SameSite do cookie de login. Original: `SameSite=Strict`. Com HABBLAUD_FRAME_ANCESTORS e a porta em HTTPS, o
 * painel Browser do TwiCC (http://...:3500) e o Habblaud (https://...:4748) são de sites diferentes (o esquema conta), e
 * um cookie Strict nunca iria dentro do iframe: aí vira `SameSite=None; Partitioned` (o Secure já vem do original). O
 * cookie particionado vale só dentro do TwiCC (entra-se uma vez lá e outra fora). A barreira contra CSRF continua: corpo
 * JSON obrigatório e Origin conferido (http/guard.ts). Em HTTP puro, SameSite=None não é aceito sem Secure: fica Strict.
 */
export function kvSameSite(secure: boolean, env: NodeJS.ProcessEnv = process.env): string {
  return secure && frameAncestorsDirective(env) ? 'SameSite=None; Partitioned' : 'SameSite=Strict';
}
