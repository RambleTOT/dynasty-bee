import { describe, expect, it } from 'vitest';
import { makeEngineer, makeRequest } from './__fixtures__/day';
import { coordinatesFor, engineerLabels, insideMoscowRegion, isSynthetic, requestLabels } from './normalize';

describe('isSynthetic', () => {
  it('по источнику', () => {
    expect(isSynthetic({ source: 'synthetic_instance', requests: [], engineers: [] })).toBe(true);
    expect(isSynthetic({ source: 'csv', requests: [makeRequest({ id: '305838184' })], engineers: [] })).toBe(false);
  });

  it('по виду id: T000 и E00', () => {
    expect(
      isSynthetic({
        source: 'json',
        requests: [makeRequest({ id: 'T000' }), makeRequest({ id: 'T001' })],
        engineers: [makeEngineer({ id: 'E00' })],
      }),
    ).toBe(true);
  });

  it('по точкам вне рамки региона', () => {
    expect(
      isSynthetic({
        source: 'json',
        requests: [makeRequest({ id: 'R1', latitude: 3.5, longitude: 12.1 })],
        engineers: [],
      }),
    ).toBe(true);
  });
});

describe('срочная без координат (п. 46): бэк отдаёт (0, 0)', () => {
  it('день не становится синтетикой, облако не переносится', () => {
    const requests = [
      makeRequest({ id: '305838184', latitude: 55.7, longitude: 37.76 }),
      makeRequest({ id: 'U-1', latitude: 0, longitude: 0 }),
    ];
    expect(isSynthetic({ source: 'csv', requests, engineers: [] })).toBe(false);
    expect(coordinatesFor(requests, [], null).approx).toBe(false);
  });
});

describe('coordinatesFor', () => {
  it('точки в регионе — без переноса', () => {
    const coords = coordinatesFor([makeRequest({ id: 'R1' })], [makeEngineer({ id: 'E1' })], null);
    expect(coords.approx).toBe(false);
    expect(coords.transform(55.75, 37.8)).toEqual([55.75, 37.8]);
  });

  it('условные км — облако переносится к офису, центр облака = офис', () => {
    const requests = [
      makeRequest({ id: 'T000', latitude: 0, longitude: 0 }),
      makeRequest({ id: 'T001', latitude: 10, longitude: 10 }),
    ];
    const coords = coordinatesFor(requests, [], { lat: 55.72, lon: 37.82 });
    expect(coords.approx).toBe(true);
    const [lat, lon] = coords.transform(5, 5);
    expect(lat).toBeCloseTo(55.72, 6);
    expect(lon).toBeCloseTo(37.82, 6);
    const [lat2] = coords.transform(10, 10);
    expect(lat2 - 55.72).toBeCloseTo(5 / 111.32, 6);
    expect(insideMoscowRegion(...coords.transform(0, 0))).toBe(true);
  });

  it('без офиса — центр Москвы', () => {
    const coords = coordinatesFor([makeRequest({ id: 'T000', latitude: 1, longitude: 1 })], [], null);
    expect(coords.transform(1, 1)).toEqual([55.751, 37.618]);
  });
});

describe('подписи', () => {
  it('синтетика: тип по навыку, «Адрес не указан», короткий №', () => {
    const labels = requestLabels({
      id: 'T000',
      type_bk: null,
      type_hd: null,
      required_skill: 'emergency',
      address: '',
      district: null,
    });
    expect(labels).toMatchObject({
      shortId: 'T000',
      number: '№T000',
      typeShort: 'Авария',
      typeFull: 'Авария',
      hasAddress: false,
      addressText: 'Адрес не указан',
      district: null,
    });
  });

  it('CSV: сокращение BK и тип с HD', () => {
    const labels = requestLabels(makeRequest({ id: '305838184' }));
    expect(labels.shortId).toBe('…8184');
    expect(labels.typeShort).toBe('Подкл.');
    expect(labels.typeFull).toBe('Подключение · Конвергенция абонента');
  });

  it('бригада без имени', () => {
    expect(engineerLabels({ id: 'E00', name: 'E00' })).toEqual({ label: 'Бригада E00', short: 'E00' });
    expect(engineerLabels({ id: 'e1', name: 'Бригада Соколов' })).toEqual({
      label: 'Бригада Соколов',
      short: 'Соколов',
    });
  });
});
