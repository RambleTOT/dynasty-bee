import { afterEach, describe, expect, it } from 'vitest';
import type { RegionInfo } from '@/api/types';
import { regionLabel } from '@/lib/dictionaries';
import {
  anyRegionEnabled,
  forgetRegions,
  isRegionSlug,
  knownRegionName,
  rememberRegions,
} from '@/lib/regions';
import { regionItems } from './useRegions';

const region = (region_id: string, name: string, builtin?: boolean): RegionInfo => ({
  region_id,
  name,
  office: { address: 'Офис', lat: 55.7, lon: 37.6 },
  request_count: 0,
  engineer_count: 4,
  demo_available: false,
  has_control: false,
  ...(builtin === undefined ? {} : { builtin }),
});

const API = [
  region('r-north', 'Север', false),
  region('east', 'Восток', true),
  region('south_center', 'Югоцентр', true),
];

describe('regionItems', () => {
  it('без §14 — три участка кейса в порядке кейса, названия с бэка или из справочника', () => {
    expect(regionItems(API, false).map((item) => [item.id, item.name, item.builtin])).toEqual([
      ['east', 'Восток', true],
      ['south_east', 'Юго-восток', true],
      ['south_center', 'Югоцентр', true],
    ]);
  });

  it('с §14 — после участков кейса свои участки в порядке ответа', () => {
    const items = regionItems(API, true);
    expect(items.map((item) => item.id)).toEqual(['east', 'south_east', 'south_center', 'r-north']);
    expect(items[3]).toMatchObject({ name: 'Север', builtin: false });
    expect(regionItems(undefined, true)).toHaveLength(3);
  });
});

describe('названия участков', () => {
  afterEach(forgetRegions);

  it('свой участок — после ответа /regions; незнакомый — null и id как есть', () => {
    expect(knownRegionName('r-north')).toBeNull();
    expect(regionLabel('r-north')).toBe('r-north');
    rememberRegions(API);
    expect(knownRegionName('r-north')).toBe('Север');
    expect(regionLabel('r-north')).toBe('Север');
    expect(knownRegionName('east')).toBe('Восток');
    expect(knownRegionName(null)).toBeNull();
  });

  it('id участка в адресе', () => {
    expect(isRegionSlug('r-3fa2c1d0')).toBe(true);
    expect(isRegionSlug('south_center')).toBe(true);
    expect(isRegionSlug('../x')).toBe(false);
    expect(isRegionSlug('')).toBe(false);
  });
});

describe('свои участки включаются сами, когда бэк выложит §14', () => {
  afterEach(forgetRegions);

  it('нет поля builtin в GET /regions — выключено; есть — включено, свои участки в списках', () => {
    rememberRegions(API.map((region) => ({ region_id: region.region_id, name: region.name })));
    expect(anyRegionEnabled()).toBe(false);
    expect(regionItems(API)).toHaveLength(3);
    rememberRegions(API);
    expect(anyRegionEnabled()).toBe(true);
    expect(regionItems(API).map((item) => item.id)).toContain('r-north');
  });
});
