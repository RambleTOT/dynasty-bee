/**
 * Загрузка JavaScript API Яндекс Карт 2.1 по ключу `VITE_YANDEX_MAPS_KEY` (README, «Яндекс Карты»).
 * Без ключа встроенной карты Яндекса нет — экраны показывают карту OSM. Ссылки «открыть маршрут
 * в Яндекс Картах» ключа не требуют (`lib/yandexMaps.ts`).
 */

/** Нужная нам часть API 2.1 (типов у пакета нет). */
export interface YMapsGeoObjects {
  add(object: unknown): void;
  removeAll(): void;
  getBounds(): number[][] | null;
}

/** Событие API: поля — через `get`. */
export interface YEvent {
  get(name: string): unknown;
}

export interface YEventManager {
  add(type: string, handler: (event: YEvent) => void): void;
}

export interface YMap {
  geoObjects: YMapsGeoObjects;
  /** `click` по карте: `event.get('coords')` — [широта, долгота]. */
  events: YEventManager;
  /** Слои карты: у слоя с тайлами есть событие `tileloadchange` (`readyTileNumber`). */
  layers: { each(callback: (layer: { events: YEventManager }) => void): void };
  setBounds(bounds: number[][], options?: Record<string, unknown>): PromiseLike<void> | void;
  setCenter(center: number[], zoom?: number): void;
  getZoom(): number;
  setZoom(zoom: number, options?: Record<string, unknown>): void;
  destroy(): void;
  container: { fitToViewport(): void };
}

/** Метка, линия: подписка на `click` — через `events`. */
export interface YGeoObject {
  events: YEventManager;
}

/** Класс макета из шаблона: `{{ properties.x }}` экранирует, `{{ properties.x|raw }}` — нет. */
export type YLayoutClass = unknown;

export interface YMultiRoute {
  model: { events: YEventManager };
  getBounds(): number[][] | null;
}

export interface YMaps {
  ready(): PromiseLike<void>;
  Map: new (
    element: HTMLElement,
    state: { center: number[]; zoom: number; controls?: string[] },
    options?: Record<string, unknown>,
  ) => YMap;
  Placemark: new (
    coordinates: number[],
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => YGeoObject;
  Polyline: new (
    coordinates: number[][],
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => unknown;
  templateLayoutFactory: { createClass(template: string): YLayoutClass };
  multiRouter: {
    MultiRoute: new (
      model: { referencePoints: number[][]; params?: Record<string, unknown> },
      options?: Record<string, unknown>,
    ) => YMultiRoute;
  };
}

declare global {
  interface Window {
    ymaps?: YMaps;
  }
}

export const YANDEX_MAPS_KEY: string | null = import.meta.env.VITE_YANDEX_MAPS_KEY?.trim() || null;

let loading: Promise<YMaps> | null = null;

/**
 * Карта Яндекса не грузит тайлы: ключ не активен, кончился суточный лимит, нет сети. До перезагрузки
 * страницы встроенную карту Яндекса не показываем — остаётся карта OSM, лимит не тратим.
 */
let unavailable = false;
export const yandexMapsUnavailable = () => unavailable;
export function markYandexMapsUnavailable() {
  unavailable = true;
}

/**
 * Карта есть, но маршрут Яндекс не строит (бесплатный ключ: сервис маршрутов отвечает 401). До
 * перезагрузки рисуем на карте Яндекса свою линию маршрута с бэка и маршрутизатор не дёргаем.
 */
let routingUnavailable = false;
export const yandexRoutingUnavailable = () => routingUnavailable;
export function markYandexRoutingUnavailable() {
  routingUnavailable = true;
}

export function loadYandexMaps(): Promise<YMaps> {
  if (!YANDEX_MAPS_KEY) return Promise.reject(new Error('Нет ключа Яндекс Карт'));
  if (unavailable) return Promise.reject(new Error('Яндекс Карты недоступны'));
  if (loading) return loading;
  loading = new Promise<YMaps>((resolve, reject) => {
    const done = () => {
      const ymaps = window.ymaps;
      if (!ymaps) {
        reject(new Error('Яндекс Карты не загрузились'));
        return;
      }
      ymaps.ready().then(() => resolve(ymaps), reject);
    };
    if (window.ymaps) {
      done();
      return;
    }
    const script = document.createElement('script');
    // csp=true и точная версия — режим API для сайта с Content-Security-Policy (deploy/nginx):
    // стили через blob:, без inline-стилей и eval
    script.src = `https://api-maps.yandex.ru/2.1.79/?apikey=${encodeURIComponent(YANDEX_MAPS_KEY)}&lang=ru_RU&csp=true`;
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error('Яндекс Карты не загрузились'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null; // следующая попытка — заново
    throw error;
  });
  return loading;
}

/** `routingMode` мультимаршрута по транспорту бригады. */
export function routingMode(transport: string | null | undefined, points: number): string {
  switch (transport) {
    case 'walk':
      return 'pedestrian';
    case 'bike':
      return 'bicycle';
    case 'public_transport':
      // общественный транспорт Яндекс строит только между двумя точками
      return points <= 2 ? 'masstransit' : 'auto';
    default:
      return 'auto';
  }
}
