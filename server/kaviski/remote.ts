// Fork Kaviski (KAVISKI.md): na porta remota (com login), o link direto para a sala (`/?sala=<caminho>` ou `?room=`)
// sobrevive à ida pela tela de login: o redirecionamento leva só esse parâmetro adiante (nunca outro) e a página de
// login volta para `/` com ele. Sem `sala`/`room` na URL, o destino é exatamente o original.
import { kvBrand, KV_PATH_MAX } from '../../shared/kaviski';
import { tr } from '../../shared/i18n';
import { kvProduto } from '../../shared/kaviski-marca';
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

/** Texto nosso dentro do HTML: escapa o que o HTML interpretaria. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Tela de login com a marca (HABBLAUD_BRAND): título da aba "<marca> · entrar", o nome da empresa no lugar do
 * "Habblaud" do cabeçalho e, embaixo dele, "escritório virtual · Habblaud". Troca só pedaços conhecidos da página
 * original (loginPage); se o original mudar e eles sumirem, a página fica como está. Sem a variável: intacta.
 */
export function kvBrandLogin(html: string, env: NodeJS.ProcessEnv = process.env): string {
  const brand = kvBrand(env.HABBLAUD_BRAND);
  // Nome do produto (shared/kaviski-marca.ts) nos pedaços fixos da página que não passam por tr().
  if (!brand) {
    return html
      .replace('<meta name="apple-mobile-web-app-title" content="Habblaud">', `<meta name="apple-mobile-web-app-title" content="${esc(kvProduto('Habblaud'))}">`)
      .replace('<h1>Habblaud</h1>', `<h1>${esc(kvProduto('Habblaud'))}</h1>`);
  }
  const b = esc(brand);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(tr('{0} · entrar', [brand]))}</title>`)
    .replace('<meta name="apple-mobile-web-app-title" content="Habblaud">', `<meta name="apple-mobile-web-app-title" content="${b}">`)
    .replace(
      '<h1>Habblaud</h1>',
      `<h1>${b}</h1>\n  <div style="margin:-2px 0 14px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7d849e">${esc(tr('escritório virtual · Habblaud'))}</div>`,
    );
}
