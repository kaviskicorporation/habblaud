// Fork Kaviski (KAVISKI-HUMANOS.md, W2): roda de conversa privada nas áreas abertas (núcleo e corredor).
//
// "Conversa privada" (barra do topo) junta quem está a até KV_BUBBLE_TILES tiles num grupo `b:<id>` do servidor:
// a voz (token do LiveKit próprio) e o chat de proximidade do grupo ficam só entre os membros; quem chega perto depois
// não ouve nem lê (um membro pode chamá-lo pelo cartão: "Chamar para a conversa privada"). Um contorno sutil no chão
// marca o grupo. Afastar-se dos outros (ou sair da área) tira a pessoa da roda; com menos de 2, ela acaba.
// `kvPeople.callArea` = a área de voz e chat que vale para mim (media.ts e chat.ts usam).
import { KV_BUBBLE_TILES, kvIsOpenArea } from '../../../../shared/kaviski-social';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { TILE } from '../../world/constants';
import type { KvBar } from './bar';
import { kvEachFrame } from './overlay';
import { kvRegisterPersonAction } from './person-actions';
import type { KvPresenceClient } from './presence';
import { kvSocialPost } from './social-api';
import { kvPeople } from './world';

/** Longe de todos os outros membros (tiles) por LEAVE_MS: sai da roda. */
const LEAVE_TILES = 6;
const LEAVE_MS = 2_500;

export class KvBubble {
  readonly btn: HTMLButtonElement;
  private readonly layer: HTMLElement;
  private readonly rings = new Map<string, HTMLElement>();
  private farSince = 0;
  private busy = false;

  constructor(
    private readonly client: KvPresenceClient,
    private readonly bar: KvBar,
  ) {
    this.btn = h('button', { class: 'ui-btn ui-btn--sm kv-bubble-btn', type: 'button', hidden: true, on: { click: () => void this.toggle() } });
    this.layer = h('div', { class: 'kv-bubble-layer', attrs: { 'aria-hidden': 'true' } });
    document.body.append(this.layer);
    client.onEvent<{ id: string; by: string; joined: string[] }>('bubble', (e) => {
      const me = client.state?.me;
      if (e?.joined?.includes(me ?? '') && e.by !== client.me()?.name) this.bar.warn(tr('{0} abriu uma conversa privada com você.', [e.by]));
    });
    kvRegisterPersonAction({
      id: 'conversa-privada',
      label: tr('Chamar para a conversa privada'),
      icon: '🤫',
      order: 60,
      when: (p) => !!this.mine() && !p.bubble && !!p.pos && this.near(p.id, LEAVE_TILES),
      run: (p) => void kvSocialPost('bubble', { action: 'add', who: p.id }).then((r) => this.bar.warn(r.ok ? tr('{0} entrou na conversa privada.', [p.name]) : r.error)),
    });
    setInterval(() => this.tick(), 250);
    kvEachFrame(() => this.place());
  }

  mount(into: HTMLElement): void {
    into.append(this.btn);
  }

  /** A minha roda (id) ou null. */
  private mine(): string | null {
    return this.client.me()?.bubble ?? null;
  }

  /** Quem está a até `tiles` de mim (ids). */
  private nearIds(tiles: number): string[] {
    const me = kvPeople.locate?.(null);
    if (!me) return [];
    return (kvPeople.around?.() ?? []).filter((p) => Math.hypot(p.x - me.x, p.y - me.y) <= tiles * TILE).map((p) => p.id);
  }

  private near(id: string, tiles: number): boolean {
    return this.nearIds(tiles).includes(id);
  }

  private async toggle(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.mine()) {
        const r = await kvSocialPost('bubble', { action: 'leave' });
        if (!r.ok) this.bar.warn(r.error);
        return;
      }
      const near = this.nearIds(KV_BUBBLE_TILES);
      if (!near.length) return this.bar.warn(tr('Chegue perto de alguém (até {0} passos) para uma conversa privada.', [KV_BUBBLE_TILES]));
      const r = await kvSocialPost('bubble', { action: 'start', near });
      this.bar.warn(r.ok ? tr('Conversa privada: só vocês ouvem e leem.') : r.error);
    } finally {
      this.busy = false;
    }
  }

  private tick(): void {
    const bubble = kvPeople.inside ? this.mine() : null;
    // a área de voz e chat que vale para mim
    kvPeople.callArea = bubble ? `b:${bubble}` : undefined;
    const open = kvPeople.inside && kvIsOpenArea(kvPeople.area);
    this.btn.hidden = !bubble && (!open || !this.nearIds(KV_BUBBLE_TILES).length);
    this.btn.textContent = bubble ? tr('🤫 Sair da conversa privada') : tr('🤫 Conversa privada');
    this.btn.classList.toggle('is-on', !!bubble);
    if (!bubble) {
      this.farSince = 0;
      return;
    }
    // afastei de todos os outros da roda: saio
    const others = (this.client.state?.people ?? []).filter((p) => p.bubble === bubble && p.id !== this.client.state?.me).map((p) => p.id);
    const close = others.some((id) => this.near(id, LEAVE_TILES));
    const t = Date.now();
    if (close) this.farSince = 0;
    else if (!this.farSince) this.farSince = t;
    else if (t - this.farSince >= LEAVE_MS && !this.busy) {
      this.farSince = 0;
      this.bar.warn(tr('Você se afastou: saiu da conversa privada.'));
      void kvSocialPost('bubble', { action: 'leave' });
    }
  }

  /** Um contorno sutil em volta de cada roda (no chão, em volta dos bonecos dela). */
  private place(): void {
    const s = this.client.state;
    const groups = new Map<string, { sx: number; sy: number; zoom: number }[]>();
    if (s && kvPeople.inside) {
      for (const p of s.people) {
        if (!p.bubble) continue;
        const at = kvPeople.locate?.(p.id === s.me ? null : p.id);
        if (!at) continue;
        const g = groups.get(p.bubble) ?? [];
        g.push(at);
        groups.set(p.bubble, g);
      }
    }
    const mine = this.mine();
    for (const [id, el] of this.rings) {
      if (!groups.has(id) || (groups.get(id)?.length ?? 0) < 1) {
        el.remove();
        this.rings.delete(id);
      }
    }
    for (const [id, pts] of groups) {
      let el = this.rings.get(id);
      if (!el) {
        el = h('div', { class: 'kv-bubble-ring' });
        this.layer.append(el);
        this.rings.set(id, el);
      }
      el.classList.toggle('is-mine', id === mine);
      const z = pts[0]!.zoom;
      const pad = 14 * z;
      const xs = pts.map((p) => p.sx);
      const ys = pts.map((p) => p.sy);
      const x0 = Math.min(...xs) - pad;
      const x1 = Math.max(...xs) + pad;
      const y0 = Math.min(...ys) - pad * 0.55;
      const y1 = Math.max(...ys) + pad * 0.55;
      el.style.width = `${Math.round(x1 - x0)}px`;
      el.style.height = `${Math.round(Math.max(y1 - y0, 10 * z))}px`;
      el.style.transform = `translate(${Math.round(x0)}px, ${Math.round(y0 + 2 * z)}px)`;
    }
  }
}
