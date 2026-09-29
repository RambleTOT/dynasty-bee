import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { YMaps } from '@/lib/yandexMapsApi';
import { YandexRouteMap } from './YandexRouteMap';

type Handler = () => void;

/** Метки последней отрисовки: подсказка и обработчик клика. */
const placemarks: { hint: unknown; click?: Handler }[] = [];

class FakeMap {
  geoObjects = {
    add: vi.fn(),
    removeAll: vi.fn(() => placemarks.splice(0)),
    getBounds: () => null,
  };
  layers = { each: vi.fn() };
  setBounds = vi.fn();
  setCenter = vi.fn();
  destroy = vi.fn();
  container = { fitToViewport: vi.fn() };
}

const fakeYmaps = {
  ready: () => Promise.resolve(),
  Map: FakeMap,
  Placemark: class {
    events: { add(type: string, handler: Handler): void };
    constructor(_coordinates: number[], properties: Record<string, unknown>) {
      const entry: (typeof placemarks)[number] = { hint: properties.hintContent };
      placemarks.push(entry);
      this.events = { add: (type, handler) => type === 'click' && (entry.click = handler) };
    }
  },
  Polyline: class {},
  multiRouter: {
    MultiRoute: class {
      model = { events: { add: vi.fn() } };
      getBounds = () => null;
    },
  },
} as unknown as YMaps;

vi.mock('@/lib/yandexMapsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/yandexMapsApi')>()),
  YANDEX_MAPS_KEY: 'test-key',
  loadYandexMaps: vi.fn(() => Promise.resolve(fakeYmaps)),
}));

describe('YandexRouteMap: клик по точке маршрута', () => {
  it('точка с заявкой — onStopClick(№), старт не кликается', async () => {
    const onStopClick = vi.fn();
    render(
      <YandexRouteMap
        start={{ lat: 55.7, lon: 37.6 }}
        stops={[
          { lat: 55.71, lon: 37.61, number: 4, hint: '№305871402', id: '305871402' },
          { lat: 55.72, lon: 37.62, number: 5, hint: '№305866318', id: '305866318' },
        ]}
        transport="car"
        colorVar="--engineer-route"
        fallback={<p>Карта OSM</p>}
        onStopClick={onStopClick}
      />,
    );
    await waitFor(() => expect(placemarks).toHaveLength(3));
    expect(placemarks[0].click).toBeUndefined();
    placemarks.find((p) => p.hint === '№305866318')?.click?.();
    expect(onStopClick).toHaveBeenCalledWith('305866318');
  });
});
