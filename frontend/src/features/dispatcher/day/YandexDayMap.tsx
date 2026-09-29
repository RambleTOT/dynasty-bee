/**
 * Карта дня на Яндекс Картах — основная (DS-03). Линии маршрутов цветом бригады (геометрия с бэка),
 * маркеры те же, что на карте OSM: HTML-макет метки с классами DayMap.module.css. Клик по маркеру —
 * заявка в диалоге. Нет ключа, API не загрузился или не пришли тайлы — `fallback` (карта OSM).
 */
import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { LatLng } from '@/lib/map';
import type { YLayoutClass, YMap, YMaps } from '@/lib/yandexMapsApi';
import { IconButton, Spinner, cx } from '@/ui';
import { useYandexMap, type YandexMapHandle } from '../../shared/useYandexMap';
import type { DayMapData } from './dayMapData';
import styles from './DayMap.module.css';

/** Макеты меток — по одному на загрузку API: HTML маркера и подсказка (текст экранирует шаблон). */
const layouts = new WeakMap<YMaps, { icon: YLayoutClass; hint: YLayoutClass }>();

function layoutsOf(ymaps: YMaps) {
  let found = layouts.get(ymaps);
  if (!found) {
    found = {
      icon: ymaps.templateLayoutFactory.createClass('{{ properties.html|raw }}'),
      hint: ymaps.templateLayoutFactory.createClass(
        `<div class="${styles.yhint}"><div class="${styles.tipTitle}">{{ properties.hintTitle }}</div>` +
          `{% if properties.hintSub %}<div class="${styles.tipSub}">{{ properties.hintSub }}</div>{% endif %}</div>`,
      ),
    };
    layouts.set(ymaps, found);
  }
  return found;
}

function colorOf(element: HTMLElement, name: string): string {
  const style = getComputedStyle(element);
  return (style.getPropertyValue(name) || style.getPropertyValue('--route-1')).trim();
}

function draw(
  { ymaps, map }: YandexMapHandle,
  element: HTMLElement,
  data: DayMapData,
  onClick: (id: string) => void,
) {
  map.geoObjects.removeAll();
  const { icon, hint } = layoutsOf(ymaps);
  for (const line of data.lines) {
    map.geoObjects.add(
      new ymaps.Polyline(
        line.points.map(([lat, lon]) => [lat, lon]),
        {},
        {
          strokeColor: colorOf(element, line.colorVar),
          strokeWidth: line.ghost ? 3 : 4,
          strokeOpacity: line.ghost ? 1 : line.dim ? 0.25 : 0.9,
          strokeStyle: line.dashed ? 'dash' : 'solid',
          interactivityModel: 'default#transparent',
        },
      ),
    );
  }
  const place = (
    point: LatLng,
    html: string,
    size: number,
    z: number,
    title: string,
    sub: string,
    id: string | null,
  ) => {
    const placemark = new ymaps.Placemark(
      [point[0], point[1]],
      // hintContent — чтобы подсказка открывалась; показывает её свой макет `hintLayout`
      { html, hintContent: title, hintTitle: title, hintSub: sub },
      {
        iconLayout: icon,
        iconShape: { type: 'Circle', coordinates: [0, 0], radius: size / 2 + 2 },
        hintLayout: hint,
        hasBalloon: false,
        cursor: id ? 'pointer' : 'default',
        zIndex: 1000 + z,
        zIndexHover: 3000,
      },
    );
    if (id) placemark.events.add('click', () => onClick(id));
    map.geoObjects.add(placemark);
  };
  if (data.office) {
    const { office } = data;
    place(
      office.point,
      `<div class="${cx(styles.marker, styles.ymarker)}">${office.html}</div>`,
      28,
      400,
      office.title,
      office.sub,
      null,
    );
  }
  for (const marker of data.markers) {
    const html = `<div class="${cx(styles.marker, styles.ymarker, marker.dim && styles.dim)}">${marker.html}</div>`;
    place(marker.point, html, marker.size, marker.z, marker.title, marker.sub, marker.id);
  }
}

/** Масштаб по точкам дня: одна точка — центр, несколько — рамка, не ближе 14-го масштаба. */
function fit(map: YMap, points: LatLng[]) {
  if (points.length === 1) {
    map.setCenter([points[0][0], points[0][1]], 13);
    return;
  }
  if (points.length < 2) return;
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const done = map.setBounds(
    [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ],
    { checkZoomRange: true, zoomMargin: 56 },
  );
  void done?.then(() => {
    if (map.getZoom() > 14) map.setZoom(14);
  });
}

export function YandexDayMap({
  data,
  onMarkerClick,
  fallback,
}: {
  data: DayMapData;
  onMarkerClick: (id: string) => void;
  fallback: ReactNode;
}) {
  const { element, handle, failed } = useYandexMap();
  const latest = useRef({ data, onMarkerClick });
  latest.current = { data, onMarkerClick };
  const onClick = useRef((id: string) => latest.current.onMarkerClick(id));
  const fitted = useRef<string | null>(null);

  // перерисовываем, только когда что-то изменилось: опрос раз в 10 с не мигает метками
  const signature = [
    ...data.lines.map((line) => `${line.key}:${line.points.length}`),
    ...data.markers.map(
      (marker) => `${marker.key}:${marker.point.join(',')}:${marker.title}:${marker.sub}`,
    ),
    data.office ? data.office.point.join(',') : '-',
  ].join('|');
  useEffect(() => {
    const target = element.current;
    if (!handle || !target) return;
    const current = latest.current.data;
    draw(handle, target, current, onClick.current);
    if (fitted.current !== current.fitKey) {
      fit(handle.map, current.bounds);
      fitted.current = current.fitKey;
    }
  }, [handle, element, signature, data.fitKey]);

  if (failed) return <>{fallback}</>;
  return (
    <div className={styles.ycanvas}>
      <div ref={element} className={styles.map} />
      {handle ? (
        <div className={styles.zoom}>
          <IconButton
            icon={Plus}
            label="Приблизить"
            variant="secondary"
            onClick={() => handle.map.setZoom(handle.map.getZoom() + 1, { duration: 200 })}
          />
          <IconButton
            icon={Minus}
            label="Отдалить"
            variant="secondary"
            onClick={() => handle.map.setZoom(handle.map.getZoom() - 1, { duration: 200 })}
          />
        </div>
      ) : (
        <div className={styles.yloading}>
          <Spinner size={28} label="Загрузка Яндекс Карт" />
        </div>
      )}
    </div>
  );
}
