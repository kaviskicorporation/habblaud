// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): peças de tela comuns às janelas de reunião
// (meetings-dialog.ts, meetings-panel.ts e a seção "Sala de reunião" de rooms-dialog.ts): ícones em pixel dos tipos de
// sala e dos equipamentos, selo da sala, chips de equipamento, rótulo do dia, faixa de horário e a linha do tempo.
import type { KvMeetEquip, KvMeetingView, KvMeetLayout, KvMeetPerson, KvMeetRoomView } from '../../../../shared/kaviski-meetings';
import { kvMeetEquipName, kvMeetLayoutText } from '../../../../shared/kaviski-meetings';
import { intlLocale, tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { kvHour } from './agenda';
import { kvMeetLabel } from './meetings-api';
import { HOUR, kvBlock, kvDayKind, kvTimeFrac, type Span } from './meetings-model';
import { kvPeople } from './world';
import { kvAvatar } from './ui/kit';
import './meetings.css';

/** Ícone do botão do topo e da janela Reuniões: mesa vista de cima com gente em volta. */
export const MEET_ICON = pixelIcon(['.##..##..##.', '.##..##..##.', '............', '############', '#..........#', '############', '............', '.##..##..##.', '.##..##..##.']);

/** Ícone em pixel de cada tipo de sala de reunião (pintado com a cor do tipo, `LAYOUT_COLOR`). */
export const LAYOUT_PIX: Record<KvMeetLayout, string> = {
  // fone de chamada
  cabine: pixelIcon(['##......##', '###....###', '###....###', '.##....##.', '.########.', '..######..']),
  // mesa redonda com quatro lugares
  'bate-papo': pixelIcon(['....##....', '....##....', '..######..', '##.####.##', '##.####.##', '..######..', '....##....', '....##....']),
  // mesa com cadeiras dos dois lados
  reuniao: pixelIcon(['.#..#..#.', '.........', '#########', '#########', '.........', '.#..#..#.']),
  // telão e mesa longa
  conselho: pixelIcon(['..######..', '..######..', '....##....', '..........', '#.#.#.#.#.', '##########', '##########', '.#.#.#.#.#']),
  // telão e fileiras de mesas
  treinamento: pixelIcon(['##########', '#........#', '##########', '..........', '.##.##.##.', '..........', '.##.##.##.', '..........', '.##.##.##.']),
  // lâmpada
  criativa: pixelIcon(['...####...', '..#....#..', '.#......#.', '.#..##..#.', '.#......#.', '..#....#..', '...####...', '...####...', '....##....']),
};

export const LAYOUT_COLOR: Record<KvMeetLayout, string> = {
  cabine: '#7cc8ff',
  'bate-papo': '#ff9a3d',
  reuniao: '#4fd18b',
  conselho: '#e0b24a',
  treinamento: '#a98bff',
  criativa: '#f4d35d',
};

/** Ícone em pixel de cada equipamento. */
export const EQUIP_PIX: Record<KvMeetEquip, string> = {
  tela: pixelIcon(['########', '#......#', '#......#', '#......#', '########', '...##...', '.######.']),
  video: pixelIcon(['#####...', '#...#..#', '#...#.##', '#...####', '#...#.##', '#####..#']),
  quadro: pixelIcon(['########', '#......#', '#.##.#.#', '#......#', '########', '.#....#.', '#......#']),
  som: pixelIcon(['...#..#.', '..##...#', '####.#.#', '####.#.#', '####.#.#', '..##...#', '...#..#.']),
  projetor: pixelIcon(['.######.', '#..##..#', '#.#..#.#', '#..##..#', '.######.', '.#....#.']),
  cafe: pixelIcon(['.#.#.#..', '#.#.#...', '........', '######..', '#....###', '#....#.#', '#....###', '.####...']),
  acessivel: pixelIcon(['..##....', '..##....', '...#....', '...####.', '.#.#..#.', '#...#.#.', '#...#...', '.###....']),
};

export const LOCK_PIX = pixelIcon(['..####..', '.#....#.', '.#....#.', '########', '########', '###..###', '###..###', '########']);
export const CLOCK_PIX = pixelIcon(['..####..', '.#....#.', '#..#...#', '#..#...#', '#..###.#', '#......#', '.#....#.', '..####..']);
export const CAL_PIX = pixelIcon(['.#....#.', '########', '#......#', '#.#.#.##', '#......#', '#.#.#..#', '#......#', '########']);
export const DOWNLOAD_PIX = pixelIcon(['...##...', '...##...', '...##...', '.######.', '..####..', '...##...', '........', '########']);
export const PANEL_PIX = pixelIcon(['########', '#......#', '#.####.#', '#......#', '#.##...#', '#......#', '########', '...##...']);
export const REPEAT_PIX = pixelIcon(['.#####..', '#.....#.', '#....###', '#.....#.', '.#.....#', '###....#', '.#.....#', '..#####.']);
export const NOTE_PIX = pixelIcon(['######..', '#....##.', '#.##..##', '#......#', '#.####.#', '#......#', '#.###..#', '########']);

/** Um <span> com um ícone (SVG) dentro. */
export function pix(svg: string, cls = 'kv-ui-ico'): HTMLElement {
  const s = h('span', { class: cls, attrs: { 'aria-hidden': 'true' } });
  s.innerHTML = svg;
  return s;
}

/** Nome (e descrição) traduzidos do tipo de sala e do equipamento (do contrato). */
export function layoutName(l: KvMeetLayout): string {
  return kvMeetLayoutText(l).name;
}
export function layoutDesc(l: KvMeetLayout): string {
  return kvMeetLayoutText(l).desc;
}
export function equipName(e: KvMeetEquip): string {
  return kvMeetEquipName(e);
}

/** O quadradinho do tipo da sala (ícone na cor do tipo). */
export function kvLayoutBadge(l: KvMeetLayout, size: 'sm' | 'md' | 'lg' = 'sm'): HTMLElement {
  const el = pix(LAYOUT_PIX[l], `kv-meet-lay kv-meet-lay--${size}`);
  el.style.setProperty('--lay', LAYOUT_COLOR[l]);
  el.title = layoutName(l);
  return el;
}

/** Selo da sala: ícone do tipo e nome (cor do tipo). */
export function kvRoomTag(room: KvMeetRoomView | undefined, fallback = ''): HTMLElement {
  if (!room) return h('span', { class: 'kv-meet-roomtag', text: fallback || tr('Sala') });
  const el = h('span', { class: 'kv-meet-roomtag', title: layoutName(room.meet.layout) }, kvLayoutBadge(room.meet.layout), h('span', { class: 'kv-meet-roomtag__name', text: room.name }));
  el.style.setProperty('--lay', LAYOUT_COLOR[room.meet.layout]);
  return el;
}

/** Chips pequenos dos equipamentos (só ícone + nome curto). */
export function kvEquipChips(list: readonly KvMeetEquip[], max = 7): HTMLElement {
  const el = h('span', { class: 'kv-meet-equips' });
  for (const e of list.slice(0, max)) el.append(h('span', { class: 'kv-meet-equip', title: equipName(e) }, pix(EQUIP_PIX[e]), h('span', { text: equipName(e) })));
  if (list.length > max) el.append(h('span', { class: 'kv-meet-equip', text: `+${list.length - max}` }));
  return el;
}

/** "14h–15h30". */
export function kvSpanText(s: Span): string {
  return `${kvHour(s.start)}–${kvHour(s.end)}`;
}

/** "Hoje", "Amanhã" ou "qui., 12/11". */
export function kvDayLabel(day: number, now: number): string {
  const k = kvDayKind(day, now);
  if (k === 'hoje') return tr('Hoje');
  if (k === 'amanha') return tr('Amanhã');
  return new Date(day).toLocaleDateString(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit' });
}

/** Dia por extenso ("quinta-feira, 12 de novembro"). */
export function kvDayLong(t: number): string {
  return new Date(t).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Meu id (presença), ou ''. */
export function kvMeId(): string {
  return kvPeople.client?.state?.me ?? '';
}

/** Avatar de uma pessoa (o boneco se ela está online, senão as iniciais). */
export function kvMeetAvatar(p: KvMeetPerson, size: 'xs' | 'sm' | 'md' = 'xs'): HTMLElement {
  const live = kvPeople.client?.state?.people.find((x) => x.id === p.id);
  const el = kvAvatar({ id: p.id, name: p.name, look: live?.look }, size, live ? live.status : null);
  el.title = p.name;
  return el;
}

/** Fila de avatares (até `max`, depois "+n"). */
export function kvAvatarRow(list: readonly KvMeetPerson[], max = 5): HTMLElement {
  const el = h('span', { class: 'kv-meet-avs' });
  for (const p of list.slice(0, max)) el.append(kvMeetAvatar(p));
  if (list.length > max) el.append(h('span', { class: 'kv-meet-avs__more', text: `+${list.length - max}`, title: list.slice(max).map((p) => p.name).join(', ') }));
  return el;
}

export interface KvStripBlock {
  span: Span;
  cls: string;
  label?: string;
  title?: string;
}

/** Régua das horas (rótulos de hora em hora) de uma linha do tempo. */
export function kvHourRuler(range: Span, every = 1): HTMLElement {
  const el = h('div', { class: 'kv-meet-ruler', attrs: { 'aria-hidden': 'true' } });
  const first = Math.ceil(range.start / HOUR) * HOUR;
  for (let t = first; t <= range.end; t += HOUR * every) {
    const tick = h('span', { class: 'kv-meet-ruler__tick', text: kvHour(t) });
    tick.style.left = `${kvTimeFrac(t, range) * 100}%`;
    el.append(tick);
  }
  return el;
}

/** Uma faixa da linha do tempo com blocos (reservas, ocupado) e, se `now` cair nela, a linha do agora. */
export function kvStrip(blocks: readonly KvStripBlock[], range: Span, now?: number, cls = ''): HTMLElement {
  const el = h('div', { class: `kv-meet-strip ${cls}`.trim() });
  const first = Math.ceil(range.start / HOUR) * HOUR;
  for (let t = first; t < range.end; t += HOUR) {
    const g = h('span', { class: 'kv-meet-strip__grid' });
    g.style.left = `${kvTimeFrac(t, range) * 100}%`;
    el.append(g);
  }
  for (const b of blocks) {
    const pos = kvBlock(b.span, range);
    if (!pos) continue;
    const e = h('span', { class: `kv-meet-strip__blk ${b.cls}`, title: b.title ?? b.label ?? '', text: b.label ?? '' });
    e.style.left = `${pos.left * 100}%`;
    e.style.width = `${pos.width * 100}%`;
    el.append(e);
  }
  if (now !== undefined && now > range.start && now < range.end) {
    const n = h('span', { class: 'kv-meet-strip__now', title: tr('agora') });
    n.style.left = `${kvTimeFrac(now, range) * 100}%`;
    el.append(n);
  }
  return el;
}

/** Os blocos de reserva de uma sala (a privada sem título para quem não é dela). */
export function kvMeetingBlocks(list: readonly KvMeetingView[], now: number): KvStripBlock[] {
  return list.map((m) => ({
    span: m,
    cls: `${m.mine ? 'is-mine' : ''}${m.private ? ' is-private' : ''}${m.end <= now ? ' is-past' : ''}`.trim(),
    label: kvMeetLabel(m),
    title: `${kvSpanText(m)} · ${kvMeetLabel(m)}`,
  }));
}

/** Baixa um texto como arquivo. */
export function kvDownload(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { attrs: { href: url, download: name } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
