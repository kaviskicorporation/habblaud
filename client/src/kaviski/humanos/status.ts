// Fork Kaviski (KAVISKI-HUMANOS.md, W2): meu status — disponível, ocupado, ausente ou não perturbe, com uma nota livre
// ("🍽️ Almoçando", até 60 caracteres) e um "até" (limpa sozinho no horário).
//
// API para os outros módulos (agenda, timer de foco...):
//   kvSetStatus({ status?, note?, until?, source? })   source padrão 'manual'; until em epoch ms (0 = sem prazo)
//   kvClearStatus(source)                               a camada daquela fonte acaba (ex.: a reunião terminou)
//   kvStatusNow()                                       o status que vale agora, e de que fonte veio
// Cada fonte é uma camada. Vale, nesta ordem: a manual (se não for a padrão: disponível sem nota); senão a automática
// mais recente ainda válida; senão disponível. Por cima, o "ausente automático": aba escondida ou sem mexer por um tempo
// vira ausente (menos em não perturbe), e volta sozinho. A manual fica lembrada neste navegador.
import type { KvPresencePerson, KvStatus } from '../../../../shared/kaviski-presence';
import { kvIsStatus } from '../../../../shared/kaviski-presence';
import { KV_NOTE_MAX, kvStatusNote } from '../../../../shared/kaviski-social';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvEndOfDay, kvUntilText } from './status-text';
import { kvPeople, STATUS_LABEL } from './world';

const SAVE_KEY = 'habblaud.kv.status';
/** Aba escondida por este tempo: ausente. */
export const IDLE_HIDDEN_MS = 10 * 60_000;
/** Aba à vista, mas sem mexer (mouse, teclado, toque) por este tempo: ausente. */
export const IDLE_STILL_MS = 15 * 60_000;
const TICK_MS = 5_000;

export interface KvStatusInput {
  status?: KvStatus;
  note?: string;
  /** epoch ms; 0 = sem prazo. */
  until?: number;
  /** 'manual' (padrão), 'agenda', 'foco'... */
  source?: string;
}

export interface KvStatusValue {
  status: KvStatus;
  note: string;
  until: number;
  /** De onde veio: 'manual', a fonte automática, 'idle' (ausente automático) ou 'padrao'. */
  source: string;
}

interface Layer {
  status: KvStatus;
  note: string;
  until: number;
  at: number;
}

const layers = new Map<string, Layer>();
const listeners = new Set<(v: KvStatusValue) => void>();
let idle = false;
let lastInput = Date.now();
let hiddenAt: number | null = null;
let lastSent = '';
let started = false;

const isDefault = (l: Pick<Layer, 'status' | 'note'>) => l.status === 'disponivel' && !l.note;

/** Muda o meu status (uma camada por fonte; veja o topo do arquivo). */
export function kvSetStatus(s: KvStatusInput): void {
  const source = s.source || 'manual';
  const cur = layers.get(source);
  const note = s.note !== undefined ? (kvStatusNote(s.note) ?? '') : (cur?.note ?? '');
  const status = s.status && kvIsStatus(s.status) ? s.status : (cur?.status ?? (source === 'manual' ? 'disponivel' : 'ocupado'));
  const until = s.until !== undefined ? (s.until > Date.now() ? Math.round(s.until) : 0) : (cur?.until ?? 0);
  const layer: Layer = { status, note, until, at: Date.now() };
  if (source === 'manual' && isDefault(layer)) layers.delete(source);
  else layers.set(source, layer);
  if (source === 'manual') save();
  apply();
}

/** Encerra a camada de uma fonte (ex.: kvClearStatus('agenda') quando a reunião acaba). */
export function kvClearStatus(source: string): void {
  if (!layers.delete(source || 'manual')) return;
  if ((source || 'manual') === 'manual') save();
  apply();
}

/** O status que vale agora. */
export function kvStatusNow(): KvStatusValue {
  return effective(Date.now());
}

/** Avisa quando o status que vale muda. */
export function kvOnStatus(cb: (v: KvStatusValue) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** A camada manual (para o editor). */
export function kvManualStatus(): Layer | undefined {
  return layers.get('manual');
}

function effective(now: number): KvStatusValue {
  for (const [k, l] of layers) {
    if (l.until && l.until <= now) {
      layers.delete(k);
      if (k === 'manual') save();
    }
  }
  const manual = layers.get('manual');
  let base: KvStatusValue = { status: 'disponivel', note: '', until: 0, source: 'padrao' };
  if (manual && !isDefault(manual)) base = { ...manual, source: 'manual' };
  else {
    const auto = [...layers.entries()].filter(([k]) => k !== 'manual').sort((a, b) => b[1].at - a[1].at)[0];
    if (auto) base = { status: auto[1].status, note: auto[1].note, until: auto[1].until, source: auto[0] };
  }
  if (idle && base.status !== 'naoperturbe' && base.status !== 'ausente') return { ...base, status: 'ausente', source: 'idle' };
  return base;
}

function apply(): void {
  // antes do fluxo de presença abrir, o servidor não me conhece (409): manda quando ele abrir (kvStartStatus)
  if (!kvPeople.client?.state) return;
  const v = effective(Date.now());
  const key = `${v.status}|${v.note}|${v.until}`;
  if (key === lastSent) return;
  lastSent = key;
  kvPeople.client?.setStatus(v.status, v.note, v.until);
  for (const cb of listeners) cb(v);
}

function save(): void {
  try {
    const m = layers.get('manual');
    if (m) localStorage.setItem(SAVE_KEY, JSON.stringify(m));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // sem localStorage
  }
}

function load(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Partial<Layer> | null;
    if (!raw || !kvIsStatus(raw.status)) return;
    const until = typeof raw.until === 'number' ? raw.until : 0;
    if (until && until <= Date.now()) return;
    layers.set('manual', { status: raw.status, note: kvStatusNote(raw.note) ?? '', until, at: Date.now() });
  } catch {
    // nada salvo
  }
}

/** O ausente automático: aba escondida ou sem mexer há muito tempo. */
function checkIdle(): void {
  const now = Date.now();
  const next = (hiddenAt !== null && now - hiddenAt >= IDLE_HIDDEN_MS) || now - lastInput >= IDLE_STILL_MS;
  if (next !== idle) idle = next;
  apply();
}

/** Liga o status: lembra a escolha manual, o ausente automático e o "até". Chamado uma vez (social.ts). */
export function kvStartStatus(): void {
  if (started) return;
  started = true;
  load();
  const touch = () => {
    lastInput = Date.now();
    if (idle) checkIdle();
  };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, touch, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    hiddenAt = document.hidden ? Date.now() : null;
    if (!document.hidden) touch();
    checkIdle();
  });
  hiddenAt = document.hidden ? Date.now() : null;
  setInterval(checkIdle, TICK_MS);
  kvPeople.client?.on(() => apply());
}

/** "ocupado · 🍽️ Almoçando (até 15:30)" para a lista de online. */
export function kvStatusLine(p: Pick<KvPresencePerson, 'status' | 'note' | 'until' | 'hand'>): string {
  const parts = [STATUS_LABEL[p.status]];
  if (p.note) parts.push(p.until ? `${p.note} (${tr('até {0}', [kvUntilText(p.until)])})` : p.note);
  else if (p.until) parts.push(tr('até {0}', [kvUntilText(p.until)]));
  return `${p.hand ? '✋ ' : ''}${parts.join(' · ')}`;
}

const UNTIL_OPTIONS: { label: string; ms: (now: number) => number }[] = [
  { label: tr('sem prazo'), ms: () => 0 },
  { label: tr('30 minutos'), ms: (n) => n + 30 * 60_000 },
  { label: tr('1 hora'), ms: (n) => n + 60 * 60_000 },
  { label: tr('2 horas'), ms: (n) => n + 2 * 60 * 60_000 },
  { label: tr('4 horas'), ms: (n) => n + 4 * 60 * 60_000 },
  { label: tr('hoje'), ms: (n) => kvEndOfDay(n) },
];

/** Sugestões da nota. */
const SUGGESTIONS = (): string[] => [tr('🍽️ Almoçando'), tr('📅 Em reunião'), tr('🎧 Focado'), tr('🏠 Home office'), tr('☕ Pausa'), tr('🚗 A caminho')];

/** O pedaço "nota do status" da lista de online: campo, sugestões, "até", Limpar. */
export class KvStatusEditor {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly until: HTMLSelectElement;
  private readonly info: HTMLElement;

  constructor() {
    this.input = h('input', {
      class: 'kv-stnote__input',
      type: 'text',
      attrs: { maxlength: String(KV_NOTE_MAX), placeholder: tr('Nota (ex.: 🍽️ Almoçando)'), 'aria-label': tr('Nota do status') },
      on: {
        keydown: (e) => {
          const k = e as KeyboardEvent;
          if (k.key === 'Enter') {
            k.preventDefault();
            this.save();
          }
          k.stopPropagation();
        },
      },
    });
    this.until = h('select', { class: 'kv-stnote__until', attrs: { 'aria-label': tr('Até quando') } }, ...UNTIL_OPTIONS.map((o, i) => h('option', { text: o.label, attrs: { value: String(i) } })));
    const chips = h(
      'div',
      { class: 'kv-stnote__chips' },
      ...SUGGESTIONS().map((s) =>
        h('button', {
          class: 'kv-stnote__chip',
          type: 'button',
          text: s,
          on: {
            click: () => {
              this.input.value = s;
              this.save();
            },
          },
        }),
      ),
    );
    const save = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Salvar'), on: { click: () => this.save() } });
    const clear = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Limpar'), on: { click: () => this.clear() } });
    this.info = h('p', { class: 'kv-stnote__info' });
    this.el = h('div', { class: 'kv-stnote' }, h('div', { class: 'kv-stnote__row' }, this.input, this.until), chips, h('div', { class: 'kv-stnote__row' }, this.info, save, clear));
    kvOnStatus(() => this.paint());
    this.paint();
  }

  /** Mostra o que vale agora (e de onde veio). */
  paint(): void {
    const m = kvManualStatus();
    if (document.activeElement !== this.input) this.input.value = m?.note ?? '';
    const v = kvStatusNow();
    const bits: string[] = [];
    if (v.source === 'idle') bits.push(tr('ausente automático (aba parada)'));
    else if (v.source !== 'manual' && v.source !== 'padrao') bits.push(tr('automático: {0}', [v.source]));
    if (v.until) bits.push(tr('até {0}', [kvUntilText(v.until)]));
    this.info.textContent = bits.join(' · ');
  }

  private save(): void {
    const opt = UNTIL_OPTIONS[Number(this.until.value)] ?? UNTIL_OPTIONS[0]!;
    kvSetStatus({ note: this.input.value, until: opt.ms(Date.now()) });
    this.input.blur();
  }

  private clear(): void {
    this.input.value = '';
    this.until.value = '0';
    kvClearStatus('manual');
  }
}
