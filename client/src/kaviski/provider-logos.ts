// Fork Kaviski (KAVISKI.md): logos do Claude e do Codex nos cartões de uso da barra superior, que ficam compactos
// (uma linha, ver usage-compact.css). Os SVGs são desenhados aqui (caminhos simples, sem arquivo externo):
// - Claude: a estrela laranja (#D97757), raios afinando para o centro;
// - Codex: a "flor" da OpenAI, seis cápsulas vazadas giradas de 60°, em cinza claro.
// Gancho: ui/usage.ts chama kvUsageLogo() no updateCard; o chip com letra fica escondido pelo CSS.
import type { AccountInfo, Provider } from '../../../shared/types';
import { isCodex } from '../ui/provider';
import './usage-compact.css';

const f = (n: number): number => Number(n.toFixed(2));

/** Raios da estrela do Claude: [ângulo em graus, comprimento] num quadro de -12 a 12 (levemente irregulares). */
const CLAUDE_RAYS: readonly [number, number][] = [
  [0, 11],
  [30, 9.6],
  [61, 10.6],
  [91, 9.9],
  [119, 11],
  [150, 9.4],
  [180, 10.8],
  [211, 9.7],
  [239, 10.9],
  [270, 9.5],
  [300, 10.6],
  [329, 9.8],
];

/** Um raio: fino no centro, largo e arredondado na ponta. */
function ray(deg: number, len: number): string {
  const a = ((deg - 90) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const w0 = 0.35; // meia-largura no centro
  const w1 = 1.35; // meia-largura na ponta
  const tip = len - w1;
  const p = (r: number, w: number): string => `${f(c * r - s * w)} ${f(s * r + c * w)}`;
  return `M${p(0.5, w0)}L${p(tip, w1)}A${w1} ${w1} 0 0 0 ${p(tip, -w1)}L${p(0.5, -w0)}Z`;
}

export const CLAUDE_LOGO_SVG =
  '<svg class="kv-logo kv-logo--claude" viewBox="-12 -12 24 24" focusable="false" aria-hidden="true">' +
  `<path fill="currentColor" d="${CLAUDE_RAYS.map(([d, l]) => ray(d, l)).join('')}"/>` +
  '<circle r="2.2" fill="currentColor"/></svg>';

export const CODEX_LOGO_SVG =
  '<svg class="kv-logo kv-logo--codex" viewBox="-12 -12 24 24" focusable="false" aria-hidden="true">' +
  '<g fill="none" stroke="currentColor" stroke-width="1.8">' +
  [0, 60, 120, 180, 240, 300].map((d) => `<rect x="2.4" y="-9.4" width="6.6" height="11.2" rx="3.3" transform="rotate(${d})"/>`).join('') +
  '</g></svg>';

export function kvProviderLogoSvg(provider: Provider): string {
  return provider === 'codex' ? CODEX_LOGO_SVG : CLAUDE_LOGO_SVG;
}

interface LogoRefs {
  logo: HTMLElement;
  tag: HTMLElement;
}

const logos = new WeakMap<HTMLElement, LogoRefs>();

/**
 * Logo da ferramenta no lugar do chip com letra (gancho do updateCard em ui/usage.ts). Roda a cada render: só mexe no
 * DOM quando a ferramenta ou a letra mudam. A letra da conta (A, B…) fica num selinho na cor da conta, visível só
 * quando o nome some (telas médias), para distinguir duas contas do Claude.
 */
export function kvUsageLogo(card: HTMLElement, a: Pick<AccountInfo, 'provider' | 'short'>): void {
  let refs = logos.get(card);
  if (!refs) {
    const tag = document.createElement('span');
    tag.className = 'kv-usage-logo__tag';
    const logo = document.createElement('span');
    logo.className = 'kv-usage-logo';
    logo.setAttribute('aria-hidden', 'true');
    card.classList.add('kv-usage');
    card.prepend(logo);
    refs = { logo, tag };
    logos.set(card, refs);
  }
  const provider: Provider = isCodex(a) ? 'codex' : 'claude';
  if (refs.logo.dataset.provider !== provider) {
    refs.logo.dataset.provider = provider;
    refs.logo.innerHTML = kvProviderLogoSvg(provider);
    refs.logo.append(refs.tag);
  }
  const letter = provider === 'codex' ? '' : a.short;
  if (refs.tag.textContent !== letter) refs.tag.textContent = letter;
  refs.tag.hidden = !letter;
}
