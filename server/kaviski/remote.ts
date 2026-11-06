// Fork Kaviski (KAVISKI.md): na porta remota (com login), o link direto para a sala (`/?sala=<caminho>` ou `?room=`)
// sobrevive à ida pela tela de login: o redirecionamento leva só esse parâmetro adiante (nunca outro) e a página de
// login volta para `/` com ele. Sem `sala`/`room` na URL, o destino é exatamente o original.
import { KV_PATH_MAX } from '../../shared/kaviski';
import { tr } from '../../shared/i18n';
import { kvProduto } from '../../shared/kaviski-marca';
import { kvEmpresaNome } from './empresa';
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

/** Logotipo do Voxtrin (assets/brand/wordmark.png, liberado sem login: PUBLIC_STATIC) e as cores do site. */
const LOGIN_HEAD = `<link rel="icon" href="/assets/brand/favicon-32.png" type="image/png" sizes="32x32">
<style>
  .kv-logo { display: block; width: 210px; max-width: 70%; height: auto; margin: 0 0 18px; filter: drop-shadow(0 8px 22px rgba(226,44,63,.28)); }
  .kv-sub { margin: -2px 0 14px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #8b8f9c; }
  input:focus { border-color: #e22c3f !important; }
  button { background: #e22c3f !important; color: #fff !important; }
  h1 { color: #eef0f4 !important; }
</style>
</head>`;

/**
 * Tela de login (e de convite) com o logotipo do Voxtrin e o nome da empresa (Configurações › Empresa ou HABBLAUD_BRAND,
 * kaviski/empresa.ts): título da aba "<empresa> · entrar", o logotipo no alto, o nome da empresa no lugar do "Habblaud"
 * do cabeçalho e, embaixo dele, "escritório virtual · Voxtrin". Troca só pedaços conhecidos da página original
 * (loginPage); se o original mudar e eles sumirem, a página fica como está.
 */
export function kvBrandLogin(html: string, env: NodeJS.ProcessEnv = process.env): string {
  const brand = kvEmpresaNome(env);
  const produto = esc(kvProduto('Habblaud'));
  const logo = `<img class="kv-logo" src="/assets/brand/wordmark.png" alt="${produto}" width="210" height="51">`;
  const out = html
    .replace('</head>', LOGIN_HEAD)
    .replace('<meta name="apple-mobile-web-app-title" content="Habblaud">', `<meta name="apple-mobile-web-app-title" content="${brand ? esc(brand) : produto}">`);
  if (!brand) return out.replace('<h1>Habblaud</h1>', `${logo}\n  <h1 class="kv-sr" style="position:absolute;left:-9999px">${produto}</h1>`);
  return out
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(tr('{0} · entrar', [brand]))}</title>`)
    .replace('<h1>Habblaud</h1>', `${logo}\n  <h1>${esc(brand)}</h1>\n  <div class="kv-sub">${esc(tr('escritório virtual · Habblaud'))}</div>`);
}
