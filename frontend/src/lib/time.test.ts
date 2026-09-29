import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  addMonths,
  axisFraction,
  axisHours,
  fromMin,
  isoWeekday,
  monthGrid,
  monthRange,
  nowFor,
  nowMsk,
  parseWindow,
  timelineAxis,
  todayMsk,
  toMin,
} from './time';

afterEach(() => {
  vi.useRealTimers();
});

describe('nowMsk / todayMsk', () => {
  it('время по Москве (UTC+3)', () => {
    expect(nowMsk(new Date('2026-09-28T09:05:00Z'))).toBe('12:05');
  });

  it('полночь — 00:00, а не 24:00', () => {
    expect(nowMsk(new Date('2026-09-28T21:00:00Z'))).toBe('00:00');
  });

  it('дата по Москве, а не по UTC', () => {
    expect(todayMsk(new Date('2026-09-28T20:59:00Z'))).toBe('2026-09-28');
    expect(todayMsk(new Date('2026-09-28T21:30:00Z'))).toBe('2026-09-29');
  });

  it('по умолчанию — текущий момент', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T07:40:00Z'));
    expect(nowMsk()).toBe('10:40');
    expect(todayMsk()).toBe('2026-01-05');
  });
});

describe('nowFor', () => {
  it('часы дня, если заданы', () => {
    expect(nowFor('12:30')).toBe('12:30');
  });

  it.each([null, undefined, ''])('без часов (%s) — реальное московское время', (clock) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T16:15:00Z'));
    expect(nowFor(clock)).toBe('19:15');
  });
});

describe('toMin / fromMin', () => {
  it.each([
    ['00:00', 0],
    ['09:05', 545],
    ['9:05', 545],
    ['10:00', 600],
    ['22:00', 1320],
    ['24:00', 1440],
    ['10:00:30', 600],
  ])('toMin(%s) = %i', (time, minutes) => {
    expect(toMin(time)).toBe(minutes);
  });

  it.each(['', 'abc', '10', '10:75', '10-00'])('toMin(%j) — NaN', (time) => {
    expect(toMin(time)).toBeNaN();
  });

  it.each([
    [0, '00:00'],
    [545, '09:05'],
    [1439, '23:59'],
    [1440, '24:00'],
    [90.4, '01:30'],
    [-10, '00:00'],
    [Number.NaN, '--:--'],
  ])('fromMin(%d) = %s', (minutes, time) => {
    expect(fromMin(minutes)).toBe(time);
  });

  it('туда и обратно', () => {
    expect(fromMin(toMin('13:25'))).toBe('13:25');
  });
});

describe('parseWindow', () => {
  it('формат бэка', () => {
    expect(parseWindow('10:00-12:00')).toEqual({ start: '10:00', end: '12:00' });
  });

  it('тире, пробелы и часы без нуля', () => {
    expect(parseWindow(' 9:00 – 11:30 ')).toEqual({ start: '09:00', end: '11:30' });
  });

  it.each(['', '10:00', 'утро', '10:00-25:99'])('%j — null', (value) => {
    expect(parseWindow(value)).toBeNull();
  });
});

describe('ось таймлайна по сменам (§10.3)', () => {
  it('CSV-день 10–22, синтетика 09–19', () => {
    expect(timelineAxis([{ start: '10:00', end: '22:00' }])).toEqual({ start: 600, end: 1320 });
    expect(timelineAxis([{ start: '09:00', end: '19:00' }])).toEqual({ start: 540, end: 1140 });
  });

  it('округление вниз и вверх до часа, min/max по бригадам', () => {
    const axis = timelineAxis([
      { start: '09:30', end: '18:10' },
      { start: '10:00', end: '21:45' },
    ]);
    expect(axis).toEqual({ start: 540, end: 1320 });
    expect(axisHours(axis!)).toHaveLength(14);
    expect(axisFraction(toMin('15:30'), axis!)).toBeCloseTo((930 - 540) / 780);
    expect(axisFraction(0, axis!)).toBe(0);
  });

  it('нет смен — нет оси', () => {
    expect(timelineAxis([])).toBeNull();
    expect(timelineAxis([{ start: 'x', end: 'y' }])).toBeNull();
  });
});

describe('даты месяца', () => {
  it('addDays через границу месяца и года', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('addMonths, monthRange', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('monthGrid — целые недели с понедельника (как в DS-01: 31.08…04.10)', () => {
    const grid = monthGrid('2026-09');
    expect(grid[0]).toBe('2026-08-31');
    expect(grid.at(-1)).toBe('2026-10-04');
    expect(grid).toHaveLength(35);
    expect(isoWeekday('2026-09-28')).toBe(1);
  });
});
