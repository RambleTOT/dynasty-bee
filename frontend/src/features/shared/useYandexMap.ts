/**
 * Встроенная Яндекс Карта на элементе: загрузка JavaScript API, карта, проверка тайлов.
 * - Нет ключа или API не загрузился — `failed`: экран показывает карту OSM.
 * - Тайлы не пришли за `TILES_TIMEOUT_MS` (ключ не активен, кончился суточный лимит) — карту
 *   убираем, до перезагрузки страницы Яндекс не грузим (`markYandexMapsUnavailable`), `failed`.
 */
import { useEffect, useRef, useState } from 'react';
import {
  loadYandexMaps,
  markYandexMapsUnavailable,
  YANDEX_MAPS_KEY,
  yandexMapsUnavailable,
  type YMap,
  type YMaps,
} from '@/lib/yandexMapsApi';

/** Сколько ждём первые тайлы карты, прежде чем уйти на карту OSM. */
export const TILES_TIMEOUT_MS = 12_000;

export interface YandexMapHandle {
  ymaps: YMaps;
  map: YMap;
}

export function useYandexMap({ controls = [] }: { controls?: string[] } = {}) {
  const element = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<YandexMapHandle | null>(null);
  const [failed, setFailed] = useState(() => !YANDEX_MAPS_KEY || yandexMapsUnavailable());
  const controlsRef = useRef(controls);

  useEffect(() => {
    if (!YANDEX_MAPS_KEY || yandexMapsUnavailable()) return;
    let cancelled = false;
    let current: YandexMapHandle | null = null;
    let tilesTimer: ReturnType<typeof setTimeout> | undefined;
    loadYandexMaps()
      .then((ymaps) => {
        if (cancelled || !element.current) return;
        const map = new ymaps.Map(
          element.current,
          { center: [55.751, 37.618], zoom: 11, controls: controlsRef.current },
          {
            suppressMapOpenBlock: true,
            yandexMapDisablePoiInteractivity: true,
            // высота экрана меняется (баннер, шторка, боковая панель) — карта подстраивается сама
            autoFitToViewport: 'always',
          },
        );
        current = { ymaps, map };
        let tiles = false;
        map.layers.each((layer) =>
          layer.events.add('tileloadchange', (event) => {
            if (Number(event.get('readyTileNumber')) > 0) tiles = true;
          }),
        );
        tilesTimer = setTimeout(() => {
          if (cancelled || tiles) return;
          markYandexMapsUnavailable();
          map.destroy();
          current = null;
          setHandle(null);
          setFailed(true);
        }, TILES_TIMEOUT_MS);
        setHandle(current);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(tilesTimer);
      current?.map.destroy();
      current = null;
    };
  }, []);

  return { element, handle, failed };
}
