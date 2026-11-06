import { describe, expect, it } from 'vitest';
import type { KvMeetingView, KvMeetRoomView } from '../../../../shared/kaviski-meetings';
import { kvDefaultMeet } from '../../../../shared/kaviski-meetings';
import {
  dayStartOf,
  HOUR,
  kvBlock,
  kvClickSlot,
  kvDateValue,
  kvDayKind,
  kvDragStart,
  kvFracTime,
  kvFreeSpans,
  kvFromInputs,
  kvGroupByDay,
  kvHiddenByFilter,
  kvMergeSpans,
  kvNextFree,
  kvQuickMax,
  kvRankRooms,
  kvRoomNow,
  kvSnap,
  kvSuggestStart,
  kvTimeFrac,
  kvTimelineRange,
  kvTimeValue,
  MIN,
  nextDay,
} from './meetings-model';

const DAY0 = new Date(2026, 10, 12, 0, 0, 0, 0).getTime(); // qui 12/11/2026, meia-noite local
const at = (hh: number, mm = 0, day = DAY0) => day + hh * HOUR + mm * MIN;

function mt(id: string, room: string, s: number, e: number, extra: Partial<KvMeetingView> = {}): KvMeetingView {
  return { id, room, start: s, end: e, private: false, mine: false, ...extra };
}

function room(id: string, name: string, over: Partial<ReturnType<typeof kvDefaultMeet>> = {}): KvMeetRoomView {
  return { id, name, meet: { ...kvDefaultMeet('reuniao'), ...over } };
}

describe('dias', () => {
  it('hoje, amanhã e outro', () => {
    const now = at(10);
    expect(kvDayKind(DAY0, now)).toBe('hoje');
    expect(kvDayKind(nextDay(DAY0), now)).toBe('amanha');
    expect(kvDayKind(nextDay(nextDay(DAY0)), now)).toBe('outro');
    expect(dayStartOf(at(23, 59))).toBe(DAY0);
  });

  it('agrupa por dia em ordem, e a que começou antes de hoje fica em hoje', () => {
    const now = at(10);
    const g = kvGroupByDay([mt('c', 'r', at(9, 0, nextDay(DAY0)), at(10, 0, nextDay(DAY0))), mt('b', 'r', at(15), at(16)), mt('a', 'r', at(23, 0, DAY0 - 24 * HOUR), at(11))], now);
    expect(g.map((x) => x.day)).toEqual([DAY0, nextDay(DAY0)]);
    expect(g[0]!.items.map((m) => m.id)).toEqual(['a', 'b']);
    expect(g[1]!.items.map((m) => m.id)).toEqual(['c']);
  });
});

describe('vãos livres', () => {
  it('junta sobrepostos e encostados', () => {
    expect(kvMergeSpans([{ start: 5, end: 7 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 6, end: 9 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 9 },
    ]);
  });

  it('acha os vãos entre os ocupados', () => {
    expect(kvFreeSpans([{ start: 2, end: 4 }, { start: 6, end: 12 }], 0, 10)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ]);
    expect(kvFreeSpans([], 0, 10)).toEqual([{ start: 0, end: 10 }]);
  });

  it('arredonda no passo a partir da meia-noite local', () => {
    expect(kvSnap(at(9, 7))).toBe(at(9, 0));
    expect(kvSnap(at(9, 8))).toBe(at(9, 15));
    expect(kvSnap(at(9, 1), 15 * MIN, 'ceil')).toBe(at(9, 15));
    expect(kvSnap(at(9, 14), 15 * MIN, 'floor')).toBe(at(9, 0));
  });

  it('clique num vão: começa ali, recua para caber, e num ocupado não muda', () => {
    const range = { start: at(8), end: at(20) };
    const busy = [{ start: at(10), end: at(11) }, { start: at(12), end: at(13) }];
    expect(kvClickSlot(busy, at(9, 20), 30 * MIN, range)).toBe(at(9, 15));
    // 11h40 + 30 min passa das 12h: recua para 11h30
    expect(kvClickSlot(busy, at(11, 40), 30 * MIN, range)).toBe(at(11, 30));
    // vão de 1 h e reunião de 2 h: começa no começo do vão
    expect(kvClickSlot(busy, at(11, 40), 2 * HOUR, range)).toBe(at(11));
    expect(kvClickSlot(busy, at(10, 30), 30 * MIN, range)).toBeNull();
  });

  it('próximo horário livre que cabe', () => {
    const busy = [{ start: at(9), end: at(10, 10) }, { start: at(10, 30), end: at(12) }];
    expect(kvNextFree(busy, at(9), 30 * MIN, at(20))).toBe(at(12));
    expect(kvNextFree(busy, at(9), 15 * MIN, at(20))).toBe(at(10, 15));
    expect(kvNextFree([{ start: at(9), end: at(20) }], at(9), 30 * MIN, at(20))).toBeNull();
  });
});

describe('linha do tempo', () => {
  it('8h–20h, aumentando para caber o horário', () => {
    expect(kvTimelineRange(DAY0)).toEqual({ start: at(8), end: at(20) });
    expect(kvTimelineRange(DAY0, { start: at(7, 30), end: at(21, 15) })).toEqual({ start: at(7), end: at(22) });
  });

  it('posição e horário de uma fração', () => {
    const r = { start: at(8), end: at(20) };
    expect(kvTimeFrac(at(14), r)).toBe(0.5);
    expect(kvTimeFrac(at(6), r)).toBe(0);
    expect(kvFracTime(0.25, r)).toBe(at(11));
    expect(kvBlock({ start: at(11), end: at(14) }, r)).toEqual({ left: 0.25, width: 0.25 });
    expect(kvBlock({ start: at(21), end: at(22) }, r)).toBeNull();
  });

  it('arrastar o bloco anda no passo e não sai da linha', () => {
    const r = { start: at(8), end: at(20) };
    const w = 12 * 64; // 64 px por hora
    expect(kvDragStart(at(10), 30 * MIN, 64, w, r)).toBe(at(11));
    expect(kvDragStart(at(10), 30 * MIN, 20, w, r)).toBe(at(10, 15)); // 18,75 min → 15
    expect(kvDragStart(at(10), 30 * MIN, -10_000, w, r)).toBe(at(8));
    expect(kvDragStart(at(10), 30 * MIN, 10_000, w, r)).toBe(at(19, 30));
  });
});

describe('achar sala', () => {
  const rooms = [
    room('a', 'Aquário', { capacity: 4, equipment: ['tela'] }),
    room('b', 'Boardroom', { capacity: 14, equipment: ['tela', 'video', 'quadro'] }),
    room('c', 'Cabine', { capacity: 2, equipment: ['video'] }),
    room('d', 'Depósito', { bookable: false }),
    room('e', 'Estúdio', { capacity: 8, equipment: ['tela', 'video'] }),
  ];
  const slot = { start: at(14), end: at(15) };
  const meetings = [mt('m1', 'e', at(14, 30), at(15, 30)), mt('m2', 'a', at(15), at(16)), mt('m3', 'b', at(13), at(14, 30), { released: 'auto' })];

  it('livres primeiro (capacidade mais justa antes), ocupadas no fim; sem as não reserváveis', () => {
    const r = kvRankRooms(rooms, meetings, slot, { capMin: 3 });
    expect(r.map((f) => f.room.id)).toEqual(['a', 'b', 'e']);
    expect(r[2]!.busy.map((m) => m.id)).toEqual(['m1']);
    expect(r.every((f) => f.matches)).toBe(true);
  });

  it('filtra por equipamento e mantém a escolhida fora do filtro', () => {
    const r = kvRankRooms(rooms, meetings, slot, { capMin: 1, equip: ['video'], keep: 'a' });
    expect(r.map((f) => [f.room.id, f.matches])).toEqual([
      ['c', true],
      ['b', true],
      ['a', false],
      ['e', true],
    ]);
    expect(kvHiddenByFilter(rooms, 1, ['video'])).toBe(1);
  });

  it('a reunião editada não ocupa a própria sala', () => {
    const r = kvRankRooms(rooms, meetings, slot, { capMin: 8, ignore: 'm1' });
    expect(r.find((f) => f.room.id === 'e')!.busy).toEqual([]);
  });
});

describe('estado agora', () => {
  const list = [mt('a', 'r', at(9), at(10)), mt('b', 'r', at(10), at(11)), mt('c', 'r', at(14), at(15)), mt('x', 'r', at(12), at(13), { released: 'cancelada' })];

  it('ocupada até o fim das emendadas', () => {
    const s = kvRoomNow('r', list, at(9, 30));
    expect(s.kind).toBe('ocupada');
    expect(s.cur!.id).toBe('a');
    expect(s.until).toBe(at(11));
    expect(kvQuickMax('r', list, at(9, 30))).toBe(0);
  });

  it('livre até a próxima, breve a 15 min dela', () => {
    const s = kvRoomNow('r', list, at(12));
    expect(s.kind).toBe('livre');
    expect(s.next!.id).toBe('c');
    expect(s.until).toBe(at(14));
    expect(kvRoomNow('r', list, at(13, 50)).kind).toBe('breve');
    expect(kvQuickMax('r', list, at(13))).toBe(60);
    expect(kvQuickMax('r', list, at(16))).toBe(Infinity);
  });
});

describe('campos de data e hora', () => {
  it('ida e volta', () => {
    const t = at(14, 35);
    expect(kvDateValue(t)).toBe('2026-11-12');
    expect(kvTimeValue(t)).toBe('14:35');
    expect(kvFromInputs('2026-11-12', '14:35')).toBe(t);
    expect(kvFromInputs('2026-02-30', '10:00')).toBeNull();
    expect(kvFromInputs('2026-11-12', '25:00')).toBeNull();
    expect(kvFromInputs('', '10:00')).toBeNull();
  });

  it('sugere o próximo horário redondo', () => {
    expect(kvSuggestStart(at(9, 10))).toBe(at(9, 30));
    expect(kvSuggestStart(at(9, 26))).toBe(at(10));
  });
});
