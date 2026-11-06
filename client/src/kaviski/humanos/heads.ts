// Fork Kaviski (KAVISKI-HUMANOS.md): coisas "saindo da cabeça" do boneco, em tamanho reduzido (como no Gather).
//
// Cada pessoa no escritório pode ter uma pilha de miniaturas ao lado da cabeça, que acompanha o boneco quando ele
// anda e a câmera quando ela se move: a tela compartilhada em miniatura (clique amplia; media.ts), o começo de uma
// mensagem 1:1 que acabou de chegar (só quem recebe vê; clique abre a conversa; chat.ts) e o que outros módulos
// pendurarem (`kvHeads.set`). A bolinha da câmera continua em cima da cabeça (media.ts); a pilha fica do lado.
// A pilha some quando a pessoa sai da tela ou do escritório.
import type { Track } from 'livekit-client';
import { h } from '../../ui/dom';
import { kvPeople } from './world';

interface Item {
  el: HTMLElement;
  order: number;
  until: number;
}

interface Stack {
  box: HTMLElement;
  items: Map<string, Item>;
}

/** Escala das miniaturas pelo zoom da câmera (perto maior, longe menor, sempre legível). */
export function kvHeadScale(zoom: number): number {
  return Math.max(0.75, Math.min(1.25, 0.55 + zoom * 0.25));
}

class KvHeads {
  private readonly stacks = new Map<string, Stack>();
  private started = false;

  /** Pendura (ou troca) uma miniatura na cabeça da pessoa ('' = eu). `ttlMs` some sozinha depois desse tempo. */
  set(personId: string, key: string, el: HTMLElement, opts: { order?: number; ttlMs?: number } = {}): void {
    this.start();
    let s = this.stacks.get(personId);
    if (!s) {
      s = { box: h('div', { class: 'kv-heads', hidden: true, attrs: { 'data-who': personId || 'eu' } }), items: new Map() };
      (document.querySelector('.ui-root') ?? document.body).append(s.box);
      this.stacks.set(personId, s);
    }
    s.items.get(key)?.el.remove();
    el.classList.add('kv-heads__item');
    s.items.set(key, { el, order: opts.order ?? 50, until: opts.ttlMs ? Date.now() + opts.ttlMs : Infinity });
    const sorted = [...s.items.values()].sort((a, b) => a.order - b.order);
    s.box.replaceChildren(...sorted.map((i) => i.el));
  }

  drop(personId: string, key: string): void {
    const s = this.stacks.get(personId);
    const it = s?.items.get(key);
    if (!s || !it) return;
    it.el.remove();
    s.items.delete(key);
    if (!s.items.size) {
      s.box.remove();
      this.stacks.delete(personId);
    }
  }

  has(personId: string, key: string): boolean {
    return !!this.stacks.get(personId)?.items.has(key);
  }

  private start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    const loop = () => {
      requestAnimationFrame(loop);
      this.place();
    };
    requestAnimationFrame(loop);
  }

  /** A cada quadro: cada pilha ao lado da cabeça do seu boneco. */
  private place(): void {
    const now = Date.now();
    for (const [id, s] of [...this.stacks]) {
      for (const [key, it] of [...s.items]) if (now >= it.until) this.drop(id, key);
      if (!this.stacks.has(id)) continue;
      const at = kvPeople.inside || id ? kvPeople.locate?.(id || null) : null;
      if (!at) {
        s.box.hidden = true;
        continue;
      }
      s.box.hidden = false;
      const k = kvHeadScale(at.zoom);
      // ao lado da cabeça (à direita), na altura dela
      const x = Math.round(at.sx + 9 * at.zoom);
      const y = Math.round(at.sy - 26 * at.zoom);
      s.box.style.transform = `translate(${x}px, ${y}px) translate(0, -50%) scale(${k})`;
    }
  }
}

export const kvHeads = new KvHeads();

/** Miniatura ao vivo de uma tela compartilhada (clique amplia o quadro grande). */
export function kvScreenMini(track: Track, title: string, open: () => void): HTMLElement {
  const video = track.attach() as HTMLVideoElement;
  video.muted = true;
  video.playsInline = true;
  return h('button', { class: 'kv-head-screen', type: 'button', title, attrs: { 'aria-label': title }, on: { click: open } }, video, h('span', { class: 'kv-head-screen__tag', text: '📺' }));
}

/** Balãozinho de uma mensagem 1:1 que acabou de chegar (clique abre a conversa). */
export function kvMessageMini(text: string, title: string, open: () => void, urgent = false): HTMLElement {
  const short = [...text.replace(/\s+/g, ' ').trim()].slice(0, 38).join('') + ([...text].length > 38 ? '…' : '');
  return h('button', { class: `kv-head-msg${urgent ? ' is-urgent' : ''}`, type: 'button', title, attrs: { 'aria-label': title }, on: { click: open } }, h('span', { text: urgent ? '❗' : '💬' }), h('span', { class: 'kv-head-msg__text', text: short }));
}
