// Fork Kaviski (KAVISKI-HUMANOS.md): status automático da agenda ("📅 Em reunião até 15h") e do modo foco
// ("🎧 Focado até 15h"). Quem decide o status de verdade é o status.ts (kvSetStatus/kvClearStatus: manual vence; senão
// o automático mais recente ainda válido; `until` limpa sozinho). Este arquivo é só o ponto de troca: guarda as camadas
// para mostrar a nota na tela e repassa cada uma ao status.ts com a fonte ('agenda' | 'foco').
import type { KvStatus } from '../../../../shared/kaviski-presence';
import { kvClearStatus, kvSetStatus } from './status';

export type KvAutoSource = 'agenda' | 'foco';

export interface KvAutoStatus {
  status: KvStatus;
  /** Até 60 caracteres, pode começar com emoji. */
  note: string;
  /** epoch ms */
  until: number;
}

const layers = new Map<KvAutoSource, KvAutoStatus & { at: number }>();
const listeners = new Set<() => void>();

/** O automático que vale agora (o mais recente ainda válido), para mostrar a nota na tela. */
export function kvAutoNow(): (KvAutoStatus & { source: KvAutoSource }) | null {
  const t = Date.now();
  let best: (KvAutoStatus & { at: number; source: KvAutoSource }) | null = null;
  for (const [source, l] of layers) {
    if (l.until <= t) continue;
    if (!best || l.at > best.at) best = { ...l, source };
  }
  return best;
}

export function kvOnAutoStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const changed = () => listeners.forEach((f) => f());

export function kvAutoSet(source: KvAutoSource, s: KvAutoStatus): void {
  const prev = layers.get(source);
  if (prev && prev.status === s.status && prev.note === s.note && prev.until === s.until) return;
  layers.set(source, { ...s, at: Date.now() });
  kvSetStatus({ status: s.status, note: s.note, until: s.until, source });
  changed();
}

export function kvAutoClear(source: KvAutoSource): void {
  if (!layers.delete(source)) return;
  kvClearStatus(source);
  changed();
}

// as camadas vencem sozinhas (o status.ts também tira a dele no "até")
setInterval(() => {
  const t = Date.now();
  let gone = false;
  for (const [k, l] of layers) {
    if (l.until <= t) {
      layers.delete(k);
      gone = true;
    }
  }
  if (gone) changed();
}, 15_000);
