// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): os ajustes do microfone e da câmera, lembrados neste
// navegador — dispositivo (microfone, câmera, alto-falante), redução de ruído e o fundo da câmera.
//
// - Ruído: as restrições do próprio navegador (noiseSuppression, echoCancellation, autoGainControl; ligadas por padrão)
//   e, opcional, o filtro forte RNNoise (BSD-3, em WebAssembly, pelo @sapphi-red/web-noise-suppressor, MIT). O Krisp do
//   LiveKit é só do LiveKit Cloud, que não usamos.
// - Fundo: desfoque ou imagem pelo @livekit/track-processors (Apache 2.0; segmentação do MediaPipe, Apache 2.0). Tudo
//   servido pelo próprio Habblaud (nada de CDN) e carregado só quando a pessoa liga o efeito.
import type { AudioCaptureOptions, AudioProcessorOptions, LocalAudioTrack, LocalVideoTrack, Track, TrackProcessor, VideoCaptureOptions } from 'livekit-client';
// Arquivos servidos pelo Vite (só o endereço; nada baixa até o efeito ligar). O MediaPipe não exporta a pasta wasm no
// package.json, então o caminho é relativo.
import visionJs from '../../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url';
import visionWasm from '../../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url';
import visionJsNoSimd from '../../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js?url';
import visionWasmNoSimd from '../../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm?url';
import segmenterModel from './assets/selfie_segmenter.tflite?url';
import rnnoiseWorklet from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasm from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasm from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import { tr } from '../../../../shared/i18n';

const KEY = 'habblaud.kv.media.fx';
/** Imagem própria de fundo (JPEG pequeno, guardado à parte: pode não caber). */
const BG_KEY = 'habblaud.kv.media.bg';

export type KvBackground = 'none' | 'blur' | 'office' | 'garden' | 'night' | 'custom';
export const KV_BACKGROUNDS: readonly KvBackground[] = ['none', 'blur', 'office', 'garden', 'night', 'custom'];

export interface KvFxPrefs {
  micId?: string;
  camId?: string;
  outId?: string;
  /** Redução de ruído, cancelamento de eco e ganho automático do navegador. */
  browserNs: boolean;
  /** Filtro de ruído forte (RNNoise). */
  rnnoise: boolean;
  bg: KvBackground;
  /** Palco silenciado neste navegador. */
  stageMuted: boolean;
}

export function kvBackgroundLabel(bg: KvBackground): string {
  return {
    none: tr('Sem efeito'),
    blur: tr('Desfocar o fundo'),
    office: tr('Fundo: escritório'),
    garden: tr('Fundo: jardim'),
    night: tr('Fundo: cidade à noite'),
    custom: tr('Fundo: minha imagem…'),
  }[bg];
}

export class KvFx {
  prefs: KvFxPrefs = { browserNs: true, rnnoise: false, bg: 'none', stageMuted: false };
  private readonly listeners = new Set<() => void>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<KvFxPrefs>;
      this.prefs = { ...this.prefs, ...saved };
      if (!KV_BACKGROUNDS.includes(this.prefs.bg)) this.prefs.bg = 'none';
    } catch {
      // sem preferências
    }
  }

  set(part: Partial<KvFxPrefs>): void {
    Object.assign(this.prefs, part);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.prefs));
    } catch {
      // sem localStorage
    }
    for (const cb of this.listeners) cb();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  /** Opções de captura do microfone (dispositivo e o filtro do navegador). */
  micOptions(): AudioCaptureOptions {
    const on = this.prefs.browserNs;
    return { ...(this.prefs.micId ? { deviceId: this.prefs.micId } : {}), noiseSuppression: on, echoCancellation: on, autoGainControl: on };
  }

  camOptions(): VideoCaptureOptions {
    return { ...(this.prefs.camId ? { deviceId: this.prefs.camId } : {}), resolution: { width: 320, height: 240, frameRate: 15 } };
  }

  /** Põe (ou tira) o filtro RNNoise na faixa do microfone. Devolve o erro (texto) ou null. */
  async applyMic(track: LocalAudioTrack | undefined): Promise<string | null> {
    if (!track) return null;
    const cur = track.getProcessor();
    try {
      if (!this.prefs.rnnoise) {
        if (cur?.name === RNNOISE) await track.stopProcessor();
        return null;
      }
      if (cur?.name === RNNOISE) return null;
      await track.setProcessor(new KvRnnoise() as unknown as TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>);
      return null;
    } catch (err) {
      return tr('Não deu para ligar o filtro de ruído ({0}).', [(err as Error).message]);
    }
  }

  /** Põe (ou tira) o efeito de fundo na faixa da câmera. Devolve o erro (texto) ou null. */
  async applyCam(track: LocalVideoTrack | undefined): Promise<string | null> {
    if (!track) return null;
    const bg = this.prefs.bg;
    const cur = track.getProcessor() as (TrackProcessor<Track.Kind.Video> & { switchTo?: (o: unknown) => Promise<void> }) | undefined;
    try {
      if (bg === 'none') {
        if (cur?.name === BG) await track.stopProcessor();
        return null;
      }
      const lib = await loadBackgroundLib();
      if (!lib.supportsBackgroundProcessors()) return tr('Este navegador não consegue mudar o fundo da câmera.');
      const mode = bg === 'blur' ? ({ mode: 'background-blur', blurRadius: 12 } as const) : ({ mode: 'virtual-background', imagePath: await backgroundImage(bg) } as const);
      if (cur?.name === BG && cur.switchTo) await cur.switchTo(mode);
      else await track.setProcessor(lib.BackgroundProcessor({ ...mode, assetPaths: { modelAssetPath: segmenterModel } }, BG) as unknown as TrackProcessor<Track.Kind.Video>);
      return null;
    } catch (err) {
      return tr('Não deu para mudar o fundo da câmera ({0}).', [(err as Error).message]);
    }
  }

  /** Guarda a imagem própria de fundo (reduzida a 640×480, JPEG). */
  async saveCustomImage(file: File): Promise<string | null> {
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const g = c.getContext('2d')!;
      // cobre o quadro inteiro, cortando as sobras
      const s = Math.max(c.width / bmp.width, c.height / bmp.height);
      g.drawImage(bmp, (c.width - bmp.width * s) / 2, (c.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
      const url = c.toDataURL('image/jpeg', 0.82);
      try {
        localStorage.setItem(BG_KEY, url);
      } catch {
        sessionImage = url; // não coube: vale só até fechar a página
      }
      images.delete('custom');
      return null;
    } catch {
      return tr('Essa imagem não abriu.');
    }
  }
}

const RNNOISE = 'kv-rnnoise';
const BG = 'kv-background';

// ---------------------------------------------------------------- fundo da câmera

type BgLib = typeof import('@livekit/track-processors');
let bgLib: Promise<BgLib> | null = null;

/** Carrega o @livekit/track-processors e aponta o MediaPipe para os arquivos servidos pelo Habblaud (não o CDN). */
function loadBackgroundLib(): Promise<BgLib> {
  bgLib ??= (async () => {
    const [lib, vision] = await Promise.all([import('@livekit/track-processors'), import('@mediapipe/tasks-vision')]);
    const simd = await vision.FilesetResolver.isSimdSupported();
    // O track-processors chama forVisionTasks(pasta do CDN); com os nomes do Vite (com hash) a pasta não serve, então
    // a resposta vem pronta, com os endereços certos.
    (vision.FilesetResolver as unknown as { forVisionTasks: () => Promise<unknown> }).forVisionTasks = async () => ({
      wasmLoaderPath: simd ? visionJs : visionJsNoSimd,
      wasmBinaryPath: simd ? visionWasm : visionWasmNoSimd,
    });
    return lib;
  })();
  bgLib.catch(() => (bgLib = null));
  return bgLib;
}

const images = new Map<KvBackground, string>();
let sessionImage: string | null = null;

/** A imagem de fundo (desenhada aqui mesmo, em pixel art, ou a da pessoa). */
async function backgroundImage(bg: KvBackground): Promise<string> {
  const hit = images.get(bg);
  if (hit) return hit;
  let url: string;
  if (bg === 'custom') {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(BG_KEY);
    } catch {
      // sem localStorage
    }
    url = saved ?? sessionImage ?? drawBackground('office');
  } else url = drawBackground(bg);
  images.set(bg, url);
  return url;
}

/** Fundos prontos, desenhados em 160×120 e ampliados sem suavizar (o mesmo jeito do escritório). */
export function drawBackground(kind: KvBackground): string {
  const W = 160;
  const H = 120;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  if (kind === 'garden') {
    rect(0, 0, W, 70, '#8fd3ff');
    rect(0, 50, W, 20, '#b9e6ff');
    for (let i = 0; i < 8; i++) rect(i * 22 - 4, 46 - (i % 3) * 6, 26, 30, i % 2 ? '#3f9b4f' : '#4fb35d');
    rect(0, 70, W, 50, '#6cc06a');
    for (let i = 0; i < 40; i++) rect((i * 37) % W, 74 + ((i * 13) % 44), 2, 2, i % 3 ? '#f7e26b' : '#f29ad8');
    rect(120, 8, 14, 14, '#ffe680');
  } else if (kind === 'night') {
    rect(0, 0, W, H, '#1b1f3b');
    for (let i = 0; i < 30; i++) rect((i * 53) % W, (i * 29) % 50, 1, 1, '#e8e8ff');
    rect(18, 10, 10, 10, '#f4f1c9');
    for (let i = 0; i < 9; i++) {
      const bh = 40 + ((i * 17) % 45);
      const x = i * 18;
      rect(x, H - bh, 16, bh, i % 2 ? '#2b3058' : '#353b6b');
      for (let wy = H - bh + 4; wy < H - 4; wy += 7) for (let wx = x + 3; wx < x + 14; wx += 5) if ((wx + wy + i) % 3) rect(wx, wy, 2, 3, '#f7d774');
    }
  } else {
    // escritório: parede, janela, estante e planta
    rect(0, 0, W, H, '#d9cbb4');
    rect(0, 92, W, 28, '#9b7b5b');
    rect(0, 90, W, 3, '#7d5f43');
    rect(14, 16, 56, 44, '#5e4632');
    rect(17, 19, 50, 38, '#9fd8ff');
    rect(41, 19, 2, 38, '#5e4632');
    rect(17, 37, 50, 2, '#5e4632');
    rect(100, 20, 44, 70, '#7a5a3d');
    for (let s = 0; s < 3; s++) {
      rect(103, 26 + s * 21, 38, 2, '#5e4632');
      for (let b = 0; b < 7; b++) rect(105 + b * 5, 14 + s * 21 + ((b * 3) % 4), 4, 12 - ((b * 3) % 4), ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e', '#8064a2'][(b + s) % 5]!);
    }
    rect(80, 74, 12, 16, '#b5651d');
    rect(76, 58, 20, 18, '#4fb35d');
    rect(82, 52, 8, 8, '#3f9b4f');
  }
  const out = document.createElement('canvas');
  out.width = 640;
  out.height = 480;
  const o = out.getContext('2d')!;
  o.imageSmoothingEnabled = false;
  o.drawImage(c, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

// ---------------------------------------------------------------- filtro de ruído (RNNoise)

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;

/**
 * Processador de áudio do LiveKit com o RNNoise: microfone → AudioWorklet (48 kHz, o que o RNNoise espera) → faixa
 * nova que vai para a chamada. Tem o próprio AudioContext (o do LiveKit pode ter outra taxa).
 */
class KvRnnoise {
  readonly name = RNNOISE;
  processedTrack?: MediaStreamTrack;
  private ctx: AudioContext | null = null;
  private node: (AudioWorkletNode & { destroy(): void }) | null = null;
  private resume = () => void this.ctx?.resume().catch(() => {});

  async init(opts: { track: MediaStreamTrack }): Promise<void> {
    const lib = await import('@sapphi-red/web-noise-suppressor');
    rnnoiseBinary ??= lib.loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimdWasm });
    rnnoiseBinary.catch(() => (rnnoiseBinary = null));
    const wasmBinary = await rnnoiseBinary;
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.audioWorklet.addModule(rnnoiseWorklet);
    const node = new lib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    const src = ctx.createMediaStreamSource(new MediaStream([opts.track]));
    const dest = ctx.createMediaStreamDestination();
    src.connect(node).connect(dest);
    this.ctx = ctx;
    this.node = node;
    this.processedTrack = dest.stream.getAudioTracks()[0];
    // sem um gesto da pessoa o navegador pode deixar o áudio parado: volta no próximo clique ou tecla
    if (ctx.state === 'suspended') {
      this.resume();
      window.addEventListener('pointerdown', this.resume);
      window.addEventListener('keydown', this.resume);
    }
  }

  async restart(opts: { track: MediaStreamTrack }): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    window.removeEventListener('pointerdown', this.resume);
    window.removeEventListener('keydown', this.resume);
    this.node?.destroy();
    this.node = null;
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.processedTrack = undefined;
  }
}

// ---------------------------------------------------------------- dispositivos

export interface KvDevice {
  id: string;
  label: string;
}

/** Microfones, câmeras e alto-falantes (os nomes só aparecem depois que a pessoa deu a permissão uma vez). */
export async function kvListDevices(kind: MediaDeviceKind): Promise<KvDevice[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    let n = 0;
    return all
      .filter((d) => d.kind === kind && d.deviceId)
      .map((d) => ({ id: d.deviceId, label: d.label || (kind === 'audioinput' ? tr('Microfone {0}', [String(++n)]) : kind === 'videoinput' ? tr('Câmera {0}', [String(++n)]) : tr('Alto-falante {0}', [String(++n)])) }));
  } catch {
    return [];
  }
}

/** O navegador deixa escolher o alto-falante (Chrome e Edge; Firefox e Safari não). */
export function kvCanPickOutput(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}
