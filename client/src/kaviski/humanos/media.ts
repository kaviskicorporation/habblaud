// Fork Kaviski (KAVISKI-HUMANOS.md): voz e vídeo (fase 1c) com o LiveKit (livekit-client, Apache 2.0, carregado só
// quando o servidor diz que a voz está ligada).
//
// - Uma chamada por área (world.ts kvPeople.area): entrou na sala, entra na chamada dela; nas áreas comuns e no
//   corredor também, com o volume pela distância entre os bonecos (proximidade). Trocar de área troca de chamada.
// - Microfone e câmera começam desligados; a escolha fica lembrada neste navegador.
// - Câmera: bolinha com o vídeo em cima do boneco de cada pessoa (some quando ela está longe demais para ouvir).
// - Compartilhar tela: quem recebe vê um quadro flutuante (clique amplia).
// - O servidor só dá o token das chamadas que a pessoa pode ouvir (cliente: as salas dele e as áreas comuns).
import type { Participant, RemoteParticipant, RemoteTrack, Room, Track, TrackPublication } from 'livekit-client';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { ICONS, pixelIcon } from '../../ui/icons';
import { TILE } from '../../world/constants';
import { kvPeople } from './world';
import type { KvBar } from './bar';

type LK = typeof import('livekit-client');

const PREFS = 'habblaud.kv.media';
/** Proximidade nas áreas abertas: volume cheio até NEAR tiles, some em FAR. */
const NEAR = 3 * TILE;
const FAR = 11 * TILE;
/** A área precisa ficar parada este tempo antes de trocar de chamada (atravessar uma porta não troca duas vezes). */
const SWITCH_MS = 700;

const CAM_ICON = pixelIcon(['..........', '.######...', '.#....#.##', '.#....###.', '.#....###.', '.#....#.##', '.######...', '..........']);
const SCREEN_ICON = pixelIcon(['##########', '#........#', '#........#', '#........#', '#........#', '##########', '....##....', '..######..']);

/** Chave da minha própria tela no mapa de quadros. */
const ME = '\u0000eu';

/** Erro de microfone/câmera em palavras (sem aparelho, bloqueado, em uso por outro programa). */
function deviceError(err: unknown, kind: 'mic' | 'cam'): string {
  const name = (err as Error)?.name ?? '';
  if (name === 'NotFoundError' || /not found/i.test((err as Error)?.message ?? '')) {
    return kind === 'cam' ? tr('Nenhuma câmera encontrada neste aparelho.') : tr('Nenhum microfone encontrado neste aparelho.');
  }
  if (name === 'NotAllowedError') return kind === 'cam' ? tr('A câmera foi bloqueada no navegador (cadeado ao lado do endereço).') : tr('O microfone foi bloqueado no navegador (cadeado ao lado do endereço).');
  if (name === 'NotReadableError') return kind === 'cam' ? tr('A câmera está em uso por outro programa.') : tr('O microfone está em uso por outro programa.');
  return kind === 'cam' ? tr('Não deu para ligar a câmera ({0}).', [(err as Error)?.message ?? '']) : tr('Não deu para ligar o microfone ({0}).', [(err as Error)?.message ?? '']);
}

export function proximityVolume(dist: number): number {
  if (dist <= NEAR) return 1;
  if (dist >= FAR) return 0;
  return 1 - (dist - NEAR) / (FAR - NEAR);
}

interface Prefs {
  mic: boolean;
  cam: boolean;
}

export class KvMedia {
  private lk: LK | null = null;
  private room: Room | null = null;
  private area: string | null = null;
  private wanted: string | null = null;
  private wantedSince = 0;
  private switching = false;
  private prefs: Prefs = { mic: false, cam: false };
  private screen = false;
  private readonly micBtn: HTMLButtonElement;
  private readonly camBtn: HTMLButtonElement;
  private readonly screenBtn: HTMLButtonElement;
  private readonly audio: HTMLElement;
  /** Bolinhas de câmera por pessoa ('' = eu). */
  private readonly bubbles = new Map<string, HTMLElement>();
  private readonly screens = new Map<string, HTMLElement>();
  private readonly volumes = new Map<string, number>();
  private raf = 0;

  constructor(
    private readonly url: string,
    private readonly bar: KvBar,
  ) {
    try {
      this.prefs = { ...this.prefs, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>) };
    } catch {
      // sem preferências
    }
    this.micBtn = this.toggle(ICONS.mic, () => void this.setMic(!this.prefs.mic));
    this.camBtn = this.toggle(CAM_ICON, () => void this.setCam(!this.prefs.cam));
    this.screenBtn = this.toggle(SCREEN_ICON, () => void this.setScreen(!this.screen));
    bar.media.append(this.micBtn, this.camBtn, this.screenBtn);
    bar.media.setAttribute('aria-label', tr('Voz e vídeo'));
    this.audio = h('div', { class: 'kv-audio', hidden: true });
    (document.querySelector('.ui-root') ?? document.body).append(this.audio);
    this.paint();
    setInterval(() => void this.tick(), 250);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.place();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private toggle(icon: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { class: 'ui-icon-btn kv-dock__btn', type: 'button', on: { click: onClick } });
    b.innerHTML = icon;
    return b;
  }

  private save(): void {
    try {
      localStorage.setItem(PREFS, JSON.stringify(this.prefs));
    } catch {
      // sem localStorage
    }
  }

  private paint(): void {
    const set = (b: HTMLButtonElement, on: boolean, onText: string, offText: string) => {
      b.classList.toggle('is-on', on);
      b.title = on ? onText : offText;
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(on));
    };
    set(this.micBtn, this.prefs.mic, tr('Desligar o microfone'), tr('Ligar o microfone'));
    set(this.camBtn, this.prefs.cam, tr('Desligar a câmera'), tr('Ligar a câmera'));
    set(this.screenBtn, this.screen, tr('Parar de compartilhar a tela'), tr('Compartilhar a tela'));
    this.bar.setCall(!!this.room);
  }

  private warn(text: string): void {
    this.bar.warn(text);
  }

  private mediaOk(): boolean {
    if (window.isSecureContext && navigator.mediaDevices) return true;
    this.warn(tr('Microfone e câmera só funcionam com o Habblaud em HTTPS (ou localhost).'));
    return false;
  }

  private async setMic(on: boolean): Promise<void> {
    if (on && !this.mediaOk()) return;
    this.prefs.mic = on;
    this.save();
    this.paint();
    try {
      await this.room?.localParticipant.setMicrophoneEnabled(on);
    } catch (err) {
      this.prefs.mic = false;
      this.paint();
      this.warn(deviceError(err, 'mic'));
    }
  }

  private async setCam(on: boolean): Promise<void> {
    if (on && !this.mediaOk()) return;
    this.prefs.cam = on;
    this.save();
    this.paint();
    try {
      await this.room?.localParticipant.setCameraEnabled(on, { resolution: { width: 320, height: 240, frameRate: 15 } });
    } catch (err) {
      this.prefs.cam = false;
      this.paint();
      this.warn(deviceError(err, 'cam'));
    }
    if (!on) this.dropBubble('');
  }

  private async setScreen(on: boolean): Promise<void> {
    if (on && !this.mediaOk()) return;
    if (!this.room) return this.warn(tr('Entre numa sala para compartilhar a tela.'));
    try {
      await this.room.localParticipant.setScreenShareEnabled(on);
      this.screen = on;
    } catch (err) {
      this.screen = false;
      if ((err as Error).name !== 'NotAllowedError') this.warn(tr('Não deu para compartilhar a tela ({0}).', [(err as Error).message]));
    }
    this.paint();
  }

  /** A cada 250 ms: troca de chamada quando a área mudou e ficou parada; ajusta os volumes pela distância. */
  private async tick(): Promise<void> {
    const want = kvPeople.inside ? kvPeople.area : null;
    const now = Date.now();
    if (want !== this.wanted) {
      this.wanted = want;
      this.wantedSince = now;
    }
    if (!this.switching && this.wanted !== this.area && now - this.wantedSince >= SWITCH_MS) {
      this.switching = true;
      try {
        await this.join(this.wanted);
      } finally {
        this.switching = false;
      }
    }
    this.updateVolumes();
    this.paint();
  }

  private async join(area: string | null): Promise<void> {
    const old = this.room;
    this.room = null;
    this.area = area;
    // Microfone, câmera e tela continuam ligados de uma área para a outra: as faixas saem da chamada velha sem
    // desligar (disconnect(false)) e são publicadas na nova (sem pedir permissão de novo nem a tela sumir).
    const keep = old ? [...old.localParticipant.trackPublications.values()].map((p) => p.track).filter((t): t is NonNullable<typeof t> => !!t) : [];
    if (old) {
      await old.disconnect(false).catch(() => {});
      for (const id of [...this.bubbles.keys()]) this.dropBubble(id);
      for (const id of [...this.screens.keys()]) this.dropScreen(id);
      this.audio.replaceChildren();
    }
    if (!area) {
      for (const t of keep) t.stop();
      this.screen = false;
      this.dropScreen(ME);
      return;
    }
    let info: { url: string; token: string; name: string };
    try {
      const res = await fetch('/api/kaviski/humanos/livekit-token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area }),
      });
      if (!res.ok) {
        this.area = null;
        return;
      }
      info = (await res.json()) as typeof info;
    } catch {
      this.area = null;
      return;
    }
    this.lk ??= await import('livekit-client');
    const lk = this.lk;
    const room = new lk.Room({ adaptiveStream: true, dynacast: true });
    room
      .on(lk.RoomEvent.TrackSubscribed, (track, _pub, p) => this.onTrack(track, p))
      .on(lk.RoomEvent.TrackUnsubscribed, (track, _pub, p) => this.offTrack(track, p))
      .on(lk.RoomEvent.LocalTrackPublished, (pub) => this.onLocal(pub, true))
      .on(lk.RoomEvent.LocalTrackUnpublished, (pub) => this.onLocal(pub, false))
      .on(lk.RoomEvent.ParticipantDisconnected, (p) => {
        this.dropBubble(p.identity);
        this.dropScreen(p.identity);
      });
    try {
      await room.connect(info.url || this.url, info.token, { autoSubscribe: true });
    } catch (err) {
      this.area = null;
      this.warn(tr('Não deu para entrar na chamada ({0}).', [(err as Error).message]));
      return;
    }
    if (this.area !== area) {
      // mudou de área enquanto conectava
      for (const t of keep) t.stop();
      await room.disconnect();
      return;
    }
    this.room = room;
    const kept = new Set<string>();
    for (const t of keep) {
      try {
        await room.localParticipant.publishTrack(t, { source: t.source });
        kept.add(t.source);
      } catch {
        t.stop();
      }
    }
    if (!kept.has(lk.Track.Source.ScreenShare)) this.screen = false;
    if (this.prefs.mic && !kept.has(lk.Track.Source.Microphone) && this.mediaOk()) await room.localParticipant.setMicrophoneEnabled(true).catch((err) => this.warn(deviceError(err, 'mic')));
    if (this.prefs.cam && !kept.has(lk.Track.Source.Camera) && this.mediaOk()) await room.localParticipant.setCameraEnabled(true, { resolution: { width: 320, height: 240, frameRate: 15 } }).catch((err) => this.warn(deviceError(err, 'cam')));
  }

  private onTrack(track: RemoteTrack, p: RemoteParticipant): void {
    const lk = this.lk!;
    if (track.kind === lk.Track.Kind.Audio) {
      const el = track.attach();
      el.dataset.who = p.identity;
      this.audio.append(el);
    } else if (track.source === lk.Track.Source.ScreenShare) this.addScreen(p, track);
    else if (track.kind === lk.Track.Kind.Video) this.addBubble(p.identity, p.name || p.identity, track);
  }

  private offTrack(track: RemoteTrack, p: RemoteParticipant): void {
    const lk = this.lk!;
    for (const el of track.detach()) el.remove();
    if (track.source === lk.Track.Source.ScreenShare) this.dropScreen(p.identity);
    else if (track.kind === lk.Track.Kind.Video) this.dropBubble(p.identity);
  }

  private onLocal(pub: TrackPublication, on: boolean): void {
    const lk = this.lk!;
    if (pub.source === lk.Track.Source.ScreenShare) {
      // quem compartilha vê a própria tela (com Parar); o navegador também para pelo botão dele
      if (on && pub.track) {
        this.screen = true;
        this.addScreen(null, pub.track);
      } else {
        this.screen = false;
        this.dropScreen(ME);
      }
      this.paint();
      return;
    }
    if (pub.source !== lk.Track.Source.Camera) return;
    if (on && pub.track) this.addBubble('', tr('Você'), pub.track);
    else this.dropBubble('');
  }

  private addBubble(id: string, name: string, track: Track): void {
    this.dropBubble(id);
    const video = track.attach() as HTMLVideoElement;
    video.muted = true;
    video.playsInline = true;
    const el = h('div', { class: `kv-cam${id ? '' : ' kv-cam--me'}`, title: name }, video);
    document.body.append(el);
    this.bubbles.set(id, el);
  }

  private dropBubble(id: string): void {
    const el = this.bubbles.get(id);
    if (!el) return;
    el.querySelectorAll('video').forEach((v) => v.remove());
    el.remove();
    this.bubbles.delete(id);
  }

  /** Quadro da tela compartilhada (p = null: a minha, com o botão Parar). */
  private addScreen(p: Participant | null, track: Track): void {
    const id = p ? p.identity : ME;
    this.dropScreen(id);
    const video = track.attach() as HTMLVideoElement;
    video.muted = true;
    const stop = p
      ? null
      : h('button', { class: 'ui-btn ui-btn--sm kv-screen__stop', type: 'button', text: tr('Parar'), on: { click: (e: Event) => (e.stopPropagation(), void this.setScreen(false)) } });
    const el = h(
      'div',
      { class: `kv-screen${p ? '' : ' kv-screen--me'}`, on: { click: () => el.classList.toggle('is-big') } },
      h('div', { class: 'kv-screen__head' }, h('span', { text: p ? tr('Tela de {0}', [p.name || p.identity]) : tr('Você está compartilhando a tela') }), stop),
      video,
    );
    (document.querySelector('.ui-root') ?? document.body).append(el);
    this.screens.set(id, el);
    this.stackScreens();
  }

  private dropScreen(id: string): void {
    this.screens.get(id)?.remove();
    this.screens.delete(id);
    this.stackScreens();
  }

  private stackScreens(): void {
    let i = 0;
    for (const el of this.screens.values()) el.style.setProperty('--kv-i', String(i++));
  }

  /** Volume de cada pessoa: cheio dentro de uma sala de projeto; pela distância nas áreas abertas. */
  private updateVolumes(): void {
    const room = this.room;
    if (!room) return;
    const open = !this.area?.startsWith('r:');
    const me = kvPeople.locate?.(null);
    for (const p of room.remoteParticipants.values()) {
      let v = 1;
      if (open) {
        const them = kvPeople.locate?.(p.identity);
        v = me && them ? proximityVolume(Math.hypot(me.x - them.x, me.y - them.y)) : 0;
      }
      if (this.volumes.get(p.identity) !== v) {
        this.volumes.set(p.identity, v);
        p.setVolume(v);
      }
    }
  }

  /** A cada quadro: as bolinhas de câmera em cima do boneco de cada um. */
  private place(): void {
    for (const [id, el] of this.bubbles) {
      const at = kvPeople.locate?.(id || null);
      const audible = !id || (this.volumes.get(id) ?? 1) > 0;
      if (!at || !audible) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      const size = Math.round(Math.max(44, Math.min(120, 22 * at.zoom)));
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.transform = `translate(${Math.round(at.sx - size / 2)}px, ${Math.round(at.sy - 34 * at.zoom - size)}px)`;
    }
  }
}

/** Liga a voz e o vídeo se o servidor tiver o LiveKit configurado. */
export async function kvStartMedia(bar: KvBar): Promise<KvMedia | null> {
  try {
    const res = await fetch('/api/kaviski/humanos/livekit', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { enabled?: boolean; url?: string };
    return body.enabled && body.url ? new KvMedia(body.url, bar) : null;
  } catch {
    return null;
  }
}
