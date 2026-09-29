import { describe, expect, it } from 'vitest';
import {
  countOf,
  formatDateShort,
  formatDayTitle,
  formatDelta,
  formatDuration,
  formatHoursMinutes,
  formatInt,
  formatKm,
  formatMonthTitle,
  formatDateWithWeekday,
  plural,
  PL_REQUEST,
  timeOfIso,
} from './format';

describe('plural', () => {
  it.each([
    [1, 'заявка'],
    [2, 'заявки'],
    [4, 'заявки'],
    [5, 'заявок'],
    [11, 'заявок'],
    [12, 'заявок'],
    [21, 'заявка'],
    [22, 'заявки'],
    [66, 'заявок'],
    [0, 'заявок'],
  ])('%i %s', (n, word) => {
    expect(plural(n, PL_REQUEST)).toBe(word);
  });

  it('countOf с разделителем тысяч', () => {
    expect(countOf(1314, PL_REQUEST)).toBe('1 314 заявок');
    expect(formatInt(1314)).toBe('1 314');
  });
});

describe('formatKm / formatDelta (FRONTEND_SPEC §8.2, п. 17)', () => {
  it('км с запятой и одним знаком', () => {
    expect(formatKm(42.34)).toBe('42,3');
    expect(formatKm(null)).toBe('—');
  });

  it('км с процентом от базы', () => {
    expect(formatDelta(-38.2, 'km', 331.2)).toBe('−38,2 км (−12%)');
    expect(formatDelta(6.5, 'km')).toBe('+6,5 км');
    expect(formatDelta(0, 'km', 100)).toBe('0,0 км');
  });

  it('инженеры, заявки, счётчики', () => {
    expect(formatDelta(-2, 'engineers')).toBe('−2 инженера');
    expect(formatDelta(1, 'engineers')).toBe('+1 инженер');
    expect(formatDelta(-4, 'requests')).toBe('−4 заявки');
    expect(formatDelta(9, 'count')).toBe('+9');
    expect(formatDelta(-4, 'count')).toBe('−4');
    expect(formatDelta(0, 'count')).toBe('0');
  });
});

describe('длительность и время', () => {
  it('formatDuration', () => {
    expect(formatDuration(130)).toBe('2 ч 10 мин');
    expect(formatDuration(35)).toBe('35 мин');
    expect(formatDuration(300)).toBe('5 ч');
    expect(formatHoursMinutes(125)).toBe('2:05');
  });

  it('timeOfIso — по Москве; готовое HH:MM — как есть', () => {
    expect(timeOfIso('2026-09-29T09:31:00Z')).toBe('12:31');
    expect(timeOfIso('2026-09-29T21:05:00+00:00')).toBe('00:05');
    expect(timeOfIso('2026-09-28T06:40:12.345')).toBe('09:40');
    expect(timeOfIso('13:25')).toBe('13:25');
    expect(timeOfIso('13:25:40')).toBe('13:25');
    expect(timeOfIso('')).toBe('');
    expect(timeOfIso('garbage')).toBe('');
  });
});

describe('даты', () => {
  it('подписи по макетам', () => {
    expect(formatDayTitle('2026-09-29')).toBe('Вт, 29 сентября');
    expect(formatMonthTitle('2026-09')).toBe('Сентябрь 2026');
    expect(formatDateShort('2026-09-30')).toBe('30.09');
    expect(formatDateWithWeekday('2026-09-29')).toBe('Вт, 29.09');
  });
});
