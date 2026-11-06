// Fork Kaviski (KAVISKI-HUMANOS.md, W2): reações rápidas para todos (👍 ❤️ 😂 🎉 👏 ☕ ✋ 😮 🙏). Pela barra do topo
// (botão de carinha) ou pelas teclas 1–9 com o foco no escritório. Aparecem sobre o meu boneco para todo mundo que me
// vê (o servidor manda o evento `react` só a quem vê o meu boneco) e sobem sumindo; não vão para o chat.
// ✋ é "levantar a mão": fica ao lado da cabeça (na pilha do heads.ts) e na lista até baixar.
import { KV_HAND, KV_REACTIONS, type KvReactEvent } from '../../../../shared/kaviski-social';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { modalOpen } from '../../world/input';
import type { KvBar } from './bar';
import { kvHeads } from './heads';
import { kvEachFrame } from './overlay';
import type { KvPresenceClient } from './presence';
import { kvSocialPost } from './social-api';
import { kvPeople } from './world';

const FLOAT_MS = 2_600;

interface Float {
  who: string | null;
  el: HTMLElement;
  born: number;
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}

export class KvReactions {
  readonly btn: HTMLButtonElement;
  private readonly strip: HTMLElement;
  private handBtn: HTMLButtonElement | null = null;
  private readonly floats: Float[] = [];
  private readonly hands = new Set<string>();
  private readonly layer: HTMLElement;

  constructor(
    private readonly client: KvPresenceClient,
    private readonly bar: KvBar,
  ) {
    this.btn = h('button', { class: 'ui-icon-btn kv-dock__btn kv-dock__plain kv-react-toggle', type: 'button', text: '😀', title: tr('Reações (1–9)'), attrs: { 'aria-label': tr('Reações (1–9)'), 'aria-expanded': 'false' }, on: { click: () => this.toggle() } });
    const items = KV_REACTIONS.map((emoji, i) => {
      const b = h('button', {
        class: 'kv-react-strip__btn',
        type: 'button',
        text: emoji,
        title: emoji === KV_HAND ? tr('Levantar/baixar a mão ({0})', [i + 1]) : `${emoji} (${i + 1})`,
        attrs: { 'aria-label': emoji === KV_HAND ? tr('Levantar a mão') : emoji },
        on: { click: () => void this.send(emoji) },
      });
      if (emoji === KV_HAND) this.handBtn = b;
      return b;
    });
    this.strip = h('span', { class: 'kv-react-strip', hidden: true, role: 'group', attrs: { 'aria-label': tr('Reações') } }, ...items);
    this.layer = h('div', { class: 'kv-react-layer', attrs: { 'aria-hidden': 'true' } });
    document.body.append(this.layer);
    client.onEvent<KvReactEvent>('react', (e) => this.show(e));
    client.on(() => this.syncHands());
    document.addEventListener('keydown', (e) => this.onKey(e));
    kvEachFrame((now) => this.place(now));
  }

  /** O botão e a faixa entram na barra do topo (social.ts). */
  mount(into: HTMLElement): void {
    into.append(this.btn, this.strip);
  }

  private toggle(open = !!this.strip.hidden): void {
    this.strip.hidden = !open;
    this.btn.classList.toggle('is-on', open);
    this.btn.setAttribute('aria-expanded', String(open));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    if (!kvPeople.inside || typing(e.target) || modalOpen(e.target as HTMLElement | null)) return;
    const t = e.target as HTMLElement | null;
    if (t && t !== document.body && t !== document.documentElement && t.tagName !== 'CANVAS') return;
    if (document.querySelector('.ui-city-wheel:not([hidden])')) return; // a roda de cumprimentos usa 1–9
    e.preventDefault();
    void this.send(KV_REACTIONS[Number(e.key) - 1]!);
  }

  private async send(emoji: string): Promise<void> {
    if (!kvPeople.inside) return this.bar.warn(tr('Entre no escritório (Andar) para reagir.'));
    const r = await kvSocialPost('react', { emoji });
    if (!r.ok) this.bar.warn(r.error);
  }

  private show(e: KvReactEvent): void {
    if (!e?.emoji) return;
    const who = e.who === this.client.state?.me ? null : e.who;
    const el = h('span', { class: 'kv-float', text: e.emoji });
    this.layer.append(el);
    this.floats.push({ who, el, born: performance.now() });
    while (this.floats.length > 40) this.floats.shift()!.el.remove();
  }

  /** Mãos levantadas: uma ✋ na pilha ao lado da cabeça de cada boneco com `hand` (kvHeads, ordem 30). */
  private syncHands(): void {
    const s = this.client.state;
    const up = new Set((s?.people ?? []).filter((p) => p.hand).map((p) => (p.id === s?.me ? '' : p.id)));
    for (const id of [...this.hands]) {
      if (!up.has(id)) {
        kvHeads.drop(id, 'hand');
        this.hands.delete(id);
      }
    }
    for (const id of up) {
      if (this.hands.has(id)) continue;
      kvHeads.set(id, 'hand', h('span', { class: 'kv-hand', text: KV_HAND, title: tr('Mão levantada') }), { order: 30 });
      this.hands.add(id);
    }
    const mine = up.has('');
    this.handBtn?.classList.toggle('is-on', mine);
    this.handBtn?.setAttribute('aria-label', mine ? tr('Baixar a mão') : tr('Levantar a mão'));
  }

  private place(now: number): void {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]!;
      const age = now - f.born;
      const at = age < FLOAT_MS ? kvPeople.locate?.(f.who) : null;
      if (!at) {
        f.el.remove();
        this.floats.splice(i, 1);
        continue;
      }
      const k = age / FLOAT_MS;
      // cada reação nova sai um pouco de lado para não cobrir a anterior
      const dx = ((i % 3) - 1) * 9;
      f.el.style.transform = `translate(${Math.round(at.sx + dx)}px, ${Math.round(at.sy - 40 * at.zoom - k * 46)}px) translate(-50%, -100%) scale(${0.8 + Math.min(1, k * 4) * 0.4})`;
      f.el.style.opacity = String(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
    }
  }
}
