// Fork Kaviski (KAVISKI.md): a marca da empresa (HABBLAUD_BRAND, vinda em meta.kaviski.brand). No topo, uma linha
// pequena com o nome da empresa logo acima do logotipo "Habblaud" (que continua, com a versão embaixo); no título da
// aba, "<marca> · Habblaud". Sem a variável nada muda. Os mesmos pontos de corte do logotipo escondem a linha (ela fica
// dentro de .ui-brand__name).
import type { KvSnapshotMeta } from '../../../shared/kaviski';
import type { OfficeStore } from '../net/store';
import './kaviski.css';

let brand: string | undefined;

/** Título da aba com a marca (o notify.ts chama com o título original). */
export function kvTitle(base: string): string {
  return brand ? `${brand} · ${base}` : base;
}

function paint(root: ParentNode): void {
  const name = root.querySelector('.ui-topbar .ui-brand__name');
  if (!name) return;
  let el = name.querySelector<HTMLElement>('.kv-brand');
  if (!brand) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('span');
    el.className = 'kv-brand';
    name.prepend(el);
  }
  if (el.textContent !== brand) {
    el.textContent = brand;
    el.title = brand;
  }
}

/** Acompanha o snapshot ao vivo e põe/tira a marca do topo (o título da aba vem do notify.ts, com kvTitle). */
export function kvStartBrand(store: OfficeStore, root: ParentNode = document): void {
  const update = (): void => {
    const next = (store.liveSnapshot?.meta as KvSnapshotMeta | undefined)?.kaviski?.brand;
    if (next === brand && !!brand === !!root.querySelector('.kv-brand')) return;
    brand = next;
    paint(root);
  };
  store.on('snapshot', update);
  update();
}
