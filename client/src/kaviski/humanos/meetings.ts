// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): as reuniões no escritório desta página.
// - Botão Reuniões no topo (janela de meetings-dialog.ts: minhas reuniões, marcar, salas).
// - Na porta de cada sala de reunião, a plaquinha como a do Teams Rooms: LIVRE (verde), OCUPADA até… (vermelho) ou
//   "começa às…" (âmbar). Clicar nela (ou E perto da porta) abre o painel da sala (meetings-panel.ts).
// - Sala privada (reunião privada ou sala trancada e coberta) de que eu não faço parte: coberta com persianas e o aviso
//   "Reunião privada · até 15h" — o servidor já não manda quem está dentro, nem voz, conversa ou quadro.
// - Minha reunião acontecendo: status "📅 Em reunião até 15h" (fonte `reuniao`; o manual vence). 1 min antes: aviso com
//   "Ir para a sala" (som, notificação do sistema e aviso na página: `kvAlert`, tipo "reunioes").
import type { KvMe } from '../../../../shared/kaviski-humanos';
import type { KvLockInfo } from '../../../../shared/kaviski-social';
import type { KvMeetingView } from '../../../../shared/kaviski-meetings';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { TILE } from '../../world/constants';
import type { Sim } from '../../world/sim/sim';
import { kvRegisterAction, kvPlanWorld } from '../plan/api';
import { kvHour } from './agenda';
import { kvAlert } from './alerts';
import { kvAutoClear, kvAutoSet } from './auto-status';
import { kvRegisterInteract } from './interact';
import { kvMeetingNow, kvMeetings, kvMeetLabel, kvMeetRoom, kvMyMeetings, kvNextMeeting, kvOnMeetings, kvStartMeetingsStore } from './meetings-api';
import { kvOpenMeetings, MEET_ICON } from './meetings-dialog';
import { kvOpenRoomPanel } from './meetings-panel';
import { kvEachFrame } from './overlay';
import type { KvPresenceClient } from './presence';
import { kvTopButton } from './topbar';
import { kvGoArea } from './walk';
import { kvPeople } from './world';
import './meetings-world.css';

/** Até esta distância (tiles) da porta, E abre o painel da sala. */
const PANEL_TILES = 2.6;
/** Avisar este tempo antes de uma reunião minha. */
const REMIND_MS = 60_000;
/** Abaixo deste zoom a plaquinha da porta vira só a bolinha. */
const BADGE_TEXT_ZOOM = 1.6;
const BADGE_MIN_ZOOM = 0.7;

type Rect = { x: number; y: number; w: number; h: number };

function sim(): Sim | null {
  try {
    return kvPeople.sim?.() ?? null;
  } catch {
    return null;
  }
}

/** Retângulo e porta da sala no prédio desta página (tiles). */
function geom(s: Sim, id: string): { rect: Rect; door: Rect | null } | null {
  const room = s.rooms.get(id);
  if (!room || !room.present || room.ghost) return null;
  return { rect: room.layout.rect, door: room.layout.door ?? null };
}

function screen(x: number, y: number): { sx: number; sy: number; zoom: number } | null {
  return kvPeople.toScreen?.(x, y) ?? null;
}

/** Estado da sala para a plaquinha. */
function roomState(id: string, now: number): { tone: 'free' | 'busy' | 'soon'; text: string; title: string } {
  const cur = kvMeetingNow(id, now);
  if (cur) return { tone: 'busy', text: tr('até {0}', [kvHour(cur.end)]), title: tr('Ocupada até {0}: {1}', [kvHour(cur.end), kvMeetLabel(cur)]) };
  const next = kvNextMeeting(id, now);
  if (next && next.start - now < 30 * 60_000) return { tone: 'soon', text: kvHour(next.start), title: tr('Livre até {0} ({1})', [kvHour(next.start), kvMeetLabel(next)]) };
  return { tone: 'free', text: tr('Livre'), title: next && next.start - now < 12 * 3600_000 ? tr('Livre até {0}', [kvHour(next.start)]) : tr('Livre agora') };
}

class MeetingsWorld {
  private readonly layer: HTMLElement;
  private readonly badges = new Map<string, HTMLButtonElement>();
  private readonly veils = new Map<string, HTMLElement>();
  private locks: KvLockInfo[] = [];
  private readonly reminded = new Set<string>();

  constructor(private readonly client: KvPresenceClient) {
    this.layer = h('div', { class: 'kv-meet-layer', attrs: { 'aria-hidden': 'false' } });
    document.body.append(this.layer);
    client.on((s) => {
      this.locks = s.locks ?? [];
      this.syncVeils();
    });
    kvOnMeetings(() => {
      this.syncBadges();
      this.status();
    });
    kvEachFrame(() => this.place());
    kvRegisterInteract((me) => this.panelTarget(me));
    setInterval(() => {
      this.syncBadges();
      this.status();
      this.remind();
    }, 15_000);
  }

  // ---------------------------------------------------------------- plaquinha da porta

  private syncBadges(): void {
    const now = Date.now();
    const want = new Set(kvMeetings().rooms.filter((r) => r.meet.bookable).map((r) => r.id));
    for (const [id, el] of this.badges) {
      if (!want.has(id)) {
        el.remove();
        this.badges.delete(id);
      }
    }
    for (const id of want) {
      let el = this.badges.get(id);
      if (!el) {
        el = h('button', { class: 'kv-meet-door', type: 'button', on: { click: (e) => (e.stopPropagation(), kvOpenRoomPanel(id)) } }, h('span', { class: 'kv-meet-door__led' }), h('span', { class: 'kv-meet-door__text' })) as HTMLButtonElement;
        this.layer.append(el);
        this.badges.set(id, el);
      }
      const st = roomState(id, now);
      el.dataset.tone = st.tone;
      (el.lastElementChild as HTMLElement).textContent = st.text;
      const name = kvMeetRoom(id)?.name ?? '';
      el.title = `${name} · ${st.title}`;
      el.setAttribute('aria-label', el.title);
    }
  }

  // ---------------------------------------------------------------- sala coberta (privada)

  private syncVeils(): void {
    const want = new Map(this.locks.filter((l) => l.veil && l.area.startsWith('r:')).map((l) => [l.area.slice(2), l]));
    for (const [id, el] of this.veils) {
      if (!want.has(id)) {
        el.remove();
        this.veils.delete(id);
      }
    }
    for (const [id, l] of want) {
      let el = this.veils.get(id);
      if (!el) {
        el = h('div', { class: 'kv-meet-veil' }, h('span', { class: 'kv-meet-veil__label' }));
        this.layer.prepend(el);
        this.veils.set(id, el);
      }
      el.classList.toggle('is-in', l.in);
      const until = l.until ? tr('até {0}', [kvHour(l.until)]) : '';
      const label = l.in
        ? [`🔒 ${l.meeting ? tr('Reunião privada') : tr('Sala privada')}`, l.title ?? '', tr('só a lista vê e ouve')].filter(Boolean).join(' · ')
        : [`🔒 ${l.meeting ? tr('Reunião privada') : tr('Sala privada')}`, until].filter(Boolean).join(' · ');
      (el.firstElementChild as HTMLElement).textContent = label;
    }
  }

  // ---------------------------------------------------------------- posição a cada quadro

  private place(): void {
    const s = (this.badges.size || this.veils.size) && kvPeople.client ? sim() : null;
    for (const [id, el] of this.badges) {
      const g = s ? geom(s, id) : null;
      const d = g?.door;
      // a plaquinha fica na parede, ao lado da porta, do lado de fora (a porta pode estar em qualquer parede)
      const at = d ? screen((d.x + d.w + 0.15) * TILE, (d.y + d.h / 2) * TILE) : null;
      const show = !!at && at.zoom >= BADGE_MIN_ZOOM && !this.veiledFor(id);
      el.hidden = !show;
      if (!show || !at) continue;
      el.classList.toggle('is-mini', at.zoom < BADGE_TEXT_ZOOM);
      el.style.setProperty('--z', String(Math.max(0.7, Math.min(1.6, at.zoom / 2.2))));
      el.style.transform = `translate(${Math.round(at.sx)}px, ${Math.round(at.sy)}px) translate(0, -50%) scale(var(--z))`;
    }
    for (const [id, el] of this.veils) {
      const g = s ? geom(s, id) : null;
      const a = g ? screen(g.rect.x * TILE, g.rect.y * TILE) : null;
      const b = g ? screen((g.rect.x + g.rect.w) * TILE, (g.rect.y + g.rect.h) * TILE) : null;
      el.hidden = !a || !b || !kvPeople.inside;
      if (!a || !b) continue;
      el.style.transform = `translate(${Math.round(a.sx)}px, ${Math.round(a.sy)}px)`;
      el.style.width = `${Math.max(0, Math.round(b.sx - a.sx))}px`;
      el.style.height = `${Math.max(0, Math.round(b.sy - a.sy))}px`;
      el.style.setProperty('--z', String(a.zoom));
    }
  }

  /** A sala está coberta para mim (privada e eu fora da lista). */
  private veiledFor(id: string): boolean {
    return this.locks.some((l) => l.area === `r:${id}` && l.veil && !l.in);
  }

  // ---------------------------------------------------------------- E perto da porta

  private panelTarget(me: { x: number; y: number }) {
    const s = sim();
    if (!s) return null;
    let best: { id: string; dist: number } | null = null;
    for (const r of kvMeetings().rooms) {
      if (!r.meet.bookable || this.veiledFor(r.id)) continue; // coberta: a tecla E é "Bater na porta" (locks.ts)
      const d = geom(s, r.id)?.door;
      if (!d) continue;
      const dist = Math.hypot((d.x + d.w / 2) * TILE - me.x, (d.y + d.h / 2) * TILE - me.y);
      if (dist <= PANEL_TILES * TILE && (!best || dist < best.dist)) best = { id: r.id, dist };
    }
    if (!best) return null;
    const id = best.id;
    return { id: `meet-panel:${id}`, label: tr('Agenda da sala'), dist: best.dist + 2, run: () => kvOpenRoomPanel(id) };
  }

  // ---------------------------------------------------------------- status e avisos

  private status(): void {
    const now = Date.now();
    const cur = kvMyMeetings(now).filter((m) => m.start <= now).sort((a, b) => b.end - a.end)[0];
    if (cur) kvAutoSet('reuniao', { status: 'ocupado', note: `📅 ${tr('Em reunião até {0}', [kvHour(cur.end)])}`, until: cur.end });
    else kvAutoClear('reuniao');
  }

  private remind(): void {
    const now = Date.now();
    for (const m of kvMyMeetings(now)) {
      if (this.reminded.has(m.id) || m.start - now > REMIND_MS || m.start <= now - 60_000) continue;
      this.reminded.add(m.id);
      this.toast(m);
    }
  }

  private toast(m: KvMeetingView): void {
    const room = kvMeetRoom(m.room)?.name ?? '';
    kvAlert({
      kind: 'reunioes',
      key: `meet:${m.id}`,
      icon: '📅',
      title: tr('Reunião às {0}: {1}', [kvHour(m.start), kvMeetLabel(m)]),
      body: [room, m.private ? tr('privada') : ''].filter(Boolean).join(' · '),
      tone: 'enter',
      attention: tr('📅 {0}', [kvMeetLabel(m)]),
      urgent: true,
      needsAnswer: true,
      toast: { ms: 5 * 60_000 },
      actions: [
        { id: 'ir', label: tr('Ir para a sala'), primary: true, run: () => void kvGoArea(`r:${m.room}`) },
        { id: 'agenda', label: tr('Agenda da sala'), run: () => kvOpenRoomPanel(m.room) },
      ],
    });
  }
}

/** A sala de reunião em que estou (ou a do item de "agenda da sala" mais perto). */
function roomHere(): string | null {
  const a = kvPeople.area;
  if (a?.startsWith('r:') && kvMeetRoom(a.slice(2))) return a.slice(2);
  const me = kvPeople.locate?.(null);
  if (!me) return null;
  let best: { id: string; d: number } | null = null;
  for (const s of kvPlanWorld.actionSpots()) {
    if (s.action !== 'reunioes' || !kvMeetRoom(s.areaId)) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (!best || d < best.d) best = { id: s.areaId, d };
  }
  return best?.id ?? null;
}

let started = false;

export function kvStartMeetings(m: KvMe, client: KvPresenceClient, root: ParentNode = document): void {
  if (started || !m.person) return;
  started = true;
  kvStartMeetingsStore(client);
  new MeetingsWorld(client);
  const btn = kvTopButton(MEET_ICON, tr('Reuniões: marcar, salas e a minha agenda'), () => kvOpenMeetings(), 'kv-btn-reunioes', 26, root);
  btn?.setAttribute('aria-haspopup', 'dialog');
  // o item da sala de reunião (painel ao lado da porta, TV) no "ir e fazer" da planta livre
  kvRegisterAction({
    key: 'reunioes',
    label: tr('Agenda da sala'),
    icon: '📅',
    pose: 'use',
    run: () => {
      const id = roomHere();
      if (id) kvOpenRoomPanel(id);
      else kvOpenMeetings({ tab: 'salas' });
    },
  });
  Object.assign((window as { habblaud?: object }).habblaud ?? {}, { kvMeetings: { state: kvMeetings, open: kvOpenMeetings, panel: kvOpenRoomPanel } });
}
