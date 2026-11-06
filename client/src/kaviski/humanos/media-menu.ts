// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): os menus do microfone e da câmera na barra do topo.
// Uma setinha ao lado de cada botão (ou o botão direito nele) abre: dispositivo, alto-falante e ruído (microfone);
// dispositivo e fundo (câmera). Tudo fica lembrado neste navegador (media-fx.ts).
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { KV_BACKGROUNDS, kvBackgroundLabel, kvCanPickOutput, kvListDevices, type KvBackground } from './media-fx';
import type { KvMedia } from './media';

let open: { el: HTMLElement; close: () => void } | null = null;

function closeMenu(): void {
  open?.close();
}

/** Uma linha que se marca (rádio ou caixa). */
function item(label: string, on: boolean, run: () => void, role: 'menuitemradio' | 'menuitemcheckbox' = 'menuitemradio'): HTMLButtonElement {
  return h(
    'button',
    { class: `kv-menu__item${on ? ' is-on' : ''}`, type: 'button', role, attrs: { 'aria-checked': String(on) }, on: { click: () => run() } },
    h('span', { class: 'kv-menu__mark', text: on ? (role === 'menuitemradio' ? '●' : '✓') : '' }),
    h('span', { text: label }),
  );
}

function section(title: string): HTMLElement {
  return h('div', { class: 'kv-menu__title', text: title });
}

/** Abre o menu montado por `build` embaixo do botão (fecha ao clicar fora, Esc ou abrir outro). */
async function show(anchor: HTMLElement, label: string, build: () => Promise<Node[]>): Promise<void> {
  const again = open?.el.dataset.for === label;
  closeMenu();
  if (again) return;
  const el = h('div', { class: 'kv-menu', role: 'menu', attrs: { 'aria-label': label, 'data-for': label } });
  const fill = async () => el.replaceChildren(...(await build()));
  await fill();
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)))}px`;
  el.style.top = `${Math.round(r.bottom + 8)}px`;
  const onDown = (e: Event) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  };
  // um clique numa opção redesenha o menu (a marca muda) sem fechar
  el.addEventListener('click', () => setTimeout(() => void (el.isConnected && fill()), 0));
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  document.addEventListener('keydown', onKey, true);
  open = {
    el,
    close: () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      open = null;
    },
  };
  (el.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
}

function devices(media: KvMedia, kind: 'audioinput' | 'videoinput' | 'audiooutput', current: string | undefined): Promise<Node[]> {
  return kvListDevices(kind).then((list) => {
    if (!list.length) return [h('div', { class: 'kv-menu__empty', text: tr('Nenhum aparelho encontrado (ou sem permissão ainda).') })];
    const sel = current && list.some((d) => d.id === current) ? current : (list.find((d) => d.id === 'default') ?? list[0])!.id;
    return list.map((d) => item(d.label, d.id === sel, () => void media.switchDevice(kind, d.id)));
  });
}

/** Põe a setinha dos menus ao lado do microfone e da câmera. */
export function kvAttachMediaMenus(media: KvMedia): void {
  const fx = media.fx;
  const micMenu = async (): Promise<Node[]> => {
    const out: Node[] = [section(tr('Microfone')), ...(await devices(media, 'audioinput', fx.prefs.micId))];
    if (kvCanPickOutput()) out.push(section(tr('Alto-falante')), ...(await devices(media, 'audiooutput', fx.prefs.outId)));
    out.push(
      section(tr('Ruído')),
      item(tr('Redução de ruído e eco do navegador'), fx.prefs.browserNs, () => {
        fx.set({ browserNs: !fx.prefs.browserNs });
        void media.restartMic();
      }, 'menuitemcheckbox'),
      item(tr('Filtro de ruído forte (RNNoise)'), fx.prefs.rnnoise, () => {
        fx.set({ rnnoise: !fx.prefs.rnnoise });
        void media.applyFx();
      }, 'menuitemcheckbox'),
    );
    return out;
  };
  const pick = h('input', { type: 'file', hidden: true, attrs: { accept: 'image/*' } });
  pick.addEventListener('change', () => {
    const f = pick.files?.[0];
    pick.value = '';
    if (!f) return;
    void fx.saveCustomImage(f).then((err) => {
      if (err) return media.warn(err);
      fx.set({ bg: 'custom' });
      void media.applyFx();
    });
  });
  document.body.append(pick);
  const camMenu = async (): Promise<Node[]> => [
    section(tr('Câmera')),
    ...(await devices(media, 'videoinput', fx.prefs.camId)),
    section(tr('Fundo')),
    ...KV_BACKGROUNDS.map((bg: KvBackground) =>
      item(kvBackgroundLabel(bg), fx.prefs.bg === bg, () => {
        if (bg === 'custom') {
          closeMenu();
          pick.click();
          return;
        }
        fx.set({ bg });
        void media.applyFx();
      }),
    ),
  ];
  const caret = (btn: HTMLButtonElement, label: string, build: () => Promise<Node[]>) => {
    const c = h('button', { class: 'ui-icon-btn kv-dock__caret', type: 'button', title: label, text: '▾', attrs: { 'aria-label': label, 'aria-haspopup': 'menu' } });
    c.addEventListener('click', () => void show(btn, label, build));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void show(btn, label, build);
    });
    btn.after(c);
  };
  caret(media.micBtn, tr('Ajustes do microfone'), micMenu);
  caret(media.camBtn, tr('Ajustes da câmera e fundo'), camMenu);
}
