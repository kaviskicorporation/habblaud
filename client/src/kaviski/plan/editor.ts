// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): o editor da empresa, por cima do mundo de verdade (alinhado à
// câmera). A planta aparece em "blueprint" (editor-draw.ts), cada mudança vira o rascunho ao vivo no mundo
// (`kvPlanWorld.preview`, do motor do prédio) e "Gravar" manda ao servidor (store.ts; 409 = outra pessoa gravou no meio).
//
// Mexer: arrastar move (grade + ímã; Shift sem ímã), alças redimensionam (limites do tipo; vermelho quando não cabe),
// clique na borda da parede da sala escolhida põe/tira porta (arrastar a porta a move), Delete apaga, setas movem 1 tile
// (Shift: 4), Ctrl+Z/Ctrl+Shift+Z, Ctrl+D duplica, Ctrl+S grava, L trava, F sala fixa, roda = zoom, arrastar o vazio,
// espaço ou o botão do meio = mover a câmera. Paleta à esquerda (arrastar ou clicar), painel à direita.
// Celular: só ver e mover com cuidado (o editor completo é para tela grande).
import { tr } from '../../../../shared/i18n';
import { KV_CORE_REFS, KV_PLAN_SIZE, KV_THEME_KEYS, kvPlanRoomRef, kvPlanWalled, type KvCoreRef, type KvPlan, type KvPlanItem, type KvPlanKind, type KvThemeKey } from '../../../../shared/kaviski-plan';
import type { KvMe } from '../../../../shared/kaviski-humanos';
import { TILE } from '../../art/api';
import { h as hh } from '../../ui/dom';
import type { OfficeStore } from '../../net/store';
import { kvPeople } from '../humanos/world';
import { kvRoomsState } from '../humanos/rooms';
import { kvBtn, kvIconBtn, kvToggle, kvInput } from '../humanos/ui/kit';
import { KV_ICONS } from '../humanos/ui/icons';
import { kvConfirm, KvModal } from '../humanos/ui/modal';
import { kvToast } from '../humanos/ui/toast';
import { kvTopButton } from '../humanos/topbar';
import { kvFurnisherKeys, kvPlanWorld, kvRegisterAction } from './api';
import {
  KvUndo,
  kvAutoDoor,
  kvClampRect,
  kvClonePlan,
  kvDoorIndexAt,
  kvDuplicate,
  kvFindFree,
  kvFitPlan,
  kvFixDoors,
  kvHit,
  kvItemAt,
  kvMagnet,
  kvMoveDoor,
  kvNewItem,
  kvPlanWarnings,
  kvResize,
  kvSamePlan,
  kvToggleDoor,
  kvTrimPlan,
  kvWallAt,
  type KvHandle,
  type KvPlanWarn,
  type KvRect,
} from './editor-model';
import { kvAutoFlagScreen, kvDrawPlan, kvHandlePoints, type KvView, type KvViewMode } from './editor-draw';
import { kvCoreName, kvIcon, kvItemIcon, kvItemName, kvKindColor, kvKindLabel } from './editor-kinds';
import { kvLoadPlan, kvOnPlanDoc, kvPlanDoc, kvPlanVersions, kvRestorePlan, kvSavePlan } from './store';
import { kvPlanFromClassic } from './templates';
import { kvThemeInfo } from './themes-info';
import { kvOpenWizard } from './wizard';
import { kvDrawThumb } from './editor-draw';
import './editor.css';

const MOBILE = () => typeof matchMedia === 'function' && (matchMedia('(max-width: 760px)').matches || (matchMedia('(pointer: coarse)').matches && innerWidth < 1024));

type Drag =
  | { mode: 'move'; id: string; fx: number; fy: number; orig: KvRect; cur: KvRect; ok: boolean; moved: boolean }
  | { mode: 'resize'; id: string; handle: KvHandle; fx: number; fy: number; orig: KvRect; cur: KvRect; ok: boolean; moved: boolean }
  | { mode: 'door'; id: string; index: number; sx: number; sy: number; moved: boolean; before: KvPlan }
  | { mode: 'wall'; id: string; side: 'n' | 's' | 'e' | 'w'; pos: number; sx: number; sy: number }
  | { mode: 'pan'; sx: number; sy: number; moved: boolean; click?: boolean }
  | { mode: 'new'; item: KvPlanItem; cur: KvRect; ok: boolean; inside: boolean }
  | { mode: 'auto'; fx: number; fy: number; ox: number; oy: number };

export interface KvProjectOption {
  ref: string;
  path: string;
  name: string;
}

let me: KvMe | null = null;
let officeStore: OfficeStore | null = null;
let current: KvPlanEditor | null = null;
let folders: KvProjectOption[] | null = null;

/** Abre o editor da empresa (a frente das salas temáticas liga a maquete da sala Arquitetura aqui). */
export function kvOpenPlanEditor(opts: { focus?: string; templates?: boolean } = {}): void {
  if (current) {
    if (opts.focus) current.focusItem(opts.focus);
    if (opts.templates) current.openTemplates();
    return;
  }
  void (async () => {
    const doc = (await kvLoadPlan()) ?? kvPlanDoc();
    if (!doc?.canEdit && !me?.local) {
      kvToast(tr('Só quem é admin (ou a equipe, se liberada) mexe na planta da empresa.'), { kind: 'warn', key: 'kv-plan' });
      return;
    }
    current = new KvPlanEditor(() => (current = null));
    if (opts.focus) current.focusItem(opts.focus);
    if (opts.templates || !doc?.plan) current.openTemplates(true);
  })();
}

/** Botão no topo (só para quem pode editar) e a ação "planta" do "ir e fazer". */
export function kvStartPlanEditor(m: KvMe, store: OfficeStore | null, root: ParentNode = document): void {
  me = m;
  officeStore = store;
  kvRegisterAction({ key: 'planta', label: tr('Planta da empresa'), icon: 'planta', run: () => kvOpenPlanEditor(), allowed: () => !!kvPlanDoc()?.canEdit });
  let btn: HTMLButtonElement | null = null;
  const sync = () => {
    const can = !!kvPlanDoc()?.canEdit;
    if (can && !btn) {
      btn = kvTopButton(kvIcon('regua'), tr('Planta da empresa: monte e reorganize o escritório'), () => kvOpenPlanEditor(), 'kv-btn-plan', 58, root);
      btn?.setAttribute('aria-haspopup', 'dialog');
    }
    if (btn) btn.hidden = !can;
  };
  kvOnPlanDoc(sync);
  sync();
}

/** Salas de projeto que dá para pôr na planta: as do prédio e as pastas conhecidas (lista do Novo agente). */
async function projectOptions(): Promise<KvProjectOption[]> {
  const out = new Map<string, KvProjectOption>();
  for (const r of officeStore?.snapshot?.rooms ?? []) {
    const path = r.path || r.id;
    if (!path.startsWith('/') && !/^[a-z]:\//i.test(path)) continue;
    out.set(kvPlanRoomRef(path), { ref: kvPlanRoomRef(path), path, name: r.name || path.split('/').pop() || path });
  }
  if (!folders) {
    try {
      const res = await fetch('/api/spawn/folders', { credentials: 'same-origin', cache: 'no-store' });
      const j = res.ok ? ((await res.json()) as { folders?: { path: string; name: string }[] }) : {};
      folders = (j.folders ?? []).filter((f) => typeof f.path === 'string').map((f) => ({ ref: kvPlanRoomRef(f.path), path: f.path, name: f.name || f.path.split('/').pop() || f.path }));
    } catch {
      folders = [];
    }
  }
  for (const f of folders) if (!out.has(f.ref)) out.set(f.ref, f);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** O prédio de hoje como rascunho (a planta começa igual ao que se vê, sem pular). */
function classicDraft(): KvPlan {
  const rooms = (officeStore?.snapshot?.rooms ?? [])
    .filter((r) => (r.path || r.id).startsWith('/') || /^[a-z]:\//i.test(r.path || r.id))
    .map((r) => ({ ref: kvPlanRoomRef(r.path || r.id), slot: r.slot, ...((r as { kaviski?: { pinned?: boolean } }).kaviski?.pinned ? { fixed: true } : {}) }));
  const own = kvRoomsState().rooms.map((r) => ({ id: r.id }));
  return kvPlanFromClassic(rooms, own);
}

class KvPlanEditor {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly palette: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly modeSeg: HTMLElement;
  private draft: KvPlan;
  private saved: KvPlan | null;
  private base: number;
  private sel: string | null = null;
  private hover: string | null = null;
  private autoHover = false;
  private drag: Drag | null = null;
  private doorHint: { id: string; side: 'n' | 's' | 'e' | 'w'; at: number; w: number; remove: boolean } | null = null;
  private mode: KvViewMode;
  private readonly undo = new KvUndo(120);
  private warns: KvPlanWarn[] = [];
  private raf = 0;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private space = false;
  private projects: KvProjectOption[] = [];
  private readonly mobile = MOBILE();
  private readonly camSaved: { bounds: { x: number; y: number; w: number; h: number }; minZoom: number; follow: string | null } | null;
  private readonly off: (() => void)[] = [];
  private panelSig = '';
  /** Último ponteiro durante um arrasto (a câmera anda sozinha perto da borda). */
  private lastPtr: { clientX: number; clientY: number; shiftKey: boolean } | null = null;
  private saving = false;

  constructor(private readonly onClose: () => void) {
    const doc = kvPlanDoc();
    this.saved = doc?.plan ? kvClonePlan(doc.plan) : null;
    this.base = doc?.version ?? 0;
    this.draft = this.saved ? kvFitPlan(kvClonePlan(this.saved)) : classicDraft();
    this.mode = kvPlanWorld.preview ? 'misto' : 'planta';
    this.canvas = h('canvas', { class: 'kv-pe__canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    this.palette = h('aside', { class: 'kv-pe__palette', attrs: { 'aria-label': tr('Peças da planta') } });
    this.panel = h('aside', { class: 'kv-pe__panel', attrs: { 'aria-label': tr('Detalhes') } });
    this.status = h('div', { class: 'kv-pe__status' });
    this.undoBtn = kvIconBtn(kvIcon('relogio'), tr('Desfazer (Ctrl+Z)'), () => this.doUndo(), { cls: 'kv-pe__undo' });
    this.undoBtn.innerHTML = undoSvg(false);
    this.redoBtn = kvIconBtn('', tr('Refazer (Ctrl+Shift+Z)'), () => this.doRedo(), { cls: 'kv-pe__redo' });
    this.redoBtn.innerHTML = undoSvg(true);
    this.saveBtn = kvBtn(tr('Gravar'), { variant: 'primary', icon: KV_ICONS.check, onClick: () => void this.save(), title: tr('Gravar a planta (Ctrl+S)') });
    this.modeSeg = h('div', { class: 'kv-pe__seg', role: 'radiogroup', attrs: { 'aria-label': tr('Como ver') } });
    const modes: [KvViewMode, string, string][] = [
      ['planta', tr('Planta'), tr('Só a planta (blueprint)')],
      ['misto', tr('Misto'), tr('A planta por cima do mundo')],
      ['mundo', tr('Mundo'), tr('O mundo em pixel art, com o contorno da planta')],
    ];
    for (const [m, label, title] of modes) {
      this.modeSeg.append(h('button', { type: 'button', class: 'kv-pe__seg-btn', title, text: label, attrs: { role: 'radio', 'data-mode': m }, on: { click: () => this.setMode(m) } }));
    }
    const name = h('strong', { class: 'kv-pe__title', text: tr('Planta da empresa') });
    this.bar = h(
      'header',
      { class: 'kv-pe__bar' },
      h('span', { class: 'kv-pe__logo', html: kvIcon('regua') }),
      name,
      h('span', { class: 'kv-pe__sep' }),
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'kv-pe__sep' }),
      kvIconBtn(KV_ICONS.plus, tr('Aproximar'), () => this.zoomBy(1.25)),
      kvIconBtn(minusSvg(), tr('Afastar'), () => this.zoomBy(0.8)),
      kvIconBtn(fitSvg(), tr('Ver a planta inteira'), () => this.fit()),
      this.mobile ? null : this.modeSeg,
      h('span', { class: 'kv-pe__grow' }),
      this.mobile ? null : kvBtn(tr('Modelos'), { icon: kvIcon('modelos'), onClick: () => this.openTemplates(), title: tr('Monte a sua empresa a partir de um modelo') }),
      this.mobile ? null : kvBtn(tr('Versões'), { icon: kvIcon('relogio'), onClick: () => void this.openVersions(), title: tr('Histórico de versões') }),
      kvBtn(tr('Descartar'), { variant: 'ghost', onClick: () => void this.discard(), title: tr('Voltar para a planta gravada') }),
      this.saveBtn,
      kvIconBtn(KV_ICONS.close, tr('Sair do editor (Esc)'), () => void this.close()),
    );
    this.root = h(
      'div',
      { class: `kv-pe${this.mobile ? ' is-mobile' : ''}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Planta da empresa') } },
      this.canvas,
      this.bar,
      this.mobile ? null : this.palette,
      this.panel,
      this.status,
    );
    if (this.mobile) {
      this.root.append(
        h('div', { class: 'kv-pe__mobile-tip' }, h('span', { html: kvIcon('planta') }), h('span', { text: tr('No celular dá para ver a planta e mover salas com cuidado. Para montar a empresa inteira (paleta, portas, modelos), abra numa tela grande.') })),
      );
    }
    (document.querySelector('.ui-root') ?? document.body).append(this.root);
    // câmera: sem seguir o boneco, solta para passear pela planta inteira
    const cam = kvPeople.camera;
    this.camSaved = cam ? { bounds: { ...cam.bounds }, minZoom: cam.minZoom, follow: cam.follow } : null;
    if (cam) cam.follow = null;
    this.bind();
    this.buildPalette();
    this.setMode(this.mode);
    this.changed(false);
    void projectOptions().then((p) => {
      this.projects = p;
      this.buildPalette();
      this.renderPanel(true);
    });
    this.off.push(kvOnPlanDoc((d) => this.remoteChanged(d)));
    this.loop();
    this.fit(false);
  }

  // ------------------------------------------------------------------ estado

  private get dirty(): boolean {
    return !kvSamePlan(this.draft, this.saved);
  }

  /** Antes de mudar: guarda para o desfazer. */
  private before(): void {
    this.undo.push(this.draft);
  }

  /** Depois de mudar: avisos, painel, prévia no mundo. */
  private changed(preview = true): void {
    this.warns = kvPlanWarnings(this.draft);
    this.undoBtn.disabled = !this.undo.canUndo;
    this.redoBtn.disabled = !this.undo.canRedo;
    this.saveBtn.disabled = this.saving || (!this.dirty && this.base > 0);
    this.saveBtn.classList.toggle('is-dirty', this.dirty);
    this.renderPanel();
    this.renderStatus();
    if (preview) this.schedulePreview();
  }

  private schedulePreview(): void {
    if (!kvPlanWorld.preview) return;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      try {
        kvPlanWorld.preview?.(this.draft.on ? kvClonePlan(this.draft) : null);
      } catch (err) {
        console.error('[habblaud] prévia da planta:', err);
      }
    }, 120);
  }

  private set(plan: KvPlan, o: { keepSel?: boolean } = {}): void {
    this.draft = kvFitPlan(plan);
    if (!o.keepSel && this.sel && !this.draft.items.some((i) => i.id === this.sel)) this.sel = null;
    this.changed();
  }

  private item(id: string | null): KvPlanItem | undefined {
    return id ? this.draft.items.find((i) => i.id === id) : undefined;
  }

  private replaceItem(next: KvPlanItem): void {
    this.set({ ...this.draft, items: this.draft.items.map((i) => (i.id === next.id ? next : i)) }, { keepSel: true });
  }

  private nameOf = (it: KvPlanItem): string =>
    kvItemName(it, {
      project: (ref) => this.projects.find((p) => p.ref === ref)?.name ?? officeStore?.snapshot?.rooms.find((r) => kvPlanRoomRef(r.path || r.id) === ref)?.name,
      own: (id) => kvRoomsState().rooms.find((r) => r.id === id)?.name,
    });

  // ------------------------------------------------------------------ câmera e vista

  private view(): KvView {
    const cam = kvPeople.camera;
    const o = (kvPlanWorld as { origin?: { x: number; y: number } }).origin ?? { x: 0, y: 0 };
    const w = this.canvas.clientWidth;
    const hh = this.canvas.clientHeight;
    if (!cam) return { s: 8, ox: 40, oy: 80, w, h: hh };
    const p = cam.worldToScreen(o.x, o.y);
    const r = this.worldRect();
    return { s: cam.zoom * TILE, ox: p.x + r.left - this.canvasRect().left, oy: p.y + r.top - this.canvasRect().top, w, h: hh };
  }

  private worldRect(): DOMRect {
    return (document.getElementById('world') ?? this.canvas).getBoundingClientRect();
  }

  private canvasRect(): DOMRect {
    return this.canvas.getBoundingClientRect();
  }

  /** A câmera pode ir até a planta inteira (com folga), e afastar o bastante para vê-la toda. */
  private extendCamera(): void {
    const cam = kvPeople.camera;
    if (!cam) return;
    const o = (kvPlanWorld as { origin?: { x: number; y: number } }).origin ?? { x: 0, y: 0 };
    const b = this.camSaved?.bounds ?? cam.bounds;
    const px = { x: o.x - 24 * TILE, y: o.y - 24 * TILE, w: (this.draft.w + 48) * TILE, h: (this.draft.h + 48) * TILE };
    const x0 = Math.min(b.x, px.x);
    const y0 = Math.min(b.y, px.y);
    const x1 = Math.max(b.x + b.w, px.x + px.w);
    const y1 = Math.max(b.y + b.h, px.y + px.h);
    cam.bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    cam.minZoom = Math.min(cam.minZoom, 0.25);
  }

  private zoomBy(k: number): void {
    const cam = kvPeople.camera;
    if (!cam) return;
    const r = this.worldRect();
    cam.zoomAt(cam.zoom * k, r.width / 2, r.height / 2, performance.now(), true);
  }

  private fit(animate = true): void {
    const cam = kvPeople.camera;
    if (!cam) return;
    this.extendCamera();
    const o = (kvPlanWorld as { origin?: { x: number; y: number } }).origin ?? { x: 0, y: 0 };
    let x1 = 16;
    let y1 = 12;
    for (const it of this.draft.items) {
      x1 = Math.max(x1, it.x + it.w);
      y1 = Math.max(y1, it.y + it.h);
    }
    const r = this.worldRect();
    const left = this.mobile ? 0 : 236;
    const right = 300;
    const top = 96;
    const bottom = 70;
    const zw = (r.width - left - right - 80) / (x1 * TILE);
    const zh = (r.height - top - bottom) / (y1 * TILE);
    const z = Math.max(0.25, Math.min(4, zw, zh));
    // centro deslocado pelos painéis
    const cx = o.x + (x1 * TILE) / 2 - (left - right) / 2 / z;
    const cy = o.y + (y1 * TILE) / 2 - (top - bottom) / 2 / z;
    if (animate) cam.animateTo(cx, cy, z, performance.now(), 350);
    else {
      cam.stop();
      cam.zoom = z;
      cam.x = cx;
      cam.y = cy;
    }
  }

  focusItem(id: string): void {
    const it = this.item(id);
    if (!it) return;
    this.sel = id;
    const cam = kvPeople.camera;
    if (cam) {
      const o = (kvPlanWorld as { origin?: { x: number; y: number } }).origin ?? { x: 0, y: 0 };
      cam.animateTo(o.x + (it.x + it.w / 2) * TILE, o.y + (it.y + it.h / 2) * TILE, Math.max(cam.zoom, 2), performance.now(), 350);
    }
    this.changed(false);
  }

  private setMode(m: KvViewMode): void {
    this.mode = m;
    for (const b of this.modeSeg.querySelectorAll<HTMLElement>('[data-mode]')) {
      const on = b.dataset.mode === m;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const hh = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hh * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(hh * dpr);
    }
    this.extendCamera();
    this.edgePan();
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ghost = this.drag && (this.drag.mode === 'move' || this.drag.mode === 'resize') && this.drag.moved ? { item: this.item(this.drag.id)!, rect: this.drag.cur, ok: this.drag.ok } : this.drag?.mode === 'new' && this.drag.inside ? { item: this.drag.item, rect: this.drag.cur, ok: this.drag.ok } : null;
    kvDrawPlan(this.ctx, this.view(), {
      plan: this.draft,
      mode: this.mode,
      sel: this.sel,
      hover: this.hover,
      ghost: ghost?.item ? ghost : null,
      doorHint: this.doorHint,
      warned: new Set(this.warns.map((w) => w.id).filter((x): x is string => !!x)),
      name: this.nameOf,
      now: performance.now(),
      autoHover: this.autoHover || this.drag?.mode === 'auto',
    });
  };

  /** Arrastando perto da borda da área livre (fora dos painéis): a câmera anda para lá. */
  private edgePan(): void {
    const d = this.drag;
    const p = this.lastPtr;
    if (!p || !d || (d.mode !== 'move' && d.mode !== 'resize' && d.mode !== 'new' && d.mode !== 'auto')) return;
    if (d.mode === 'new' && !d.inside) return;
    const cam = kvPeople.camera;
    if (!cam) return;
    const r = this.canvasRect();
    const left = this.mobile ? r.left : this.palette.getBoundingClientRect().right;
    const right = this.panel.getBoundingClientRect().left || r.right;
    const top = this.bar.getBoundingClientRect().bottom;
    const bottom = r.bottom - 34;
    const zone = 30;
    const k = (dist: number) => Math.max(0, Math.min(1, (zone - dist) / zone)) * 12;
    const dx = k(p.clientX - left) - k(right - p.clientX);
    const dy = k(p.clientY - top) - k(bottom - p.clientY);
    if (!dx && !dy) return;
    cam.panBy(dx, dy);
    this.move(p);
  }

  // ------------------------------------------------------------------ ponteiro e teclado

  private tileAt(e: { clientX: number; clientY: number }): { fx: number; fy: number; sx: number; sy: number } {
    const r = this.canvasRect();
    const v = this.view();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return { fx: (sx - v.ox) / v.s, fy: (sy - v.oy) / v.s, sx, sy };
  }

  private handleAt(sx: number, sy: number): KvHandle | null {
    const it = this.item(this.sel);
    if (!it || it.locked || it.kind === 'nucleo' || it.kind === 'vaga' || this.mobile) return null;
    for (const p of kvHandlePoints(this.view(), it)) if (Math.abs(p.x - sx) <= 8 && Math.abs(p.y - sy) <= 8) return p.h;
    return null;
  }

  private wallAt(fx: number, fy: number): { it: KvPlanItem; side: 'n' | 's' | 'e' | 'w'; pos: number } | null {
    const it = this.item(this.sel);
    if (!it || !kvPlanWalled(it.kind) || it.kind === 'nucleo' || it.locked || this.mobile) return null;
    const v = this.view();
    const w = kvWallAt(it, fx, fy, Math.max(0.35, 9 / v.s));
    return w ? { it, ...w } : null;
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', () => this.cancelDrag());
    c.addEventListener('dblclick', (e) => {
      const t = this.tileAt(e);
      const it = kvItemAt(this.draft, Math.floor(t.fx), Math.floor(t.fy));
      if (it) {
        this.sel = it.id;
        this.changed(false);
        (this.panel.querySelector('input[name="kv-pe-name"]') as HTMLInputElement | null)?.focus();
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const cam = kvPeople.camera;
        if (!cam) return;
        const r = this.worldRect();
        if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
          cam.zoomAt(cam.zoom * k, e.clientX - r.left, e.clientY - r.top, performance.now(), false);
        } else cam.panBy(-e.deltaX, 0);
      },
      { passive: false },
    );
    const key = (e: KeyboardEvent) => this.key(e);
    const keyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') this.space = false;
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('keyup', keyUp, true);
    const unload = (e: BeforeUnloadEvent) => {
      if (this.dirty) e.preventDefault();
    };
    addEventListener('beforeunload', unload);
    this.off.push(() => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('keyup', keyUp, true);
      removeEventListener('beforeunload', unload);
    });
  }

  private down(e: PointerEvent): void {
    if (e.button === 2) return;
    this.canvas.setPointerCapture(e.pointerId);
    const t = this.tileAt(e);
    if (e.button === 1 || this.space) {
      e.preventDefault();
      this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }
    // bandeirinha da faixa automática
    const f = kvAutoFlagScreen(this.view(), this.draft);
    if (!this.mobile && t.sx >= f.x && t.sx <= f.x + f.w && t.sy >= f.y && t.sy <= f.y + f.h) {
      this.before();
      this.drag = { mode: 'auto', fx: t.fx, fy: t.fy, ox: this.draft.auto.x, oy: this.draft.auto.y };
      return;
    }
    const handle = this.handleAt(t.sx, t.sy);
    const sel = this.item(this.sel);
    if (handle && sel) {
      this.drag = { mode: 'resize', id: sel.id, handle, fx: t.fx, fy: t.fy, orig: { x: sel.x, y: sel.y, w: sel.w, h: sel.h }, cur: { x: sel.x, y: sel.y, w: sel.w, h: sel.h }, ok: true, moved: false };
      return;
    }
    const wall = this.wallAt(t.fx, t.fy);
    if (wall) {
      const i = kvDoorIndexAt(wall.it, wall.side, wall.pos);
      if (i >= 0) this.drag = { mode: 'door', id: wall.it.id, index: i, sx: t.sx, sy: t.sy, moved: false, before: kvClonePlan(this.draft) };
      else this.drag = { mode: 'wall', id: wall.it.id, side: wall.side, pos: wall.pos, sx: t.sx, sy: t.sy };
      return;
    }
    const it = kvItemAt(this.draft, Math.floor(t.fx), Math.floor(t.fy));
    if (it) {
      if (this.sel !== it.id) {
        this.sel = it.id;
        this.changed(false);
      }
      this.drag = { mode: 'move', id: it.id, fx: t.fx, fy: t.fy, orig: { x: it.x, y: it.y, w: it.w, h: it.h }, cur: { x: it.x, y: it.y, w: it.w, h: it.h }, ok: true, moved: false };
      return;
    }
    this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, moved: false, click: true };
  }

  private move(e: PointerEvent | { clientX: number; clientY: number; shiftKey: boolean }): void {
    const t = this.tileAt(e);
    const d = this.drag;
    this.lastPtr = d ? { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey } : null;
    if (!d) {
      this.hoverAt(t);
      return;
    }
    if (d.mode === 'pan') {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      kvPeople.camera?.panBy(dx, dy);
      d.sx = e.clientX;
      d.sy = e.clientY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (d.mode === 'auto') {
      const x = Math.max(0, Math.round(d.ox + t.fx - d.fx));
      const y = Math.max(0, Math.round(d.oy + t.fy - d.fy));
      this.draft = { ...this.draft, auto: { ...this.draft.auto, x, y } };
      return;
    }
    if (d.mode === 'move') {
      const it = this.item(d.id)!;
      const dx = Math.round(t.fx - d.fx);
      const dy = Math.round(t.fy - d.fy);
      if (!d.moved && Math.abs(t.fx - d.fx) < 0.4 && Math.abs(t.fy - d.fy) < 0.4) return;
      if (it.locked) {
        if (!d.moved) kvToast(tr('Sala travada: destrave no painel (L) para mover.'), { kind: 'warn', key: 'kv-plan-lock', ms: 2500 });
        d.moved = true;
        d.ok = false;
        return;
      }
      d.moved = true;
      let r = kvClampRect({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy });
      if (!e.shiftKey) r = kvMagnet(this.draft, r, d.id);
      d.cur = r;
      d.ok = !kvHit(this.draft, r, d.id);
      this.canvas.style.cursor = d.ok ? 'grabbing' : 'not-allowed';
      return;
    }
    if (d.mode === 'resize') {
      const it = this.item(d.id)!;
      d.moved = true;
      const r = kvResize(d.orig, it.kind, d.handle, Math.round(t.fx - d.fx), Math.round(t.fy - d.fy));
      d.cur = r;
      d.ok = !kvHit(this.draft, r, d.id);
      return;
    }
    if (d.mode === 'door') {
      if (!d.moved && Math.hypot(t.sx - d.sx, t.sy - d.sy) < 4) return;
      const it = this.item(d.id);
      if (!it) return;
      const w = kvWallAt(it, t.fx, t.fy, 3);
      if (!w) return;
      d.moved = true;
      const next = kvMoveDoor(it, d.index, w.side, w.pos);
      if (next !== it) {
        this.draft = { ...this.draft, items: this.draft.items.map((i) => (i.id === it.id ? next : i)) };
        d.index = (next.doors ?? []).findIndex((x) => x.side === w.side && Math.abs(x.at + (x.w ?? 2) / 2 - w.pos) < (x.w ?? 2));
        if (d.index < 0) d.index = 0;
      }
      return;
    }
    if (d.mode === 'new') {
      const r = this.canvasRect();
      d.inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && !this.overPanel(e);
      let rect = kvClampRect({ x: Math.round(t.fx - d.item.w / 2), y: Math.round(t.fy - d.item.h / 2), w: d.item.w, h: d.item.h });
      if (!e.shiftKey) rect = kvMagnet(this.draft, rect, d.item.id);
      d.cur = rect;
      d.ok = !kvHit(this.draft, rect);
    }
  }

  private overPanel(e: { clientX: number; clientY: number }): boolean {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return !!el?.closest('.kv-pe__palette, .kv-pe__panel, .kv-pe__bar');
  }

  private hoverAt(t: { fx: number; fy: number; sx: number; sy: number }): void {
    const f = kvAutoFlagScreen(this.view(), this.draft);
    this.autoHover = !this.mobile && t.sx >= f.x && t.sx <= f.x + f.w && t.sy >= f.y && t.sy <= f.y + f.h;
    const handle = this.handleAt(t.sx, t.sy);
    const wall = handle ? null : this.wallAt(t.fx, t.fy);
    if (wall) {
      const i = kvDoorIndexAt(wall.it, wall.side, wall.pos);
      const d = i >= 0 ? wall.it.doors![i] : null;
      this.doorHint = d ? { id: wall.it.id, side: d.side, at: d.at, w: d.w ?? 2, remove: true } : { id: wall.it.id, side: wall.side, at: Math.max(0, Math.round(wall.pos - 1)), w: 2, remove: false };
    } else this.doorHint = null;
    const it = kvItemAt(this.draft, Math.floor(t.fx), Math.floor(t.fy));
    this.hover = it?.id ?? null;
    const cursors: Record<KvHandle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
    this.canvas.style.cursor = this.autoHover ? 'grab' : handle ? cursors[handle] : wall ? (this.doorHint?.remove ? 'pointer' : 'copy') : it ? (it.locked ? 'default' : 'move') : this.space ? 'grab' : 'default';
    this.canvas.title = this.autoHover ? tr('Faixa automática: arraste para onde nascem as salas novas sem lugar') : wall ? (this.doorHint?.remove ? tr('Clique para tirar a porta; arraste para mover') : tr('Clique para pôr uma porta aqui')) : '';
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.lastPtr = null;
    this.canvas.style.cursor = '';
    if (!d) return;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // já solto
    }
    if (d.mode === 'pan') {
      if (d.click && !d.moved && this.sel) {
        this.sel = null;
        this.changed(false);
      }
      return;
    }
    if (d.mode === 'auto') {
      this.changed();
      return;
    }
    if (d.mode === 'move' || d.mode === 'resize') {
      if (!d.moved) return;
      const it = this.item(d.id);
      if (!it || it.locked) return;
      if (!d.ok) {
        kvToast(tr('Não cabe aí: encostaria em outra sala.'), { kind: 'warn', key: 'kv-plan-bad', ms: 2200 });
        return;
      }
      if (d.cur.x === it.x && d.cur.y === it.y && d.cur.w === it.w && d.cur.h === it.h) return;
      this.before();
      this.replaceItem(kvFixDoors({ ...it, ...d.cur }));
      return;
    }
    if (d.mode === 'door') {
      const it = this.item(d.id);
      if (!it) return;
      if (!d.moved) {
        const t = this.tileAt(e);
        const w = kvWallAt(it, t.fx, t.fy, 3);
        if (!w) return;
        this.before();
        this.replaceItem(kvToggleDoor(it, w.side, w.pos));
      } else {
        this.undo.push(d.before);
        this.changed();
      }
      return;
    }
    if (d.mode === 'wall') {
      const it = this.item(d.id);
      if (!it) return;
      this.before();
      this.replaceItem(kvToggleDoor(it, d.side, d.pos));
      return;
    }
    if (d.mode === 'new') {
      document.body.classList.remove('kv-pe-dragging');
      if (!d.inside) return;
      if (!d.ok) {
        kvToast(tr('Não cabe aí: encostaria em outra sala.'), { kind: 'warn', key: 'kv-plan-bad', ms: 2200 });
        return;
      }
      this.addItem({ ...d.item, ...d.cur });
    }
  }

  private cancelDrag(): void {
    if (this.drag?.mode === 'door') this.draft = this.drag.before;
    this.drag = null;
    document.body.classList.remove('kv-pe-dragging');
  }

  private key(e: KeyboardEvent): void {
    if (!this.root.isConnected) return;
    // outra janela por cima (modelos, versões, confirmação): ela cuida das teclas
    if (document.querySelector('dialog[open]')) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') {
      e.preventDefault();
      e.stopPropagation();
      void this.save();
      return;
    }
    if (typing) {
      if (e.key === 'Escape') (t as HTMLElement).blur();
      return;
    }
    let handled = true;
    const sel = this.item(this.sel);
    if (mod && k === 'z' && !e.shiftKey) this.doUndo();
    else if ((mod && k === 'z' && e.shiftKey) || (mod && k === 'y')) this.doRedo();
    else if (mod && k === 'd') this.duplicate();
    else if (e.key === 'Delete' || e.key === 'Backspace') this.remove();
    else if (e.key === 'Escape') {
      if (this.drag) this.cancelDrag();
      else if (this.sel) {
        this.sel = null;
        this.changed(false);
      } else void this.close();
    } else if (e.key === ' ') {
      this.space = true;
      this.canvas.style.cursor = 'grab';
    } else if (k === 'l' && sel && !mod) this.toggle('locked');
    else if (k === 'f' && sel && !mod) this.toggle('fixed');
    else if (e.key === 'Enter' && sel) (this.panel.querySelector('input[name="kv-pe-name"]') as HTMLInputElement | null)?.focus();
    else if (e.key.startsWith('Arrow') && sel) this.nudge(e.key, e.shiftKey ? 4 : 1);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private nudge(key: string, n: number): void {
    const it = this.item(this.sel);
    if (!it) return;
    if (it.locked) {
      kvToast(tr('Sala travada: destrave no painel (L) para mover.'), { kind: 'warn', key: 'kv-plan-lock', ms: 2500 });
      return;
    }
    const dx = key === 'ArrowLeft' ? -n : key === 'ArrowRight' ? n : 0;
    const dy = key === 'ArrowUp' ? -n : key === 'ArrowDown' ? n : 0;
    // anda o quanto der até encostar
    for (let k = n; k >= 1; k--) {
      const r = kvClampRect({ x: it.x + Math.sign(dx) * k, y: it.y + Math.sign(dy) * k, w: it.w, h: it.h });
      if (!kvHit(this.draft, r, it.id) && (r.x !== it.x || r.y !== it.y)) {
        this.before();
        this.replaceItem({ ...it, x: r.x, y: r.y });
        return;
      }
    }
  }

  // ------------------------------------------------------------------ ações

  private doUndo(): void {
    const p = this.undo.undo(this.draft);
    if (p) this.set(p, { keepSel: false });
  }

  private doRedo(): void {
    const p = this.undo.redo(this.draft);
    if (p) this.set(p, { keepSel: false });
  }

  private duplicate(): void {
    if (!this.sel) return;
    const r = kvDuplicate(this.draft, this.sel);
    if (!r) {
      kvToast(tr('Essa sala não se duplica (é uma sala só da empresa).'), { kind: 'warn', key: 'kv-plan-dup', ms: 2500 });
      return;
    }
    this.before();
    this.sel = r.id;
    this.set(r.plan);
  }

  private remove(): void {
    const it = this.item(this.sel);
    if (!it) return;
    if (it.locked) {
      kvToast(tr('Sala travada: destrave no painel (L) antes de apagar.'), { kind: 'warn', key: 'kv-plan-lock', ms: 2500 });
      return;
    }
    this.before();
    this.sel = null;
    this.set({ ...this.draft, items: this.draft.items.filter((i) => i.id !== it.id) });
    kvToast(tr('“{0}” saiu da planta.', [this.nameOf(it)]), { key: 'kv-plan-del', ms: 4000, action: { label: tr('Desfazer'), run: () => this.doUndo() } });
  }

  private toggle(field: 'locked' | 'fixed'): void {
    const it = this.item(this.sel);
    if (!it) return;
    if (field === 'fixed' && it.kind !== 'projeto') {
      kvToast(tr('Só sala de projeto vira sala fixa (as outras já existem sempre).'), { key: 'kv-plan-fix', ms: 2500 });
      return;
    }
    this.before();
    const next = { ...it };
    if (next[field]) delete next[field];
    else next[field] = true;
    this.replaceItem(next);
  }

  /** Põe um item novo (da paleta): no lugar pedido ou perto do meio da tela. */
  private addItem(it: KvPlanItem): void {
    let item = it;
    if (kvHit(this.draft, item)) {
      const v = this.view();
      const c = { fx: (v.w / 2 - v.ox) / v.s, fy: (v.h / 2 - v.oy) / v.s };
      const spot = kvFindFree(this.draft, item.w, item.h, c.fx, c.fy);
      if (!spot) {
        kvToast(tr('Não achei lugar livre: abra espaço na planta.'), { kind: 'warn', key: 'kv-plan-bad' });
        return;
      }
      item = { ...item, ...spot };
    }
    if (item.kind === 'vaga') item.order = Math.max(-1, ...this.draft.items.filter((i) => i.kind === 'vaga').map((i) => i.order ?? 0)) + 1;
    this.before();
    this.sel = item.id;
    this.set({ ...this.draft, items: [...this.draft.items, kvFixDoors(item)] });
    // porta encostada num corredor, se der
    const placed = this.item(item.id);
    if (placed && kvPlanWalled(placed.kind) && placed.kind !== 'nucleo' && this.warns.some((w) => w.id === placed.id && w.kind === 'porta')) {
      const fixed = kvAutoDoor(this.draft, { ...placed, doors: [] });
      if (fixed) this.replaceItem(fixed);
    }
  }

  /** Começa a arrastar uma peça da paleta (soltar no vazio da planta põe; clique sem arrastar põe perto do meio). */
  private startNew(e: PointerEvent, make: () => KvPlanItem | null): void {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const target = e.currentTarget as HTMLElement;
    let started = false;
    const moveFn = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
        const it = make();
        if (!it) return cleanup();
        started = true;
        document.body.classList.add('kv-pe-dragging');
        this.drag = { mode: 'new', item: it, cur: { x: 0, y: 0, w: it.w, h: it.h }, ok: false, inside: false };
      }
      if (started) this.move(ev);
    };
    const upFn = (ev: PointerEvent) => {
      cleanup();
      if (started) this.up(ev);
      else if (target.contains(document.elementFromPoint(ev.clientX, ev.clientY))) {
        const it = make();
        if (it) this.addItem(it);
      }
    };
    const cleanup = () => {
      removeEventListener('pointermove', moveFn);
      removeEventListener('pointerup', upFn);
    };
    addEventListener('pointermove', moveFn);
    addEventListener('pointerup', upFn);
  }

  // ------------------------------------------------------------------ paleta

  private buildPalette(): void {
    if (this.mobile) return;
    const used = new Set(this.draft.items.map((i) => `${i.kind}:${i.ref ?? ''}`));
    const card = (icon: string, label: string, sub: string, color: string, make: () => KvPlanItem | null, o: { disabled?: string } = {}) => {
      const b = h(
        'button',
        { type: 'button', class: 'kv-pe__card', style: `--c:${color}`, title: o.disabled ?? `${label} — ${sub}`, disabled: !!o.disabled },
        h('span', { class: 'kv-pe__card-icon', html: icon }),
        h('span', { class: 'kv-pe__card-text' }, h('span', { class: 'kv-pe__card-label', text: label }), h('span', { class: 'kv-pe__card-sub', text: o.disabled ?? sub })),
      );
      b.addEventListener('pointerdown', (e) => this.startNew(e, make));
      return b;
    };
    const section = (title: string, ...els: HTMLElement[]) => h('section', { class: 'kv-pe__sec' }, h('h3', { class: 'kv-pe__sec-title', text: title }), ...els);
    const search = h('input', { class: 'kv-pe__search', type: 'search', attrs: { placeholder: tr('Buscar projeto ou sala…'), 'aria-label': tr('Buscar') } });
    // projetos: um cartão por projeto que ainda não está na planta
    const projList = h('div', { class: 'kv-pe__list' });
    const ownList = h('div', { class: 'kv-pe__list' });
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      projList.replaceChildren();
      const free = this.projects.filter((p) => !used.has(`projeto:${p.ref}`) && (!q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)));
      for (const p of free.slice(0, 60)) {
        projList.append(card(kvIcon('planta') && kvItemIcon({ kind: 'projeto' }), p.name, p.path.split('/').slice(-2, -1)[0] ?? tr('projeto'), kvKindColor('projeto'), () => kvNewItem('projeto', { ref: p.ref, w: 16, h: 12 })));
      }
      if (!free.length) projList.append(h('p', { class: 'kv-pe__empty', text: this.projects.length ? tr('Todos os projetos já estão na planta.') : tr('Carregando os projetos…') }));
      ownList.replaceChildren();
      const own = kvRoomsState().rooms.filter((r) => !used.has(`propria:${r.id}`) && (!q || r.name.toLowerCase().includes(q)));
      for (const r of own) ownList.append(card(kvItemIcon({ kind: 'propria' }), r.name, tr('sala própria'), kvKindColor('propria'), () => kvNewItem('propria', { ref: r.id, w: 14, h: 10 })));
      if (!own.length) ownList.append(h('p', { class: 'kv-pe__empty', text: tr('Nenhuma sala própria fora da planta (crie pela tela Salas).') }));
    };
    search.addEventListener('input', fill);
    fill();
    const themes = h('div', { class: 'kv-pe__grid' });
    for (const k of KV_THEME_KEYS) {
      const info = kvThemeInfo(k);
      themes.append(card(info.icon, info.name, info.desc, info.color, () => kvNewItem('tema', { ref: k, w: info.size.w, h: info.size.h })));
    }
    const core = h('div', { class: 'kv-pe__grid' });
    for (const r of KV_CORE_REFS) {
      const there = used.has(`nucleo:${r}`);
      core.append(card(kvItemIcon({ kind: 'nucleo', ref: r }), kvCoreName(r), tr('área comum 16×12'), kvKindColor('nucleo', r), () => kvNewItem('nucleo', { ref: r }), there ? { disabled: tr('já está na planta') } : {}));
    }
    const areas = h(
      'div',
      { class: 'kv-pe__grid' },
      card(kvItemIcon({ kind: 'corredor' }), tr('Corredor'), tr('passagem entre as salas'), kvKindColor('corredor'), () => kvNewItem('corredor', { w: 16, h: 4 })),
      card(kvItemIcon({ kind: 'jardim' }), tr('Jardim'), tr('pátio verde, dá para andar'), kvKindColor('jardim'), () => kvNewItem('jardim', { w: 8, h: 8 })),
      card(kvItemIcon({ kind: 'vaga' }), tr('Vaga'), tr('lugar para sala nova automática'), kvKindColor('vaga'), () => kvNewItem('vaga')),
    );
    this.palette.replaceChildren(
      h('div', { class: 'kv-pe__palette-head' }, h('strong', { class: 'kv-pe__palette-title kv-ui-px', text: tr('Peças') }), h('span', { class: 'kv-pe__palette-hint', text: tr('Arraste para a planta ou clique') })),
      search,
      section(tr('Áreas'), areas),
      section(tr('Salas temáticas'), themes),
      section(tr('Salas de projeto'), projList),
      section(tr('Salas próprias'), ownList),
      section(tr('Núcleo'), core),
    );
  }

  // ------------------------------------------------------------------ painel da direita

  private renderPanel(force = false): void {
    const it = this.item(this.sel);
    const sig = JSON.stringify([it ?? null, this.warns, this.draft.name, this.draft.on, this.draft.editors, this.draft.w, this.draft.h, this.draft.auto, this.projects.length, this.mobile]);
    if (!force && sig === this.panelSig) return;
    // sem refazer enquanto alguém digita no painel (o foco sairia do campo)
    const active = document.activeElement as HTMLElement | null;
    if (!force && active && this.panel.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && this.panelSig.startsWith(`${JSON.stringify([it ?? null]).slice(0, 12)}`)) {
      this.panelSig = sig;
      return;
    }
    this.panelSig = sig;
    this.panel.replaceChildren(...(it ? this.itemPanel(it) : this.planPanel()));
    if (!this.mobile) this.buildPalette();
  }

  private warnText(w: KvPlanWarn): string {
    switch (w.kind) {
      case 'porta':
        return tr('sem porta para um corredor ou área aberta');
      case 'caminho':
        return tr('sem caminho até a recepção (os elevadores)');
      case 'fora':
        return tr('fora da planta');
      case 'recepcao':
        return tr('a planta não tem recepção: é por ela que as pessoas chegam');
    }
  }

  private warnList(list: KvPlanWarn[]): HTMLElement | null {
    if (!list.length) return null;
    const ul = h('ul', { class: 'kv-pe__warns' });
    for (const w of list) {
      const it = this.item(w.id ?? null);
      const fixBtn = kvBtn(tr('Corrigir'), {
        size: 'sm',
        onClick: () => this.fix(w),
      });
      ul.append(
        h(
          'li',
          { class: 'kv-pe__warn' },
          h('span', { class: 'kv-pe__warn-icon', html: kvIcon('aviso') }),
          h('span', { class: 'kv-pe__warn-text' }, it ? h('strong', { text: this.nameOf(it) }) : null, h('span', { text: it ? ` — ${this.warnText(w)}` : this.warnText(w) })),
          fixBtn,
        ),
      );
    }
    return ul;
  }

  /** "Corrigir": leva até o item e conserta o que der sozinho (porta encostada no corredor, recepção de volta). */
  private fix(w: KvPlanWarn): void {
    if (w.kind === 'recepcao') {
      const it = kvNewItem('nucleo', { ref: 'recepcao' });
      this.addItem(it);
      this.focusItem(it.id);
      return;
    }
    const it = this.item(w.id ?? null);
    if (!it) return;
    this.focusItem(it.id);
    if (w.kind === 'porta') {
      const fixed = kvAutoDoor(this.draft, it);
      if (fixed) {
        this.before();
        this.replaceItem(fixed);
        kvToast(tr('Porta posta na parede encostada no corredor.'), { kind: 'ok', key: 'kv-plan-fix', ms: 2500 });
      } else kvToast(tr('Encoste a sala num corredor (ou ponha um corredor na frente da porta).'), { key: 'kv-plan-fix', ms: 4000 });
    } else if (w.kind === 'caminho') kvToast(tr('Ligue o corredor desta sala aos outros (encostando um no outro).'), { key: 'kv-plan-fix', ms: 4000 });
    else if (w.kind === 'fora') {
      this.set(kvFitPlan(this.draft));
    }
  }

  private planPanel(): HTMLElement[] {
    const p = this.draft;
    const name = kvInput({ placeholder: tr('Nome da empresa'), value: p.name ?? '', maxlength: 60, name: 'kv-pe-company' });
    name.input.addEventListener('change', () => {
      this.before();
      const v = name.input.value.trim();
      const next = { ...this.draft };
      if (v) next.name = v;
      else delete next.name;
      this.set(next);
    });
    const on = kvToggle(tr('Planta ligada'), {
      checked: p.on,
      hint: tr('Desligada, o escritório volta ao prédio original — o desenho fica guardado.'),
      onChange: (v) => {
        this.before();
        this.set({ ...this.draft, on: v });
      },
    });
    const isAdmin = me?.local || me?.person?.role === 'admin';
    const editors = isAdmin
      ? kvToggle(tr('A equipe também edita'), {
          checked: p.editors === 'equipe',
          hint: tr('Desligado: só quem é admin mexe na planta.'),
          onChange: (v) => {
            this.before();
            const next = { ...this.draft };
            if (v) next.editors = 'equipe';
            else delete next.editors;
            this.set(next);
          },
        })
      : null;
    const counts = new Map<KvPlanKind, number>();
    for (const it of p.items) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
    const stats = h(
      'div',
      { class: 'kv-pe__stats' },
      ...(['projeto', 'tema', 'propria', 'vaga', 'corredor', 'jardim'] as KvPlanKind[]).map((k) =>
        h('span', { class: 'kv-pe__stat', style: `--c:${kvKindColor(k)}` }, h('b', { text: String(counts.get(k) ?? 0) }), h('span', { text: kvKindLabel(k) })),
      ),
    );
    const dirW = this.draft.auto.dir;
    const autoSeg = h(
      'div',
      { class: 'kv-pe__seg kv-pe__seg--sm' },
      ...(['e', 's'] as const).map((d) =>
        h('button', {
          type: 'button',
          class: `kv-pe__seg-btn${dirW === d ? ' is-on' : ''}`,
          text: d === 'e' ? tr('para a direita ▶') : tr('para baixo ▼'),
          on: {
            click: () => {
              this.before();
              this.set({ ...this.draft, auto: { ...this.draft.auto, dir: d } });
            },
          },
        }),
      ),
    );
    const out: (HTMLElement | null)[] = [
      h('div', { class: 'kv-pe__panel-head' }, h('span', { class: 'kv-pe__panel-icon', html: kvIcon('planta') }), h('div', {}, h('strong', { class: 'kv-pe__panel-title', text: p.name || tr('A sua empresa') }), h('span', { class: 'kv-pe__panel-sub', text: tr('{0}×{1} tiles · {2} peças', [p.w, p.h, p.items.length]) }))),
      this.mobile ? h('p', { class: 'kv-pe__hint', text: tr('Toque numa sala para escolher; arraste para mover.') }) : h('p', { class: 'kv-pe__hint', text: tr('Escolha uma peça na planta para editar. Arraste da paleta para pôr salas novas.') }),
      field(tr('Nome da empresa'), name.el),
      stats,
      this.warnList(this.warns),
      this.warns.length ? null : h('p', { class: 'kv-pe__ok' }, h('span', { html: KV_ICONS.check }), h('span', { text: tr('Tudo certo: toda sala tem porta e caminho até a recepção.') })),
      h('div', { class: 'kv-pe__group' }, on.el, editors?.el ?? null),
      h('div', { class: 'kv-pe__group' }, h('strong', { class: 'kv-pe__label', text: tr('Faixa automática') }), h('p', { class: 'kv-pe__hint', text: tr('Projetos novos sem vaga livre nascem na faixa marcada pela bandeirinha verde. Arraste a bandeirinha para mudar o lugar.') }), autoSeg),
      h(
        'div',
        { class: 'kv-pe__actions' },
        kvBtn(tr('Ajustar o tamanho'), { size: 'sm', onClick: () => this.set(kvTrimPlan(this.draft)), title: tr('Encolhe a planta ao que as peças ocupam') }),
        this.mobile ? null : kvBtn(tr('Voltar ao prédio original'), { size: 'sm', variant: 'ghost', onClick: () => void this.resetClassic() }),
      ),
    ];
    return out.filter((x): x is HTMLElement => !!x);
  }

  private itemPanel(it: KvPlanItem): HTMLElement[] {
    const color = it.color ?? kvKindColor(it.kind, it.ref);
    const name = kvInput({ placeholder: this.nameOf({ ...it, name: undefined }), value: it.name ?? '', maxlength: 40, name: 'kv-pe-name' });
    name.input.addEventListener('change', () => {
      const v = name.input.value.trim();
      const cur = this.item(it.id);
      if (!cur || (cur.name ?? '') === v) return;
      this.before();
      const next = { ...cur };
      if (v) next.name = v;
      else delete next.name;
      this.replaceItem(next);
    });
    const out: (HTMLElement | null)[] = [
      h(
        'div',
        { class: 'kv-pe__panel-head', style: `--c:${color}` },
        h('span', { class: 'kv-pe__panel-icon', html: kvItemIcon(it) }),
        h('div', {}, h('strong', { class: 'kv-pe__panel-title', text: this.nameOf(it) }), h('span', { class: 'kv-pe__panel-sub', text: `${kvKindLabel(it.kind)} · ${it.w}×${it.h}` })),
        kvIconBtn(KV_ICONS.close, tr('Soltar (Esc)'), () => {
          this.sel = null;
          this.changed(false);
        }),
      ),
    ];
    if (it.kind !== 'corredor' && it.kind !== 'jardim') out.push(field(tr('Nome na placa'), name.el));
    // o que é: projeto / sala própria / tema
    if (it.kind === 'projeto') {
      const sel = h('select', { class: 'kv-pe__select', attrs: { 'aria-label': tr('Projeto') } });
      const opts = this.projects.some((p) => p.ref === it.ref) ? this.projects : [...this.projects, { ref: it.ref ?? '', path: it.ref ?? '', name: this.nameOf({ ...it, name: undefined }) }];
      for (const p of opts) {
        const taken = p.ref !== it.ref && this.draft.items.some((o) => o.kind === 'projeto' && o.ref === p.ref);
        sel.append(h('option', { value: p.ref, text: `${p.name}${taken ? ` · ${tr('já na planta')}` : ''}`, disabled: taken, selected: p.ref === it.ref }));
      }
      sel.addEventListener('change', () => {
        this.before();
        this.replaceItem({ ...this.item(it.id)!, ref: sel.value });
      });
      out.push(field(tr('Projeto'), sel));
      out.push(
        kvToggle(tr('Sala fixa'), {
          checked: !!it.fixed,
          hint: tr('Existe sempre, mesmo vazia (fica apagada até alguém chegar). Tecla F.'),
          onChange: () => this.toggle('fixed'),
        }).el,
      );
    } else if (it.kind === 'propria') {
      const sel = h('select', { class: 'kv-pe__select', attrs: { 'aria-label': tr('Sala própria') } });
      for (const r of kvRoomsState().rooms) {
        const taken = r.id !== it.ref && this.draft.items.some((o) => o.kind === 'propria' && o.ref === r.id);
        sel.append(h('option', { value: r.id, text: r.name, disabled: taken, selected: r.id === it.ref }));
      }
      sel.addEventListener('change', () => {
        this.before();
        this.replaceItem({ ...this.item(it.id)!, ref: sel.value });
      });
      out.push(field(tr('Sala própria'), sel));
    } else if (it.kind === 'tema') {
      const sel = h('select', { class: 'kv-pe__select', attrs: { 'aria-label': tr('Tema') } });
      for (const k of KV_THEME_KEYS) sel.append(h('option', { value: k, text: kvThemeInfo(k).name, selected: k === it.ref }));
      sel.addEventListener('change', () => {
        this.before();
        this.replaceItem({ ...this.item(it.id)!, ref: sel.value as KvThemeKey });
      });
      out.push(field(tr('Tema'), sel));
      const info = KV_THEME_KEYS.includes(it.ref as KvThemeKey) ? kvThemeInfo(it.ref as KvThemeKey) : null;
      if (info) out.push(h('p', { class: 'kv-pe__hint', text: info.desc }));
    } else if (it.kind === 'nucleo') {
      out.push(h('p', { class: 'kv-pe__hint', text: tr('Área comum do prédio original: tamanho e portas fixos (16×12).') }));
    } else if (it.kind === 'vaga') {
      out.push(h('p', { class: 'kv-pe__hint', text: tr('Um projeto novo sem lugar marcado ocupa a primeira vaga livre (na ordem das vagas).') }));
    }
    // travar
    out.push(kvToggle(tr('Travar'), { checked: !!it.locked, hint: tr('Travada não se arrasta, não muda de tamanho nem se apaga. Tecla L.'), onChange: () => this.toggle('locked') }).el);
    // aparência
    if (it.kind !== 'corredor' && it.kind !== 'jardim' && it.kind !== 'vaga' && it.kind !== 'nucleo') {
      const pal = h('div', { class: 'kv-pe__swatches', role: 'radiogroup', attrs: { 'aria-label': tr('Paleta da sala') } });
      const swatchColors = ['#3f7fd8', '#4cae6a', '#e0b030', '#e05a5a', '#8d66cf', '#2fb3b0', '#f08a3c', '#e47aa8', '#5b6f99', '#7fae2c'];
      pal.append(
        h('button', {
          type: 'button',
          class: `kv-pe__swatch kv-pe__swatch--auto${it.palette === undefined ? ' is-on' : ''}`,
          title: tr('Paleta automática'),
          text: 'A',
          on: { click: () => this.setField(it.id, 'palette', undefined) },
        }),
      );
      swatchColors.forEach((c, i) =>
        pal.append(h('button', { type: 'button', class: `kv-pe__swatch${it.palette === i ? ' is-on' : ''}`, style: `--c:${c}`, title: tr('Paleta {0}', [i + 1]), on: { click: () => this.setField(it.id, 'palette', i) } })),
      );
      out.push(field(tr('Paleta da sala'), pal));
      const colorIn = h('input', { type: 'color', class: 'kv-pe__color', value: it.color ?? color, attrs: { 'aria-label': tr('Cor da placa') } });
      colorIn.addEventListener('change', () => this.setField(it.id, 'color', colorIn.value));
      const clear = kvBtn(tr('Sem cor'), { size: 'sm', variant: 'ghost', onClick: () => this.setField(it.id, 'color', undefined) });
      out.push(field(tr('Cor da placa'), h('div', { class: 'kv-pe__row' }, colorIn, it.color ? clear : null)));
      const styles = furnStyles(it);
      if (styles.length) {
        const sel = h('select', { class: 'kv-pe__select', attrs: { 'aria-label': tr('Mobília') } });
        sel.append(h('option', { value: '', text: tr('Padrão'), selected: !it.style }));
        for (const s of styles) sel.append(h('option', { value: s, text: s, selected: it.style === s }));
        sel.addEventListener('change', () => this.setField(it.id, 'style', sel.value || undefined));
        out.push(field(tr('Mobília'), sel));
      }
    }
    // portas
    if (kvPlanWalled(it.kind) && it.kind !== 'nucleo') {
      const sides: Record<string, string> = { n: tr('em cima'), s: tr('embaixo'), e: tr('à direita'), w: tr('à esquerda') };
      const list = h('div', { class: 'kv-pe__doors' });
      (it.doors ?? []).forEach((d, i) => {
        list.append(
          h(
            'span',
            { class: 'kv-pe__door' },
            h('span', { class: 'kv-pe__door-dot' }),
            h('span', { text: tr('Porta {0} · {1}', [i + 1, sides[d.side]]) }),
            (it.doors?.length ?? 0) > 1
              ? kvIconBtn(KV_ICONS.close, tr('Tirar a porta'), () => {
                  this.before();
                  const cur = this.item(it.id)!;
                  this.replaceItem({ ...cur, doors: (cur.doors ?? []).filter((_, j) => j !== i) });
                })
              : null,
          ),
        );
      });
      out.push(h('div', { class: 'kv-pe__group' }, h('strong', { class: 'kv-pe__label', text: tr('Portas') }), list, h('p', { class: 'kv-pe__hint', text: this.mobile ? tr('Mexa nas portas numa tela grande.') : tr('Clique na borda da parede para pôr ou tirar uma porta; arraste a porta para mudar de lugar.') })));
    }
    // tamanho e posição
    const num = (label: string, key: 'x' | 'y' | 'w' | 'hh', value: number, min: number, max: number, disabled: boolean) => {
      const input = h('input', { type: 'number', class: 'kv-pe__num', value: String(value), attrs: { min: String(min), max: String(max), 'aria-label': label }, disabled });
      input.addEventListener('change', () => {
        const cur = this.item(it.id);
        if (!cur) return;
        const n = Math.round(Number(input.value));
        if (!Number.isFinite(n)) return;
        const lim = KV_PLAN_SIZE[cur.kind];
        const next: KvRect = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
        if (key === 'x') next.x = Math.max(0, n);
        if (key === 'y') next.y = Math.max(0, n);
        if (key === 'w') next.w = Math.max(lim.minW, Math.min(lim.maxW, n));
        if (key === 'hh') next.h = Math.max(lim.minH, Math.min(lim.maxH, n));
        if (kvHit(this.draft, next, cur.id)) {
          kvToast(tr('Não cabe aí: encostaria em outra sala.'), { kind: 'warn', key: 'kv-plan-bad', ms: 2200 });
          input.value = String(key === 'hh' ? cur.h : cur[key]);
          return;
        }
        this.before();
        this.replaceItem(kvFixDoors({ ...cur, ...next }));
      });
      return h('label', { class: 'kv-pe__numfield' }, h('span', { text: label }), input);
    };
    const lim = KV_PLAN_SIZE[it.kind];
    const fixedSize = it.kind === 'nucleo' || it.kind === 'vaga';
    out.push(
      h(
        'div',
        { class: 'kv-pe__nums' },
        num(tr('Largura'), 'w', it.w, lim.minW, lim.maxW, fixedSize || !!it.locked),
        num(tr('Altura'), 'hh', it.h, lim.minH, lim.maxH, fixedSize || !!it.locked),
        num('X', 'x', it.x, 0, 320, !!it.locked),
        num('Y', 'y', it.y, 0, 200, !!it.locked),
      ),
    );
    out.push(this.warnList(this.warns.filter((w) => w.id === it.id)));
    out.push(
      h(
        'div',
        { class: 'kv-pe__actions' },
        it.kind === 'projeto' || it.kind === 'propria' || it.kind === 'nucleo' ? null : kvBtn(tr('Duplicar'), { size: 'sm', icon: KV_ICONS.copy, onClick: () => this.duplicate(), title: 'Ctrl+D' }),
        kvBtn(tr('Apagar'), { size: 'sm', variant: 'danger', icon: KV_ICONS.trash, onClick: () => this.remove(), title: 'Delete' }),
      ),
    );
    return out.filter((x): x is HTMLElement => !!x);
  }

  private setField<K extends 'palette' | 'color' | 'style'>(id: string, key: K, value: KvPlanItem[K] | undefined): void {
    const cur = this.item(id);
    if (!cur) return;
    this.before();
    const next = { ...cur };
    if (value === undefined) delete next[key];
    else next[key] = value;
    this.replaceItem(next);
  }

  private renderStatus(): void {
    const doc = kvPlanDoc();
    const parts: string[] = [];
    if (doc?.version) {
      const when = new Date(doc.updatedAt).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      parts.push(tr('versão {0} · gravada por {1} em {2}', [doc.version, doc.by ?? '?', when]));
    } else parts.push(tr('ainda não gravada: é o prédio de hoje'));
    if (this.dirty) parts.push(tr('mudanças sem gravar'));
    if (!kvPlanWorld.preview) parts.push(tr('prévia no mundo ainda indisponível (o blueprint já mostra como fica)'));
    else if (!this.draft.on) parts.push(tr('planta desligada: o mundo mostra o prédio original'));
    this.status.replaceChildren(h('span', { class: `kv-pe__dot${this.dirty ? ' is-dirty' : ''}` }), h('span', { text: parts.join(' · ') }));
  }

  // ------------------------------------------------------------------ gravar, versões, modelos

  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.saveBtn.disabled = true;
    const paths = this.draft.items.filter((i) => i.kind === 'projeto' && i.ref).map((i) => this.projects.find((p) => p.ref === i.ref)?.path).filter((p): p is string => !!p);
    const r = await kvSavePlan(this.draft, this.base, { paths });
    this.saving = false;
    if (r.ok) {
      this.base = r.doc.version;
      this.saved = r.doc.plan ? kvClonePlan(r.doc.plan) : null;
      // o servidor pode ter limpado algo (devolve a planta normalizada)
      if (this.saved) this.draft = kvFitPlan(kvClonePlan(this.saved));
      kvToast(r.problems.length ? tr('Planta gravada (versão {0}), com {1} peça(s) recusada(s).', [r.doc.version, r.problems.length]) : tr('Planta gravada (versão {0}).', [r.doc.version]), { kind: r.problems.length ? 'warn' : 'ok', key: 'kv-plan-save' });
      this.changed();
      return;
    }
    if (r.conflict) {
      await this.conflict(r.conflict);
      this.changed(false);
      return;
    }
    kvToast(r.error, { kind: 'error', key: 'kv-plan-save' });
    this.changed(false);
  }

  /** Outra pessoa gravou enquanto eu editava: escolher (as duas edições nunca se apagam sem querer). */
  private async conflict(doc: NonNullable<ReturnType<typeof kvPlanDoc>>): Promise<void> {
    const mine = await new Promise<'mine' | 'theirs' | null>((resolve) => {
      let answer: 'mine' | 'theirs' | null = null;
      const m = new KvModal({ title: tr('A planta mudou enquanto você editava'), icon: kvIcon('aviso'), width: 560, onClose: () => (m.el.remove(), resolve(answer)) });
      const thumbs = h('div', { class: 'kv-pe__thumbs' });
      const a = h('canvas', { class: 'kv-pe__thumb' });
      const b = h('canvas', { class: 'kv-pe__thumb' });
      thumbs.append(h('figure', {}, a, h('figcaption', { text: tr('A sua (sem gravar)') })), h('figure', {}, b, h('figcaption', { text: tr('A de {0} (versão {1})', [doc.by ?? '?', doc.version]) })));
      m.body.append(h('p', { class: 'kv-pe__hint', text: tr('{0} gravou uma versão nova. Escolha qual fica — a outra continua no histórico de versões.', [doc.by ?? tr('Alguém')]) }), thumbs);
      m.setFoot(
        kvBtn(tr('Ficar com a de {0}', [doc.by ?? '?']), { onClick: () => ((answer = 'theirs'), m.close()) }),
        kvBtn(tr('Gravar a minha por cima'), { variant: 'primary', onClick: () => ((answer = 'mine'), m.close()) }),
      );
      m.show();
      requestAnimationFrame(() => {
        kvDrawThumb(a, this.draft);
        if (doc.plan) kvDrawThumb(b, doc.plan);
      });
    });
    if (mine === 'theirs') {
      this.base = doc.version;
      this.saved = doc.plan ? kvClonePlan(doc.plan) : null;
      this.before();
      this.set(this.saved ? kvClonePlan(this.saved) : classicDraft());
    } else if (mine === 'mine') {
      this.base = doc.version;
      await this.save();
    }
  }

  private remoteChanged(d: ReturnType<typeof kvPlanDoc>): void {
    if (!d || d.version === this.base || this.saving) return;
    if (!this.dirty) {
      this.base = d.version;
      this.saved = d.plan ? kvClonePlan(d.plan) : null;
      this.draft = this.saved ? kvFitPlan(kvClonePlan(this.saved)) : this.draft;
      this.changed();
      kvToast(tr('{0} gravou a planta (versão {1}).', [d.by ?? tr('Alguém'), d.version]), { key: 'kv-plan-remote' });
    } else {
      kvToast(tr('{0} gravou a planta (versão {1}) enquanto você editava. Ao gravar, você escolhe qual fica.', [d.by ?? tr('Alguém'), d.version]), { kind: 'warn', key: 'kv-plan-remote', ms: 8000 });
    }
  }

  private async discard(): Promise<void> {
    if (!this.dirty) return;
    if (!(await kvConfirm({ title: tr('Descartar as mudanças?'), text: tr('A planta volta a ser a gravada.'), ok: tr('Descartar'), danger: true }))) return;
    this.before();
    this.set(this.saved ? kvClonePlan(this.saved) : classicDraft());
  }

  private async resetClassic(): Promise<void> {
    if (!(await kvConfirm({ title: tr('Voltar ao prédio original?'), text: tr('O rascunho vira o prédio de hoje (núcleo, corredor e as salas em 2 fileiras). Dá para desfazer; nada muda até gravar.'), ok: tr('Voltar') }))) return;
    this.before();
    this.sel = null;
    this.set({ ...classicDraft(), ...(this.draft.name ? { name: this.draft.name } : {}), ...(this.draft.editors ? { editors: this.draft.editors } : {}) });
    this.fit();
  }

  openTemplates(first = false): void {
    void kvOpenWizard({
      first,
      name: this.draft.name,
      projects: this.projects.length ? this.projects : undefined,
      loadProjects: () => projectOptions(),
      own: kvRoomsState().rooms.map((r) => ({ id: r.id, name: r.name })),
      onApply: (plan) => {
        this.before();
        this.sel = null;
        this.set({ ...plan, ...(this.draft.editors ? { editors: this.draft.editors } : {}) });
        this.fit();
        kvToast(tr('Modelo aplicado no rascunho: ajuste o que quiser e grave.'), { kind: 'ok', key: 'kv-plan-tpl', ms: 5000 });
      },
    });
  }

  private async openVersions(): Promise<void> {
    const list = await kvPlanVersions();
    if (!list) {
      kvToast(tr('Não deu para buscar as versões.'), { kind: 'error', key: 'kv-plan-v' });
      return;
    }
    const m = new KvModal({ title: tr('Versões da planta'), subtitle: tr('As últimas {0} gravações. Voltar para uma versão grava uma versão nova (nada se perde).', [40]), icon: kvIcon('relogio'), width: 520, onClose: () => m.el.remove() });
    const ul = h('ul', { class: 'kv-pe__versions' });
    if (!list.length) ul.append(h('li', { class: 'kv-pe__empty', text: tr('Nenhuma versão gravada ainda.') }));
    for (const v of list) {
      const when = new Date(v.at).toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
      const isCur = v.version === this.base;
      ul.append(
        h(
          'li',
          { class: `kv-pe__version${isCur ? ' is-current' : ''}` },
          h('span', { class: 'kv-pe__version-n', text: `v${v.version}` }),
          h('span', { class: 'kv-pe__version-text' }, h('strong', { text: v.by ?? '?' }), h('span', { text: ` · ${when} · ${tr('{0} peças', [v.items])}${v.note ? ` · ${v.note}` : ''}` })),
          isCur
            ? h('span', { class: 'kv-pe__version-tag', text: tr('atual') })
            : kvBtn(tr('Voltar para esta'), {
                size: 'sm',
                onClick: async () => {
                  if (this.dirty && !(await kvConfirm({ title: tr('Voltar para a versão {0}?', [v.version]), text: tr('As mudanças sem gravar deste rascunho se perdem.'), ok: tr('Voltar'), danger: true }))) return;
                  const r = await kvRestorePlan(v.version, this.base);
                  if (!r.ok) {
                    if (r.conflict) kvToast(tr('Alguém gravou agora há pouco: abra as versões de novo.'), { kind: 'warn', key: 'kv-plan-v' });
                    else kvToast(r.error, { kind: 'error', key: 'kv-plan-v' });
                    return;
                  }
                  this.base = r.doc.version;
                  this.saved = r.doc.plan ? kvClonePlan(r.doc.plan) : null;
                  this.before();
                  this.set(this.saved ? kvClonePlan(this.saved) : classicDraft());
                  m.close();
                  kvToast(tr('Voltou para a versão {0} (gravada como versão {1}).', [v.version, r.doc.version]), { kind: 'ok', key: 'kv-plan-v' });
                },
              }),
        ),
      );
    }
    m.body.append(ul);
    m.show();
  }

  async close(): Promise<void> {
    if (this.dirty && !(await kvConfirm({ title: tr('Sair sem gravar?'), text: tr('As mudanças deste rascunho se perdem (o mundo volta à planta gravada).'), ok: tr('Sair sem gravar'), danger: true }))) return;
    cancelAnimationFrame(this.raf);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    try {
      kvPlanWorld.preview?.(null);
    } catch (err) {
      console.error('[habblaud] prévia da planta:', err);
    }
    for (const f of this.off) f();
    const cam = kvPeople.camera;
    if (cam && this.camSaved) {
      cam.bounds = this.camSaved.bounds;
      cam.minZoom = this.camSaved.minZoom;
      cam.clamp();
    }
    document.body.classList.remove('kv-pe-dragging');
    this.root.remove();
    this.onClose();
  }
}

type XProps = NonNullable<Parameters<typeof hh>[1]> & { html?: string; disabled?: boolean; selected?: boolean; value?: string };

/** O h() do Habblaud com html/disabled/selected/value. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, p: XProps = {}, ...children: Parameters<typeof hh>[2][]): HTMLElementTagNameMap[K] {
  const { html, disabled, selected, value, ...rest } = p;
  const e = hh(tag, rest, ...children);
  if (html !== undefined) e.innerHTML = html;
  if (disabled) (e as HTMLButtonElement).disabled = true;
  if (selected) (e as HTMLOptionElement).selected = true;
  if (value !== undefined) (e as HTMLInputElement).value = value;
  return e;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'kv-pe__field' }, h('span', { class: 'kv-pe__label', text: label }), control);
}

/** Estilos de mobília registrados para o tipo (a frente das salas temáticas/motor registra `projeto:<estilo>`...). */
function furnStyles(it: KvPlanItem): string[] {
  const keys = kvFurnisherKeys();
  const prefix = it.kind === 'tema' ? `tema:${it.ref}:` : it.kind === 'projeto' ? 'projeto:' : `${it.kind}:`;
  return keys.filter((k) => k.startsWith(prefix) && k.length > prefix.length).map((k) => k.slice(prefix.length)).filter((s) => /^[a-z0-9_-]+$/.test(s));
}

function undoSvg(redo: boolean): string {
  const rows = ['..#.......', '.##.......', '#########.', '.##......#', '..#......#', '.........#', '........#.', '.######...'];
  const r = redo ? rows.map((x) => x.split('').reverse().join('')) : rows;
  return `<svg class="ui-px-icon" width="20" height="16" viewBox="0 0 10 8" shape-rendering="crispEdges" aria-hidden="true">${r
    .flatMap((row, y) => row.split('').map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/>` : '')))
    .join('')}</svg>`;
}

function minusSvg(): string {
  return '<svg class="ui-px-icon" width="16" height="16" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><rect x="0" y="3" width="8" height="2" fill="currentColor"/></svg>';
}

function fitSvg(): string {
  return '<svg class="ui-px-icon" width="20" height="20" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h3v1H1v2H0zM7 0h3v3H9V1H7zM0 7h1v2h2v1H0zM9 7h1v3H7V9h2zM3 3h4v4H3z" fill="currentColor"/></svg>';
}

export type { KvCoreRef };
