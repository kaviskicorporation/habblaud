// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): o palco (megafone), lado da página.
//
// - Admin e equipe têm o botão 📢 na barra do topo: sobe no palco e fala para o andar inteiro (servidor: stage.ts).
// - Todo mundo online (com ou sem o boneco no escritório; cliente também) vê "📢 Fulano no palco" e ouve, numa chamada
//   do LiveKit à parte em que só quem está no palco publica (o token dos outros só deixa ouvir). Dá para silenciar o
//   palco neste navegador. Não perturbe não corta o palco (é um aviso para todos); quem não quiser ouvir, silencia.
// - Enquanto alguém está no palco, a voz dele na chamada da área fica muda para quem ouve o palco (não chega em dobro).
import type { RemoteParticipant, RemoteTrack, Room } from 'livekit-client';
import type { KvStageState, KvStageToken } from '../../../../shared/kaviski-media';
import { kvRestricted } from '../../../../shared/kaviski-humanos';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import type { KvBar } from './bar';
import type { KvMedia } from './media';
import type { KvPresenceClient } from './presence';

const API = '/api/kaviski/humanos/stage';
/** O fluxo de presença avisa na hora; isto é só a garantia (página que perdeu um evento). */
const POLL_MS = 30_000;

const MEGAPHONE_ICON = pixelIcon(['........#.', '......###.', '....##.##.', '####...##.', '#.#....##.', '#.#....##.', '####...##.', '.#..##.##.', '.#....###.', '.##.....#.']);

export class KvStageClient {
  state: KvStageState = { active: false };
  /** A chamada do palco em que estou (ouvindo ou falando). */
  room: Room | null = null;
  private joinedSince = 0;
  private busy = false;
  private canPlay = true;
  private readonly btn: HTMLButtonElement;
  private readonly pill: HTMLElement;
  private readonly text: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly audio: HTMLElement;

  constructor(
    private readonly media: KvMedia,
    private readonly bar: KvBar,
    private readonly client: KvPresenceClient,
  ) {
    this.btn = h('button', { class: 'ui-icon-btn kv-dock__btn kv-dock__stage', type: 'button', hidden: true, on: { click: () => void this.toggle() } });
    this.btn.innerHTML = MEGAPHONE_ICON;
    bar.media.append(this.btn);
    this.text = h('span', { class: 'kv-stage__text' });
    this.action = h('button', { class: 'ui-btn ui-btn--sm kv-stage__action', type: 'button', on: { click: () => this.onAction() } });
    this.pill = h('div', { class: 'kv-stage', hidden: true, attrs: { role: 'status', 'aria-live': 'polite' } }, this.text, this.action);
    (document.querySelector('.ui-root') ?? document.body).append(this.pill);
    this.audio = h('div', { class: 'kv-audio', hidden: true });
    document.body.append(this.audio);
    client.onEvent<KvStageState>('stage', (s) => this.apply(s));
    // a página voltou a ver o fluxo (servidor reiniciado, rede): pergunta de novo
    client.on(() => this.paint());
    void this.fetchState();
    setInterval(() => void this.fetchState(), POLL_MS);
    media.fx.onChange(() => this.paint());
  }

  private me(): string | undefined {
    return this.client.state?.me;
  }

  private mine(): boolean {
    return this.state.active && !!this.me() && this.state.by?.id === this.me();
  }

  private async fetchState(): Promise<void> {
    try {
      const res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) this.apply((await res.json()) as KvStageState);
    } catch {
      // fica com o que tinha
    }
  }

  private apply(s: KvStageState): void {
    this.state = s?.active ? s : { active: false };
    void this.sync();
    this.paint();
  }

  /** Entra na chamada do palco aberto (ou sai, se fechou). */
  private async sync(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const want = this.state.active ? (this.state.since ?? 0) : 0;
      if (this.room && this.joinedSince !== want) await this.leave();
      if (want && !this.room) await this.join();
    } finally {
      this.busy = false;
    }
    // mudou de novo enquanto conectava
    const want = this.state.active ? (this.state.since ?? 0) : 0;
    if (want !== (this.room ? this.joinedSince : 0)) void this.sync();
    this.paint();
  }

  private async join(): Promise<void> {
    let info: KvStageToken;
    try {
      const res = await fetch(`${API}/token`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) return;
      info = (await res.json()) as KvStageToken;
    } catch {
      return;
    }
    const lk = (this.media.lk ??= await import('livekit-client'));
    const room = new lk.Room({ adaptiveStream: true, dynacast: true });
    room
      .on(lk.RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
        if (track.kind !== lk.Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset.who = p.identity;
        this.audio.append(el);
        this.volume();
      })
      .on(lk.RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const el of track.detach()) el.remove();
      })
      .on(lk.RoomEvent.AudioPlaybackStatusChanged, () => {
        this.canPlay = room.canPlaybackAudio;
        this.paint();
      })
      .on(lk.RoomEvent.Disconnected, () => {
        if (this.room !== room) return;
        this.room = null;
        this.audio.replaceChildren();
        this.paint();
        // caiu sem o palco fechar: tenta de novo daqui a pouco
        setTimeout(() => void this.sync(), 2000);
      });
    try {
      await room.connect(info.url, info.token, { autoSubscribe: true });
    } catch (err) {
      this.bar.warn(tr('Não deu para ouvir o palco ({0}).', [(err as Error).message]));
      return;
    }
    this.room = room;
    this.joinedSince = info.since;
    this.canPlay = room.canPlaybackAudio;
    if (info.canPublish) {
      if (!window.isSecureContext) this.bar.warn(tr('Microfone e câmera só funcionam com o Habblaud em HTTPS (ou localhost).'));
      else {
        try {
          await room.localParticipant.setMicrophoneEnabled(true, this.media.fx.micOptions());
          const mic = room.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.track;
          const err = await this.media.fx.applyMic(mic as Parameters<KvMedia['fx']['applyMic']>[0]);
          if (err) this.bar.warn(err);
        } catch (err) {
          this.bar.warn(tr('Não deu para ligar o microfone ({0}).', [(err as Error).message]));
        }
      }
    }
    if (this.media.fx.prefs.outId) await room.switchActiveDevice('audiooutput', this.media.fx.prefs.outId).catch(() => {});
    this.volume();
  }

  private async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.audio.replaceChildren();
    await room?.disconnect().catch(() => {});
  }

  /** Palco silenciado neste navegador: volume 0 (e a voz de quem está no palco volta pela chamada da área). */
  private volume(): void {
    const muted = this.media.fx.prefs.stageMuted;
    for (const p of this.room?.remoteParticipants.values() ?? []) p.setVolume(muted ? 0 : 1);
    const by = this.state.active ? this.state.by?.id : undefined;
    this.media.stageSpeaker = by && by !== this.me() && !muted && this.room ? by : null;
  }

  private async toggle(): Promise<void> {
    // aberto: quem está no palco desce (ou um admin fecha o palco de outro); fechado: sobe
    const on = !this.state.active;
    try {
      const res = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
      const body = (await res.json().catch(() => ({}))) as KvStageState & { error?: string };
      if (!res.ok) return this.bar.warn(body.error ?? String(res.status));
      this.apply(body);
    } catch {
      this.bar.warn(tr('Sem conexão com o Habblaud.'));
    }
  }

  private onAction(): void {
    if (this.mine()) return void this.toggle();
    if (!this.canPlay && this.room) {
      // o navegador segurou o som até um clique: este é o clique
      void this.room.startAudio().then(() => {
        this.canPlay = true;
        this.paint();
      });
      return;
    }
    this.media.fx.set({ stageMuted: !this.media.fx.prefs.stageMuted });
    this.volume();
  }

  paint(): void {
    const me = this.client.me();
    const canSpeak = !!me && !kvRestricted(me);
    const mine = this.mine();
    this.btn.hidden = !canSpeak;
    this.btn.classList.toggle('is-on', mine);
    this.btn.title = mine ? tr('Descer do palco') : this.state.active ? me?.role === 'admin' ? tr('Fechar o palco de {0}', [this.state.by?.name ?? '']) : tr('{0} está no palco', [this.state.by?.name ?? '']) : tr('Palco: falar para o andar inteiro');
    this.btn.setAttribute('aria-label', this.btn.title);
    this.btn.setAttribute('aria-pressed', String(mine));
    this.btn.disabled = this.state.active && !mine && me?.role !== 'admin';
    const s = this.state;
    this.pill.hidden = !s.active;
    if (!s.active) return;
    const muted = this.media.fx.prefs.stageMuted;
    this.text.textContent = mine ? tr('📢 Você está no palco: o andar inteiro ouve') : tr('📢 {0} no palco', [s.by?.name ?? '']);
    this.action.textContent = mine ? tr('Descer do palco') : !this.canPlay && this.room ? tr('Ouvir o palco') : muted ? tr('Ouvir') : tr('Silenciar');
    this.action.title = mine ? '' : muted ? tr('Voltar a ouvir o palco') : tr('Silenciar o palco neste navegador');
    this.pill.classList.toggle('is-muted', muted && !mine);
    this.volume();
  }
}
