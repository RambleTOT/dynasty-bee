import { describe, expect, it } from 'vitest';
import type { EngineerMeDay, EngineerRoute, EngineerVisit } from '@/api/types';
import { toEngineerDay } from './engineerDay';
import {
  dayRouteUrl,
  effectiveRoute,
  linkTransport,
  nextLegUrl,
  routeFromVisits,
  routeUrlTo,
  toEngineerRoute,
} from './engineerRoute';

/** Визиты дня с координатами — как их отдаёт бэк (в схеме `EngineerVisit` полей lat/lon нет). */
function visitsWithPoints() {
  const visit = (id: string, sequence: number, status: string, lat: unknown, lon: unknown) =>
    ({
      request_id: id,
      sequence,
      status,
      window: '14:00-16:00',
      duration_minutes: 30,
      leg_km: 1,
      gigabit: false,
      why_you: '',
      lat,
      lon,
    }) as EngineerVisit;
  const raw: EngineerMeDay = {
    engineer: { id: 'E01', shift_status: 'on_shift' },
    summary: {},
    visits: [
      visit('A', 1, 'done', 55.71, 37.78),
      visit('B', 2, 'done', 55.705, 37.77),
      visit('C', 3, 'cancel_pending', 55.7, 37.76),
      visit('D', 4, 'in_progress', 55.707, 37.761),
      visit('E', 5, 'planned', null, null),
      visit('F', 6, 'planned', 55.713, 37.748),
    ],
  };
  return toEngineerDay(raw).visits;
}

describe('маршрут по визитам — если /me/route пуст', () => {
  it('старт — последняя выполненная, точки — текущая и оставшиеся с координатами', () => {
    const route = routeFromVisits(visitsWithPoints());
    expect(route.start).toEqual({ lat: 55.705, lon: 37.77 });
    expect(route.points.map((p) => p.requestId)).toEqual(['D', 'F']);
    expect(route.line).toEqual([
      [55.705, 37.77],
      [55.707, 37.761],
      [55.713, 37.748],
    ]);
  });

  it('ответ /me/route с точками важнее; пустой — заменяем визитами', () => {
    const visits = visitsWithPoints();
    const fromApi = toEngineerRoute(raw);
    const route = effectiveRoute(fromApi, visits);
    expect(route.start).toBe(fromApi.start);
    expect(route.line).toBe(fromApi.line);
    // номера на карте — как в списке дня: бэк нумерует оставшиеся точки заново с 1
    expect(route.points.map((p) => [p.requestId, p.sequence])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
    const numbered = toEngineerRoute({
      ...raw,
      points: [
        { request_id: 'D', sequence: 4, lat: 55.707, lon: 37.761 },
        { request_id: 'F', sequence: 6, lat: 55.713, lon: 37.748 },
      ],
    });
    expect(effectiveRoute(numbered, visits)).toBe(numbered);
    const empty = toEngineerRoute({ transport: 'walk', points: [], geometry: null });
    const byVisits = effectiveRoute(empty, visits);
    expect(byVisits.points.map((p) => p.requestId)).toEqual(['D', 'F']);
    expect(byVisits.transport).toBe('walk');
    expect(effectiveRoute(undefined, visits).points).toHaveLength(2);
  });
});

const raw: EngineerRoute = {
  transport: 'car',
  start: { lat: 55.7098, lon: 37.7805, label: 'ул. Окская' },
  points: [
    { request_id: 'B', sequence: 6, lat: 55.7133, lon: 37.7481 },
    { request_id: 'A', sequence: 5, lat: 55.7071, lon: 37.7612 },
    { request_id: 'X', sequence: 7, lat: Number.NaN, lon: 37.7 },
  ],
  geometry: {
    type: 'LineString',
    coordinates: [
      [37.7805, 55.7098],
      [37.7612, 55.7071],
      [37.7481, 55.7133],
    ],
  },
};

describe('toEngineerRoute', () => {
  it('точки по sequence, без битых координат; линия [lon, lat] → [lat, lon]', () => {
    const route = toEngineerRoute(raw);
    expect(route.points.map((p) => p.requestId)).toEqual(['A', 'B']);
    expect(route.line[0]).toEqual([55.7098, 37.7805]);
    expect(route.start).toEqual({ lat: 55.7098, lon: 37.7805 });
    expect(route.transport).toBe('car');
  });

  it('пустой ответ — пустой маршрут', () => {
    expect(toEngineerRoute(null)).toEqual({ transport: null, start: null, points: [], line: [] });
  });
});

describe('ссылки в Яндекс Карты', () => {
  const route = toEngineerRoute(raw);
  const rtext = (url: string | null) => new URL(url ?? '').searchParams.get('rtext');

  it('«До следующей» — старт и первая точка', () => {
    expect(rtext(nextLegUrl(route, 'car'))).toBe('55.709800,37.780500~55.707100,37.761200');
  });

  it('«Маршрут на день» — все точки', () => {
    expect(rtext(dayRouteUrl(route, 'walk'))?.split('~')).toHaveLength(3);
    expect(dayRouteUrl(route, 'walk')).toMatch(/&rtt=pd$/);
  });

  it('из карточки — до этой заявки включительно; нет в маршруте — ссылки нет', () => {
    expect(rtext(routeUrlTo(route, 'A', 'car'))?.split('~')).toHaveLength(2);
    expect(rtext(routeUrlTo(route, 'B', 'car'))?.split('~')).toHaveLength(3);
    expect(routeUrlTo(route, 'Z', 'car')).toBeNull();
  });

  it('без старта — от первой точки; одной точки мало', () => {
    const noStart = toEngineerRoute({ ...raw, start: null });
    expect(rtext(dayRouteUrl(noStart, 'car'))).toBe('55.707100,37.761200~55.713300,37.748100');
    expect(nextLegUrl(noStart, 'car')).toBeNull();
  });

  it('транспорт: фактический, иначе по справочнику, иначе из маршрута', () => {
    expect(linkTransport({ actualTransport: 'bike', transport: 'car' })).toBe('bike');
    expect(linkTransport({ actualTransport: null, transport: 'walk' }, route)).toBe('walk');
    expect(linkTransport({ actualTransport: null, transport: null }, route)).toBe('car');
    expect(linkTransport({ actualTransport: null, transport: null })).toBe('car');
  });
});
