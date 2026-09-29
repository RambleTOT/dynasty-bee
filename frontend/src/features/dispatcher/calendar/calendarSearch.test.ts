import { afterEach, describe, expect, it } from 'vitest';
import { FEATURES } from '@/config';
import { calendarSearch, dayPath, regionOptions } from './calendarSearch';

const flags = FEATURES as Record<keyof typeof FEATURES, boolean>;

afterEach(() => {
  flags.anyRegion = false;
});

describe('регион календаря в адресе', () => {
  it('без §14 — только участки кейса, остальное — «Все регионы»', () => {
    expect(calendarSearch.region.parse('south_east')).toBe('south_east');
    expect(calendarSearch.region.parse('r-north')).toBe('all');
    expect(calendarSearch.region.parse(null)).toBe('all');
    expect(calendarSearch.region.serialize('all')).toBeNull();
  });

  it('с §14 — любой id участка, мусор — «Все регионы»', () => {
    flags.anyRegion = true;
    expect(calendarSearch.region.parse('r-north')).toBe('r-north');
    expect(calendarSearch.region.parse('../x')).toBe('all');
    expect(calendarSearch.region.serialize('r-north')).toBe('r-north');
  });

  it('пункты фильтра и ссылка на день', () => {
    expect(
      regionOptions([
        { id: 'east', name: 'Восток' },
        { id: 'r-north', name: 'Север' },
      ]),
    ).toEqual([
      { value: 'all', label: 'Все регионы' },
      { value: 'east', label: 'Восток' },
      { value: 'r-north', label: 'Север' },
    ]);
    expect(dayPath('2026-10-01', 'r-north', ['east'])).toBe(
      '/dispatcher/day/2026-10-01?region=r-north',
    );
    expect(dayPath('2026-10-01', 'all', ['south_center'])).toBe(
      '/dispatcher/day/2026-10-01?region=south_center',
    );
  });
});
