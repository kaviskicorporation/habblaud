// Fork Kaviski (KAVISKI-HUMANOS.md): leitor de ICS da agenda.
import { describe, expect, it } from 'vitest';
import { kvParseDuration, kvParseIcs, kvResolveTz, kvZonedToUtc } from './kaviski-ics';

const cal = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//teste//PT', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const iso = (t: number) => new Date(t).toISOString();
const D = (s: string) => Date.parse(s);
const WIDE = [D('2000-01-01T00:00:00Z'), D('2030-01-01T00:00:00Z')] as const;

describe('fusos', () => {
  it('converte hora de parede para UTC, com e sem horário de verão', () => {
    expect(iso(kvZonedToUtc(2026, 11, 6, 15, 0, 0, 'America/Sao_Paulo'))).toBe('2026-11-06T18:00:00.000Z');
    expect(iso(kvZonedToUtc(2026, 7, 1, 9, 0, 0, 'Europe/Paris'))).toBe('2026-07-01T07:00:00.000Z');
    expect(iso(kvZonedToUtc(2026, 1, 15, 9, 0, 0, 'Europe/Paris'))).toBe('2026-01-15T08:00:00.000Z');
    expect(iso(kvZonedToUtc(2026, 3, 8, 2, 30, 0, 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z'); // hora que não existe
  });
  it('aceita IANA, nomes do Windows e o prefixo do Thunderbird', () => {
    expect(kvResolveTz('America/Sao_Paulo')).toBe('America/Sao_Paulo');
    expect(kvResolveTz('E. South America Standard Time')).toBe('America/Sao_Paulo');
    expect(kvResolveTz('/mozilla.org/20050126_1/Europe/Paris')).toBe('Europe/Paris');
    expect(kvResolveTz('Fuso/Inventado')).toBeNull();
    expect(kvResolveTz('UTC')).toBe('UTC');
  });
  it('DURATION', () => {
    expect(kvParseDuration('PT1H30M')).toBe(90 * 60_000);
    expect(kvParseDuration('P1D')).toBe(86_400_000);
    expect(kvParseDuration('P1W')).toBe(7 * 86_400_000);
    expect(kvParseDuration('P')).toBeNull();
    expect(kvParseDuration('abc')).toBeNull();
  });
});

describe('kvParseIcs', () => {
  it('evento simples em UTC, com texto escapado e linhas dobradas', () => {
    const text = cal(
      ev('UID:1', 'DTSTART:20261106T180000Z', 'DTEND:20261106T190000Z', 'SUMMARY:Reunião\\, com cliente', 'LOCATION:Sala FPF \\; 2º andar', 'DESCRIPTION:linha 1\\nlinha', '  2 dobrada'),
    );
    const out = kvParseIcs(text, ...WIDE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ uid: '1', title: 'Reunião, com cliente', location: 'Sala FPF ; 2º andar', description: 'linha 1\nlinha 2 dobrada', allDay: false, busy: true });
    expect(iso(out[0]!.start)).toBe('2026-11-06T18:00:00.000Z');
    expect(iso(out[0]!.end)).toBe('2026-11-06T19:00:00.000Z');
  });

  it('TZID, flutuante no fuso da agenda (X-WR-TIMEZONE) e DURATION', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'X-WR-TIMEZONE:America/Sao_Paulo',
      ev('UID:a', 'DTSTART;TZID=Europe/Paris:20261106T100000', 'DURATION:PT45M', 'SUMMARY:Paris'),
      ev('UID:b', 'DTSTART:20261106T150000', 'DTEND:20261106T153000', 'SUMMARY:Flutuante'),
      ev('UID:c', 'DTSTART;TZID="E. South America Standard Time":20261106T080000', 'DTEND;TZID="E. South America Standard Time":20261106T090000', 'SUMMARY:Outlook'),
      'END:VCALENDAR',
    ].join('\n');
    const out = kvParseIcs(text, ...WIDE, 'UTC');
    const by = Object.fromEntries(out.map((e) => [e.uid, e]));
    expect(iso(by.a!.start)).toBe('2026-11-06T09:00:00.000Z');
    expect(by.a!.end - by.a!.start).toBe(45 * 60_000);
    expect(iso(by.b!.start)).toBe('2026-11-06T18:00:00.000Z');
    expect(iso(by.c!.start)).toBe('2026-11-06T11:00:00.000Z');
  });

  it('dia inteiro, cancelado, livre e VALARM não atrapalham', () => {
    const text = cal(
      ev('UID:d', 'DTSTART;VALUE=DATE:20261106', 'DTEND;VALUE=DATE:20261107', 'SUMMARY:Feriado', 'TRANSP:TRANSPARENT'),
      ev('UID:x', 'DTSTART:20261106T120000Z', 'DTEND:20261106T130000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelada'),
      ev('UID:y', 'DTSTART:20261106T140000Z', 'DTEND:20261106T150000Z', 'SUMMARY:Com alarme', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:lembrete', 'TRIGGER:-PT10M', 'END:VALARM'),
    );
    const out = kvParseIcs(text, ...WIDE, 'America/Sao_Paulo');
    expect(out.map((e) => e.uid)).toEqual(['d', 'y']);
    expect(out[0]).toMatchObject({ allDay: true, busy: false });
    expect(iso(out[0]!.start)).toBe('2026-11-06T03:00:00.000Z');
    expect(out[0]!.end - out[0]!.start).toBe(86_400_000);
    expect(out[1]!.description).toBeUndefined();
  });

  it('RRULE semanal com BYDAY, INTERVAL, EXDATE e UNTIL, mantendo a hora local', () => {
    const text = cal(
      ev(
        'UID:w',
        'DTSTART;TZID=America/New_York:20260302T090000',
        'DTEND;TZID=America/New_York:20260302T093000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260320T235959Z',
        'EXDATE;TZID=America/New_York:20260304T090000',
        'SUMMARY:Daily de NY',
      ),
    );
    const out = kvParseIcs(text, ...WIDE);
    // seg 2, (qua 4 fora), seg 9, qua 11, seg 16, qua 18
    expect(out.map((e) => iso(e.start))).toEqual([
      '2026-03-02T14:00:00.000Z',
      '2026-03-09T13:00:00.000Z', // depois do horário de verão (8/3): continua às 9h de NY
      '2026-03-11T13:00:00.000Z',
      '2026-03-16T13:00:00.000Z',
      '2026-03-18T13:00:00.000Z',
    ]);
    const two = kvParseIcs(cal(ev('UID:q', 'DTSTART:20261102T120000Z', 'DTEND:20261102T130000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3')), ...WIDE);
    expect(two.map((e) => iso(e.start).slice(0, 10))).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });

  it('RRULE diária com COUNT, mensal e exceção de uma ocorrência (RECURRENCE-ID)', () => {
    const text = cal(
      ev('UID:r', 'DTSTART:20261101T120000Z', 'DTEND:20261101T121500Z', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Stand-up'),
      ev('UID:r', 'RECURRENCE-ID:20261103T120000Z', 'DTSTART:20261103T160000Z', 'DTEND:20261103T161500Z', 'SUMMARY:Stand-up (mudou)'),
      ev('UID:m', 'DTSTART:20260131T100000Z', 'DTEND:20260131T110000Z', 'RRULE:FREQ=MONTHLY;COUNT=4', 'SUMMARY:Fim do mês'),
    );
    const out = kvParseIcs(text, ...WIDE);
    const r = out.filter((e) => e.uid === 'r');
    expect(r.map((e) => `${iso(e.start).slice(5, 16)} ${e.title}`)).toEqual([
      '11-01T12:00 Stand-up',
      '11-02T12:00 Stand-up',
      '11-03T16:00 Stand-up (mudou)',
      '11-04T12:00 Stand-up',
      '11-05T12:00 Stand-up',
    ]);
    // 31 só existe em jan, mar, mai... (fev e abr pulam)
    expect(out.filter((e) => e.uid === 'm').map((e) => iso(e.start).slice(0, 10))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  });

  it('só devolve o que cruza a janela; repetição sem fim não trava', () => {
    const text = cal(ev('UID:s', 'DTSTART:20200106T120000Z', 'DTEND:20200106T130000Z', 'RRULE:FREQ=DAILY'));
    const t0 = performance.now();
    const out = kvParseIcs(text, D('2026-11-06T00:00:00Z'), D('2026-11-08T00:00:00Z'));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(out.map((e) => iso(e.start).slice(0, 10))).toEqual(['2026-11-06', '2026-11-07']);
  });

  it('regra que não sabemos ler vira um evento só (não inventa repetições); lixo é ignorado', () => {
    const text = cal(ev('UID:z', 'DTSTART:20261106T120000Z', 'DTEND:20261106T130000Z', 'RRULE:FREQ=MONTHLY;BYDAY=1MO')) + '\nlixo sem dois pontos\nBEGIN:VEVENT\nDTSTART:quebrado\nEND:VEVENT';
    expect(kvParseIcs(text, ...WIDE)).toHaveLength(1);
    expect(kvParseIcs('', ...WIDE)).toEqual([]);
  });
});
