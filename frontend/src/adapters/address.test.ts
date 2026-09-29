import { describe, expect, it } from 'vitest';
import { geocodeHit, geocodeQuery, lookupOf, parseSuggestions } from './address';

const feature = (properties: Record<string, unknown>, coordinates: unknown = [37.61, 55.76]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
});

describe('parseSuggestions — подсказки адресов', () => {
  it('дом, улица и место; в поле — город и адрес', () => {
    const list = parseSuggestions({
      type: 'FeatureCollection',
      features: [
        feature({
          osm_type: 'R',
          osm_id: 451292,
          type: 'house',
          name: 'Центральный телеграф',
          street: 'Тверская улица',
          housenumber: '7',
          district: 'Тверской',
          city: 'Москва',
        }),
        feature({ osm_type: 'W', osm_id: 1, type: 'street', name: 'Тверская улица', city: 'Москва' }),
        feature({ osm_type: 'N', osm_id: 2, type: 'house', name: 'Химки', state: 'Московская область' }, [37.43, 55.89]),
      ],
    });
    expect(list).toEqual([
      {
        id: 'R451292',
        title: 'Тверская улица, 7',
        subtitle: 'Москва, Тверской, Центральный телеграф',
        value: 'Москва, Тверская улица, 7',
        lat: 55.76,
        lon: 37.61,
      },
      { id: 'W1', title: 'Тверская улица', subtitle: 'Москва', value: 'Москва, Тверская улица', lat: 55.76, lon: 37.61 },
      { id: 'N2', title: 'Химки', subtitle: 'Московская область', value: 'Московская область, Химки', lat: 55.89, lon: 37.43 },
    ]);
  });

  it('повторы, без координат и мусор — отбрасываем', () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions({ features: 'x' })).toEqual([]);
    const list = parseSuggestions({
      features: [
        feature({ osm_id: 1, name: 'Тверская улица', city: 'Москва' }),
        feature({ osm_id: 2, name: 'Тверская улица', city: 'Москва' }),
        feature({ osm_id: 3, name: 'Без точки' }, null),
        feature({ osm_id: 4 }),
      ],
    });
    expect(list.map((s) => s.value)).toEqual(['Москва, Тверская улица']);
  });
});

describe('lookupOf — адрес события без подсказки', () => {
  it('нашли, не нашли, сервис не ответил', () => {
    expect(lookupOf({ features: [feature({ osm_id: 1, name: 'Тверская улица', city: 'Москва' })] })).toMatchObject({
      status: 'found',
      suggestion: { value: 'Москва, Тверская улица' },
    });
    expect(lookupOf({ features: [] })).toEqual({ status: 'none' });
    expect(lookupOf(null)).toEqual({ status: 'unavailable' });
  });
});

describe('точки заявок другого участка', () => {
  it('запрос геокодеру: без квартиры и «д.», сокращения улиц полностью', () => {
    expect(geocodeQuery('Город Москва, б-р.Чонгарский, д. 1 к 4, кв. 314')).toBe(
      'Москва, бульвар Чонгарский, 1 к4',
    );
    expect(geocodeQuery('г.Город Москва, пр-кт.Ленинский, д. 70/11')).toBe(
      'Москва, проспект Ленинский, 70/11',
    );
    expect(geocodeQuery('Город Москва, проезд.3-й Павелецкий, д. 9, подъезд 2')).toBe(
      'Москва, проезд 3-й Павелецкий, 9',
    );
    expect(geocodeQuery('г. Подольск, ул.Кирова, д. 5 стр. 1, оф. 12')).toBe(
      'Подольск, улица Кирова, 5 с1',
    );
  });

  const feature = (street: string, housenumber: string | null, lat: number, lon: number) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { street, housenumber, type: housenumber ? 'house' : 'street' },
  });

  it('берём вариант с той же улицей: дом — точно, без дома — улица', () => {
    const query = 'Москва, бульвар Чонгарский, 1 к4';
    const response = {
      features: [
        feature('улица Капотня', '1', 55.64, 37.8),
        feature('Чонгарский бульвар', '1 к4', 55.652, 37.6157),
      ],
    };
    expect(geocodeHit(response, query, null)).toEqual({
      lat: 55.652,
      lon: 37.6157,
      precision: 'house',
      label: 'Чонгарский бульвар, 1 к4',
    });
    expect(geocodeHit({ features: [feature('Чонгарский бульвар', null, 55.65, 37.61)] }, query, null))
      .toMatchObject({ precision: 'street' });
  });

  it('чужая улица, город без улицы, дальше 100 км от офиса, мусор — не нашли', () => {
    const query = 'Химки, улица Молодёжная, 4';
    expect(geocodeHit({ features: [feature('улица Москвина', '4', 55.9, 37.45)] }, query, null)).toBeNull();
    expect(
      geocodeHit({ features: [feature('Молодёжная улица', '4', 59.9, 30.3)] }, query, { lat: 55.9, lon: 37.45 }),
    ).toBeNull();
    expect(geocodeHit({ features: [{ properties: { type: 'city', name: 'Химки' } }] }, query, null)).toBeNull();
    expect(geocodeHit(null, query, null)).toBeNull();
    expect(geocodeHit({ features: [feature('Молодёжная', '4', 55.9, 37.45)] }, 'Москва', null)).toBeNull();
  });
});
