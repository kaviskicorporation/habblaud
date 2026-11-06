// Fork Kaviski (KAVISKI-HUMANOS.md): status automático da agenda ("📅 Em reunião até 15h") e do modo foco
// ("🎧 Focado até 15h"). Quem decide o status de verdade é o status.ts (kvSetStatus/kvClearStatus: manual vence; senão
// o automático mais recente ainda válido; `until` limpa sozinho). Este arquivo é só o ponto de troca: enquanto o
// status.ts não existe, faz o mínimo com o setStatus da presença (só mexe se a pessoa está "disponível" ou se fui eu
// que pus).
import type { KvStatus } from '../../../../shared/kaviski-presence';
import { kvPeople } from './world';

export type KvAutoSource = 'agenda' | 'foco';

export interface KvAutoStatus {
  status: KvStatus;
  /** Até 60 caracteres, pode começar com emoji. */
  note: string;
  /** epoch ms */
  until: number;
}

const layers = new Map<KvAutoSource, KvAutoStatus & { at: number }>();
let applied: KvStatus | null = null;
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

function apply(): void {
  const cur = kvPeople.client?.me()?.status ?? 'disponivel';
  const want = kvAutoNow();
  if (want) {
    // manual vence: só troca se está disponível ou se o status atual fui eu que pus
    if (cur === 'disponivel' || cur === applied) {
      if (cur !== want.status) kvPeople.client?.setStatus(want.status);
      applied = want.status;
    }
  } else if (applied && cur === applied) {
    kvPeople.client?.setStatus('disponivel');
    applied = null;
  } else applied = null;
  listeners.forEach((f) => f());
}

export function kvAutoSet(source: KvAutoSource, s: KvAutoStatus): void {
  const prev = layers.get(source);
  if (prev && prev.status === s.status && prev.note === s.note && prev.until === s.until) return;
  layers.set(source, { ...s, at: Date.now() });
  apply();
}

export function kvAutoClear(source: KvAutoSource): void {
  if (!layers.delete(source)) return;
  apply();
}

// as camadas vencem sozinhas
setInterval(() => {
  const t = Date.now();
  let changed = false;
  for (const [k, l] of layers) {
    if (l.until <= t) {
      layers.delete(k);
      changed = true;
    }
  }
  if (changed) apply();
}, 15_000);
