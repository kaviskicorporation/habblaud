// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): a janela Reuniões, no espírito do Outlook/Teams.
// - Minhas reuniões: as próximas 14 dias, por dia, com sala, convidados, selos (agora, check-in feito, liberada) e as
//   ações Ir para a sala, Painel da sala, Baixar .ics, Editar e Cancelar (esta ou a série).
// - Marcar reunião (equipe e admin): título, dia, hora, duração, convidados, privada, repetição e nota; Achar sala (livre
//   no horário, capacidade e equipamentos) e o Assistente de agendamento (linha do tempo do dia com uma faixa por pessoa,
//   via freebusy, e a faixa da sala; o horário escolhido é um bloco que se arrasta, e clicar num vão muda o início).
//   Salva com POST /meetings (ou /meetings/<id> na edição); 409 mostra os conflitos e oferece saídas.
// - Salas: o diretório das salas de reunião com o estado agora e a linha do tempo de hoje.
// O botão do topo e a ação "ir e fazer" são ligados pelo integrador (kvOpenMeetings, MEET_ICON).
import {
  KV_MEET_EQUIPS,
  KV_MEET_NOTE_MAX,
  KV_MEET_REPEAT_MAX,
  KV_MEET_TITLE_MAX,
  kvExpandRepeat,
  kvMeetingIcs,
  kvMeetLive,
  type KvMeetEquip,
  type KvMeetFreq,
  type KvMeetingView,
  type KvMeetPerson,
  type KvMeetRoomView,
} from '../../../../shared/kaviski-meetings';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvBrandName } from '../brand';
import { kvHour } from './agenda';
import { kvFetchMeetings, kvMeetings, kvMeetLabel, kvMeetRequest, kvMeetRoom, kvOnMeetings, kvReloadMeetings, MEETINGS_API, type KvMeetResult } from './meetings-api';
import {
  DAY,
  dayStartOf,
  HOUR,
  KV_MEET_DURATIONS,
  KV_MEET_SOON_MS,
  KV_MEET_STEP,
  kvBlock,
  kvClampDur,
  kvClickSlot,
  kvDateValue,
  kvDragStart,
  kvFracTime,
  kvFromInputs,
  kvGroupByDay,
  kvHiddenByFilter,
  kvNextFree,
  kvRankRooms,
  kvRoomNow,
  kvSuggestStart,
  kvTimelineRange,
  kvTimeValue,
  MIN,
  nextDay,
  type Span,
} from './meetings-model';
import {
  CAL_PIX,
  CLOCK_PIX,
  DOWNLOAD_PIX,
  EQUIP_PIX,
  equipName,
  kvAvatarRow,
  kvDayLabel,
  kvDayLong,
  kvDownload,
  kvEquipChips,
  kvHourRuler,
  kvLayoutBadge,
  kvMeetAvatar,
  kvMeetingBlocks,
  kvMeId,
  kvRoomTag,
  kvSpanText,
  kvStrip,
  LAYOUT_COLOR,
  layoutName,
  LOCK_PIX,
  MEET_ICON,
  NOTE_PIX,
  PANEL_PIX,
  pix,
  REPEAT_PIX,
} from './meetings-ui';
import { kvOpenRoomPanel } from './meetings-panel';
import { kvGoArea } from './walk';
import { KV_ICONS, kvBtn, kvEmpty, kvField, kvIconBtn, kvInput, kvRoleBadge, kvTabs, kvTitle, kvToggle, type KvInput, type KvTabs, type KvToggle } from './ui/kit';
import { KvModal, kvConfirm } from './ui/modal';
import { kvPick, kvSection, kvSeg, type KvSeg } from './ui/section';
import { kvToast } from './ui/toast';

export { MEET_ICON } from './meetings-ui';

export type KvMeetTab = 'minhas' | 'marcar' | 'salas';

export interface KvOpenMeetingsOpts {
  tab?: KvMeetTab;
  /** Sala já escolhida (aba Marcar). */
  room?: string;
  /** Início sugerido (aba Marcar). */
  start?: number;
  /** Id da reunião a editar (abre Marcar preenchida). */
  edit?: string;
}

/** Largura de uma hora na linha do tempo do assistente (px). */
const HOUR_PX = 64;
const MINE_DAYS = 14;

let dialog: MeetingsDialog | null = null;

/** Abre a janela Reuniões (na aba pedida; `edit` abre a reunião para editar, `room`/`start` preenchem Marcar). */
export function kvOpenMeetings(opts: KvOpenMeetingsOpts = {}): void {
  dialog ??= new MeetingsDialog();
  dialog.open(opts);
}

/** "15 min", "1 h", "1h30". */
function durLabel(min: number): string {
  if (min < 60) return tr('{0} min', [min]);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return mm ? `${hh}h${String(mm).padStart(2, '0')}` : tr('{0} h', [hh]);
}

/** Vai até a sala (fecha a janela se deu). */
function goRoom(room: string, close: () => void): void {
  if (kvGoArea(`r:${room}`)) close();
  else kvToast(tr('Não deu para ir até a sala daqui (entre no escritório primeiro).'), { kind: 'warn' });
}

/** Baixa o .ics da reunião. */
function downloadIcs(m: KvMeetingView): void {
  const room = kvMeetRoom(m.room);
  const title = kvMeetLabel(m);
  const ics = kvMeetingIcs({ id: m.id, title, start: m.start, end: m.end, note: m.note, by: m.by, people: m.people }, room?.name ?? '', kvBrandName() ?? 'Voxtrin', { by: tr('Organizador'), people: tr('Convidados') });
  const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'reuniao';
  kvDownload(`${slug}.ics`, ics, 'text/calendar;charset=utf-8');
}

/** Pergunta como cancelar: só esta, esta e as próximas da série, ou nada. */
function askCancel(m: KvMeetingView): Promise<'one' | 'series' | null> {
  const what = `${kvMeetLabel(m)} · ${kvDayLabel(dayStartOf(m.start), Date.now())} ${kvSpanText(m)}`;
  if (!m.series) {
    return kvConfirm({ title: tr('Cancelar a reunião?'), text: tr('{0}. Os convidados deixam de ver a reunião e a sala fica livre.', [what]), ok: tr('Cancelar a reunião'), cancel: tr('Voltar'), danger: true }).then((ok) => (ok ? 'one' : null));
  }
  return new Promise((resolve) => {
    let answer: 'one' | 'series' | null = null;
    const md = new KvModal({
      title: tr('Cancelar a reunião?'),
      icon: KV_ICONS.alert,
      width: 460,
      cls: 'kv-ui-confirm is-danger',
      onClose: () => {
        md.el.remove();
        resolve(answer);
      },
    });
    md.body.append(h('p', { class: 'kv-ui-confirm__text', text: tr('{0}. Esta reunião faz parte de uma série.', [what]) }));
    const pickBtn = (label: string, v: 'one' | 'series', variant: 'secondary' | 'danger') =>
      kvBtn(label, {
        variant,
        onClick: () => {
          answer = v;
          md.close();
        },
      });
    const back = kvBtn(tr('Voltar'), { variant: 'ghost', onClick: () => md.close() });
    md.setFoot(back, pickBtn(tr('Só esta'), 'one', 'secondary'), pickBtn(tr('Esta e as próximas'), 'series', 'danger'));
    md.show();
    back.focus();
  });
}

async function cancelMeeting(m: KvMeetingView): Promise<void> {
  const how = await askCancel(m);
  if (!how) return;
  const r = await kvMeetRequest('DELETE', `/${encodeURIComponent(m.id)}${how === 'series' ? '?series=1' : ''}`);
  if (r.ok) kvToast(how === 'series' ? tr('Reunião e as próximas da série canceladas.') : tr('Reunião cancelada.'), { kind: 'ok' });
  else kvToast(r.error || tr('Não deu para cancelar.'), { kind: 'error' });
}

// ====================================================================== janela

class MeetingsDialog {
  private readonly modal: KvModal;
  private readonly tabs: KvTabs;
  private readonly panes: Record<KvMeetTab, HTMLElement>;
  private readonly book: BookForm;
  private tab: KvMeetTab = 'minhas';
  private unsub: (() => void) | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.modal = new KvModal({
      title: tr('Reuniões'),
      subtitle: tr('As suas reuniões, as salas do escritório e quem está livre.'),
      icon: MEET_ICON,
      width: 1140,
      cls: 'kv-meet',
      onClose: () => this.stop(),
    });
    this.tabs = kvTabs(
      [
        { id: 'minhas', label: tr('Minhas reuniões'), icon: CAL_PIX },
        { id: 'marcar', label: tr('Marcar reunião'), icon: KV_ICONS.plus },
        { id: 'salas', label: tr('Salas'), icon: MEET_ICON },
      ],
      (id) => this.show(id as KvMeetTab),
    );
    this.panes = {
      minhas: h('div', { class: 'kv-meet__pane kv-meet__pane--mine', role: 'tabpanel' }),
      marcar: h('div', { class: 'kv-meet__pane kv-meet__pane--book', role: 'tabpanel' }),
      salas: h('div', { class: 'kv-meet__pane kv-meet__pane--rooms', role: 'tabpanel' }),
    };
    this.book = new BookForm({
      saved: () => this.show('minhas'),
      close: () => this.modal.close(),
      foot: (...els) => this.tab === 'marcar' && this.modal.setFoot(...els),
    });
    this.panes.marcar.append(this.book.el);
    this.modal.body.append(h('div', { class: 'kv-meet__tabs' }, this.tabs.el), this.panes.minhas, this.panes.marcar, this.panes.salas);
  }

  open(o: KvOpenMeetingsOpts): void {
    if (!this.modal.open) {
      this.unsub = kvOnMeetings(() => this.refresh());
      this.tick = setInterval(() => this.refresh(), 30_000);
      void kvReloadMeetings();
    }
    const tab: KvMeetTab = o.edit ? 'marcar' : (o.tab ?? (o.room || o.start ? 'marcar' : 'minhas'));
    if (tab === 'marcar') this.book.reset({ room: o.room, start: o.start, edit: o.edit });
    this.modal.show();
    this.show(tab);
  }

  private stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private show(tab: KvMeetTab): void {
    this.tab = tab;
    this.tabs.set(tab);
    for (const [k, el] of Object.entries(this.panes)) el.hidden = k !== tab;
    this.modal.setFoot();
    if (tab === 'minhas') this.renderMine();
    else if (tab === 'salas') this.renderRooms();
    else this.book.activate();
  }

  private refresh(): void {
    const s = kvMeetings();
    this.tabs.setBadge('minhas', s.meetings.filter((m) => m.mine && !m.released && m.end > Date.now() && m.start < Date.now() + DAY).length);
    if (!this.modal.open) return;
    if (this.tab === 'minhas') this.renderMine();
    else if (this.tab === 'salas') this.renderRooms();
    else this.book.storeChanged();
  }

  /** Editar: abre Marcar preenchida. */
  private edit(m: KvMeetingView): void {
    this.book.reset({ edit: m.id });
    this.show('marcar');
  }

  // ------------------------------------------------------------------ Minhas reuniões

  private renderMine(): void {
    const s = kvMeetings();
    const now = Date.now();
    const limit = dayStartOf(now) + MINE_DAYS * DAY;
    const list = s.meetings.filter((m) => m.mine && m.released !== 'cancelada' && m.end > now && m.start < limit);
    const head = h(
      'div',
      { class: 'kv-meet__bar' },
      h('p', { class: 'kv-meet__bar-text', text: list.length ? tr('{0} reuniões nos próximos {1} dias', [list.length, MINE_DAYS]) : tr('Próximos {0} dias', [MINE_DAYS]) }),
      s.canBook ? kvBtn(tr('Marcar reunião'), { variant: 'primary', size: 'sm', icon: KV_ICONS.plus, onClick: () => (this.book.reset({}), this.show('marcar')) }) : null,
    );
    if (!list.length) {
      this.panes.minhas.replaceChildren(
        head,
        h(
          'div',
          { class: 'kv-meet__empty' },
          kvEmpty(
            CAL_PIX,
            tr('Nenhuma reunião marcada'),
            s.canBook ? tr('Marque uma reunião e convide as pessoas: a sala fica reservada para vocês.') : tr('Quando convidarem você para uma reunião, ela aparece aqui.'),
            s.canBook ? kvBtn(tr('Marcar reunião'), { variant: 'primary', icon: KV_ICONS.plus, onClick: () => (this.book.reset({}), this.show('marcar')) }) : undefined,
          ),
        ),
      );
      return;
    }
    const groups = kvGroupByDay(list, now).map((g) =>
      h(
        'section',
        { class: 'kv-meet-day' },
        h('header', { class: 'kv-meet-day__head' }, kvTitle('h3', kvDayLabel(g.day, now), 'kv-meet-day__title'), h('span', { class: 'kv-meet-day__long', text: kvDayLong(g.day) }), h('span', { class: 'kv-meet-day__n', text: String(g.items.length) })),
        h('ul', { class: 'kv-meet-list' }, ...g.items.map((m) => this.mineCard(m, now))),
      ),
    );
    this.panes.minhas.replaceChildren(head, ...groups);
  }

  private mineCard(m: KvMeetingView, now: number): HTMLElement {
    const room = kvMeetRoom(m.room);
    const live = kvMeetLive(m, now);
    const me = kvMeId();
    const soon = !live && !m.released && m.start > now && m.start - now <= KV_MEET_SOON_MS;
    const badges: HTMLElement[] = [];
    if (m.released === 'auto') badges.push(h('span', { class: 'kv-ui-state kv-ui-state--off', text: tr('liberada'), title: tr('Ninguém apareceu nos primeiros 10 minutos: a sala foi liberada.') }));
    else if (live) badges.push(h('span', { class: 'kv-ui-state kv-ui-state--ok kv-meet-live', text: tr('agora') }));
    else if (soon) badges.push(h('span', { class: 'kv-ui-state kv-ui-state--warn', text: tr('em {0} min', [Math.max(1, Math.round((m.start - now) / MIN))]) }));
    if (m.checkin && !m.released) badges.push(h('span', { class: 'kv-ui-state kv-ui-state--ok', text: tr('check-in feito') }));
    const people: KvMeetPerson[] = [...(m.by ? [m.by] : []), ...(m.people ?? [])];
    const byText = m.by ? (m.by.id === me ? tr('Você organiza') : tr('Organizada por {0}', [m.by.name])) : '';
    const color = room ? LAYOUT_COLOR[room.meet.layout] : '#7cc8ff';
    const card = h(
      'li',
      { class: `kv-meet-card${live ? ' is-live' : ''}${m.released ? ' is-released' : ''}`, style: `--lay:${color}` },
      h('div', { class: 'kv-meet-card__time' }, h('strong', { text: kvHour(m.start) }), h('span', { text: kvHour(m.end) })),
      h(
        'div',
        { class: 'kv-meet-card__main' },
        h(
          'div',
          { class: 'kv-meet-card__top' },
          m.private ? pix(LOCK_PIX, 'kv-ui-ico kv-meet-lock') : null,
          h('strong', { class: 'kv-meet-card__title', text: kvMeetLabel(m) }),
          ...badges,
        ),
        h(
          'div',
          { class: 'kv-meet-card__meta' },
          kvRoomTag(room, tr('Sala')),
          byText ? h('span', { text: byText }) : null,
          m.series ? h('span', { class: 'kv-meet-card__series', title: tr('Faz parte de uma série') }, pix(REPEAT_PIX), h('span', { text: tr('repete') })) : null,
        ),
        people.length ? h('div', { class: 'kv-meet-card__people' }, kvAvatarRow(people, 6), h('span', { class: 'kv-meet-card__count', text: tr('{0} pessoas', [people.length]) })) : null,
        m.note ? h('p', { class: 'kv-meet-card__note', title: m.note }, pix(NOTE_PIX), h('span', { text: m.note })) : null,
      ),
      h(
        'div',
        { class: 'kv-meet-card__actions' },
        m.released ? null : kvBtn(tr('Ir para a sala'), { variant: live || soon ? 'primary' : 'secondary', size: 'sm', icon: KV_ICONS.walk, onClick: () => goRoom(m.room, () => this.modal.close()) }),
        h(
          'div',
          { class: 'kv-meet-card__icons' },
          kvIconBtn(PANEL_PIX, tr('Painel da sala'), () => (this.modal.close(), kvOpenRoomPanel(m.room)), { size: 'sm' }),
          kvIconBtn(DOWNLOAD_PIX, tr('Baixar .ics (Outlook, Google, Apple)'), () => downloadIcs(m), { size: 'sm' }),
          m.canEdit && !m.released ? kvIconBtn(KV_ICONS.edit, tr('Editar'), () => this.edit(m), { size: 'sm' }) : null,
          m.canEdit && !m.released ? kvIconBtn(KV_ICONS.trash, tr('Cancelar a reunião'), () => void cancelMeeting(m), { size: 'sm', cls: 'kv-meet-del' }) : null,
        ),
      ),
    );
    return card;
  }

  // ------------------------------------------------------------------ Salas

  private renderRooms(): void {
    const s = kvMeetings();
    const now = Date.now();
    if (!s.rooms.length) {
      this.panes.salas.replaceChildren(
        h('div', { class: 'kv-meet__empty' }, kvEmpty(MEET_ICON, tr('Nenhuma sala de reunião ainda'), tr('Crie uma sala do tipo Reunião na tela Salas: ela aparece aqui e passa a aceitar reservas.'))),
      );
      return;
    }
    const day = dayStartOf(now);
    const range = kvTimelineRange(day);
    const cards = [...s.rooms]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => {
        const st = kvRoomNow(r.id, s.meetings, now);
        const today = s.meetings.filter((m) => m.room === r.id && !m.released && m.end > day && m.start < nextDay(day));
        const color = LAYOUT_COLOR[r.meet.layout];
        let stateText: string;
        let stateSub = '';
        if (st.kind === 'ocupada') {
          stateText = tr('Ocupada até {0}', [kvHour(st.until!)]);
          stateSub = kvMeetLabel(st.cur!);
        } else if (st.kind === 'breve') {
          stateText = tr('Próxima às {0}', [kvHour(st.next!.start)]);
          stateSub = kvMeetLabel(st.next!);
        } else {
          stateText = tr('Livre');
          stateSub = st.next && st.next.start < nextDay(day) ? tr('Próxima às {0}: {1}', [kvHour(st.next.start), kvMeetLabel(st.next)]) : tr('Nada mais marcado hoje');
        }
        if (!r.meet.bookable) stateSub = tr('Sala de uso livre: não aceita reservas');
        return h(
          'li',
          { class: `kv-meet-room is-${st.kind}`, style: `--lay:${color}` },
          h(
            'header',
            { class: 'kv-meet-room__head' },
            kvLayoutBadge(r.meet.layout, 'lg'),
            h('div', { class: 'kv-meet-room__title' }, h('strong', { text: r.name }), h('span', { text: `${layoutName(r.meet.layout)} · ${tr('{0} lugares', [r.meet.capacity])}` })),
          ),
          h(
            'div',
            { class: `kv-meet-room__state is-${st.kind}` },
            h('span', { class: 'kv-meet-room__dot' }),
            h('div', {}, h('strong', { text: stateText }), stateSub ? h('span', { text: stateSub }) : null),
            (st.cur ?? (st.kind === 'breve' ? st.next : undefined))?.private ? pix(LOCK_PIX, 'kv-ui-ico kv-meet-lock') : null,
          ),
          r.meet.equipment.length ? kvEquipChips(r.meet.equipment) : null,
          h('div', { class: 'kv-meet-room__tl' }, kvHourRuler(range, 3), kvStrip(kvMeetingBlocks(today, now), range, now, 'kv-meet-strip--room')),
          h(
            'div',
            { class: 'kv-meet-room__actions' },
            s.canBook && r.meet.bookable ? kvBtn(tr('Marcar'), { variant: 'primary', size: 'sm', icon: KV_ICONS.plus, onClick: () => (this.book.reset({ room: r.id }), this.show('marcar')) }) : null,
            kvBtn(tr('Agenda da sala'), { size: 'sm', icon: PANEL_PIX, onClick: () => (this.modal.close(), kvOpenRoomPanel(r.id)) }),
            kvBtn(tr('Ir até a sala'), { size: 'sm', variant: 'ghost', icon: KV_ICONS.walk, onClick: () => goRoom(r.id, () => this.modal.close()) }),
          ),
        );
      });
    this.panes.salas.replaceChildren(h('ul', { class: 'kv-meet-rooms' }, ...cards));
  }
}

// ====================================================================== Marcar reunião

interface BookHooks {
  saved: () => void;
  close: () => void;
  foot: (...els: (HTMLElement | null)[]) => void;
}

type RepeatChoice = 'nao' | KvMeetFreq;

class BookForm {
  readonly el: HTMLElement;
  private readonly form: HTMLElement;
  private readonly blocked: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly title: KvInput;
  private readonly date: KvInput;
  private readonly time: KvInput;
  private readonly endTime: KvInput;
  private readonly durSeg: KvSeg<string>;
  private readonly dateHint: HTMLElement;
  private readonly guestSearch: KvInput;
  private readonly guestResults: HTMLElement;
  private readonly guestChips: HTMLElement;
  private readonly guestCount: HTMLElement;
  private readonly priv: KvToggle;
  private readonly repeatSeg: KvSeg<RepeatChoice>;
  private readonly repeatCount: KvInput;
  private readonly repeatRow: HTMLElement;
  private readonly repeatHint: HTMLElement;
  private readonly repeatSec: HTMLElement;
  private readonly note: HTMLTextAreaElement;
  private readonly seriesTg: KvToggle;
  private readonly conflictBox: HTMLElement;
  private readonly asstLabels: HTMLElement;
  private readonly asstScroll: HTMLElement;
  private readonly asstTracks: HTMLElement;
  private readonly asstHead: HTMLElement;
  private readonly capInput: KvInput;
  private readonly equipBox: HTMLElement;
  private readonly roomList: HTMLElement;
  private readonly roomsSec: HTMLElement;
  private readonly roomHidden: HTMLElement;
  private readonly error: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly cancelEdit: HTMLButtonElement;

  private start = 0;
  private dur = 30 * MIN;
  private people: string[] = [];
  private names = new Map<string, string>();
  private room = '';
  private editId = '';
  private editOrig: Span | null = null;
  private capTouched = false;
  private equip = new Set<KvMeetEquip>();
  private dayList: KvMeetingView[] = [];
  private dayLoaded = -1;
  private fb: Record<string, Span[]> | null = null;
  private fbKey = '';
  private fbTimer: ReturnType<typeof setTimeout> | null = null;
  private dayTimer: ReturnType<typeof setTimeout> | null = null;
  private busySaving = false;
  private scrollPending = true;

  constructor(private readonly hooks: BookHooks) {
    this.heading = kvTitle('h3', tr('Nova reunião'), 'kv-meet-book__title');
    this.title = kvInput({ placeholder: tr('ex.: Alinhamento da semana'), maxlength: KV_MEET_TITLE_MAX, name: 'title' });
    this.date = kvInput({ type: 'date', name: 'date', onInput: () => this.fromInputs() });
    this.time = kvInput({ type: 'time', name: 'time', onInput: () => this.fromInputs() });
    this.time.input.step = '300';
    this.endTime = kvInput({ type: 'time', name: 'end', onInput: () => this.fromEnd() });
    this.endTime.input.step = '300';
    this.dateHint = h('p', { class: 'kv-ui-field__hint kv-meet-book__when' });
    this.durSeg = kvSeg(
      KV_MEET_DURATIONS.map((m) => ({ value: String(m), label: durLabel(m) })),
      '30',
      (v) => this.setDur(Number(v) * MIN),
      tr('Duração'),
    );

    // convidados
    this.guestSearch = kvInput({ placeholder: tr('Buscar pessoas para convidar…'), icon: KV_ICONS.search, onInput: () => this.renderGuestResults() });
    this.guestSearch.input.setAttribute('aria-label', tr('Buscar pessoas para convidar…'));
    this.guestSearch.input.addEventListener('focus', () => this.renderGuestResults());
    this.guestSearch.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (this.guestResults.querySelector('button') as HTMLButtonElement | null)?.click();
      } else if (e.key === 'Escape' && !this.guestResults.hidden) {
        e.stopPropagation();
        e.preventDefault();
        this.guestResults.hidden = true;
      }
    });
    this.guestResults = h('ul', { class: 'kv-meet-guests__results', hidden: true, role: 'listbox' });
    this.guestChips = h('div', { class: 'kv-meet-guests__chips' });
    this.guestCount = h('span', { class: 'kv-meet-guests__count' });

    this.priv = kvToggle(tr('Reunião privada'), { hint: tr('Enquanto acontece, ninguém de fora entra, vê ou ouve: só você e os convidados.') });
    this.repeatSeg = kvSeg<RepeatChoice>(
      [
        { value: 'nao', label: tr('Não repete') },
        { value: 'diaria', label: tr('Todo dia') },
        { value: 'uteis', label: tr('Dias úteis') },
        { value: 'semanal', label: tr('Toda semana') },
      ],
      'nao',
      () => this.renderRepeat(),
      tr('Repetir'),
    );
    this.repeatCount = kvInput({ type: 'number', value: '4', onInput: () => this.renderRepeat() });
    this.repeatCount.input.min = '2';
    this.repeatCount.input.max = String(KV_MEET_REPEAT_MAX);
    this.repeatHint = h('p', { class: 'kv-ui-field__hint' });
    this.repeatRow = h('div', { class: 'kv-meet-book__repeat' }, kvField(tr('Quantas vezes (contando esta)'), this.repeatCount.el).el, this.repeatHint);
    this.note = h('textarea', { class: 'kv-meet-book__note', attrs: { maxlength: KV_MEET_NOTE_MAX, rows: 3, placeholder: tr('Pauta, link da chamada, o que levar…') } });
    this.seriesTg = kvToggle(tr('Aplicar às próximas da série'), { hint: tr('Título, convidados, privada e nota mudam também nas próximas reuniões desta série.') });

    this.conflictBox = h('div', { class: 'kv-meet-conflict', hidden: true, role: 'alert' });

    // assistente
    this.asstHead = h('div', { class: 'kv-meet-asst__day' });
    this.asstLabels = h('div', { class: 'kv-meet-asst__labels' });
    this.asstTracks = h('div', { class: 'kv-meet-asst__tracks' });
    this.asstScroll = h('div', { class: 'kv-meet-asst__scroll' }, this.asstTracks);
    this.asstTracks.addEventListener('click', (e) => this.trackClick(e));

    // achar sala
    this.capInput = kvInput({
      type: 'number',
      onInput: () => {
        this.capTouched = true;
        this.renderRooms();
      },
    });
    this.capInput.input.min = '1';
    this.capInput.input.max = '60';
    this.capInput.input.setAttribute('aria-label', tr('Lugares, no mínimo'));
    this.equipBox = h('div', { class: 'kv-meet-filter__equips' });
    for (const e of KV_MEET_EQUIPS) {
      const b = kvPick(equipName(e), false, (on) => {
        if (on) this.equip.add(e);
        else this.equip.delete(e);
        this.renderRooms();
      }, { extra: pix(EQUIP_PIX[e], 'kv-ui-ico kv-meet-pick-ico') });
      b.dataset.eq = e;
      this.equipBox.append(b);
    }
    this.roomList = h('ul', { class: 'kv-meet-findroom', role: 'radiogroup', attrs: { 'aria-label': tr('Sala') } });
    this.roomHidden = h('p', { class: 'kv-meet-findroom__hidden', hidden: true });

    this.error = h('p', { class: 'kv-ui-field__error kv-meet-book__error', attrs: { role: 'alert' } });
    this.saveBtn = kvBtn(tr('Marcar reunião'), { variant: 'primary', icon: KV_ICONS.check, onClick: () => void this.save() });
    this.cancelEdit = kvBtn(tr('Descartar'), { variant: 'ghost', onClick: () => this.reset({}) });

    const whenGrid = h(
      'div',
      { class: 'kv-meet-book__when-grid' },
      kvField(tr('Dia'), this.date.el).el,
      kvField(tr('Início'), this.time.el).el,
      kvField(tr('Fim'), this.endTime.el).el,
    );
    this.repeatSec = kvSection(REPEAT_PIX, tr('Repetir'), null, this.repeatSeg.el, this.repeatRow);
    const left = h(
      'div',
      { class: 'kv-meet-book__col' },
      kvSection(KV_ICONS.edit, tr('Detalhes'), null, kvField(tr('Título'), this.title.el).el, whenGrid, h('div', { class: 'kv-meet-book__durs' }, h('span', { class: 'kv-ui-field__label', text: tr('Duração') }), this.durSeg.el), this.dateHint),
      kvSection(
        KV_ICONS.users,
        tr('Convidados'),
        tr('Quem você chamar vê a reunião na agenda e pode entrar na sala.'),
        h('div', { class: 'kv-meet-guests' }, this.guestSearch.el, this.guestResults),
        this.guestChips,
        this.guestCount,
      ),
      kvSection(LOCK_PIX, tr('Privacidade'), null, this.priv.el),
      this.repeatSec,
      kvSection(NOTE_PIX, tr('Nota'), null, this.note, this.seriesTg.el),
    );
    this.roomsSec = kvSection(
      MEET_ICON,
      tr('Achar sala'),
      tr('As salas livres no horário escolhido vêm primeiro.'),
      h(
        'div',
        { class: 'kv-meet-filter' },
        h('label', { class: 'kv-meet-filter__cap' }, pix(KV_ICONS.users), h('span', { text: tr('Lugares, no mínimo') }), this.capInput.el),
        this.equipBox,
      ),
      this.roomList,
      this.roomHidden,
    );
    const right = h(
      'div',
      { class: 'kv-meet-book__col' },
      kvSection(
        CLOCK_PIX,
        tr('Assistente de agendamento'),
        tr('Clique num horário livre ou arraste o bloco azul para mudar o início.'),
        this.asstHead,
        h('div', { class: 'kv-meet-asst' }, this.asstLabels, this.asstScroll),
        h(
          'div',
          { class: 'kv-meet-asst__legend' },
          h('span', { class: 'kv-meet-legend kv-meet-legend--busy', text: tr('ocupado') }),
          h('span', { class: 'kv-meet-legend kv-meet-legend--room', text: tr('reserva da sala') }),
          h('span', { class: 'kv-meet-legend kv-meet-legend--sel', text: tr('esta reunião') }),
        ),
      ),
      this.roomsSec,
    );
    this.form = h('div', { class: 'kv-meet-book' }, h('div', { class: 'kv-meet-book__head' }, this.heading), this.conflictBox, h('div', { class: 'kv-meet-book__grid' }, left, right));
    this.blocked = h(
      'div',
      { class: 'kv-meet__empty', hidden: true },
      kvEmpty(KV_ICONS.lock, tr('Só a equipe marca reuniões'), tr('Você vê as salas e entra nas reuniões para as quais foi convidado.')),
    );
    this.el = h('div', {}, this.blocked, this.form);
    document.addEventListener('pointerdown', (e) => {
      if (!this.guestResults.hidden && !this.guestResults.parentElement?.contains(e.target as Node)) this.guestResults.hidden = true;
    });
  }

  // ------------------------------------------------------------------ estado

  /** Começa de novo: reunião nova (com sala/início opcionais) ou a edição de uma reunião. */
  reset(o: { room?: string; start?: number; edit?: string }): void {
    const now = Date.now();
    const s = kvMeetings();
    const m = o.edit ? s.meetings.find((x) => x.id === o.edit && x.canEdit) : undefined;
    this.editId = m?.id ?? '';
    this.editOrig = m ? { start: m.start, end: m.end } : null;
    this.error.textContent = '';
    this.conflictBox.hidden = true;
    this.capTouched = false;
    this.equip.clear();
    this.equipBox.querySelectorAll<HTMLElement>('[data-eq]').forEach((b) => (b.classList.remove('is-on'), b.setAttribute('aria-pressed', 'false')));
    this.names = new Map((s.people ?? []).map((p) => [p.id, p.name]));
    if (m) {
      for (const p of m.people ?? []) this.names.set(p.id, p.name);
      this.title.input.value = m.title ?? '';
      this.start = m.start;
      this.dur = m.end - m.start;
      this.people = (m.people ?? []).map((p) => p.id);
      this.room = m.room;
      this.priv.checked = m.private;
      this.note.value = m.note ?? '';
    } else {
      this.title.input.value = '';
      this.start = o.start && o.start > now - DAY ? o.start : kvSuggestStart(now);
      this.dur = 30 * MIN;
      this.people = [];
      this.room = o.room && kvMeetRoom(o.room)?.meet.bookable ? o.room : '';
      this.priv.checked = this.room ? !!kvMeetRoom(this.room)?.meet.privateDefault : false;
      this.note.value = '';
    }
    this.seriesTg.checked = false;
    this.seriesTg.el.hidden = !m?.series;
    this.repeatSec.hidden = !!m;
    this.repeatSeg.set('nao');
    this.repeatCount.input.value = '4';
    this.heading.textContent = m ? tr('Editar: {0}', [kvMeetLabel(m)]) : tr('Nova reunião');
    this.heading.classList.toggle('kv-ui-px', false);
    this.saveBtn.querySelector('.kv-ui-btn__label')!.textContent = m ? tr('Salvar') : tr('Marcar reunião');
    this.guestSearch.input.value = '';
    this.guestResults.hidden = true;
    this.scrollPending = true;
    this.dayLoaded = -1;
    this.fbKey = '';
    this.fb = null;
    this.paintTimes();
    this.renderGuests();
    this.renderRepeat();
    this.render();
  }

  /** A aba ficou visível. */
  activate(): void {
    const canBook = kvMeetings().canBook;
    this.blocked.hidden = canBook;
    this.form.hidden = !canBook;
    if (!canBook) return;
    if (!this.start) this.reset({});
    this.hooks.foot(this.error, this.editId ? this.cancelEdit : null, this.saveBtn);
    this.loadDay();
    this.loadFreeBusy();
    this.render();
  }

  /** As reservas mudaram (evento do servidor). */
  storeChanged(): void {
    this.dayLoaded = -1;
    this.loadDay();
    this.render();
  }

  private get end(): number {
    return this.start + this.dur;
  }

  private get day(): number {
    return dayStartOf(this.start);
  }

  private setStart(t: number): void {
    const oldDay = this.day;
    this.start = t;
    this.conflictBox.hidden = true;
    this.paintTimes();
    if (this.day !== oldDay) {
      this.loadDay();
      this.loadFreeBusy();
    }
    this.render();
  }

  private setDur(ms: number): void {
    this.dur = kvClampDur(ms);
    this.conflictBox.hidden = true;
    this.paintTimes();
    this.render();
  }

  private paintTimes(): void {
    this.date.input.value = kvDateValue(this.start);
    this.time.input.value = kvTimeValue(this.start);
    this.endTime.input.value = kvTimeValue(this.end);
    this.durSeg.set(KV_MEET_DURATIONS.includes(this.dur / MIN) ? String(this.dur / MIN) : '');
    const cross = dayStartOf(this.end - 1) !== this.day;
    this.dateHint.textContent = `${kvDayLong(this.start)} · ${kvSpanText({ start: this.start, end: this.end })} (${durLabel(Math.round(this.dur / MIN))})${cross ? ` · ${tr('termina no dia seguinte')}` : ''}`;
    this.dateHint.hidden = false;
  }

  private fromInputs(): void {
    const t = kvFromInputs(this.date.input.value, this.time.input.value);
    if (t === null) return;
    this.setStart(t);
  }

  private fromEnd(): void {
    const t = kvFromInputs(kvDateValue(this.start), this.endTime.input.value);
    if (t === null) return;
    let d = t - this.start;
    if (d <= 0) d += DAY; // fim depois da meia-noite
    this.setDur(d);
  }

  // ------------------------------------------------------------------ dados do dia

  private loadDay(): void {
    const day = this.day;
    if (this.dayLoaded === day) return;
    this.dayLoaded = day;
    if (this.dayTimer) clearTimeout(this.dayTimer);
    this.dayTimer = setTimeout(async () => {
      const r = await kvFetchMeetings(day, nextDay(day) + 12 * HOUR);
      if (r && this.dayLoaded === day) {
        this.dayList = r.meetings ?? [];
        this.render();
      }
    }, 120);
  }

  /** As reservas conhecidas do dia (as buscadas do dia, ou as do armazém enquanto não chegam). */
  private meetingsOfDay(): KvMeetingView[] {
    const day = this.day;
    const from = this.dayList.length || this.dayLoaded === day ? this.dayList : kvMeetings().meetings;
    const byId = new Map<string, KvMeetingView>();
    for (const m of [...kvMeetings().meetings, ...from]) byId.set(m.id, m);
    return [...byId.values()].filter((m) => m.end > day && m.start < nextDay(day) + 12 * HOUR);
  }

  private loadFreeBusy(): void {
    const me = kvMeId();
    const ids = [...new Set([me, ...this.people].filter(Boolean))];
    const key = `${this.day}|${ids.join(',')}`;
    if (key === this.fbKey) return;
    this.fbKey = key;
    if (this.fbTimer) clearTimeout(this.fbTimer);
    if (!ids.length) {
      this.fb = {};
      return;
    }
    const day = this.day;
    this.fbTimer = setTimeout(async () => {
      try {
        const res = await fetch(`${MEETINGS_API}/freebusy?people=${ids.map(encodeURIComponent).join(',')}&from=${day}&to=${nextDay(day)}`, { credentials: 'same-origin', cache: 'no-store' });
        const b = (await res.json().catch(() => ({}))) as { busy?: Record<string, Span[]> };
        if (this.fbKey !== key) return;
        this.fb = res.ok ? (b.busy ?? {}) : null;
      } catch {
        if (this.fbKey === key) this.fb = null;
      }
      this.renderAsst();
    }, 250);
  }

  /** Ocupado de uma pessoa (sem a própria reunião que está sendo editada). */
  private busyOf(id: string): Span[] | null {
    if (!this.fb) return null;
    const list = this.fb[id] ?? [];
    const o = this.editOrig;
    return o ? list.filter((s) => !(s.start === o.start && s.end === o.end)) : list;
  }

  private roomBusy(roomId: string): KvMeetingView[] {
    return this.meetingsOfDay().filter((m) => m.room === roomId && !m.released && m.id !== this.editId);
  }

  // ------------------------------------------------------------------ desenho

  private render(): void {
    if (!kvMeetings().canBook) return;
    this.renderGuests();
    this.renderAsst();
    this.renderRooms();
  }

  private renderGuests(): void {
    this.guestChips.replaceChildren(
      ...this.people.map((id) => {
        const name = this.names.get(id) ?? id;
        const x = h('button', { class: 'kv-ui-chip__x', type: 'button', attrs: { 'aria-label': tr('Tirar {0}', [name]) }, on: { click: () => this.toggleGuest(id) } });
        x.innerHTML = KV_ICONS.close;
        return h('span', { class: 'kv-ui-chip kv-meet-guest' }, kvMeetAvatar({ id, name }), h('span', { class: 'kv-ui-chip__label', text: name }), x);
      }),
    );
    if (!this.people.length) this.guestChips.append(h('span', { class: 'kv-meet-guests__none', text: tr('Ninguém convidado ainda: só você.') }));
    const total = this.people.length + 1;
    const room = this.room ? kvMeetRoom(this.room) : undefined;
    const over = room && total > room.meet.capacity;
    this.guestCount.textContent = over ? tr('{0} pessoas com você · a sala tem {1} lugares', [total, room.meet.capacity]) : tr('{0} pessoas com você', [total]);
    this.guestCount.classList.toggle('is-warn', !!over);
    if (!this.capTouched) this.capInput.input.value = String(total);
  }

  private renderGuestResults(): void {
    const q = this.guestSearch.input.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const me = kvMeId();
    const all = (kvMeetings().people ?? []).filter((p) => p.id !== me && !this.people.includes(p.id));
    const list = all.filter((p) => !q || p.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q)).slice(0, 8);
    this.guestResults.replaceChildren(
      ...list.map((p) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: 'kv-meet-guests__opt',
              type: 'button',
              role: 'option',
              on: {
                click: () => {
                  this.names.set(p.id, p.name);
                  this.toggleGuest(p.id);
                  this.guestSearch.input.value = '';
                  this.guestSearch.input.focus();
                  this.renderGuestResults();
                },
              },
            },
            kvMeetAvatar(p, 'sm'),
            h('span', { class: 'kv-meet-guests__name', text: p.name }),
            kvRoleBadge(p.role),
          ),
        ),
      ),
    );
    if (!list.length) this.guestResults.append(h('li', { class: 'kv-meet-guests__empty', text: all.length ? tr('Ninguém com esse nome.') : tr('Todo mundo já foi convidado.') }));
    this.guestResults.hidden = false;
  }

  private toggleGuest(id: string): void {
    this.people = this.people.includes(id) ? this.people.filter((x) => x !== id) : [...this.people, id];
    this.conflictBox.hidden = true;
    this.loadFreeBusy();
    this.render();
  }

  private renderRepeat(): void {
    const on = this.repeatSeg.value !== 'nao';
    this.repeatRow.hidden = !on;
    if (!on) return;
    const n = Math.min(KV_MEET_REPEAT_MAX, Math.max(2, Math.round(Number(this.repeatCount.input.value) || 2)));
    const list = kvExpandRepeat(this.start, this.end, { freq: this.repeatSeg.value as KvMeetFreq, count: n });
    const last = list[list.length - 1];
    this.repeatHint.textContent = last ? tr('{0} reuniões, a última em {1}', [list.length, kvDayLong(last.start)]) : '';
  }

  /** A linha do tempo do assistente: eu, os convidados e a sala; o horário escolhido como bloco. */
  private renderAsst(): void {
    const day = this.day;
    const range = kvTimelineRange(day, { start: this.start, end: Math.min(this.end, nextDay(day)) });
    const hours = (range.end - range.start) / HOUR;
    const now = Date.now();
    this.asstHead.replaceChildren(
      kvIconBtn(KV_ICONS.back, tr('Dia anterior'), () => this.setStart(this.start - DAY), { size: 'sm' }),
      h('strong', { text: `${kvDayLabel(day, now)} · ${kvDayLong(day)}` }),
      h('span', { class: 'kv-meet-asst__fwd' }, kvIconBtn(KV_ICONS.back, tr('Dia seguinte'), () => this.setStart(this.start + DAY), { size: 'sm' })),
    );
    const me = kvMeId();
    const lanes: { label: HTMLElement; strip: HTMLElement }[] = [];
    const lane = (person: KvMeetPerson, tag: string) => {
      const busy = this.busyOf(person.id);
      const blocks = (busy ?? []).map((s) => ({ span: s, cls: 'is-busy', title: `${kvSpanText(s)} · ${tr('ocupado')}` }));
      const strip = kvStrip(blocks, range, now, busy ? '' : 'is-unknown');
      if (!busy) strip.title = tr('Sem informação de agenda');
      lanes.push({ label: h('div', { class: 'kv-meet-asst__who', title: person.name }, kvMeetAvatar(person), h('span', { text: tag || person.name })), strip });
    };
    if (me) lane({ id: me, name: personName(me) || tr('Você') }, tr('Você'));
    for (const id of this.people) lane({ id, name: this.names.get(id) ?? id }, '');
    const room = this.room ? kvMeetRoom(this.room) : undefined;
    if (room) {
      const list = this.roomBusy(room.id);
      const strip = kvStrip(kvMeetingBlocks(list, now).map((b) => ({ ...b, cls: `${b.cls} is-room` })), range, now);
      lanes.push({ label: h('div', { class: 'kv-meet-asst__who is-room', title: room.name }, kvLayoutBadge(room.meet.layout), h('span', { text: room.name })), strip });
    } else {
      lanes.push({ label: h('div', { class: 'kv-meet-asst__who is-room' }, pix(MEET_ICON), h('span', { text: tr('Sala') })), strip: h('div', { class: 'kv-meet-strip is-empty', text: tr('Escolha uma sala abaixo') }) });
    }
    this.asstLabels.replaceChildren(h('div', { class: 'kv-meet-asst__who is-ruler' }), ...lanes.map((l) => l.label));
    const sel = h('div', {
      class: 'kv-meet-asst__sel',
      tabIndex: 0,
      role: 'slider',
      title: tr('Arraste para mudar o início (setas: 15 min)'),
      attrs: { 'aria-label': tr('Horário da reunião'), 'aria-valuetext': kvSpanText({ start: this.start, end: this.end }) },
    });
    const pos = kvBlock({ start: this.start, end: this.end }, range);
    if (pos) {
      sel.style.left = `${pos.left * 100}%`;
      sel.style.width = `${pos.width * 100}%`;
    }
    sel.append(h('span', { class: 'kv-meet-asst__sel-text', text: kvSpanText({ start: this.start, end: this.end }) }));
    this.bindDrag(sel, range);
    this.asstTracks.style.width = `${Math.round(hours * HOUR_PX)}px`;
    this.asstTracks.replaceChildren(kvHourRuler(range), ...lanes.map((l) => l.strip), sel);
    this.asstTracks.dataset.from = String(range.start);
    this.asstTracks.dataset.to = String(range.end);
    if (this.scrollPending && pos) {
      this.scrollPending = false;
      requestAnimationFrame(() => {
        const x = pos.left * hours * HOUR_PX;
        const w = this.asstScroll.clientWidth;
        if (x < this.asstScroll.scrollLeft || x + pos.width * hours * HOUR_PX > this.asstScroll.scrollLeft + w) this.asstScroll.scrollLeft = Math.max(0, x - HOUR_PX);
      });
    }
  }

  /** Todos os horários ocupados (eu, convidados, sala) para o clique num vão. */
  private allBusy(): Span[] {
    const out: Span[] = [];
    for (const id of [kvMeId(), ...this.people].filter(Boolean)) out.push(...(this.busyOf(id) ?? []));
    if (this.room) out.push(...this.roomBusy(this.room));
    return out;
  }

  private trackClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('.kv-meet-asst__sel')) return;
    const r = this.asstTracks.getBoundingClientRect();
    const range = { start: Number(this.asstTracks.dataset.from), end: Number(this.asstTracks.dataset.to) };
    const t = kvFracTime((e.clientX - r.left) / r.width, range);
    const s = kvClickSlot(this.allBusy(), t, this.dur, range);
    if (s === null) {
      this.asstTracks.classList.remove('is-nope');
      void this.asstTracks.offsetWidth;
      this.asstTracks.classList.add('is-nope');
      return;
    }
    this.setStart(s);
  }

  private bindDrag(sel: HTMLElement, range: Span): void {
    let x0 = 0;
    let orig = 0;
    let moved = false;
    let dragging = false;
    const text = sel.firstElementChild as HTMLElement | null;
    sel.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sel.setPointerCapture(e.pointerId);
      x0 = e.clientX;
      orig = this.start;
      moved = false;
      dragging = true;
      sel.classList.add('is-drag');
    });
    sel.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 3) moved = true;
      const s = kvDragStart(orig, this.dur, dx, this.asstTracks.getBoundingClientRect().width, range);
      const pos = kvBlock({ start: s, end: s + this.dur }, range);
      if (pos) sel.style.left = `${pos.left * 100}%`;
      if (text) text.textContent = kvSpanText({ start: s, end: s + this.dur });
      sel.dataset.s = String(s);
    });
    const done = () => {
      if (!dragging) return;
      dragging = false;
      sel.classList.remove('is-drag');
      const s = Number(sel.dataset.s);
      if (moved && s && s !== this.start) this.setStart(s);
    };
    sel.addEventListener('pointerup', done);
    sel.addEventListener('pointercancel', done);
    sel.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const s = this.start + (e.key === 'ArrowRight' ? KV_MEET_STEP : -KV_MEET_STEP);
      if (s < range.start || s + this.dur > range.end) return;
      this.setStart(s);
      requestAnimationFrame(() => this.asstTracks.querySelector<HTMLElement>('.kv-meet-asst__sel')?.focus());
    });
  }

  /** Achar sala: as reserváveis, livres primeiro, com o filtro. */
  private renderRooms(): void {
    const s = kvMeetings();
    const cap = Math.max(1, Math.round(Number(this.capInput.input.value) || this.people.length + 1));
    const equip = [...this.equip];
    const slot = { start: this.start, end: this.end };
    const fits = kvRankRooms(s.rooms, this.meetingsOfDay(), slot, { capMin: cap, equip, ignore: this.editId, keep: this.room });
    const total = this.people.length + 1;
    this.roomList.replaceChildren(
      ...fits.map((f) => {
        const r = f.room;
        const on = r.id === this.room;
        const busy = f.busy.length > 0;
        const few = r.meet.capacity < total;
        const status = busy
          ? h('span', { class: 'kv-meet-fr__st is-busy', text: tr('ocupada {0}', [f.busy.map((m) => kvSpanText(m)).join(', ')]) })
          : h('span', { class: 'kv-meet-fr__st is-free', text: tr('livre') });
        return h(
          'li',
          {},
          h(
            'button',
            {
              class: `kv-meet-fr${on ? ' is-on' : ''}${busy ? ' is-busy' : ''}${f.matches ? '' : ' is-off'}`,
              type: 'button',
              role: 'radio',
              style: `--lay:${LAYOUT_COLOR[r.meet.layout]}`,
              attrs: { 'aria-checked': String(on) },
              on: { click: () => this.pickRoom(r) },
            },
            kvLayoutBadge(r.meet.layout, 'md'),
            h(
              'span',
              { class: 'kv-meet-fr__text' },
              h('span', { class: 'kv-meet-fr__top' }, h('strong', { text: r.name }), status),
              h('span', { class: 'kv-meet-fr__meta' }, h('span', { text: layoutName(r.meet.layout) }), h('span', { class: few ? 'is-warn' : '', text: tr('{0} lugares', [r.meet.capacity]) }), r.meet.privateDefault ? pix(LOCK_PIX, 'kv-ui-ico kv-meet-lock') : null),
              r.meet.equipment.length ? kvEquipChips(r.meet.equipment, 5) : null,
            ),
            h('span', { class: 'kv-meet-fr__radio', attrs: { 'aria-hidden': 'true' } }),
          ),
        );
      }),
    );
    if (!s.rooms.some((r) => r.meet.bookable)) this.roomList.append(h('li', {}, kvEmpty(MEET_ICON, tr('Nenhuma sala aceita reservas'), tr('Crie uma sala do tipo Reunião na tela Salas.'))));
    const hidden = kvHiddenByFilter(s.rooms, cap, equip) - (this.room && !fits.find((f) => f.room.id === this.room)?.matches ? 1 : 0);
    this.roomHidden.hidden = hidden <= 0;
    if (hidden > 0) {
      this.roomHidden.replaceChildren(
        h('span', { text: tr('{0} salas escondidas pelo filtro.', [hidden]) }),
        kvBtn(tr('Limpar filtro'), {
          variant: 'ghost',
          size: 'sm',
          onClick: () => {
            this.equip.clear();
            this.equipBox.querySelectorAll<HTMLElement>('[data-eq]').forEach((b) => (b.classList.remove('is-on'), b.setAttribute('aria-pressed', 'false')));
            this.capTouched = true;
            this.capInput.input.value = '1';
            this.renderRooms();
          },
        }),
      );
    }
  }

  private pickRoom(r: KvMeetRoomView): void {
    if (this.room !== r.id) this.priv.checked = r.meet.privateDefault;
    this.room = r.id;
    this.conflictBox.hidden = true;
    this.error.textContent = '';
    this.render();
  }

  // ------------------------------------------------------------------ salvar

  private async save(skipConflicts = false): Promise<void> {
    if (this.busySaving) return;
    this.error.textContent = '';
    const title = this.title.input.value.trim();
    if (!title) {
      this.error.textContent = tr('Dê um título à reunião.');
      this.title.input.focus();
      return;
    }
    if (!this.room) {
      this.error.textContent = tr('Escolha uma sala em “Achar sala”.');
      this.roomsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (this.end <= Date.now() && !this.editId) {
      this.error.textContent = tr('Esse horário já passou: escolha outro.');
      return;
    }
    const freq = this.repeatSeg.value;
    const count = Math.min(KV_MEET_REPEAT_MAX, Math.max(2, Math.round(Number(this.repeatCount.input.value) || 2)));
    const note = this.note.value.trim();
    let r: KvMeetResult;
    this.busySaving = true;
    this.saveBtn.disabled = true;
    if (this.editId) {
      r = await kvMeetRequest('POST', `/${encodeURIComponent(this.editId)}`, {
        title,
        start: this.start,
        end: this.end,
        people: this.people,
        private: this.priv.checked,
        note,
        room: this.room,
        ...(this.seriesTg.checked && !this.seriesTg.el.hidden ? { series: true } : {}),
      });
    } else {
      r = await kvMeetRequest('POST', '', {
        room: this.room,
        title,
        start: this.start,
        end: this.end,
        people: this.people,
        private: this.priv.checked,
        ...(note ? { note } : {}),
        ...(freq !== 'nao' ? { repeat: { freq, count } } : {}),
        ...(skipConflicts ? { skipConflicts: true } : {}),
      });
    }
    this.busySaving = false;
    this.saveBtn.disabled = false;
    if (r.ok) {
      const warnings = Array.isArray(r.body.warnings) ? (r.body.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : [];
      for (const w of warnings) kvToast(w, { kind: 'warn', ms: 8000 });
      const skipped = Array.isArray(r.body.skipped) ? r.body.skipped.length : 0;
      const made = Array.isArray(r.body.meetings) ? r.body.meetings.length : 1;
      if (this.editId) kvToast(tr('Reunião salva.'), { kind: 'ok' });
      else if (skipped) kvToast(tr('{0} reuniões marcadas; {1} horários ocupados ficaram de fora.', [made, skipped]), { kind: 'ok', ms: 8000 });
      else kvToast(made > 1 ? tr('{0} reuniões marcadas.', [made]) : tr('Reunião marcada.'), { kind: 'ok' });
      this.reset({});
      this.hooks.saved();
      return;
    }
    if (r.status === 409) {
      const conflicts = Array.isArray(r.body.conflicts) ? (r.body.conflicts as { start: number; end: number; title?: string }[]) : [];
      this.showConflicts(conflicts, freq !== 'nao' && !this.editId ? count : 1, r.error);
      return;
    }
    this.error.textContent = r.error || tr('Não deu para salvar.');
  }

  /** O horário bate com outra reserva: mostra quais e oferece saídas. */
  private showConflicts(list: { start: number; end: number; title?: string }[], count: number, msg: string): void {
    const now = Date.now();
    const repeat = count > 1;
    const busy = this.roomBusy(this.room);
    const next = kvNextFree([...busy, ...this.allBusy()], Math.max(this.start, now), this.dur, nextDay(this.day));
    const items = list.slice(0, 6).map((c) => h('li', { text: `${kvDayLabel(dayStartOf(c.start), now)} · ${kvSpanText(c)}${c.title ? ` · ${c.title}` : ''}` }));
    if (list.length > 6) items.push(h('li', { text: tr('e mais {0}', [list.length - 6]) }));
    const actions = h(
      'div',
      { class: 'kv-meet-conflict__actions' },
      repeat && list.length < count ? kvBtn(tr('Marcar só os livres ({0})', [count - list.length]), { variant: 'primary', size: 'sm', icon: KV_ICONS.check, onClick: () => void this.save(true) }) : null,
      next !== null ? kvBtn(tr('Próximo horário livre: {0}', [kvHour(next)]), { size: 'sm', icon: CLOCK_PIX, onClick: () => this.setStart(next) }) : null,
      kvBtn(tr('Achar outra sala'), {
        size: 'sm',
        variant: 'ghost',
        icon: KV_ICONS.search,
        onClick: () => {
          this.conflictBox.hidden = true;
          this.roomsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          this.roomsSec.classList.remove('is-flash');
          void this.roomsSec.offsetWidth;
          this.roomsSec.classList.add('is-flash');
        },
      }),
    );
    this.conflictBox.replaceChildren(
      h('div', { class: 'kv-meet-conflict__head' }, pix(KV_ICONS.alert, 'kv-ui-ico kv-meet-conflict__ico'), h('strong', { text: repeat ? tr('{0} de {1} horários batem com outra reserva da sala', [list.length, count]) : tr('Esse horário bate com outra reserva da sala') })),
      ...(msg && !list.length ? [h('p', { text: msg })] : []),
      ...(list.length ? [h('ul', { class: 'kv-meet-conflict__list' }, ...items)] : []),
      actions,
    );
    this.conflictBox.hidden = false;
    this.conflictBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/** Nome de uma pessoa (lista de quem dá para convidar). */
function personName(id: string): string {
  return kvMeetings().people?.find((p) => p.id === id)?.name ?? '';
}
