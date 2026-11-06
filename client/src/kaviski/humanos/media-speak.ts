// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): quem está falando. Um anel aceso no chão, embaixo do
// boneco de quem fala (o meu também), desenhado num DOM nosso por cima do mundo, na posição de cada boneco
// (kvPeople.locate) — sem gancho no renderer do original. Quem está na minha chamada com o microfone desligado ganha
// um 🔇 na pilha ao lado da cabeça (heads.ts, ordem 5). A bolinha de vídeo ganha o destaque (media.ts, is-speaking).
import type { Participant, Room } from 'livekit-client';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvPeople } from './world';
import { kvHeads } from './heads';
import type { KvMedia } from './media';

/** Ordem do 🔇 na pilha da cabeça (heads.ts: abaixo de 10, a tela compartilhada). */
const MIC_ORDER = 5;

interface Mark {
  ring: HTMLElement;
  /** O 🔇 está pendurado na cabeça. */
  muted: boolean;
}

export class KvSpeaking {
  private readonly layer: HTMLElement;
  private readonly marks = new Map<string, Mark>();

  constructor(
    private readonly media: KvMedia,
    /** A chamada do palco (quem fala no palco também acende). */
    private readonly stage: () => Room | null,
  ) {
    this.layer = h('div', { class: 'kv-speak-layer', attrs: { 'aria-hidden': 'true' } });
    // logo acima do canvas do mundo, embaixo dos painéis
    document.body.append(this.layer);
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  private mark(id: string): Mark {
    let m = this.marks.get(id);
    if (!m) {
      m = { ring: h('div', { class: 'kv-speak-ring' }), muted: false };
      this.layer.append(m.ring);
      this.marks.set(id, m);
    }
    return m;
  }

  private frame(): void {
    const seen = new Set<string>();
    /** id da pessoa ('' = eu) → está falando / está mudo na chamada. */
    const state = new Map<string, { speaking: boolean; muted: boolean }>();
    const add = (id: string, p: Participant, inCall: boolean, audible: boolean) => {
      const cur = state.get(id) ?? { speaking: false, muted: false };
      cur.speaking ||= p.isSpeaking && audible;
      if (inCall) cur.muted = !p.isMicrophoneEnabled;
      state.set(id, cur);
    };
    const call = this.media.call;
    if (call) {
      add('', call.localParticipant, true, true);
      for (const p of call.remoteParticipants.values()) add(p.identity, p, true, this.media.volumeOf(p.identity) > 0);
    }
    const stage = this.stage();
    if (stage) {
      if (stage.localParticipant.isMicrophoneEnabled) add('', stage.localParticipant, false, true);
      for (const p of stage.remoteParticipants.values()) add(p.identity, p, false, !this.media.fx.prefs.stageMuted);
    }
    const me = kvPeople.client?.state?.me;
    for (const [id, s] of state) {
      const key = id === me ? '' : id;
      const at = kvPeople.locate?.(key || null);
      if (!at) continue;
      seen.add(key);
      const m = this.mark(key);
      const z = at.zoom;
      m.ring.hidden = !s.speaking;
      this.setMuted(key, m, s.muted && !s.speaking);
      if (!m.ring.hidden) {
        const w = Math.round(18 * z);
        const hgt = Math.round(8 * z);
        m.ring.style.width = `${w}px`;
        m.ring.style.height = `${hgt}px`;
        m.ring.style.transform = `translate(${Math.round(at.sx - w / 2)}px, ${Math.round(at.sy - hgt / 2)}px)`;
      }
    }
    for (const [id, m] of this.marks) {
      if (seen.has(id)) continue;
      m.ring.remove();
      this.setMuted(id, m, false);
      this.marks.delete(id);
    }
  }

  private setMuted(id: string, m: Mark, on: boolean): void {
    if (on === m.muted) return;
    m.muted = on;
    if (on) kvHeads.set(id, 'mic', h('span', { class: 'kv-head-mute', text: '🔇', title: tr('Microfone desligado'), attrs: { 'aria-label': tr('Microfone desligado') } }), { order: MIC_ORDER });
    else kvHeads.drop(id, 'mic');
  }
}
