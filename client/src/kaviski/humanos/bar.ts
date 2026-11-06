// Fork Kaviski (KAVISKI-HUMANOS.md): a barra do topo de quem está com o boneco no escritório — onde estou (área), o
// botão da conversa (fase 2) e, com o LiveKit ligado, microfone, câmera e tela (fase 1c, media.ts). Some quando o boneco
// sai do escritório.
import type { OfficeStore } from '../../net/store';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { kvPeople } from './world';

const CHAT_ICON = pixelIcon(['.########.', '#........#', '#.##.##..#', '#........#', '#.#####..#', '#........#', '.###.####.', '...##.....', '...#......']);

/** Nome de uma área (`r:<sala>`, `a:<núcleo>`, `c`) para mostrar. */
export function kvAreaLabel(area: string | null, store: OfficeStore): string {
  if (!area) return '';
  if (area === 'c') return tr('corredor');
  if (area.startsWith('b:')) return tr('conversa privada'); // W2: roda privada
  if (area.startsWith('a:')) {
    const names: Record<string, string> = { 'core:recepcao': tr('Recepção'), 'core:copa': tr('Copa'), 'core:banheiros': tr('Banheiros'), 'core:lounge': tr('Lounge') };
    return names[area.slice(2)] ?? area.slice(2);
  }
  const id = area.slice(2);
  return store.liveSnapshot?.rooms.find((r) => r.id === id)?.name ?? tr('sala');
}

export class KvBar {
  readonly el: HTMLElement;
  /** Onde os botões de voz e vídeo entram (media.ts). */
  readonly media: HTMLElement;
  readonly chatBtn: HTMLButtonElement;
  private readonly where: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly note: HTMLElement;
  private inCall = false;
  private unread = 0;

  constructor(
    private readonly store: OfficeStore,
    onChat: () => void,
  ) {
    this.where = h('span', { class: 'kv-dock__where' });
    this.badge = h('span', { class: 'kv-dock__badge', hidden: true });
    this.chatBtn = h('button', { class: 'ui-icon-btn kv-dock__btn kv-dock__chat', type: 'button', title: tr('Conversa (Enter)'), attrs: { 'aria-label': tr('Conversa (Enter)') }, on: { click: onChat } });
    this.chatBtn.innerHTML = CHAT_ICON;
    this.chatBtn.append(this.badge);
    this.media = h('span', { class: 'kv-dock__media' });
    this.note = h('span', { class: 'kv-dock__note', attrs: { role: 'status' } });
    this.el = h('div', { class: 'kv-dock', hidden: true, attrs: { role: 'toolbar', 'aria-label': tr('Escritório') } }, this.where, this.chatBtn, this.media, this.note);
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
    setInterval(() => this.paint(), 300);
  }

  /** Na chamada de voz (o rótulo ganha "Na chamada:"). */
  setCall(on: boolean): void {
    this.inCall = on;
    this.paint();
  }

  setUnread(n: number): void {
    this.unread = n;
    this.badge.hidden = n <= 0;
    this.badge.textContent = n > 9 ? '9+' : String(n);
  }

  get unreadCount(): number {
    return this.unread;
  }

  setChatOpen(open: boolean): void {
    this.chatBtn.classList.toggle('is-on', open);
    this.chatBtn.setAttribute('aria-pressed', String(open));
  }

  warn(text: string): void {
    this.note.textContent = text;
    if (text) setTimeout(() => this.note.textContent === text && (this.note.textContent = ''), 8000);
  }

  paint(): void {
    this.el.hidden = !kvPeople.inside;
    const name = kvAreaLabel(kvPeople.callArea ?? kvPeople.area, this.store);
    this.where.textContent = !name ? tr('Entrando…') : this.inCall ? tr('Na chamada: {0}', [name]) : name;
  }
}
