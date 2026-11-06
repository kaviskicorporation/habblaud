// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): a grade de vídeo ampliada. Um botão na barra do topo
// abre em tela cheia todos da chamada (câmera, ou a inicial de quem está sem câmera) e as telas compartilhadas, com o
// nome, o ícone de mudo e o destaque de quem fala. Fixar um quadro deixa ele grande, com os outros numa faixa. Esc fecha.
// Nas áreas abertas só aparece quem eu ouço (a mesma proximidade das bolinhas).
import type { Participant, Track } from 'livekit-client';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import type { KvBar } from './bar';
import type { KvMedia } from './media';

const GRID_ICON = pixelIcon(['####.####', '####.####', '####.####', '.........', '####.####', '####.####', '####.####']);

interface Tile {
  el: HTMLElement;
  video: HTMLVideoElement | null;
  track: Track | null;
  name: HTMLElement;
  mute: HTMLElement;
  avatar: HTMLElement;
}

export class KvMediaGrid {
  private readonly btn: HTMLButtonElement;
  private readonly root: HTMLElement;
  private readonly main: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly tiles = new Map<string, Tile>();
  private pinned: string | null = null;
  private timer = 0;
  private lastFocus: HTMLElement | null = null;

  constructor(
    private readonly media: KvMedia,
    private readonly bar: KvBar,
  ) {
    const label = tr('Grade de vídeo (tela cheia)');
    this.btn = h('button', { class: 'ui-icon-btn kv-dock__btn kv-dock__grid', type: 'button', title: label, attrs: { 'aria-label': label, 'aria-haspopup': 'dialog' }, on: { click: () => this.open() } });
    this.btn.innerHTML = GRID_ICON;
    bar.media.append(this.btn);
    this.main = h('div', { class: 'kv-grid__main' });
    this.strip = h('div', { class: 'kv-grid__strip' });
    this.empty = h('div', { class: 'kv-grid__empty', text: tr('Ninguém com vídeo na chamada ainda.') });
    const close = h('button', { class: 'ui-btn ui-btn--sm kv-grid__close', type: 'button', text: tr('Fechar (Esc)'), on: { click: () => this.close() } });
    this.root = h(
      'div',
      // aria-modal só com a grade aberta: o modalOpen() do mundo conta qualquer [aria-modal="true"] e travaria as setas
      { class: 'kv-grid', hidden: true, role: 'dialog', attrs: { 'aria-label': label } },
      h('div', { class: 'kv-grid__head' }, h('span', { class: 'kv-grid__title', text: tr('Chamada') }), close),
      this.main,
      this.strip,
      this.empty,
    );
    (document.querySelector('.ui-root') ?? document.body).append(this.root);
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && !this.root.hidden) {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      },
      true,
    );
    media.onChange(() => !this.root.hidden && this.render());
    setInterval(() => (this.btn.disabled = !this.media.call), 500);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (!this.media.call) return this.bar.warn(tr('Entre numa chamada para abrir a grade de vídeo.'));
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.root.setAttribute('aria-modal', 'true');
    // o que flutua sobre o mundo (bolinhas, anéis, pilhas da cabeça) não aparece por cima da grade
    document.body.classList.add('kv-grid-open');
    this.btn.classList.add('is-on');
    this.render();
    this.timer = window.setInterval(() => this.render(), 300);
    (this.root.querySelector('.kv-grid__close') as HTMLElement | null)?.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.root.removeAttribute('aria-modal');
    document.body.classList.remove('kv-grid-open');
    this.btn.classList.remove('is-on');
    clearInterval(this.timer);
    for (const id of [...this.tiles.keys()]) this.drop(id);
    this.lastFocus?.focus?.();
  }

  /** Quem entra na grade: eu, os da chamada que eu ouço, e as telas compartilhadas. */
  private entries(): { key: string; p: Participant; me: boolean; screen: boolean; track: Track | null }[] {
    const room = this.media.call;
    const lk = this.media.lk;
    if (!room || !lk) return [];
    const out: { key: string; p: Participant; me: boolean; screen: boolean; track: Track | null }[] = [];
    const push = (p: Participant, me: boolean) => {
      const cam = p.getTrackPublication(lk.Track.Source.Camera);
      const scr = p.getTrackPublication(lk.Track.Source.ScreenShare);
      const camTrack = cam?.track && !cam.isMuted ? cam.track : null;
      out.push({ key: `${p.identity}|cam`, p, me, screen: false, track: camTrack });
      if (scr?.track) out.push({ key: `${p.identity}|screen`, p, me, screen: true, track: scr.track });
    };
    push(room.localParticipant, true);
    for (const p of room.remoteParticipants.values()) if (this.media.volumeOf(p.identity) > 0) push(p, false);
    return out;
  }

  private render(): void {
    const list = this.entries();
    if (!this.media.call) return this.close();
    const keys = new Set(list.map((e) => e.key));
    for (const id of [...this.tiles.keys()]) if (!keys.has(id)) this.drop(id);
    if (this.pinned && !keys.has(this.pinned)) this.pinned = null;
    // sem fixar: a primeira tela compartilhada vai grande sozinha
    const big = this.pinned ?? list.find((e) => e.screen)?.key ?? null;
    this.root.classList.toggle('has-main', !!big);
    for (const e of list) {
      const t = this.tile(e.key, e);
      if (t.track !== e.track) {
        if (t.video && t.track) t.track.detach(t.video);
        t.video?.remove();
        t.video = null;
        t.track = e.track;
        if (e.track) {
          const v = e.track.attach() as HTMLVideoElement;
          v.muted = true;
          v.playsInline = true;
          t.video = v;
          t.el.prepend(v);
        }
      }
      t.avatar.hidden = !!t.video;
      t.el.classList.toggle('is-me', e.me);
      t.el.classList.toggle('is-screen', e.screen);
      t.el.classList.toggle('is-speaking', !e.screen && e.p.isSpeaking);
      t.el.classList.toggle('is-pinned', this.pinned === e.key);
      const who = e.me ? tr('Você') : e.p.name || e.p.identity;
      t.name.textContent = e.screen ? tr('Tela de {0}', [who]) : who;
      t.mute.hidden = e.screen || e.p.isMicrophoneEnabled;
      const parent = big === e.key ? this.main : big ? this.strip : this.main;
      if (t.el.parentElement !== parent) parent.append(t.el);
    }
    this.main.dataset.n = String(this.main.childElementCount);
    this.empty.hidden = list.length > 0;
  }

  private tile(key: string, e: { p: Participant; me: boolean }): Tile {
    let t = this.tiles.get(key);
    if (t) return t;
    const name = h('span', { class: 'kv-grid__name' });
    const mute = h('span', { class: 'kv-grid__mute', text: '🔇', title: tr('Microfone desligado') });
    const initial = ([...(e.me ? tr('Você') : e.p.name || e.p.identity)][0] ?? '?').toLocaleUpperCase();
    const avatar = h('div', { class: 'kv-grid__avatar', text: initial });
    const pin = h('button', {
      class: 'ui-btn ui-btn--sm kv-grid__pin',
      type: 'button',
      text: '📌',
      title: tr('Fixar / soltar este quadro'),
      attrs: { 'aria-label': tr('Fixar / soltar este quadro') },
      on: {
        click: (ev: MouseEvent) => {
          ev.stopPropagation();
          this.pinned = this.pinned === key ? null : key;
          this.render();
        },
      },
    });
    const el = h('div', { class: 'kv-grid__tile', on: { dblclick: () => ((this.pinned = this.pinned === key ? null : key), this.render()) } }, avatar, h('div', { class: 'kv-grid__label' }, mute, name), pin);
    t = { el, video: null, track: null, name, mute, avatar };
    this.tiles.set(key, t);
    return t;
  }

  private drop(key: string): void {
    const t = this.tiles.get(key);
    if (!t) return;
    if (t.video && t.track) t.track.detach(t.video);
    t.el.remove();
    this.tiles.delete(key);
  }
}
