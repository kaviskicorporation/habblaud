// Fork Kaviski (KAVISKI.md): "Abrir no TwiCC" no painel do agente e no histórico de sessões.
// Só aparece quando o servidor manda meta.kaviski.twiccUrl (HABBLAUD_TWICC_URL) e a URL da sessão dá para montar com
// segurança (shared/kaviski.ts kvTwiccSessionUrl). Dentro de um iframe (o painel Browser do TwiCC) o link troca a página
// de cima (_top); fora, abre outra aba.
import type { AgentInfo, OfficeSnapshot, RecentSession, RoomInfo } from '../../../shared/types';
import { kvTwiccSessionUrl, type KvSnapshotMeta } from '../../../shared/kaviski';
import { tr } from '../../../shared/i18n';
import { pixelIcon } from '../ui/icons';
import './kaviski.css';
import { kvAgentExtras } from './humanos/agent';

/** Seta saindo da caixa (link externo). */
const OPEN_ICON = pixelIcon(['....####', '......##', '.....#.#', '#..##..#', '#.##....', '#.......', '#.......', '######..']);

/** Base do TwiCC que o servidor mandou, se houver. */
export function kvTwiccUrl(snap: OfficeSnapshot | null | undefined): string | undefined {
  return (snap?.meta as KvSnapshotMeta | undefined)?.kaviski?.twiccUrl;
}

/** Alvo do link: a página de cima quando o Habblaud está dentro de um iframe. */
export function kvLinkTarget(): '_top' | '_blank' {
  try {
    return window.self !== window.top ? '_top' : '_blank';
  } catch {
    // acesso à janela de cima negado: com certeza dentro de um iframe de outra origem
    return '_top';
  }
}

function setLink(a: HTMLAnchorElement, url: string | undefined): void {
  if (!url) {
    a.hidden = true;
    a.removeAttribute('href');
    return;
  }
  if (a.getAttribute('href') !== url) a.setAttribute('href', url);
  a.target = kvLinkTarget();
  a.hidden = false;
}

/** Botão do painel do agente (mesmo visual dos .ui-btn). */
export class KvTwiccButton {
  readonly el: HTMLAnchorElement;

  constructor() {
    this.el = document.createElement('a');
    this.el.className = 'ui-btn kv-twicc-btn';
    this.el.rel = 'noopener noreferrer';
    this.el.hidden = true;
    this.el.title = tr('Abrir esta sessão no TwiCC');
    this.el.innerHTML = OPEN_ICON;
    const label = document.createElement('span');
    label.textContent = tr('Abrir no TwiCC');
    this.el.append(label);
  }

  update(agent: AgentInfo | undefined, room: RoomInfo | undefined, snap: OfficeSnapshot | null | undefined): void {
    const base = kvTwiccUrl(snap);
    setLink(this.el, agent && base ? kvTwiccSessionUrl(base, { provider: agent.provider, kind: agent.kind, cwd: room?.path ?? agent.roomId, sessionId: agent.sessionId }) : undefined);
    kvAgentExtras.update?.(this.el, agent); // pessoas no escritório: "Chamar até mim" (KAVISKI-HUMANOS.md)
  }
}

/**
 * Linha do histórico: o item original é um <button> (não pode ter link dentro); com o TwiCC ligado, ele vai numa caixa
 * junto com um link pequeno ao lado. Sem o TwiCC devolve o próprio botão (o original).
 */
export function kvHistoryItem(btn: HTMLButtonElement, s: RecentSession, snap: OfficeSnapshot | null | undefined): HTMLElement {
  const base = kvTwiccUrl(snap);
  const url = base ? kvTwiccSessionUrl(base, { provider: s.provider, cwd: s.project, projectDir: s.projectDir, sessionId: s.sessionId }) : undefined;
  if (!url) return btn;
  const box = document.createElement('div');
  box.className = 'kv-hist-row';
  const a = document.createElement('a');
  a.className = 'kv-hist-twicc';
  a.rel = 'noopener noreferrer';
  a.title = tr('Abrir esta sessão no TwiCC');
  a.setAttribute('aria-label', tr('Abrir esta sessão no TwiCC'));
  a.textContent = 'TwiCC';
  setLink(a, url);
  // não deixa o clique cair no item (que abriria o terminal)
  a.addEventListener('click', (e) => e.stopPropagation());
  box.append(btn, a);
  return box;
}
