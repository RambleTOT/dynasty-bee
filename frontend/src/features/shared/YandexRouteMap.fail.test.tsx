import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { YMaps } from '@/lib/yandexMapsApi';
import { YandexRouteMap } from './YandexRouteMap';

type Handler = (event: { get(name: string): unknown }) => void;

/** Обработчики последней карты: маршрут (`requestfail`) и тайлы (`tileloadchange`). */
const handlers = new Map<string, Handler>();
const created = { routes: 0, polylines: [] as number[][][] };

class FakeMap {
  geoObjects = { add: vi.fn(), removeAll: vi.fn(), getBounds: () => null };
  layers = { each: (callback: (layer: { events: { add(type: string, h: Handler): void } }) => void) => callback({ events: { add: (type, h) => handlers.set(type, h) } }) };
  setBounds = vi.fn();
  setCenter = vi.fn();
  destroy = vi.fn();
  container = { fitToViewport: vi.fn() };
}

const fakeYmaps = {
  ready: () => Promise.resolve(),
  Map: FakeMap,
  Placemark: class {},
  Polyline: class {
    constructor(coordinates: number[][]) {
      created.polylines.push(coordinates);
    }
  },
  multiRouter: {
    MultiRoute: class {
      model = { events: { add: (type: string, handler: Handler) => handlers.set(type, handler) } };
      getBounds = () => null;
      constructor() {
        created.routes += 1;
      }
    },
  },
} as unknown as YMaps;

vi.mock('@/lib/yandexMapsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/yandexMapsApi')>();
  return {
    ...actual,
    YANDEX_MAPS_KEY: 'test-key',
    loadYandexMaps: vi.fn(() =>
      actual.yandexMapsUnavailable() ? Promise.reject(new Error('нет')) : Promise.resolve(fakeYmaps),
    ),
  };
});

const props = {
  start: { lat: 55.7, lon: 37.6 },
  stops: [{ lat: 55.71, lon: 37.61, number: 1 }],
  line: [
    [55.7, 37.6],
    [55.705, 37.603],
    [55.71, 37.61],
  ] as [number, number][],
  transport: 'car',
  colorVar: '--route-1',
  fallback: <p>Карта OSM</p>,
};

const event = (values: Record<string, unknown>) => ({ get: (name: string) => values[name] });

afterEach(() => {
  vi.useRealTimers();
});

describe('YandexRouteMap: ключ без маршрутов, лимит, неактивный ключ', () => {
  it('Яндекс не построил маршрут — карта Яндекса остаётся, линия маршрута — с бэка', async () => {
    const first = render(<YandexRouteMap {...props} />);
    await waitFor(() => expect(handlers.has('requestfail')).toBe(true));
    act(() => handlers.get('tileloadchange')?.(event({ readyTileNumber: 16, totalTileNumber: 16 })));

    act(() => handlers.get('requestfail')?.(event({})));
    expect(screen.queryByText('Карта OSM')).toBeNull();
    expect(created.polylines.at(-1)).toEqual(props.line);
    first.unmount();

    // следующая карта сразу рисует свою линию: маршрутизатор больше не дёргаем
    const routesBefore = created.routes;
    render(<YandexRouteMap {...props} />);
    await waitFor(() => expect(created.polylines.length).toBe(2));
    expect(created.routes).toBe(routesBefore);
  });

  it('тайлы не загрузились (ключ не активен, кончился лимит) — карта OSM', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<YandexRouteMap {...props} />);
    await waitFor(() => expect(handlers.has('tileloadchange')).toBe(true));
    act(() => vi.advanceTimersByTime(12_500));
    expect(screen.getByText('Карта OSM')).toBeInTheDocument();
  });
});
