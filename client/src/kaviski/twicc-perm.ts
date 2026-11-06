// Fork Kaviski (KAVISKI.md): o cartão "pede permissão" de um pedido de sessão do TwiCC (id "tw-...", ver
// server/kaviski/twicc-approvals.ts). O mesmo cartão do original, com os textos do TwiCC no lugar do terminal: não há
// prazo do Habblaud (o pedido fica até ser respondido aqui ou lá) e o TwiCC não interrompe o agente numa recusa.
import type { PermissionRequestInfo } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { setHidden, setText, setTitle } from '../ui/dom';

export const kvIsTwiccPermission = (p: Pick<PermissionRequestInfo, 'id'>): boolean => p.id.startsWith('tw-');

/** Chamado no fim de PermissionCard.render (ui/permission.ts): só mexe nos pedidos do TwiCC. */
export function kvTwiccCard(p: PermissionRequestInfo, el: { what: HTMLElement; timer: HTMLElement; terminalBtn: HTMLButtonElement; interruptRow: HTMLElement }, ask: boolean): void {
  if (!kvIsTwiccPermission(p)) return;
  if (ask) setText(el.what, tr('Aqui ou no TwiCC: vale a primeira resposta'));
  setText(el.timer, tr('sessão do TwiCC'));
  setTitle(el.timer, tr('Pedido de uma sessão do TwiCC: responda aqui ou na página do TwiCC.'));
  setText(el.terminalBtn, tr('Responder no TwiCC'));
  setTitle(el.terminalBtn, tr('Some daqui: o pedido continua esperando na página do TwiCC'));
  setHidden(el.interruptRow, true);
}
