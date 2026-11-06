// Fork Kaviski (KAVISKI-HUMANOS.md → "ir e fazer"): a parte pura do go-and-do.ts — saber se a janela que o clique abriu
// continua aberta (no modo "abre na hora", fechar a janela antes de o boneco chegar para o boneco).

export type KvOpenState = 'open' | 'closed' | 'unknown';

/**
 * Olha as janelas visíveis a cada quadro. `before` = as que já estavam abertas antes do clique (não contam). Uma janela
 * nova que aparece até `graceMs` depois do clique é "a janela da ação" (algumas abrem depois de buscar dados). Também
 * vale o botão da ação (aria-expanded/aria-pressed): se ele ligou e depois desligou, a janela fechou.
 * - 'open': a janela (ou outra nova) está aberta;
 * - 'closed': abriu e já não há nenhuma janela nova visível (ou o botão desligou);
 * - 'unknown': nada abriu que dê para ver (ação sem janela) — o boneco segue andando.
 */
export class KvOpenWatch<T> {
  private seen = false;
  private buttonOn = false;

  constructor(
    private readonly before: ReadonlySet<T>,
    private readonly t0: number,
    private readonly graceMs = 1500,
  ) {}

  update(now: number, visible: Iterable<T>, button: boolean | null): KvOpenState {
    let fresh = false;
    for (const v of visible) {
      if (this.before.has(v)) continue;
      fresh = true;
      if (now - this.t0 <= this.graceMs) this.seen = true;
    }
    if (button === true) this.buttonOn = true;
    if (this.buttonOn && button === false) return 'closed';
    if (this.seen) return fresh ? 'open' : 'closed';
    return this.buttonOn ? 'open' : 'unknown';
  }
}
