import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overlayModel } from '@/adapters/__fixtures__/dayOverlays';
import type { YMaps } from '@/lib/yandexMapsApi';
import { buildDayMapData } from './dayMapData';
import { YandexDayMap } from './YandexDayMap';

type Handler = () => void;

/** Метки последней отрисовки: свойства и обработчик клика. */
const placemarks: { properties: Record<string, unknown>; click?: Handler }[] = [];
const layouts: string[] = [];
let tileHandler: ((event: { get(name: string): unknown }) => void) | null = null;

class FakeMap {
  geoObjects = {
    add: vi.fn(),
    removeAll: vi.fn(() => placemarks.splice(0)),
    getBounds: () => null,
  };
  layers = {
    each: (
      callback: (layer: { events: { add(type: string, h: typeof tileHandler): void } }) => void,
    ) => callback({ events: { add: (_type, h) => (tileHandler = h) } }),
  };
  setBounds = vi.fn(() => Promise.resolve());
  setCenter = vi.fn();
  getZoom = () => 12;
  setZoom = vi.fn();
  destroy = vi.fn();
  container = { fitToViewport: vi.fn() };
}

const fakeYmaps = {
  ready: () => Promise.resolve(),
  Map: FakeMap,
  Placemark: class {
    events: { add(type: string, handler: Handler): void };
    constructor(_coordinates: number[], properties: Record<string, unknown>) {
      const entry: (typeof placemarks)[number] = { properties };
      placemarks.push(entry);
      this.events = { add: (type, handler) => type === 'click' && (entry.click = handler) };
    }
  },
  Polyline: class {},
  templateLayoutFactory: { createClass: (template: string) => layouts.push(template) },
  multiRouter: { MultiRoute: class {} },
} as unknown as YMaps;

vi.mock('@/lib/yandexMapsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/yandexMapsApi')>();
  return {
    ...actual,
    YANDEX_MAPS_KEY: 'test-key',
    loadYandexMaps: vi.fn(() =>
      actual.yandexMapsUnavailable()
        ? Promise.reject(new Error('нет'))
        : Promise.resolve(fakeYmaps),
    ),
  };
});

const data = buildDayMapData({
  model: overlayModel(),
  geojson: null,
  filters: { status: null, type: null },
  brigade: null,
  selectedRequest: null,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Карта дня на Яндекс Картах', () => {
  it('метки заявок с подсказкой; клик по метке — заявка в диалоге, по офису — ничего', async () => {
    const onMarkerClick = vi.fn();
    render(<YandexDayMap data={data} onMarkerClick={onMarkerClick} fallback={<p>Карта OSM</p>} />);
    await waitFor(() => expect(placemarks).toHaveLength(data.markers.length + 1));
    act(() => tileHandler?.({ get: () => 16 }));

    const office = placemarks.find((p) => p.properties.hintTitle === 'Офис')!;
    expect(office.click).toBeUndefined();
    const urgent = placemarks.find((p) => String(p.properties.hintTitle).startsWith('№305800007'))!;
    expect(urgent.properties.hintContent).toBe(urgent.properties.hintTitle);
    urgent.click?.();
    expect(onMarkerClick).toHaveBeenCalledWith('305800007');
    expect(screen.getByRole('button', { name: 'Приблизить' })).toBeInTheDocument();
    // макеты меток создаются один раз на загрузку API
    expect(layouts).toHaveLength(2);
  });

  it('тайлы Яндекса не пришли — карта OSM', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    tileHandler = null;
    render(<YandexDayMap data={data} onMarkerClick={vi.fn()} fallback={<p>Карта OSM</p>} />);
    await waitFor(() => expect(tileHandler).not.toBeNull());
    act(() => vi.advanceTimersByTime(12_500));
    expect(screen.getByText('Карта OSM')).toBeInTheDocument();
  });
});
