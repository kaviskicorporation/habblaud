// Fork Kaviski (KAVISKI-HUMANOS.md): botões das pessoas no grupo de ícones do topo (o mesmo do Feed). Um só lugar para
// todos os módulos (foco, mensagens, quadro...), na ordem pedida.
import { iconButton } from '../../ui/dom';

const placed: { el: HTMLButtonElement; order: number }[] = [];

/** Põe um botão de ícone no topo (antes do Feed). `order` menor fica mais à esquerda. Null se o topo não existe. */
export function kvTopButton(icon: string, label: string, onClick: (ev: MouseEvent) => void, cls = '', order = 50, root: ParentNode = document): HTMLButtonElement | null {
  const feed = root.querySelector('.ui-btn-feed');
  const group = feed?.parentElement;
  if (!feed || !group) return null;
  const el = iconButton(icon, label, onClick, cls);
  el.dataset.kvOrder = String(order);
  const after = placed.filter((p) => p.order > order && p.el.isConnected).sort((a, b) => a.order - b.order)[0];
  group.insertBefore(el, after?.el ?? group.firstElementChild);
  placed.push({ el, order });
  return el;
}
