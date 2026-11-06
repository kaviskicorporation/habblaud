// Fork Kaviski (KAVISKI-HUMANOS.md): tela de Salas (botão no topo, para a equipe): criar, editar e apagar as salas
// próprias — a sala pessoal, salas de reunião, de descanso e outras (admin: qualquer; equipe: a própria sala pessoal e
// salas de reunião; cliente não cria). Quem vê, paleta, cor e uma decoração simples (pôr/tirar itens em lugares livres).
// Fala com GET|POST /api/kaviski/humanos/rooms e POST|DELETE /api/kaviski/humanos/rooms/:id; o servidor confere tudo.
//
// Desenho no kit das pessoas (ui/kit.ts, o mesmo da tela Pessoas): janela com cabeçalho e ícone; à esquerda a lista das
// salas em cartões (ou um estado vazio com o botão de criar); à direita o formulário em seções. As escolhas que eram
// listas de seleção viraram blocos com ícone: o tipo da sala, quem entra e o item da decoração.
import type { KvPerson } from '../../../../shared/kaviski-humanos';
import {
  KV_DECOR_FLOOR,
  KV_DECOR_MAX,
  KV_DECOR_VARIANTS,
  KV_DECOR_WALL,
  KV_ROOM_STYLES,
  type KvDecorItem,
  type KvDecorKind,
  type KvOwnRoomKind,
} from '../../../../shared/kaviski-rooms';
import { KV_MEET_CAPACITY_MAX, KV_MEET_EQUIPS, KV_MEET_LAYOUT_INFO, KV_MEET_LAYOUTS, kvDefaultMeet, type KvMeetConfig, type KvMeetLayout } from '../../../../shared/kaviski-meetings';
import { tr } from '../../../../shared/i18n';
import { roomTheme } from '../../art';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { kvDecorFree } from './rooms-layout';
import { KIND_LABEL, kvReloadRooms, kvRoomsState, ROOMS_API, type KvOwnRoomView } from './rooms';
import { kvPeople } from './world';
import { KV_ICONS, kvBtn, kvEmpty, kvField, kvIconBtn, kvInput, kvTitle, kvToggle, type KvInput, type KvToggle } from './ui/kit';
import { KvModal, kvConfirm } from './ui/modal';
import { KvSelect } from './ui/select';
import { EQUIP_PIX, equipName, kvLayoutBadge, LAYOUT_COLOR, layoutDesc, layoutName, MEET_ICON } from './meetings-ui'; // reuniões e reservas
import { kvPick } from './ui/section';
import './rooms-dialog.css';

const DECOR_LABEL: Record<KvDecorKind, string> = {
  planta: tr('Planta'),
  planta_alta: tr('Planta alta'),
  luminaria: tr('Luminária'),
  estante: tr('Estante'),
  arquivo: tr('Arquivo'),
  puff: tr('Puff'),
  quadro: tr('Quadro'),
  poster: tr('Pôster'),
  relogio: tr('Relógio'),
  tapete: tr('Tapete'),
};
/** Ícone em pixel (colorido) de cada item da decoração: nos blocos de escolha e na sala em miniatura. */
const DECOR_PIX: Record<KvDecorKind, string> = {
  planta: pixelIcon(['...g.g...', '..ggggg..', '.ggg.ggg.', '..ggggg..', '....g....', '..bbbbb..', '..bbbbb..', '...bbb...'], { g: '#4fd18b', b: '#b0703c' }),
  planta_alta: pixelIcon(['.g..g..g.', '..g.g.g..', 'ggggggggg', '...ggg...', '....t....', '....t....', '....t....', '..bbbbb..', '...bbb...'], { g: '#4fd18b', t: '#8a5a2b', b: '#b0703c' }),
  luminaria: pixelIcon(['..yyyyy..', '.yyyyyyy.', '...lll...', '....s....', '....s....', '....s....', '....s....', '..sssss..'], { y: '#f4c95d', l: '#fff3b0', s: '#9aa4b8' }),
  estante: pixelIcon(['wwwwwwwww', 'wrrbbggyw', 'wrrbbggyw', 'wwwwwwwww', 'wggyrrbbw', 'wggyrrbbw', 'wwwwwwwww'], { w: '#a0683a', r: '#e05555', b: '#7cc8ff', g: '#4fd18b', y: '#f4c95d' }),
  arquivo: pixelIcon(['sssssss', 'sdddddds'.slice(0, 7), 'sddkdds', 'sssssss', 'sdddddds'.slice(0, 7), 'sddkdds', 'sssssss'], { s: '#8b98b3', d: '#5f6a84', k: '#e8ecf5' }),
  puff: pixelIcon(['..ooooo..', '.olllllo.', 'ooooooooo', 'ooooooooo', 'ddddddddd', '.ddddddd.'], { o: '#ff9a3d', l: '#ffc27a', d: '#c46a1f' }),
  quadro: pixelIcon(['fffffffff', 'fbbbbbbbf', 'fbbbbbybf', 'fbgbbbbbf', 'fgggbgggf', 'fgggggggf', 'fffffffff'], { f: '#c9a44a', b: '#7cc8ff', y: '#f4c95d', g: '#4fd18b' }),
  poster: pixelIcon(['ppppppp', 'pttttbp', 'ppppppp', 'ptttppp', 'ppppppp', 'pttttpp', 'ppppppp'], { p: '#e8ecf5', t: '#7c8aa8', b: '#e05555' }),
  relogio: pixelIcon(['..www..', '.wfffw.', 'wfffkfw', 'wffkffw', 'wfffffw', '.wfffw.', '..www..'], { w: '#9aa4b8', f: '#f4efe2', k: '#2b3040' }),
  tapete: pixelIcon(['rrrrrrrrr', 'ryrryrryr', 'rrrrrrrrr', 'ryrryrryr', 'rrrrrrrrr'], { r: '#b65f3a', y: '#f4c95d' }),
};
const KIND_HINT: Record<KvOwnRoomKind, string> = {
  pessoal: tr('A sua sala (ou canto) fixa na empresa: mesa, estante e um cantinho para visitas.'),
  reuniao: tr('Mesa grande com banquetas e quadro branco.'),
  descanso: tr('Sofá e poltronas de frente para a TV, puffs.'),
  outra: tr('Duas mesas e uma mesa de reunião.'),
};
/** Ícone em pixel de cada tipo de sala (blocos do tipo e cartões da lista). */
const KIND_ICON: Record<KvOwnRoomKind, string> = {
  // mesa com monitor e cadeira
  pessoal: pixelIcon(['...######...', '...#....#...', '...######...', '.....##.....', '############', '#..........#', '#..........#', '.....##.....', '....####....', '....#..#....']),
  // mesa grande com gente em volta
  reuniao: pixelIcon(['.##..##..##.', '.##..##..##.', '............', '############', '############', '#..........#', '............', '.##..##..##.', '.##..##..##.']),
  // sofá
  descanso: pixelIcon(['..########..', '.#........#.', '.#........#.', '############', '#..........#', '#..........#', '############', '.#........#.']),
  // porta
  outra: pixelIcon(['.########.', '.#......#.', '.#......#.', '.#......#.', '.#....#.#.', '.#......#.', '.#......#.', '.#......#.', '##########']),
};
const ROOM_ICON = pixelIcon(['############', '#....#.....#', '#....#.....#', '#....#.....#', '#..........#', '######..####', '#..........#', '#....#.....#', '#....#.....#', '############']);
const DECOR_ICON = pixelIcon(['....##....', '...####...', '.##.##.##.', '.########.', '..######..', '....##....', '..######..', '..#....#..', '..#....#..', '...####...']);
const PALETTE_ICON = pixelIcon(['..######..', '.#......#.', '#..##....#', '#..##..#.#', '#.......##', '#.##....#.', '#.##...#..', '.#.....#..', '..#####...']);
const RUG_SIZES: [number, number][] = [
  [2, 2],
  [3, 2],
  [4, 3],
];

async function call(method: string, url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/** Um <span> com um ícone em pixel dentro. */
function pix(cls: string, svg: string): HTMLElement {
  const s = h('span', { class: cls, attrs: { 'aria-hidden': 'true' } });
  s.innerHTML = svg;
  return s;
}

/** Seção do formulário: ícone + título (+ dica) e o conteúdo, num cartão. */
function section(icon: string, title: string, hint: string | null, ...content: (HTMLElement | null)[]): HTMLElement {
  const ico = h('span', { class: 'kv-salas2__sec-ico', attrs: { 'aria-hidden': 'true' } });
  ico.innerHTML = icon;
  return h(
    'section',
    { class: 'kv-salas2__sec' },
    h('header', { class: 'kv-salas2__sec-head' }, ico, h('div', {}, kvTitle('h3', title, 'kv-salas2__sec-title'), hint ? h('p', { class: 'kv-salas2__sec-hint', text: hint }) : null)),
    ...content.filter((c): c is HTMLElement => !!c),
  );
}

export class KvRoomsDialog {
  private readonly modal: KvModal;
  private readonly list: HTMLElement;
  private readonly side: HTMLElement;
  private readonly main: HTMLElement;
  private readonly formTitle: HTMLElement;
  private readonly kindGrid: HTMLElement;
  private readonly kindHint: HTMLElement;
  private readonly name: KvInput;
  private readonly ownerField: HTMLElement;
  private owner: KvSelect | null = null;
  private readonly accessSeg: HTMLElement;
  private readonly peopleHint: HTMLElement;
  private readonly peopleBox: HTMLElement;
  private readonly styles: HTMLElement;
  private readonly color: HTMLInputElement;
  private readonly useColor: KvToggle;
  private readonly decorItems: HTMLElement;
  private readonly decorOpts: HTMLElement;
  private variant: KvSelect | null = null;
  private rugSize: KvSelect | null = null;
  private readonly rugColor: HTMLInputElement;
  private readonly decorGrid: HTMLElement;
  private readonly decorWall: HTMLElement;
  private readonly decorCount: HTMLElement;
  private readonly error: HTMLElement;
  private readonly save: HTMLButtonElement;
  private readonly newBtn: HTMLButtonElement;
  private editing: KvOwnRoomView | null = null;
  private kind: KvOwnRoomKind = 'pessoal';
  private access: 'equipe' | 'escolhidos' = 'equipe';
  private decorKind: KvDecorKind = 'planta';
  private variantValue = '';
  private rugIndex = 0;
  private style = 0;
  private decor: KvDecorItem[] = [];
  private chosen = new Set<string>();
  // ---- sala de reunião (kind 'reuniao'): tipo, lugares, equipamentos e reservas
  private meet: KvMeetConfig = kvDefaultMeet();
  private meetSec!: HTMLElement;
  private readonly meetLayouts: HTMLElement = h('div', { class: 'kv-meet-cfg__layouts', role: 'radiogroup', attrs: { 'aria-label': tr('Tipo de sala de reunião') } });
  private readonly meetCap: KvInput = kvInput({ type: 'number', name: 'capacity' });
  private readonly meetCapField = kvField(tr('Lugares'), this.meetCap.el, { hint: tr('Até {0}.', [KV_MEET_CAPACITY_MAX]) });
  private readonly meetEquip: HTMLElement = h('div', { class: 'kv-meet-cfg__equips' });
  private readonly meetBookable: KvToggle = kvToggle(tr('Aceita reservas'), { hint: tr('Desligado, a sala é de uso livre e não aparece em Reuniões.'), onChange: (v) => (this.meet.bookable = v) });
  private readonly meetRelease: KvToggle = kvToggle(tr('Liberar se ninguém aparecer em 10 min'), { hint: tr('Reserva sem ninguém na sala nem check-in volta a ficar livre.'), onChange: (v) => (this.meet.autoRelease = v) });
  private readonly meetPrivate: KvToggle = kvToggle(tr('Reuniões privadas por padrão'), { hint: tr('Reservas novas já vêm privadas: ninguém de fora entra, vê ou ouve.'), onChange: (v) => (this.meet.privateDefault = v) });

  constructor(private readonly me: KvPerson) {
    this.newBtn = kvBtn(tr('Nova sala'), { variant: 'primary', size: 'sm', icon: KV_ICONS.plus, onClick: () => this.edit(null) });
    this.modal = new KvModal({
      title: tr('Salas do escritório'),
      subtitle: tr('Salas que não são projetos: ficam sempre no prédio, com conversa e voz da sala.'),
      icon: ROOM_ICON,
      width: 1080,
      cls: 'kv-salas2',
      headActions: [this.newBtn],
    });

    // ---- coluna da lista
    this.list = h('ul', { class: 'kv-salas2__list', attrs: { role: 'list' } });
    this.side = h('aside', { class: 'kv-salas2__side' }, this.list);

    // ---- tipo
    this.kindGrid = h('div', { class: 'kv-salas2__kinds', role: 'radiogroup', attrs: { 'aria-label': tr('Tipo') } });
    this.kindHint = h('p', { class: 'kv-salas2__sec-hint' });

    // ---- nome e dono
    this.name = kvInput({ placeholder: tr('ex.: Sala do Vitor'), maxlength: 40, name: 'name', autocomplete: 'off' });
    this.ownerField = h('div', { class: 'kv-salas2__owner' });

    // ---- quem entra
    this.accessSeg = h('div', { class: 'kv-salas2__seg', role: 'radiogroup', attrs: { 'aria-label': tr('Quem vê') } });
    const segBtn = (value: 'equipe' | 'escolhidos', icon: string, label: string) => {
      const b = h('button', { class: 'kv-salas2__seg-btn', type: 'button', role: 'radio', attrs: { 'data-v': value }, on: { click: () => this.setAccess(value) } }, h('span', { class: 'kv-ui-ico', attrs: { 'aria-hidden': 'true' } }), h('span', { text: label }));
      (b.firstElementChild as HTMLElement).innerHTML = icon;
      return b;
    };
    this.accessSeg.append(segBtn('equipe', KV_ICONS.users, tr('A equipe toda')), segBtn('escolhidos', KV_ICONS.lock, tr('Só quem eu marcar')));
    this.peopleHint = h('p', { class: 'kv-salas2__sec-hint' });
    this.peopleBox = h('div', { class: 'kv-salas2__people' });

    // ---- aparência
    this.styles = h('div', { class: 'kv-salas2__styles', role: 'radiogroup', attrs: { 'aria-label': tr('Paleta da sala') } });
    for (let i = 0; i < KV_ROOM_STYLES; i++) {
      const t = roomTheme(i);
      this.styles.append(
        h(
          'button',
          {
            class: 'kv-salas2__style',
            type: 'button',
            style: `--a:${t.accent};--c:${t.carpet};--w:${t.wall.base}`,
            title: tr('Paleta {0}', [i + 1]),
            attrs: { 'aria-label': tr('Paleta {0}', [i + 1]), 'data-style': String(i), role: 'radio' },
            on: { click: () => this.setStyle(i) },
          },
          h('span', { class: 'kv-salas2__style-wall' }),
          h('span', { class: 'kv-salas2__style-floor' }),
        ),
      );
    }
    this.color = h('input', { class: 'kv-salas2__swatch', type: 'color', attrs: { name: 'color', value: '#3f7fd8', 'aria-label': tr('Cor da placa') } });
    this.useColor = kvToggle(tr('Placa com cor própria'), {
      hint: tr('Senão, a placa usa a cor da paleta.'),
      onChange: (v) => (this.color.disabled = !v),
    });

    // ---- decoração
    this.decorItems = h('div', { class: 'kv-salas2__items', role: 'radiogroup', attrs: { 'aria-label': tr('Item') } });
    for (const k of [...KV_DECOR_FLOOR, ...KV_DECOR_WALL, 'tapete'] as KvDecorKind[]) {
      this.decorItems.append(
        h(
          'button',
          { class: 'kv-salas2__item', type: 'button', role: 'radio', title: DECOR_LABEL[k], attrs: { 'data-k': k }, on: { click: () => this.setDecorKind(k) } },
          pix('kv-salas2__item-glyph', DECOR_PIX[k]),
          h('span', { class: 'kv-salas2__item-label', text: DECOR_LABEL[k] }),
        ),
      );
    }
    this.rugColor = h('input', { class: 'kv-salas2__swatch', type: 'color', attrs: { value: '#b65f3a', 'aria-label': tr('Cor do tapete') } });
    this.decorOpts = h('div', { class: 'kv-salas2__decor-opts' });
    this.decorWall = h('div', { class: 'kv-salas2__wall' });
    this.decorGrid = h('div', { class: 'kv-salas2__grid' });
    this.decorCount = h('span', { class: 'kv-salas2__count' });

    this.error = h('p', { class: 'kv-ui-field__error kv-salas2__error', attrs: { role: 'alert' } });
    this.save = kvBtn(tr('Criar sala'), { variant: 'primary', icon: KV_ICONS.check, type: 'submit' });
    this.formTitle = kvTitle('h3', tr('Nova sala'), 'kv-salas2__form-title');

    // ---- sala de reunião
    this.meetCap.input.min = '1';
    this.meetCap.input.max = String(KV_MEET_CAPACITY_MAX);
    this.meetCap.input.addEventListener('input', () => this.meetCapField.setError(''));
    for (const l of KV_MEET_LAYOUTS) {
      const b = h(
        'button',
        { class: 'kv-meet-cfgl', type: 'button', role: 'radio', style: `--lay:${LAYOUT_COLOR[l]}`, attrs: { 'data-l': l }, on: { click: () => this.setMeetLayout(l) } },
        kvLayoutBadge(l, 'md'),
        h('span', { class: 'kv-meet-cfgl__name', text: layoutName(l) }),
        h('span', { class: 'kv-meet-cfgl__desc', text: layoutDesc(l) }),
        h('span', { class: 'kv-meet-cfgl__seats', text: tr('{0} lugares', [KV_MEET_LAYOUT_INFO[l].capacity]) }),
      );
      this.meetLayouts.append(b);
    }
    this.meetSec = section(
      MEET_ICON,
      tr('Sala de reunião'),
      tr('O tipo muda os móveis da sala e sugere os lugares e o que ela tem. As reservas ficam na janela Reuniões.'),
      this.meetLayouts,
      h('div', { class: 'kv-meet-cfg__row' }, this.meetCapField.el),
      h('div', {}, h('span', { class: 'kv-ui-field__label', text: tr('O que a sala tem') }), this.meetEquip),
      h('div', { class: 'kv-meet-cfg__toggles' }, this.meetBookable.el, this.meetRelease.el, this.meetPrivate.el),
    );

    const form = h(
      'form',
      { class: 'kv-salas2__form', on: { submit: (e: Event) => void this.submit(e) } },
      section(KIND_ICON.pessoal, tr('Tipo'), null, this.kindGrid, this.kindHint),
      this.meetSec,
      section(KV_ICONS.edit, tr('Nome e dono'), null, h('div', { class: 'kv-salas2__row' }, kvField(tr('Nome'), this.name.el).el, this.ownerField)),
      section(KV_ICONS.door, tr('Quem entra'), null, this.accessSeg, this.peopleHint, this.peopleBox),
      section(PALETTE_ICON, tr('Aparência'), tr('A paleta pinta as paredes, o chão e o tapete da sala.'), this.styles, h('div', { class: 'kv-salas2__color-row' }, this.useColor.el, this.color)),
      section(
        DECOR_ICON,
        tr('Decoração'),
        tr('Escolha um item e clique num lugar livre da sala; clique num item posto para tirar.'),
        this.decorItems,
        this.decorOpts,
        h('div', { class: 'kv-salas2__room' }, h('span', { class: 'kv-salas2__room-tag', text: tr('parede') }), this.decorWall, this.decorGrid),
        this.decorCount,
      ),
    );
    this.main = h('div', { class: 'kv-salas2__main' }, h('div', { class: 'kv-salas2__main-head' }, this.formTitle), form);
    this.modal.body.append(h('div', { class: 'kv-salas2__layout' }, this.side, this.main));
    this.modal.setFoot(this.error, kvBtn(tr('Limpar'), { variant: 'ghost', onClick: () => this.edit(this.editing) }), this.save);
    this.save.addEventListener('click', (e) => void this.submit(e));
  }

  async open(): Promise<void> {
    this.modal.show();
    await kvReloadRooms();
    this.render();
    this.edit(null);
  }

  // ------------------------------------------------------------------ lista

  private render(): void {
    const s = kvRoomsState();
    const names = new Map((s.people ?? []).map((p) => [p.id, p.name]));
    this.newBtn.hidden = !s.canCreate.length;
    if (!s.rooms.length) {
      this.list.replaceChildren(
        h(
          'li',
          { class: 'kv-salas2__empty' },
          kvEmpty(
            ROOM_ICON,
            tr('Nenhuma sala própria ainda'),
            s.canCreate.length ? tr('Crie a sua sala pessoal, uma sala de reunião ou um canto de descanso. Ela aparece no prédio na hora.') : tr('Quem é da equipe cria as salas por aqui.'),
          ),
        ),
      );
      return;
    }
    this.list.replaceChildren(
      ...s.rooms.map((r) => {
        const accent = r.color ?? roomTheme(r.style).accent;
        const ico = h('span', { class: 'kv-salas2__card-ico', style: `--a:${accent}`, attrs: { 'aria-hidden': 'true' } });
        ico.innerHTML = KIND_ICON[r.kind];
        const meta = [r.owner ? (names.get(r.owner) ?? '') : '', r.access === 'equipe' ? tr('a equipe toda') : tr('só as pessoas marcadas')].filter(Boolean).join(' · ');
        return h(
          'li',
          { class: `kv-salas2__card${this.editing?.id === r.id ? ' is-on' : ''}`, style: `--a:${accent}` },
          ico,
          h(
            'div',
            { class: 'kv-salas2__card-text' },
            h('span', { class: 'kv-salas2__card-top' }, h('strong', { text: r.name }), s.mine === r.id ? h('span', { class: 'kv-salas2__mine', text: tr('minha') }) : null),
            h(
              'span',
              { class: 'kv-salas2__card-meta' },
              h('span', { class: 'kv-salas2__kind-tag', text: KIND_LABEL[r.kind] }),
              r.kind === 'reuniao' && r.meet ? h('span', { class: 'kv-meet-cfg__tag', text: `${layoutName(r.meet.layout)} · ${tr('{0} lugares', [r.meet.capacity])}` }) : null,
              h('span', { text: meta }),
            ),
          ),
          h(
            'div',
            { class: 'kv-salas2__card-actions' },
            kvIconBtn(KV_ICONS.eye, tr('Ver no prédio'), () => this.look(r.id), { variant: 'ghost', size: 'sm' }),
            r.canEdit ? kvIconBtn(KV_ICONS.edit, tr('Editar'), () => this.edit(r), { variant: 'ghost', size: 'sm' }) : null,
            r.canEdit ? kvIconBtn(KV_ICONS.trash, tr('Apagar'), () => void this.remove(r), { variant: 'ghost', size: 'sm', cls: 'kv-salas2__del' }) : null,
          ),
        );
      }),
    );
  }

  /** Leva a câmera até a sala. */
  private look(id: string): void {
    if (!kvPeople.sim?.().rooms.get(id)) return;
    (window as { habblaud?: { world?: { focusRoom?: (id: string) => void } } }).habblaud?.world?.focusRoom?.(id);
    this.modal.close();
  }

  // ------------------------------------------------------------------ formulário

  private edit(r: KvOwnRoomView | null): void {
    const s = kvRoomsState();
    this.editing = r;
    this.error.textContent = '';
    this.formTitle.textContent = r ? tr('Editar {0}', [r.name]) : tr('Nova sala');
    this.save.querySelector('.kv-ui-btn__label')!.textContent = r ? tr('Salvar') : tr('Criar sala');
    const canForm = !!r || s.canCreate.length > 0;
    this.main.hidden = !canForm;
    this.save.hidden = !canForm;

    // tipo: os que posso criar (editando, só o da sala, sem trocar)
    const kinds: KvOwnRoomKind[] = r ? [r.kind] : s.canCreate;
    this.kind = r?.kind ?? (kinds.includes(this.kind) ? this.kind : (kinds[0] ?? 'pessoal'));
    this.kindGrid.replaceChildren(
      ...kinds.map((k) => {
        const ico = h('span', { class: 'kv-salas2__kind-ico', attrs: { 'aria-hidden': 'true' } });
        ico.innerHTML = KIND_ICON[k];
        return h(
          'button',
          { class: 'kv-salas2__kind', type: 'button', role: 'radio', attrs: { 'data-k': k, ...(r ? { disabled: '' } : {}) }, on: { click: () => this.setKind(k) } },
          ico,
          h('span', { class: 'kv-salas2__kind-label', text: KIND_LABEL[k] }),
        );
      }),
    );

    this.name.input.value = r?.name ?? '';
    // dono (só admin escolhe)
    const admin = this.me.role === 'admin';
    this.ownerField.replaceChildren();
    this.owner = null;
    if (admin) {
      const opts = (s.people ?? []).filter((p) => p.role !== 'cliente' && p.role !== 'visitante').map((p) => ({ value: p.id, label: p.name }));
      if (!opts.some((o) => o.value === this.me.id)) opts.unshift({ value: this.me.id, label: this.me.name });
      this.owner = new KvSelect({ options: opts, value: r?.owner ?? this.me.id, label: tr('Dono') });
      this.ownerField.append(kvField(tr('Dono'), this.owner.el).el);
    }
    this.access = (r?.access as 'equipe' | 'escolhidos' | undefined) ?? 'equipe';
    this.chosen = new Set(r?.people ?? []);
    this.style = r?.style ?? Math.floor(Math.random() * KV_ROOM_STYLES);
    this.useColor.checked = !!r?.color;
    this.color.disabled = !r?.color;
    this.color.value = r?.color ?? '#3f7fd8';
    this.decor = [...(r?.decor ?? [])];
    this.meet = r?.meet ? { ...r.meet, equipment: [...r.meet.equipment] } : kvDefaultMeet();
    this.paintMeet();
    this.setKind(this.kind, true);
    this.setAccess(this.access);
    this.setStyle(this.style);
    this.setDecorKind(this.decorKind);
    this.render();
  }

  private setKind(k: KvOwnRoomKind, quiet = false): void {
    this.kind = k;
    this.kindGrid.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => {
      const on = b.dataset.k === k;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    this.kindHint.textContent = k === 'reuniao' ? layoutDesc(this.meet.layout) : (KIND_HINT[k] ?? '');
    this.meetSec.hidden = k !== 'reuniao';
    if (!this.editing) {
      const ph = k === 'pessoal' ? tr('Sala de {0}', [this.me.name]) : (KIND_LABEL[k] ?? '');
      this.name.input.placeholder = ph;
    }
    if (!quiet) this.renderDecor();
  }

  private setAccess(v: 'equipe' | 'escolhidos'): void {
    this.access = v;
    this.accessSeg.querySelectorAll<HTMLElement>('[data-v]').forEach((b) => {
      const on = b.dataset.v === v;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const s = kvRoomsState();
    const only = v === 'escolhidos';
    this.peopleHint.textContent = only ? tr('Marque quem vê esta sala (você e os admins veem sempre):') : tr('A equipe toda vê. Marque os clientes que também podem entrar:');
    const list = (s.people ?? []).filter((p) => p.id !== this.me.id && (only || p.role === 'cliente' || p.role === 'visitante'));
    this.peopleBox.replaceChildren(
      ...list.map((p) => {
        const on = this.chosen.has(p.id);
        const b = h(
          'button',
          { class: `kv-salas2__person${on ? ' is-on' : ''}`, type: 'button', attrs: { 'aria-pressed': String(on) } },
          h('span', { class: 'kv-salas2__person-check', attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'kv-salas2__person-name', text: p.name }),
          h('span', { class: `kv-ui-role kv-ui-role--${p.role}`, text: p.role }),
        );
        (b.firstElementChild as HTMLElement).innerHTML = KV_ICONS.check;
        b.addEventListener('click', () => {
          const now = !this.chosen.has(p.id);
          if (now) this.chosen.add(p.id);
          else this.chosen.delete(p.id);
          b.classList.toggle('is-on', now);
          b.setAttribute('aria-pressed', String(now));
        });
        return b;
      }),
    );
    if (!list.length) this.peopleBox.append(h('p', { class: 'kv-salas2__none', text: only ? tr('Ninguém mais para marcar.') : tr('Nenhum cliente cadastrado.') }));
  }

  private setStyle(i: number): void {
    this.style = i;
    this.styles.querySelectorAll<HTMLElement>('[data-style]').forEach((b) => {
      const on = b.dataset.style === String(i);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const t = roomTheme(i);
    this.main.style.setProperty('--room-floor', t.carpet);
    this.main.style.setProperty('--room-wall', t.wall.base);
    this.main.style.setProperty('--room-accent', t.accent);
    this.renderDecor();
  }

  private setDecorKind(k: KvDecorKind): void {
    this.decorKind = k;
    this.decorItems.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => {
      const on = b.dataset.k === k;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const variants = KV_DECOR_VARIANTS[k] ?? [];
    this.variantValue = variants[0] ?? '';
    this.decorOpts.replaceChildren();
    this.variant = null;
    this.rugSize = null;
    if (variants.length > 1) {
      this.variant = new KvSelect({ options: variants.map((v) => ({ value: v, label: v })), value: this.variantValue, label: tr('Variação'), onChange: (v) => (this.variantValue = v) });
      this.decorOpts.append(kvField(tr('Variação'), this.variant.el).el);
    }
    if (k === 'tapete') {
      this.rugSize = new KvSelect({ options: RUG_SIZES.map(([w, hh], i) => ({ value: String(i), label: `${w} × ${hh}` })), value: String(this.rugIndex), label: tr('Tamanho do tapete'), onChange: (v) => (this.rugIndex = Number(v)) });
      this.decorOpts.append(kvField(tr('Tamanho do tapete'), this.rugSize.el).el, kvField(tr('Cor do tapete'), this.rugColor).el);
    }
    this.decorOpts.hidden = !this.decorOpts.childElementCount;
  }

  /** A grade da sala (14x9) e a faixa da parede (1..15), com o que já está ocupado pelo layout do tipo. */
  private renderDecor(): void {
    const kind = this.kind;
    if (!kind) return;
    // o layout da sala de reunião muda os móveis
    const free = kvDecorFree(kind, roomTheme(this.style), kind === 'reuniao' ? this.meet.layout : undefined);
    const at = (x: number, y: number) => this.decor.findIndex((d) => !KV_DECOR_WALL.includes(d.kind) && d.kind !== 'tapete' && d.x === x && d.y === y);
    const rugAt = (x: number, y: number) => this.decor.findIndex((d) => d.kind === 'tapete' && x >= d.x && x < d.x + (d.w ?? 0) && y >= d.y && y < d.y + (d.h ?? 0));
    const cells: HTMLElement[] = [];
    for (let y = 2; y <= 10; y++) {
      for (let x = 1; x <= 14; x++) {
        const i = at(x, y);
        const r = rugAt(x, y);
        const ok = free.floor.has(`${x},${y}`);
        const item = i >= 0 ? this.decor[i] : undefined;
        cells.push(
          h('button', {
            class: `kv-salas2__cell${ok ? '' : ' is-busy'}${r >= 0 ? ' is-rug' : ''}${item ? ' has-item' : ''}`,
            type: 'button',
            style: r >= 0 ? `--rug:${this.decor[r]!.color}` : '',
            title: item ? tr('Tirar {0}', [DECOR_LABEL[item.kind]]) : ok ? tr('Pôr aqui') : tr('Ocupado'),
            attrs: { 'aria-label': `${x},${y}` },
            on: { click: () => this.cellClick(x, y, ok) },
          }),
        );
        if (item) cells[cells.length - 1]!.innerHTML = DECOR_PIX[item.kind];
      }
    }
    this.decorGrid.replaceChildren(...cells);
    const wallCells: HTMLElement[] = [];
    for (let x = 1; x <= 14; x++) {
      const i = this.decor.findIndex((d) => KV_DECOR_WALL.includes(d.kind) && Math.floor(d.x - (d.kind === 'quadro' ? 1 : 0.5)) === x);
      const item = i >= 0 ? this.decor[i] : undefined;
      const busy = free.wall.some(([a, b]) => x + 0.5 > a && x + 0.5 < b);
      wallCells.push(
        h('button', {
          class: `kv-salas2__cell kv-salas2__cell--wall${busy ? ' is-busy' : ''}${item ? ' has-item' : ''}`,
          type: 'button',
          title: item ? tr('Tirar {0}', [DECOR_LABEL[item.kind]]) : busy ? tr('Ocupado') : tr('Pôr na parede'),
          attrs: { 'aria-label': tr('parede {0}', [x]) },
          on: { click: () => this.wallClick(x, i, free.wall) },
        }),
      );
      if (item) wallCells[wallCells.length - 1]!.innerHTML = DECOR_PIX[item.kind];
    }
    this.decorWall.replaceChildren(...wallCells);
    this.decorCount.textContent = tr('{0} de {1} itens', [this.decor.length, KV_DECOR_MAX]);
  }

  private cellClick(x: number, y: number, ok: boolean): void {
    const i = this.decor.findIndex((d) => !KV_DECOR_WALL.includes(d.kind) && d.kind !== 'tapete' && d.x === x && d.y === y);
    const k = this.decorKind;
    if (i >= 0) this.decor.splice(i, 1);
    else if (k === 'tapete') {
      const r = this.decor.findIndex((d) => d.kind === 'tapete' && x >= d.x && x < d.x + (d.w ?? 0) && y >= d.y && y < d.y + (d.h ?? 0));
      if (r >= 0) this.decor.splice(r, 1);
      else if (this.decor.length < KV_DECOR_MAX) {
        const [w, hh] = RUG_SIZES[this.rugIndex] ?? RUG_SIZES[0]!;
        this.decor.push({ kind: 'tapete', x, y, w: Math.min(w, 15 - x), h: Math.min(hh, 11 - y), color: this.rugColor.value });
      }
    } else if (KV_DECOR_WALL.includes(k)) {
      this.error.textContent = tr('Esse item vai na parede: clique na faixa de cima.');
      return;
    } else if (ok && this.decor.length < KV_DECOR_MAX) {
      this.decor.push({ kind: k, x, y, ...(this.variantValue ? { variant: this.variantValue } : {}) });
    }
    this.error.textContent = '';
    this.renderDecor();
  }

  private wallClick(x: number, i: number, busy: [number, number][]): void {
    const k = this.decorKind;
    if (i >= 0) this.decor.splice(i, 1);
    else if (!KV_DECOR_WALL.includes(k)) {
      this.error.textContent = tr('Esse item vai no chão: clique na sala, embaixo da parede.');
      return;
    } else if (this.decor.length < KV_DECOR_MAX) {
      const half = k === 'quadro' ? 1 : 0.5;
      const cx = x + half;
      const spans: [number, number][] = [
        ...busy,
        ...this.decor.filter((d) => KV_DECOR_WALL.includes(d.kind)).map((d) => [d.x - (d.kind === 'quadro' ? 1 : 0.5), d.x + (d.kind === 'quadro' ? 1 : 0.5)] as [number, number]),
      ];
      if (cx + half > 15.5 || spans.some(([a, b]) => cx - half < b && cx + half > a)) {
        this.error.textContent = tr('Não cabe aí: escolha um trecho livre da parede.');
        return;
      }
      this.decor.push({ kind: k, x: cx, y: 0, ...(this.variantValue ? { variant: this.variantValue } : {}) });
    }
    this.error.textContent = '';
    this.renderDecor();
  }

  // ------------------------------------------------------------------ sala de reunião

  /** Trocar o tipo traz os lugares, os equipamentos e o "privada por padrão" dele (como o servidor faz). */
  private setMeetLayout(l: KvMeetLayout): void {
    if (l === this.meet.layout) return;
    const d = kvDefaultMeet(l);
    this.meet = { ...this.meet, layout: l, capacity: d.capacity, equipment: d.equipment, privateDefault: d.privateDefault };
    this.paintMeet();
    if (this.kind === 'reuniao') this.kindHint.textContent = layoutDesc(l);
    this.renderDecor();
  }

  private paintMeet(): void {
    const m = this.meet;
    this.meetLayouts.querySelectorAll<HTMLElement>('[data-l]').forEach((b) => {
      const on = b.dataset.l === m.layout;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    this.meetCap.input.value = String(m.capacity);
    this.meetCapField.setError('');
    this.meetEquip.replaceChildren(
      ...KV_MEET_EQUIPS.map((e) => {
        const ico = h('span', { class: 'kv-ui-ico kv-meet-pick-ico', attrs: { 'aria-hidden': 'true' } });
        ico.innerHTML = EQUIP_PIX[e];
        return kvPick(
          equipName(e),
          m.equipment.includes(e),
          (on) => {
            const set = new Set(this.meet.equipment);
            if (on) set.add(e);
            else set.delete(e);
            this.meet.equipment = KV_MEET_EQUIPS.filter((x) => set.has(x));
          },
          { extra: ico },
        );
      }),
    );
    this.meetBookable.checked = m.bookable;
    this.meetRelease.checked = m.autoRelease;
    this.meetPrivate.checked = m.privateDefault;
  }

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.error.textContent = '';
    const body: Record<string, unknown> = {
      name: this.name.input.value.trim() || undefined,
      access: this.access,
      people: [...this.chosen],
      style: this.style,
      color: this.useColor.checked ? this.color.value : null,
      decor: this.decor,
    };
    if (this.me.role === 'admin' && this.owner?.value) body.owner = this.owner.value;
    if (!this.editing) body.kind = this.kind;
    if (this.kind === 'reuniao') {
      const cap = Number(this.meetCap.input.value);
      if (!Number.isInteger(cap) || cap < 1 || cap > KV_MEET_CAPACITY_MAX) {
        this.meetCapField.setError(tr('De 1 a {0} lugares.', [KV_MEET_CAPACITY_MAX]));
        this.meetCap.input.focus();
        return;
      }
      body.meet = { ...this.meet, capacity: cap };
    }
    this.save.disabled = true;
    const r = await call('POST', this.editing ? `${ROOMS_API}/${encodeURIComponent(this.editing.id)}` : ROOMS_API, body).catch(() => ({ ok: false, data: { error: tr('Sem conexão com o servidor.') } as Record<string, unknown> }));
    this.save.disabled = false;
    if (!r.ok) {
      this.error.textContent = String(r.data.error ?? tr('Não deu para salvar.'));
      return;
    }
    await kvReloadRooms();
    const saved = (r.data.room as KvOwnRoomView | undefined)?.id;
    this.edit(kvRoomsState().rooms.find((x) => x.id === saved) ?? null);
  }

  private async remove(r: KvOwnRoomView): Promise<void> {
    const ok = await kvConfirm({ title: tr('Apagar a sala {0}?', [r.name]), text: tr('O quadro, o mural e os links dela também somem.'), ok: tr('Apagar'), danger: true });
    if (!ok) return;
    const res = await call('DELETE', `${ROOMS_API}/${encodeURIComponent(r.id)}`).catch(() => ({ ok: false, data: { error: tr('Sem conexão com o servidor.') } as Record<string, unknown> }));
    if (!res.ok) this.error.textContent = String(res.data.error ?? '');
    await kvReloadRooms();
    this.edit(null);
  }
}
