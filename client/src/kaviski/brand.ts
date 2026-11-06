// Fork Kaviski (KAVISKI.md): o nome da empresa (Configurações › Empresa, ou HABBLAUD_BRAND; vem em meta.kaviski.brand).
// Vai no título da aba ("<empresa> · Voxtrin"), nas notificações do navegador e no grupo Empresa das Configurações.
// No topo não aparece mais (a linha acima do logotipo saiu: o logotipo do Voxtrin fica sozinho).
import type { KvSnapshotMeta } from '../../../shared/kaviski';
import type { OfficeStore } from '../net/store';
import './kaviski.css';

let brand: string | undefined;
const listeners = new Set<(b: string | undefined) => void>();

/** O nome da empresa em uso (undefined = sem nome). */
export function kvBrandName(): string | undefined {
  return brand;
}

/** Avisa quando o nome da empresa muda. Devolve a função que desliga. */
export function kvOnBrand(fn: (b: string | undefined) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Título com a empresa na frente (o notify.ts chama com o título original). */
export function kvTitle(base: string): string {
  return brand ? `${brand} · ${base}` : base;
}

/** Acompanha o snapshot ao vivo (o título da aba vem do notify.ts, com kvTitle). */
export function kvStartBrand(store: OfficeStore): void {
  const update = (): void => {
    const next = (store.liveSnapshot?.meta as KvSnapshotMeta | undefined)?.kaviski?.brand;
    if (next === brand) return;
    brand = next;
    for (const fn of listeners) fn(brand);
  };
  store.on('snapshot', update);
  update();
}
