// Fork Kaviski (KAVISKI-HUMANOS.md): a minha agenda (Google Agenda, Outlook, iCloud... pelo endereço secreto iCal).
// - Botão do topo (calendário) → janela "Minha agenda": reuniões de hoje (com "Ir para a reunião" quando o local cita
//   uma sala do escritório) e o campo para colar o endereço (fica só no servidor; a página só vê o começo dele).
// - A cada minuto pergunta ao servidor (que relê o ICS a cada 5 min): durante uma reunião "ocupada" o status vira
//   "📅 Em reunião até 15h" (fonte agenda; o manual vence); 1 min antes de uma reunião com sala, um aviso com o botão.
// - Reservas de sala (de todas as agendas, sem título nem dono): o mini-mapa e a dica da sala mostram "Reunião às 15h".
import type { KvAgendaEventOut, KvAgendaState, KvRoomBooking } from '../../../../shared/kaviski-agenda';
import { getLocale, tr } from '../../../../shared/i18n';
import { h, iconButton } from '../../ui/dom';
import { ICONS, pixelIcon } from '../../ui/icons';
import { kvAutoClear, kvAutoSet } from './auto-status';
import { kvTopButton } from './topbar';
import { kvGoArea } from './walk';

const API = '/api/kaviski/humanos/agenda';
const POLL_MS = 60_000;
const ROOMS_POLL_MS = 120_000;
const REMIND_MS = 60_000;

const CAL_ICON = pixelIcon(['.#....#.', '########', '#......#', '#.#.#.##', '#......#', '#.#.#..#', '#......#', '########']);

/** Hora curta: "15h" / "15h30" em português, a do idioma nos outros. */
export function kvHour(t: number): string {
  const d = new Date(t);
  if (getLocale().startsWith('pt')) return `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

let bookings: KvRoomBooking[] = [];

/** Reunião agora ou nas próximas 3 h nesta sala (texto curto), para o mini-mapa e a dica da sala. */
export function kvRoomMeeting(roomId: string, now = Date.now()): string | null {
  const b = bookings.find((x) => x.roomId === roomId && x.end > now && x.start < now + 3 * 3600_000);
  if (!b) return null;
  return b.start <= now ? tr('Em reunião até {0}', [kvHour(b.end)]) : tr('Reunião às {0} nesta sala', [kvHour(b.start)]);
}

async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T & { error?: string } };
}

class AgendaDialog {
  readonly el: HTMLDialogElement;
  private readonly today: HTMLElement;
  private readonly status: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly off: HTMLButtonElement;
  private readonly save: HTMLButtonElement;

  constructor(private readonly onSaved: (s: KvAgendaState) => void) {
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    this.today = h('ul', { class: 'kv-agenda__list' });
    this.status = h('p', { class: 'kv-people__hint kv-agenda__status' });
    this.input = h('input', { class: 'kv-people__input', type: 'url', attrs: { autocomplete: 'off', spellcheck: 'false', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', 'aria-label': tr('Endereço secreto no formato iCal') } });
    this.error = h('p', { class: 'kv-people__error', attrs: { role: 'alert' } });
    this.save = h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: tr('Ligar a agenda') });
    this.off = h('button', { class: 'ui-btn', type: 'button', text: tr('Desligar'), on: { click: () => void this.send('') } });
    const form = h(
      'form',
      { class: 'kv-people__form', on: { submit: (e: Event) => (e.preventDefault(), void this.send(this.input.value)) } },
      h('h3', { text: tr('Ligar a minha agenda') }),
      this.status,
      h('label', { class: 'kv-people__label', text: tr('Endereço secreto no formato iCal') }),
      this.input,
      h(
        'ul',
        { class: 'kv-agenda__how' },
        h('li', { text: tr('Google Agenda: Configurações → a sua agenda → “Integrar agenda” → “Endereço secreto no formato iCal”.') }),
        h('li', { text: tr('Outlook: Configurações → Agenda → Agendas compartilhadas → Publicar uma agenda → link ICS.') }),
        h('li', { text: tr('iCloud: compartilhar a agenda como “Agenda pública” e copiar o link (webcal://).') }),
        h('li', { text: tr('O endereço fica guardado só no servidor do escritório: ninguém mais vê, nem você depois de salvar. Para trocar, cole outro.') }),
      ),
      this.error,
      h('div', { class: 'kv-people__actions' }, this.off, this.save),
    );
    this.el = h(
      'dialog',
      { class: 'ui-dialog kv-people kv-agenda', attrs: { 'aria-labelledby': 'kv-agenda-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Minha agenda'), attrs: { id: 'kv-agenda-title' } }), close),
      h('div', { class: 'ui-dialog__body kv-people__body' }, h('section', {}, h('h3', { text: tr('Reuniões de hoje') }), this.today), h('section', {}, form)),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    (document.querySelector('.ui-root') ?? document.body).append(this.el);
  }

  open(state: KvAgendaState | null): void {
    this.error.textContent = '';
    this.render(state);
    if (!this.el.open) this.el.showModal();
  }

  render(state: KvAgendaState | null): void {
    if (!state) {
      this.status.textContent = tr('Carregando…');
      return;
    }
    const age = state.fetchedAt ? Math.max(0, Math.round((Date.now() - state.fetchedAt) / 60_000)) : null;
    this.status.textContent = state.configured
      ? [tr('Ligada: {0}', [state.hint ?? '?']), age === null ? '' : age < 1 ? tr('atualizada agora') : tr('atualizada há {0} min', [age]), state.error ? tr('erro: {0}', [state.error]) : ''].filter(Boolean).join(' · ')
      : tr('Nenhuma agenda ligada.');
    this.status.classList.toggle('is-error', !!state.error);
    this.off.hidden = !state.configured;
    this.save.textContent = state.configured ? tr('Trocar o endereço') : tr('Ligar a agenda');
    const now = Date.now();
    const list = state.events.filter((e) => sameDay(e.start, now) || (e.start < now && e.end > now)).sort((a, b) => a.start - b.start);
    this.today.replaceChildren(...list.map((e) => this.item(e, now)));
    if (!list.length) this.today.append(h('li', { class: 'kv-people__hint', text: state.configured ? tr('Nada na agenda hoje.') : tr('Ligue a agenda ao lado para ver as reuniões daqui.') }));
  }

  private item(e: KvAgendaEventOut, now: number): HTMLElement {
    const when = e.allDay ? tr('dia inteiro') : `${kvHour(e.start)}–${kvHour(e.end)}`;
    const live = !e.allDay && e.start <= now && e.end > now;
    const go = e.room
      ? h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Ir para a reunião'), on: { click: () => (kvGoArea(e.room!.area), this.el.close()) } })
      : null;
    return h(
      'li',
      { class: `kv-agenda__item${e.end <= now ? ' is-past' : ''}${live ? ' is-live' : ''}` },
      h('span', { class: 'kv-agenda__when', text: when }),
      h(
        'span',
        { class: 'kv-agenda__what' },
        h('strong', { text: e.title || tr('(sem título)') }),
        e.room ? h('span', { class: 'kv-agenda__room', text: `📍 ${e.room.name}` }) : e.location ? h('span', { class: 'kv-people__meta', text: e.location }) : null,
        !e.busy ? h('span', { class: 'kv-people__meta', text: tr('livre') }) : null,
      ),
      go,
    );
  }

  private async send(url: string): Promise<void> {
    this.error.textContent = '';
    this.save.disabled = true;
    this.off.disabled = true;
    try {
      const r = await getJson<KvAgendaState>(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) });
      if (!r.ok) {
        this.error.textContent = r.data.error ?? tr('Não deu para salvar.');
        return;
      }
      this.input.value = '';
      this.render(r.data);
      this.onSaved(r.data);
    } catch {
      this.error.textContent = tr('Sem conexão com o Habblaud.');
    } finally {
      this.save.disabled = false;
      this.off.disabled = false;
    }
  }
}

/** Aviso flutuante de reunião chegando (com "Ir para a reunião"). */
function remind(e: KvAgendaEventOut): void {
  const box = h(
    'div',
    { class: 'kv-toast', role: 'status' },
    h('span', { class: 'kv-toast__icon', text: '📅' }),
    h('span', { class: 'kv-toast__text', text: tr('Reunião às {0}: {1}', [kvHour(e.start), e.title || tr('(sem título)')]) }),
  );
  const close = () => box.remove();
  if (e.room) box.append(h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('Ir para a reunião'), on: { click: () => (kvGoArea(e.room!.area), close()) } }));
  box.append(iconButton(ICONS.close, tr('Fechar'), close, 'ui-icon-btn--sm'));
  (document.querySelector('.ui-root') ?? document.body).append(box);
  setTimeout(close, 5 * 60_000);
}

/** Liga a agenda da página: botão, status automático, avisos e reservas das salas. */
export function kvStartAgenda(opts: { mine: boolean; root?: ParentNode }): void {
  let state: KvAgendaState | null = null;
  let dialog: AgendaDialog | null = null;
  const reminded = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const apply = (s: KvAgendaState) => {
    state = s;
    dialog?.render(s);
    const now = Date.now();
    const cur = s.events.filter((e) => !e.allDay && e.busy && e.start <= now && e.end > now).sort((a, b) => b.end - a.end)[0];
    if (cur) kvAutoSet('agenda', { status: 'ocupado', note: `📅 ${tr('Em reunião até {0}', [kvHour(cur.end)])}`, until: cur.end });
    else kvAutoClear('agenda');
    for (const e of s.events) {
      if (e.allDay || !e.busy) continue;
      const key = `${e.start}|${e.title}`;
      const wait = e.start - REMIND_MS - now;
      if (reminded.has(key) || timers.has(key) || e.start <= now || wait > POLL_MS * 2) continue;
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        reminded.add(key);
        remind(e);
      }, Math.max(0, wait)));
    }
    btn?.classList.toggle('is-on', !!cur);
  };

  const poll = async () => {
    if (!opts.mine) return;
    try {
      const r = await getJson<KvAgendaState>(API);
      if (r.ok) apply(r.data);
    } catch {
      // sem conexão: tenta no próximo minuto
    }
  };
  const pollRooms = async () => {
    try {
      const r = await getJson<{ bookings?: KvRoomBooking[] }>(`${API}/rooms`);
      if (r.ok) bookings = r.data.bookings ?? [];
    } catch {
      // idem
    }
  };

  const btn = opts.mine
    ? kvTopButton(
        CAL_ICON,
        tr('Minha agenda: reuniões de hoje'),
        () => {
          dialog ??= new AgendaDialog((s) => apply(s));
          dialog.open(state);
          void poll();
        },
        'kv-btn-agenda',
        25,
        opts.root,
      )
    : null;
  btn?.setAttribute('aria-haspopup', 'dialog');
  void poll();
  void pollRooms();
  setInterval(() => void poll(), POLL_MS);
  setInterval(() => void pollRooms(), ROOMS_POLL_MS);
}
