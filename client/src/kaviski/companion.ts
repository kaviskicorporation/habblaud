// Fork Kaviski (KAVISKI.md): o script "companion" do painel Browser do TwiCC. Quando o Habblaud está dentro do TwiCC
// (iframe) e o snapshot traz meta.kaviski.twiccUrl (HABBLAUD_TWICC_URL), carrega <twiccUrl>/_twicc/browser-companion.js
// uma vez. Com ele o TwiCC ganha voltar/avançar de verdade, seleção de elemento (clicar numa parte da página para
// descrever ao agente) e captura de erros da página. Fora do iframe, ou sem a variável, nada muda.
import type { KvSnapshotMeta } from '../../../shared/kaviski';
import type { OfficeStore } from '../net/store';

export const KV_COMPANION_PATH = '/_twicc/browser-companion.js';

/** Endereço do companion, ou undefined se não deve carregar (fora do iframe, sem URL ou URL que não é http/https). */
export function kvCompanionSrc(twiccUrl: string | undefined, inFrame: boolean): string | undefined {
  if (!inFrame || !twiccUrl || !/^https?:\/\/[^/]+/i.test(twiccUrl)) return undefined;
  return `${twiccUrl.replace(/\/+$/, '')}${KV_COMPANION_PATH}`;
}

function inFrame(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

/** Espera o snapshot com a URL do TwiCC e põe o script uma única vez. */
export function kvStartCompanion(store: OfficeStore, doc: Document = document): void {
  let done = false;
  const update = (): void => {
    if (done) return;
    const src = kvCompanionSrc((store.liveSnapshot?.meta as KvSnapshotMeta | undefined)?.kaviski?.twiccUrl, inFrame());
    if (!src) return;
    done = true;
    const el = doc.createElement('script');
    el.src = src;
    el.defer = true;
    doc.head.appendChild(el);
  };
  store.on('snapshot', update);
  update();
}
