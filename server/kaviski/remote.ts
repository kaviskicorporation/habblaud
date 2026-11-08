// Fork Kaviski (KAVISKI.md): na porta remota (com login), o link direto para a sala (`/?sala=<caminho>` ou `?room=`)
// sobrevive à ida pela tela de login: o redirecionamento leva só esse parâmetro adiante (nunca outro) e a página de
// login volta para `/` com ele. Sem `sala`/`room` na URL, o destino é exatamente o original.
import { KV_PATH_MAX } from '../../shared/kaviski';
import { tr } from '../../shared/i18n';
import { kvProduto } from '../../shared/kaviski-marca';
import { kvEmpresaNome } from './empresa';
import { frameAncestorsDirective } from './frame';
import { KV_LOGIN_BG, KV_LOGIN_CSS, kvLoginScript } from './login-visual';

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

/** As cores do site e o visual novo (login-visual.ts: wallpaper, animações e o card de vidro). */
const LOGIN_HEAD = `<link rel="icon" href="/assets/brand/favicon-32.png" type="image/png" sizes="32x32">
<link rel="preload" as="image" href="/assets/brand/login-wallpaper.png">
<meta name="theme-color" content="#0b0d14">
<style>
  .kv-sub { margin: -2px 0 14px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #8b8f9c; }
  input:focus { border-color: #e22c3f !important; }
  button { background: #e22c3f !important; color: #fff !important; }
  h1 { color: #eef0f4 !important; }
${KV_LOGIN_CSS}
</style>
</head>`;

/**
 * Tela de login (e de convite) com o nome do produto (Voxtrin) como título e, embaixo, o nome da empresa
 * (Configurações › Empresa ou HABBLAUD_BRAND, kaviski/empresa.ts): "Kaviski Corporation · escritório virtual". Título da
 * aba "Voxtrin · entrar". O ícone do Voxtrin fica no selo em cima do card (login-visual.ts). Troca só pedaços
 * conhecidos da página original (loginPage); se o original mudar e eles sumirem, a página fica como está.
 */
export function kvBrandLogin(html: string, env: NodeJS.ProcessEnv = process.env): string {
  const brand = kvEmpresaNome(env);
  const nome = kvProduto('Habblaud');
  const produto = esc(nome);
  const sub = esc(brand ? tr('{0} · escritório virtual', [brand]) : tr('escritório virtual'));
  return html
    .replace('</head>', LOGIN_HEAD)
    .replace(/<body>/, () => `<body>\n${KV_LOGIN_BG}`)
    .replace(/<\/body>/, () => `${kvLoginScript()}\n</body>`)
    .replace('<meta name="apple-mobile-web-app-title" content="Habblaud">', `<meta name="apple-mobile-web-app-title" content="${produto}">`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(tr('{0} · entrar', [nome]))}</title>`)
    .replace('<h1>Habblaud</h1>', () => `<h1 class="kv-name">${produto}</h1>\n  <div class="kv-sub">${sub}</div>`);
}
