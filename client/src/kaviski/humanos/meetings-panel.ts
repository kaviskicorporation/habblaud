// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): o painel da porta de uma sala de reunião (como o
// tablet do Teams Rooms ao lado da porta): faixa grande LIVRE (verde) / OCUPADA (vermelha, até quando) / "Começa às…"
// (âmbar), a reunião de agora (título, ou "Reunião privada" para quem não é dela), as próximas de hoje numa linha do
// tempo e as ações do momento: Usar agora (15/30/60 min, privada ou não), Fazer check-in, Mais 15 min, Encerrar agora,
// Marcar outro horário e Ir até a sala. Atualiza ao vivo (kvOnMeetings e um relógio de 20 s).
import { KV_MEET_EARLY_MS, KV_MEET_QUICK_MIN, type KvMeetingView } from '../../../../shared/kaviski-meetings';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvHour } from './agenda';
import { kvMeetings, kvMeetLabel, kvMeetRequest, kvMeetRoom, kvOnMeetings, kvReloadMeetings } from './meetings-api';
import { kvOpenMeetings } from './meetings-dialog';
import { dayStartOf, MIN, kvQuickMax, kvRoomNow, kvTimelineRange, nextDay } from './meetings-model';
import { CLOCK_PIX, kvAvatarRow, kvEquipChips, kvHourRuler, kvMeetingBlocks, kvSpanText, kvStrip, LAYOUT_COLOR, LAYOUT_PIX, layoutName, LOCK_PIX, MEET_ICON, pix } from './meetings-ui';
import { kvGoArea } from './walk';
import { KV_ICONS, kvBtn, kvEmpty, kvTitle, kvToggle, type KvToggle } from './ui/kit';
import { KvModal, kvConfirm } from './ui/modal';
import { kvToast } from './ui/toast';

let current: RoomPanel | null = null;

/** Abre o painel da porta da sala (fecha o que estiver aberto). */
export function kvOpenRoomPanel(roomId: string): void {
  current?.close();
  current = new RoomPanel(roomId);
}

class RoomPanel {
  private readonly modal: KvModal;
  private readonly priv: KvToggle;
  private readonly unsub: () => void;
  private readonly tick: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(private readonly roomId: string) {
    const room = kvMeetRoom(roomId);
    this.modal = new KvModal({
      title: room?.name ?? tr('Sala'),
      subtitle: room ? layoutName(room.meet.layout) : '',
      icon: room ? LAYOUT_PIX[room.meet.layout] : MEET_ICON,
      width: 580,
      cls: 'kv-meet-panel',
      onClose: () => {
        this.unsub();
        clearInterval(this.tick);
        this.modal.el.remove();
        if (current === this) current = null;
      },
    });
    this.priv = kvToggle(tr('Privada'), { checked: !!room?.meet.privateDefault, hint: tr('Ninguém de fora entra, vê ou ouve.') });
    this.unsub = kvOnMeetings(() => this.render());
    this.tick = setInterval(() => this.render(), 20_000);
    this.render();
    this.modal.show();
    void kvReloadMeetings();
  }

  close(): void {
    this.modal.close();
  }

  private render(): void {
    const s = kvMeetings();
    const room = kvMeetRoom(this.roomId);
    const now = Date.now();
    if (!room) {
      this.modal.body.replaceChildren(kvEmpty(MEET_ICON, tr('Sala sem agenda'), tr('Esta sala não aceita reservas, ou você não a vê.')));
      this.modal.setFoot(kvBtn(tr('Fechar'), { onClick: () => this.close() }));
      return;
    }
    this.modal.setTitle(room.name, `${layoutName(room.meet.layout)} · ${tr('{0} lugares', [room.meet.capacity])}`);
    this.modal.el.style.setProperty('--lay', LAYOUT_COLOR[room.meet.layout]);
    const st = kvRoomNow(room.id, s.meetings, now);
    const day = dayStartOf(now);
    const today = s.meetings.filter((m) => m.room === room.id && !m.released && m.end > day && m.start < nextDay(day)).sort((a, b) => a.start - b.start);

    // ---- a faixa grande
    let big: string;
    let sub: string;
    if (st.kind === 'ocupada') {
      big = tr('Ocupada');
      sub = tr('até {0}', [kvHour(st.until!)]);
    } else if (st.kind === 'breve') {
      big = tr('Começa às {0}', [kvHour(st.next!.start)]);
      sub = tr('em {0} min', [Math.max(1, Math.round((st.next!.start - now) / MIN))]);
    } else {
      big = tr('Livre');
      sub = st.next && st.next.start < nextDay(day) ? tr('até {0}', [kvHour(st.next.start)]) : tr('o resto do dia');
    }
    const band = h(
      'div',
      { class: `kv-meet-band is-${st.kind}`, role: 'status' },
      h('span', { class: 'kv-meet-band__big', text: big }),
      h('span', { class: 'kv-meet-band__sub', text: sub }),
      h('span', { class: 'kv-meet-band__clock', text: kvHour(now) }),
    );

    // ---- a reunião de agora (ou a que vai começar)
    const focus = st.cur ?? (st.kind === 'breve' ? st.next : undefined);
    const focusEl = focus ? this.meetingBox(focus, now) : null;

    // ---- hoje
    const range = kvTimelineRange(day);
    const upcoming = today.filter((m) => m.end > now && m !== focus);
    const tl = h(
      'section',
      { class: 'kv-meet-panel__today' },
      kvTitle('h3', tr('Hoje nesta sala'), 'kv-meet-panel__h'),
      h('div', { class: 'kv-meet-room__tl' }, kvHourRuler(range, 2), kvStrip(kvMeetingBlocks(today, now), range, now, 'kv-meet-strip--room')),
      upcoming.length
        ? h(
            'ul',
            { class: 'kv-meet-panel__next' },
            ...upcoming.map((m) =>
              h(
                'li',
                { class: m.mine ? 'is-mine' : '' },
                h('span', { class: 'kv-meet-panel__when', text: kvSpanText(m) }),
                m.private ? pix(LOCK_PIX, 'kv-ui-ico kv-meet-lock') : null,
                h('span', { class: 'kv-meet-panel__what', text: kvMeetLabel(m) }),
                m.mine ? h('span', { class: 'kv-ui-state kv-ui-state--ok', text: tr('sua') }) : null,
              ),
            ),
          )
        : h('p', { class: 'kv-meet-panel__none', text: tr('Nada mais marcado hoje.') }),
    );

    // ---- ações
    const acts: HTMLElement[] = [];
    const bookable = s.canBook && room.meet.bookable;
    if (bookable && st.kind !== 'ocupada') {
      const max = kvQuickMax(room.id, s.meetings, now);
      const chips = KV_MEET_QUICK_MIN.map((min) => {
        const b = kvBtn(tr('{0} min', [min]), { variant: 'primary', size: 'sm', onClick: () => void this.useNow(min) });
        if (min > max) {
          b.disabled = true;
          b.title = tr('Não cabe antes da próxima reserva');
        }
        return b;
      });
      acts.push(
        h(
          'section',
          { class: 'kv-meet-panel__quick' },
          h('div', { class: 'kv-meet-panel__quick-head' }, pix(CLOCK_PIX), h('strong', { text: tr('Usar agora') }), max !== Infinity ? h('span', { text: tr('cabe até {0} min', [max]) }) : null),
          h('div', { class: 'kv-meet-panel__quick-row' }, ...chips),
          this.priv.el,
        ),
      );
    }
    const row: HTMLElement[] = [];
    const checkTarget = st.cur?.mine && !st.cur.checkin ? st.cur : st.next?.mine && !st.next.checkin && st.next.start - now <= KV_MEET_EARLY_MS ? st.next : undefined;
    if (checkTarget) row.push(kvBtn(tr('Fazer check-in'), { variant: 'primary', icon: KV_ICONS.check, onClick: () => void this.act(`/${encodeURIComponent(checkTarget.id)}/checkin`, undefined, tr('Check-in feito.')) }));
    if (st.cur?.mine) {
      const cur = st.cur;
      row.push(kvBtn(tr('Mais 15 min'), { icon: KV_ICONS.plus, onClick: () => void this.act(`/${encodeURIComponent(cur.id)}/extend`, { minutes: 15 }, tr('Reunião estendida até {0}.', [kvHour(cur.end + 15 * MIN)])) }));
      row.push(
        kvBtn(tr('Encerrar agora'), {
          variant: 'danger',
          icon: KV_ICONS.close,
          onClick: () =>
            void kvConfirm({ title: tr('Encerrar a reunião agora?'), text: tr('A sala fica livre para outras pessoas.'), ok: tr('Encerrar'), danger: true }).then((ok) => (ok ? this.act(`/${encodeURIComponent(cur.id)}/end`, undefined, tr('Reunião encerrada: a sala está livre.')) : undefined)),
        }),
      );
    }
    if (row.length) acts.push(h('div', { class: 'kv-meet-panel__row' }, ...row));

    this.modal.body.replaceChildren(band, ...(focusEl ? [focusEl] : []), ...acts, room.meet.equipment.length ? kvEquipChips(room.meet.equipment) : h('span'), tl);
    this.modal.setFoot(
      kvBtn(tr('Ir até a sala'), {
        variant: 'ghost',
        icon: KV_ICONS.walk,
        onClick: () => (kvGoArea(`r:${room.id}`) ? this.close() : kvToast(tr('Não deu para ir até a sala daqui (entre no escritório primeiro).'), { kind: 'warn' })),
      }),
      bookable ? kvBtn(tr('Marcar outro horário'), { icon: KV_ICONS.plus, onClick: () => (this.close(), kvOpenMeetings({ tab: 'marcar', room: room.id })) }) : null,
    );
  }

  private meetingBox(m: KvMeetingView, now: number): HTMLElement {
    const people = [...(m.by ? [m.by] : []), ...(m.people ?? [])];
    const live = m.start <= now;
    return h(
      'div',
      { class: `kv-meet-panel__cur${m.mine ? ' is-mine' : ''}` },
      h('div', { class: 'kv-meet-panel__cur-top' }, m.private ? pix(LOCK_PIX, 'kv-ui-ico kv-meet-lock') : null, h('strong', { text: kvMeetLabel(m) })),
      h(
        'div',
        { class: 'kv-meet-panel__cur-meta' },
        h('span', { text: kvSpanText(m) }),
        m.by ? h('span', { text: tr('Organizada por {0}', [m.by.name]) }) : null,
        live && m.checkin ? h('span', { class: 'kv-ui-state kv-ui-state--ok', text: tr('check-in feito') }) : null,
        live && !m.checkin ? h('span', { class: 'kv-ui-state kv-ui-state--warn', text: tr('sem check-in') }) : null,
      ),
      people.length ? kvAvatarRow(people, 8) : null,
    );
  }

  private async useNow(minutes: number): Promise<void> {
    await this.act('/now', { room: this.roomId, minutes, private: this.priv.checked }, tr('Sala reservada por {0} min.', [minutes]));
  }

  private async act(path: string, body: unknown, ok: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const r = await kvMeetRequest('POST', path, body ?? {});
    this.busy = false;
    if (r.ok) kvToast(ok, { kind: 'ok' });
    else kvToast(r.status === 409 ? tr('Não cabe: há outra reserva logo em seguida.') : r.error || tr('Não deu certo.'), { kind: 'error' });
    this.render();
  }
}
