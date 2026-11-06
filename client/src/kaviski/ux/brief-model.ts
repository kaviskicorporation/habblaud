// Fork Kaviski (KAVISKI.md, "Detalhes de UX"): regras puras do resumo (brief.ts) — a saudação pela hora e o que mudou
// nos agentes enquanto a aba esteve escondida. Testado em ux.test.ts.

/** Saudação pela hora local (o texto é a chave do tr()). */
export function kvGreeting(d: Date = new Date()): { text: 'Bom dia' | 'Boa tarde' | 'Boa noite'; icon: string } {
  const hr = d.getHours();
  if (hr >= 5 && hr < 12) return { text: 'Bom dia', icon: '☀️' };
  if (hr >= 12 && hr < 18) return { text: 'Boa tarde', icon: '🌤️' };
  return { text: 'Boa noite', icon: '🌙' };
}

interface AgentLike {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

const BUSY = new Set(['working', 'shell', 'waiting']);
const RESTING = new Set(['idle', 'done', 'offline']);

/**
 * O que mudou desde `before` (id → status): quem estava trabalhando e terminou, quem passou a pedir você, quem chegou.
 * Quem já pedia antes não conta de novo.
 */
export function kvAwaySummary<A extends AgentLike>(before: ReadonlyMap<string, string>, now: readonly A[]): { finished: A[]; waiting: A[]; arrived: A[] } {
  const finished: A[] = [];
  const waiting: A[] = [];
  const arrived: A[] = [];
  for (const a of now) {
    const was = before.get(a.id);
    if (was === undefined) {
      if (a.status !== 'offline') arrived.push(a);
      if (a.status === 'waiting') waiting.push(a);
      continue;
    }
    if (a.status === 'waiting' && was !== 'waiting') waiting.push(a);
    else if (BUSY.has(was) && RESTING.has(a.status)) finished.push(a);
  }
  return { finished, waiting, arrived };
}
