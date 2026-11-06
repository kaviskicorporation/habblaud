// Fork Kaviski (KAVISKI-HUMANOS.md): o que a barra de ações da tecla E mostra (interact.ts) — tipos e a junção das
// ações dos provedores. Puro (sem DOM), testado em ux/ux.test.ts.

/** Família da ação: dá a cor do ícone na barra. */
export type KvInteractTone = 'seat' | 'food' | 'fun' | 'read' | 'board' | 'link' | 'door' | 'work' | 'stand' | 'care' | 'rest';

export interface KvInteractable {
  /** Estável enquanto for a mesma coisa (evita piscar a barra). */
  id: string;
  /** Texto da ação, já traduzido (ex.: tr('Sentar')). */
  label: string;
  /** Distância em pixels do mundo até o meu boneco (o menor vence). */
  dist: number;
  run(): void;
  /** Emoji do ícone (padrão ✋). */
  icon?: string;
  /** Cor do ícone (padrão 'work'). */
  tone?: KvInteractTone;
  /** Linha pequena embaixo do nome, já traduzida (ex.: o nome da sala). */
  sub?: string;
}

/** Recebe a posição do meu boneco (pixels do mundo) e devolve o que dá para usar ali (uma ou várias), ou null. */
export type KvInteractProvider = (me: { x: number; y: number }, now: number) => KvInteractable | KvInteractable[] | null;

/** Quantas ações a barra mostra no máximo (a principal + alternativas). */
export const KV_INTERACT_MAX = 4;

/** Junta as ações dos provedores: sem repetidas, da mais perto para a mais longe (puro, testado). */
export function kvMergeInteract(found: (KvInteractable | KvInteractable[] | null)[], max = KV_INTERACT_MAX): KvInteractable[] {
  const byId = new Map<string, KvInteractable>();
  for (const f of found) {
    for (const c of Array.isArray(f) ? f : f ? [f] : []) {
      if (!c || !Number.isFinite(c.dist)) continue;
      const had = byId.get(c.id);
      if (!had || c.dist < had.dist) byId.set(c.id, c);
    }
  }
  return [...byId.values()].sort((a, b) => a.dist - b.dist).slice(0, max);
}
