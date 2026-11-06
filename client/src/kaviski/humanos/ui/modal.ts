// Fork Kaviski (KAVISKI-HUMANOS.md): caixa de diálogo padrão do kit (cabeçalho com ícone, título e subtítulo; corpo;
// rodapé com os botões) e a confirmação ("Apagar a conta de Ana?"). Usa o <dialog> modal do navegador (foco preso,
// Esc fecha) com o desenho do .ui-dialog do Habblaud.
import { tr } from '../../../../../shared/i18n';
import { h } from '../../../ui/dom';
import { KV_ICONS } from './icons';
import { kvBtn, kvIconBtn, kvTitle } from './kit';

export interface KvModalOpts {
  title: string;
  subtitle?: string;
  icon?: string;
  /** Largura máxima (px). */
  width?: number;
  cls?: string;
  /** Botões extras no cabeçalho, antes do fechar. */
  headActions?: HTMLElement[];
  onClose?: () => void;
}

export class KvModal {
  readonly el: HTMLDialogElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly sub: HTMLElement;

  constructor(private readonly o: KvModalOpts) {
    const icon = h('span', { class: 'kv-ui-modal__icon', attrs: { 'aria-hidden': 'true' }, hidden: !o.icon });
    if (o.icon) icon.innerHTML = o.icon;
    this.titleEl = kvTitle('h2', o.title, 'kv-ui-modal__title');
    this.titleEl.id = `kv-ui-m${Math.random().toString(36).slice(2, 8)}`;
    this.sub = h('p', { class: 'kv-ui-modal__sub', text: o.subtitle ?? '', hidden: !o.subtitle });
    this.body = h('div', { class: 'kv-ui-modal__body' });
    this.foot = h('div', { class: 'kv-ui-modal__foot', hidden: true });
    this.el = h(
      'dialog',
      { class: `ui-dialog kv-ui-modal ${o.cls ?? ''}`.trim(), attrs: { 'aria-labelledby': this.titleEl.id } },
      h(
        'header',
        { class: 'kv-ui-modal__head' },
        icon,
        h('div', { class: 'kv-ui-modal__heading' }, this.titleEl, this.sub),
        h('div', { class: 'kv-ui-modal__head-actions' }, ...(o.headActions ?? []), kvIconBtn(KV_ICONS.close, tr('Fechar'), () => this.close())),
      ),
      this.body,
      this.foot,
    );
    if (o.width) this.el.style.width = `min(${o.width}px, calc(100vw - 24px))`;
    // clique no fundo escuro fecha (o clique dentro do diálogo nunca tem o próprio diálogo como alvo fora das bordas)
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target !== this.el) return;
      const r = this.el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.close();
    });
    this.el.addEventListener('close', () => o.onClose?.());
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
  }

  setTitle(title: string, subtitle?: string): void {
    this.titleEl.textContent = title;
    this.titleEl.classList.toggle('kv-ui-px', !/[C0-9]/.test(title));
    if (subtitle !== undefined) {
      this.sub.textContent = subtitle;
      this.sub.hidden = !subtitle;
    }
  }

  setFoot(...els: (HTMLElement | null)[]): void {
    this.foot.replaceChildren(...els.filter((e): e is HTMLElement => !!e));
    this.foot.hidden = !this.foot.childElementCount;
  }

  get open(): boolean {
    return this.el.open;
  }

  show(): void {
    if (!this.el.open) this.el.showModal();
  }

  close(): void {
    if (this.el.open) this.el.close();
  }
}

/** Pergunta e espera a resposta: true = confirmou. `danger` pinta o botão de vermelho. */
export function kvConfirm(o: { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean; icon?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const m = new KvModal({
      title: o.title,
      icon: o.icon ?? (o.danger ? KV_ICONS.alert : undefined),
      width: 420,
      cls: `kv-ui-confirm${o.danger ? ' is-danger' : ''}`,
      onClose: () => {
        m.el.remove();
        resolve(answer);
      },
    });
    if (o.text) m.body.append(h('p', { class: 'kv-ui-confirm__text', text: o.text }));
    const cancel = kvBtn(o.cancel ?? tr('Cancelar'), { onClick: () => m.close() });
    const ok = kvBtn(o.ok ?? tr('Confirmar'), {
      variant: o.danger ? 'danger' : 'primary',
      onClick: () => {
        answer = true;
        m.close();
      },
    });
    m.setFoot(cancel, ok);
    m.show();
    (o.danger ? cancel : ok).focus();
  });
}
