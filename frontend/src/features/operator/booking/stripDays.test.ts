import { describe, expect, it } from 'vitest';
import { monthSegments, stripStart } from './stripDays';

describe('лента дат оператора', () => {
  it('с сегодня, пока дата в ближайших двух неделях; дальше — с неё за три дня', () => {
    expect(stripStart('2026-09-30', '2026-09-29')).toBe('2026-09-29');
    expect(stripStart('2026-10-12', '2026-09-29')).toBe('2026-09-29');
    expect(stripStart('2026-11-27', '2026-09-29')).toBe('2026-11-24');
    expect(stripStart('2026-10-14', '2026-09-29')).toBe('2026-10-11');
  });

  it('подписи месяцев — над своими днями', () => {
    const days = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
    expect(monthSegments(days)).toEqual([
      { month: '2026-09', from: 0, span: 2 },
      { month: '2026-10', from: 2, span: 2 },
    ]);
  });
});
