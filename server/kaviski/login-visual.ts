// Fork Kaviski (KAVISKI.md): visual da tela de login e de convite (kvBrandLogin). Fundo com o wallpaper gerado por IA
// (assets/brand/login-wallpaper.png, liberado sem login: PUBLIC_STATIC) em zoom lento, estrelas, brilhos e partículas
// subindo; card de vidro com borda animada, sombra em camadas, inclinação 3D que segue o mouse, ícones nos campos,
// "mostrar senha" e saudação do dia. Tudo por CSS e um script curto que só enfeita a página original (não troca o
// formulário nem o envio). Com "reduzir movimento" no sistema, nada se mexe. O card fica num palco fixo que centraliza
// sozinho (antes o <body> em grade virava duas linhas quando uma extensão do navegador injetava um elemento nele, e o
// card subia para o topo); tela baixa rola o palco.
import { tr } from '../../shared/i18n';

/** Dentro do <script>: JSON com "<" escapado, para nenhum texto fechar a tag. */
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export const KV_LOGIN_CSS = `
  :root { --kv-red: #e22c3f; --kv-red2: #ff5a6a; --kv-silver: #d9dde6; --kv-cyan: #5ee1ff; --kv-ink: #0b0d14; }
  html, body { height: 100%; }
  body { position: relative; overflow-x: hidden; background: var(--kv-ink) !important; color: #eef0f4 !important;
         font-family: Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif !important; }
  .kv-bg, .kv-bg * { pointer-events: none; }
  .kv-bg { position: fixed; inset: 0; z-index: 0; overflow: hidden; }
  .kv-wall { position: absolute; inset: -4%; background: #0b0d14 url(/assets/brand/login-wallpaper.png) center / cover no-repeat;
             animation: kv-pan 48s ease-in-out infinite alternate; filter: saturate(1.08); }
  .kv-shade { position: absolute; inset: 0;
              background: radial-gradient(ellipse 46% 60% at 50% 50%, rgba(8,9,15,.72), rgba(8,9,15,.25) 70%, rgba(8,9,15,.55)),
                          linear-gradient(180deg, rgba(8,9,15,.55), rgba(8,9,15,0) 30%, rgba(8,9,15,0) 70%, rgba(8,9,15,.8)); }
  .kv-scan { position: absolute; inset: 0; opacity: .08; mix-blend-mode: overlay;
             background: repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 3px); }
  .kv-orb { position: absolute; width: 46vmax; height: 46vmax; border-radius: 50%; filter: blur(80px); opacity: .32; mix-blend-mode: screen; }
  .kv-orb.a { background: radial-gradient(circle, var(--kv-red), transparent 65%); left: -14vmax; top: -12vmax; animation: kv-drift 26s ease-in-out infinite alternate; }
  .kv-orb.b { background: radial-gradient(circle, #6b4fd8, transparent 65%); right: -16vmax; bottom: -18vmax; animation: kv-drift 32s ease-in-out -8s infinite alternate-reverse; }
  .kv-orb.c { background: radial-gradient(circle, var(--kv-cyan), transparent 65%); width: 28vmax; height: 28vmax; right: 8vmax; top: -10vmax; opacity: .16; animation: kv-drift 22s ease-in-out -4s infinite alternate; }
  .kv-star { position: absolute; width: 2px; height: 2px; background: #fff; box-shadow: 0 0 6px #fff; animation: kv-twinkle var(--d, 4s) ease-in-out var(--w, 0s) infinite; }
  .kv-bit { position: absolute; bottom: -12px; width: 3px; height: 3px; background: var(--c, var(--kv-red2)); box-shadow: 0 0 8px var(--c, var(--kv-red2));
            opacity: 0; animation: kv-rise var(--d, 14s) linear var(--w, 0s) infinite; }
  .kv-shoot { position: absolute; top: 12%; left: 70%; width: 140px; height: 2px; opacity: 0; transform: rotate(-24deg);
              background: linear-gradient(90deg, transparent, #fff 70%, var(--kv-cyan)); border-radius: 2px; animation: kv-shoot 11s ease-in 3s infinite; }
  .kv-shoot.two { top: 22%; left: 30%; animation-duration: 17s; animation-delay: 9s; }

  form#f { position: relative; z-index: 2; max-width: 400px !important; padding: 34px 32px 28px !important; border: 0 !important; border-radius: 22px !important;
           background: linear-gradient(160deg, rgba(34,37,52,.74), rgba(16,18,27,.82)) !important;
           -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3);
           box-shadow: 0 1px 0 rgba(255,255,255,.12) inset, 0 -1px 0 rgba(0,0,0,.4) inset,
                       0 2px 4px rgba(0,0,0,.3), 0 12px 24px rgba(0,0,0,.35), 0 30px 70px rgba(0,0,0,.55), 0 0 90px rgba(226,44,63,.16);
           transform-style: preserve-3d; transform: perspective(1100px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
           transition: transform .25s ease-out; animation: kv-in .9s cubic-bezier(.2,.8,.2,1) both; }
  form#f::before { content: ""; position: absolute; inset: 0; padding: 1.5px; border-radius: inherit; pointer-events: none;
                   background: conic-gradient(from var(--kv-a, 0deg), rgba(226,44,63,.0), var(--kv-red) 12%, var(--kv-silver) 22%, rgba(226,44,63,.0) 36%,
                                rgba(255,255,255,.12) 50%, rgba(94,225,255,.55) 64%, rgba(255,255,255,.12) 78%, rgba(226,44,63,.0));
                   -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
                   mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); animation: kv-spin 7s linear infinite; }
  form#f::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
                  background: radial-gradient(420px circle at var(--mx, 50%) var(--my, 0%), rgba(255,255,255,.09), transparent 45%); }
  @property --kv-a { syntax: "<angle>"; inherits: false; initial-value: 0deg; }

  .kv-badge { display: grid; place-items: center; width: 64px; height: 64px; margin: -66px auto 14px; border-radius: 18px; transform: translateZ(40px);
              background: linear-gradient(145deg, #2a2d3d, #12131b); box-shadow: 0 1px 0 rgba(255,255,255,.18) inset, 0 10px 24px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06), 0 0 34px rgba(226,44,63,.35);
              animation: kv-float 6s ease-in-out infinite; }
  .kv-badge img { width: 44px; height: 44px; filter: drop-shadow(0 4px 10px rgba(226,44,63,.5)); }
  form#f h1 { text-align: center; font-size: 34px !important; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; margin: 2px 0 6px !important;
              padding-left: .14em; transform: translateZ(20px); line-height: 1.1;
              background: linear-gradient(180deg, #ffffff 0%, #e6e9f0 45%, #9aa1b4 52%, #f2f4f8 100%); -webkit-background-clip: text; background-clip: text;
              color: transparent !important; filter: drop-shadow(0 2px 0 rgba(0,0,0,.45)) drop-shadow(0 0 18px rgba(226,44,63,.35)); }
  form#f h1::first-letter { color: var(--kv-red2); -webkit-text-fill-color: var(--kv-red2); }
  .kv-sub { text-align: center; margin: 0 0 6px !important; font-size: 11px !important; letter-spacing: .2em !important; color: #8f95a6 !important; }
  .kv-stage { position: fixed; inset: 0; z-index: 2; display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain;
              padding: max(56px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom)); }
  .kv-stage__in { margin: auto; width: 100%; max-width: 400px; display: flex; flex-direction: column; align-items: center; }
  .kv-stage__in > form#f { width: 100%; margin: 0 !important; }
  .kv-sub::before, .kv-sub::after { content: ""; display: inline-block; width: 22px; height: 1px; margin: 0 10px; vertical-align: middle;
                                    background: linear-gradient(90deg, transparent, var(--kv-red)); }
  .kv-sub::after { transform: scaleX(-1); }
  .kv-hello { text-align: center; margin: 14px 0 2px; font-size: 15px; font-weight: 600; color: #eef0f4; }
  form#f > p { text-align: center; color: #9aa1b4 !important; font-size: 13.5px !important; margin: 0 0 18px !important; }
  form#f > p.small, form#f > p.ca { font-size: 12px !important; margin: 14px 0 0 !important; }
  form#f a { color: var(--kv-red2) !important; text-decoration: none; border-bottom: 1px dashed rgba(255,90,106,.5); }
  .tag { display: table !important; margin: 0 auto 14px !important; background: linear-gradient(135deg, var(--kv-red), #8d1424) !important;
         border-radius: 999px !important; padding: 3px 12px !important; box-shadow: 0 4px 14px rgba(226,44,63,.4); }

  form#f label { font-size: 11.5px !important; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: #a3a9ba !important; margin: 16px 0 8px !important; }
  .kv-field { position: relative; }
  .kv-field > svg { position: absolute; left: 14px; top: 50%; width: 18px; height: 18px; transform: translateY(-50%); color: #7d8396; transition: color .2s; pointer-events: none; }
  .kv-field:focus-within > svg { color: var(--kv-red2); }
  form#f input { padding: 14px 14px 14px 44px !important; font-size: 15px !important; border-radius: 12px !important; border: 1px solid rgba(255,255,255,.09) !important;
                 background: linear-gradient(180deg, rgba(6,7,11,.75), rgba(14,16,24,.75)) !important; color: #f2f3f7 !important;
                 box-shadow: 0 2px 6px rgba(0,0,0,.45) inset, 0 1px 0 rgba(255,255,255,.05); transition: border-color .2s, box-shadow .2s, background .2s; }
  form#f input::placeholder { color: #5d6275; }
  form#f input:hover { border-color: rgba(255,255,255,.16) !important; }
  form#f input:focus { border-color: rgba(226,44,63,.85) !important; box-shadow: 0 2px 6px rgba(0,0,0,.45) inset, 0 0 0 4px rgba(226,44,63,.18), 0 0 24px rgba(226,44,63,.25) !important; }
  .kv-field.pw input { padding-right: 48px !important; }
  button.kv-eye { position: absolute !important; right: 6px; top: 50%; transform: translateY(-50%); width: 38px !important; height: 38px; margin: 0 !important; padding: 0 !important;
                  display: grid; place-items: center; border-radius: 10px !important; background: transparent !important; color: #7d8396 !important; box-shadow: none !important; }
  button.kv-eye:hover { color: #fff !important; background: rgba(255,255,255,.06) !important; }
  button.kv-eye svg { width: 18px; height: 18px; }
  button.kv-eye::after { display: none !important; }

  form#f button[type=submit] { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 10px;
                               margin-top: 26px !important; padding: 15px !important; font-size: 15.5px !important; font-weight: 700; letter-spacing: .02em;
                               border-radius: 12px !important; color: #fff !important; transform: translateZ(18px);
                               background: linear-gradient(180deg, #f2475a, #c81d30) !important;
                               box-shadow: 0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 0 rgba(0,0,0,.25) inset, 0 6px 0 #7e0f1d, 0 10px 22px rgba(226,44,63,.45);
                               transition: transform .12s, box-shadow .12s, filter .2s; }
  form#f button[type=submit]:hover { filter: brightness(1.08); }
  form#f button[type=submit]:active { transform: translateY(5px) translateZ(18px);
                                      box-shadow: 0 1px 0 rgba(255,255,255,.3) inset, 0 1px 0 #7e0f1d, 0 4px 10px rgba(226,44,63,.4); }
  form#f button[type=submit]::after { content: ""; position: absolute; top: 0; left: -60%; width: 40%; height: 100%; transform: skewX(-20deg);
                                      background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent); animation: kv-shine 4.5s ease-in-out 1.5s infinite; }
  form#f button[type=submit] svg { width: 18px; height: 18px; transition: transform .2s; }
  form#f button[type=submit]:hover svg { transform: translateX(3px); }
  form#f button[type=submit]:disabled svg { animation: kv-spin-i .8s linear infinite; }
  form#f button[type=submit]:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  #err { text-align: center; color: #ff8f99 !important; min-height: 0 !important; margin-top: 10px !important; }
  #err:not(:empty) { animation: kv-shake .4s; }
  .kv-foot { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 18px; font-size: 11.5px; color: #7d8396; }
  .kv-foot i { width: 7px; height: 7px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 0 0 rgba(61,220,132,.6); animation: kv-pulse 2.2s infinite; }

  @keyframes kv-pan { 0% { transform: scale(1.04) translate(0, 0); } 100% { transform: scale(1.14) translate(-2%, -1.5%); } }
  @keyframes kv-drift { 0% { transform: translate(0, 0) scale(1); } 100% { transform: translate(8vmax, 6vmax) scale(1.15); } }
  @keyframes kv-twinkle { 0%, 100% { opacity: .15; transform: scale(.6); } 50% { opacity: 1; transform: scale(1.2); } }
  @keyframes kv-rise { 0% { opacity: 0; transform: translate(0, 0); } 10% { opacity: .9; } 85% { opacity: .5; } 100% { opacity: 0; transform: translate(var(--x, 20px), -105vh); } }
  @keyframes kv-shoot { 0% { opacity: 0; transform: rotate(-24deg) translateX(0); } 3% { opacity: 1; } 9% { opacity: 0; transform: rotate(-24deg) translateX(-420px); } 100% { opacity: 0; } }
  @keyframes kv-in { from { opacity: 0; transform: perspective(1100px) translateY(28px) rotateX(10deg) scale(.96); } to { opacity: 1; } }
  @keyframes kv-spin { to { --kv-a: 360deg; } }
  @keyframes kv-spin-i { to { transform: rotate(360deg); } }
  @keyframes kv-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -6px; } }
  @keyframes kv-shine { 0% { left: -60%; } 30%, 100% { left: 130%; } }
  @keyframes kv-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
  @keyframes kv-pulse { 0% { box-shadow: 0 0 0 0 rgba(61,220,132,.6); } 70% { box-shadow: 0 0 0 8px rgba(61,220,132,0); } 100% { box-shadow: 0 0 0 0 rgba(61,220,132,0); } }

  @media (max-width: 480px) { form#f { padding: 30px 20px 22px !important; border-radius: 18px !important; } form#f h1 { font-size: 28px !important; } .kv-orb { filter: blur(60px); } }
  @media (prefers-reduced-motion: reduce) {
    .kv-bg *, form#f, form#f::before, form#f button[type=submit]::after, .kv-badge, .kv-foot i { animation: none !important; }
    .kv-bit, .kv-shoot { display: none; }
    form#f { transform: none !important; }
  }
`;

const ICON = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  name: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.3 6.3C3.6 8.1 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
};

/** Camadas do fundo (logo depois do <body>). */
export const KV_LOGIN_BG = `<div class="kv-bg" aria-hidden="true"><div class="kv-wall"></div><div class="kv-orb a"></div><div class="kv-orb b"></div><div class="kv-orb c"></div><div class="kv-shade"></div><div class="kv-scan"></div><i class="kv-shoot"></i><i class="kv-shoot two"></i></div>`;

/** Script que enfeita a página já montada (antes do </body>): estrelas, partículas, ícones, olho da senha, 3D. */
export function kvLoginScript(): string {
  const t = {
    show: tr('Mostrar senha'),
    hide: tr('Esconder senha'),
    hello: [tr('Bom dia'), tr('Boa tarde'), tr('Boa noite')],
    secure: tr('Conexão segura'),
    online: tr('Escritório no ar'),
  };
  return `<script>
(() => {
  const T = ${js(t)}, I = ${js(ICON)};
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bg = document.querySelector('.kv-bg'), f = document.getElementById('f');
  if (bg) {
    const r = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 70; i++) {
      const s = document.createElement('i'); s.className = 'kv-star';
      s.style.cssText = 'left:' + r(0, 100) + '%;top:' + r(0, 62) + '%;--d:' + r(2.5, 7) + 's;--w:-' + r(0, 7) + 's;opacity:' + r(.2, .9);
      if (Math.random() < .2) { s.style.width = s.style.height = '3px'; }
      bg.appendChild(s);
    }
    const colors = ['#ff5a6a', '#e22c3f', '#d9dde6', '#5ee1ff'];
    for (let i = 0; i < (innerWidth < 600 ? 14 : 28); i++) {
      const b = document.createElement('i'); b.className = 'kv-bit';
      b.style.cssText = 'left:' + r(0, 100) + '%;--d:' + r(10, 22) + 's;--w:-' + r(0, 22) + 's;--x:' + r(-60, 60) + 'px;--c:' + colors[i % 4];
      bg.appendChild(b);
    }
  }
  if (!f) return;
  const badge = document.createElement('div'); badge.className = 'kv-badge';
  badge.innerHTML = '<img src="/assets/brand/voxtrin-icon.png" alt="" width="44" height="44">';
  f.insertBefore(badge, f.firstChild);
  const sub = f.querySelector('.kv-sub') || f.querySelector('h1');
  if (sub && sub.parentNode === f) {
    const h = document.createElement('div'); h.className = 'kv-hello';
    const hr = new Date().getHours();
    h.textContent = T.hello[hr >= 5 && hr < 12 ? 0 : hr >= 12 && hr < 18 ? 1 : 2];
    sub.after(h);
  }
  const wrap = (input, icon) => {
    if (!input) return;
    const w = document.createElement('div'); w.className = 'kv-field';
    input.parentNode.insertBefore(w, input); w.appendChild(input);
    w.insertAdjacentHTML('afterbegin', icon);
    return w;
  };
  wrap(document.getElementById('u'), I.user);
  wrap(document.getElementById('n'), I.name);
  const p = document.getElementById('p'), pw = wrap(p, I.lock);
  if (pw) {
    pw.classList.add('pw');
    const eye = document.createElement('button');
    eye.type = 'button'; eye.className = 'kv-eye'; eye.innerHTML = I.eye; eye.setAttribute('aria-label', T.show); eye.title = T.show;
    eye.addEventListener('click', () => {
      const shown = p.type === 'text';
      p.type = shown ? 'password' : 'text';
      eye.innerHTML = shown ? I.eye : I.eyeOff;
      eye.setAttribute('aria-label', shown ? T.show : T.hide); eye.title = shown ? T.show : T.hide;
      p.focus();
    });
    pw.appendChild(eye);
  }
  const submit = f.querySelector('button[type=submit]');
  if (submit) submit.insertAdjacentHTML('beforeend', I.arrow);
  const foot = document.createElement('div'); foot.className = 'kv-foot';
  foot.innerHTML = '<i></i><span></span>';
  foot.lastChild.textContent = T.online + (location.protocol === 'https:' ? ' · ' + T.secure : '');
  // palco fixo e centralizado: nada que uma extensão ponha no <body> empurra o card
  const stage = document.createElement('div'); stage.className = 'kv-stage';
  const inner = document.createElement('div'); inner.className = 'kv-stage__in';
  stage.appendChild(inner);
  f.parentNode.insertBefore(stage, f);
  inner.appendChild(f);
  inner.appendChild(foot);
  if (!reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
      const b = f.getBoundingClientRect();
      const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
      const near = x > -0.4 && x < 1.4 && y > -0.4 && y < 1.4;
      f.style.setProperty('--ry', near ? ((x - .5) * 9).toFixed(2) + 'deg' : '0deg');
      f.style.setProperty('--rx', near ? ((.5 - y) * 7).toFixed(2) + 'deg' : '0deg');
      f.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      f.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    });
    document.addEventListener('pointerleave', () => { f.style.setProperty('--rx', '0deg'); f.style.setProperty('--ry', '0deg'); });
  }
})();
</script>`;
}
