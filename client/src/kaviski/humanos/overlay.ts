// Fork Kaviski (KAVISKI-HUMANOS.md, W2): coisas desenhadas por cima do escritório em HTML (reações, mão levantada,
// cadeado na porta, contorno da roda privada). A cada quadro, cada uma se posiciona pelo boneco (kvPeople.locate).
import { kvPeople } from './world';

const fns = new Set<(now: number) => void>();
let running = false;

/** Roda `fn` a cada quadro (depois do desenho do mundo); devolve a função que para. */
export function kvEachFrame(fn: (now: number) => void): () => void {
  fns.add(fn);
  if (!running) {
    running = true;
    const loop = (t: number) => {
      for (const f of fns) {
        try {
          f(t);
        } catch {
          // um desenho com erro não derruba os outros
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return () => fns.delete(fn);
}

/** Converte px de mundo em px da janela, pela posição de um boneco na tela (o meu, ou o de alguém). */
export function kvWorldToScreen(wx: number, wy: number): { x: number; y: number; zoom: number } | null {
  let ref = kvPeople.locate?.(null) ?? null;
  if (!ref) {
    const any = kvPeople.around?.()[0];
    ref = any ? (kvPeople.locate?.(any.id) ?? null) : null;
  }
  if (!ref) return null;
  return { x: ref.sx + (wx - ref.x) * ref.zoom, y: ref.sy + (wy - ref.y) * ref.zoom, zoom: ref.zoom };
}
