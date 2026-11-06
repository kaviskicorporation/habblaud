// Fork Kaviski (KAVISKI-HUMANOS.md): janela de Atalhos das pessoas (lista em shortcuts-list.ts) e a mesma lista no
// começo da Ajuda do Habblaud (tecla ?), posta em tempo de execução — nenhum gancho no help.ts original.
import { tr } from '../../../../shared/i18n';
import { h, iconButton } from '../../ui/dom';
import { ICONS } from '../../ui/icons';
import { KV_SHORTCUTS } from './shortcuts-list';

function list(team: boolean): HTMLElement[] {
  return KV_SHORTCUTS.map((g) =>
    h(
      'div',
      { class: 'kv-keys__group' },
      h('h4', { text: g.title }),
      h(
        'dl',
        { class: 'ui-shortcuts' },
        ...g.items
          .filter((i) => team || i.only !== 'team')
          .flatMap((i) => [h('dt', {}, h('span', { class: 'ui-keys' }, ...i.keys.map((k) => h('kbd', { class: 'ui-kbd', text: k })))), h('dd', { text: i.text })]),
      ),
    ),
  );
}

export class KvShortcutsDialog {
  readonly el: HTMLDialogElement;

  constructor(team: boolean, onTour: () => void) {
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    const tour = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Ver o tour de boas-vindas de novo'), on: { click: () => (this.el.close(), onTour()) } });
    this.el = h(
      'dialog',
      { class: 'ui-dialog kv-keys', attrs: { 'aria-labelledby': 'kv-keys-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Atalhos das pessoas no escritório'), attrs: { id: 'kv-keys-title' } }), close),
      h('div', { class: 'ui-dialog__body' }, ...list(team), h('p', { class: 'kv-people__hint', text: tr('Botões do topo: conversas, agenda, modo foco e (equipe) convidar visitantes.') }), tour),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
  }

  open(): void {
    if (!this.el.open) this.el.showModal();
  }
}

/** Põe as teclas das pessoas no começo da Ajuda original (quando ela existir no DOM). */
export function kvInjectHelp(team: boolean): void {
  const put = (): boolean => {
    const body = document.querySelector('dialog.ui-help .ui-dialog__body');
    if (!body) return false;
    if (body.querySelector('.kv-keys__help')) return true;
    const intro = body.querySelector('.ui-help__intro');
    const sec = h('section', { class: 'kv-keys__help' }, h('h3', { text: tr('Pessoas no escritório: teclas') }), ...list(team));
    if (intro) intro.after(sec);
    else body.prepend(sec);
    return true;
  };
  if (put()) return;
  const obs = new MutationObserver(() => {
    if (put()) obs.disconnect();
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 60_000);
}
