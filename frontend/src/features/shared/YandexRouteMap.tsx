/**
 * Встроенная Яндекс Карта с маршрутом: старт, точки с номерами, одна линия цветом бригады.
 * - Маршрут сначала просим у Яндекса (мультимаршрут по точкам по порядку). Не построил (бесплатный
 *   ключ: сервис маршрутов отвечает 401) — рисуем на карте Яндекса свою линию маршрута (`line`,
 *   дорожная геометрия с бэка), дальше до перезагрузки маршрутизатор не дёргаем.
 * - Нет ключа, API не загрузился или карта не грузит тайлы (ключ не активен, кончился суточный
 *   лимит) — `fallback` (карта OSM).
 * - Клик по точке с `id` — `onStopClick` (заявка в диалоге).
 * Цвет — CSS-переменная с элемента карты: JS API понимает только готовый цвет.
 */
import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import {
  markYandexRoutingUnavailable,
  routingMode,
  yandexRoutingUnavailable,
} from '@/lib/yandexMapsApi';
import { cx, Spinner } from '@/ui';
import { useYandexMap, type YandexMapHandle } from './useYandexMap';
import styles from './YandexRouteMap.module.css';

export interface RouteStop {
  lat: number;
  lon: number;
  /** Номер на метке — `sequence`. */
  number: number | string;
  hint?: string;
  /** Заявка точки: по клику — `onStopClick(id)`. */
  id?: string;
}

interface YandexRouteMapProps {
  start: { lat: number; lon: number } | null;
  stops: RouteStop[];
  /** Линия маршрута `[lat, lon]` — если Яндекс маршрут не построит; нет — прямые между точками. */
  line?: readonly (readonly [number, number])[];
  transport: string | null;
  /** CSS-переменная цвета маршрута, например `--engineer-route` или `--route-3`. */
  colorVar: string;
  fallback: ReactNode;
  className?: string;
  onStopClick?: (id: string) => void;
}

function cssColor(element: HTMLElement, name: string): string {
  const style = getComputedStyle(element);
  return (style.getPropertyValue(name) || style.getPropertyValue('--route-1')).trim();
}

function draw(
  { ymaps, map }: YandexMapHandle,
  element: HTMLElement,
  props: YandexRouteMapProps,
  onRoutingFail: () => void,
  onStopClick: (id: string) => void,
) {
  map.geoObjects.removeAll();
  const color = cssColor(element, props.colorVar);
  const refs = [...(props.start ? [props.start] : []), ...props.stops].map((p) => [p.lat, p.lon]);
  if (refs.length >= 2 && !yandexRoutingUnavailable()) {
    const route = new ymaps.multiRouter.MultiRoute(
      { referencePoints: refs, params: { routingMode: routingMode(props.transport, refs.length), results: 1 } },
      {
        boundsAutoApply: true,
        wayPointVisible: false,
        viaPointVisible: false,
        pinVisible: false,
        routeActiveStrokeColor: color,
        routeActiveStrokeWidth: 5,
        routeActivePedestrianSegmentStrokeStyle: 'solid',
        routeActivePedestrianSegmentStrokeColor: color,
      },
    );
    route.model.events.add('requestfail', onRoutingFail);
    map.geoObjects.add(route);
  } else if (refs.length >= 2) {
    const line = props.line && props.line.length >= 2 ? props.line.map(([lat, lon]) => [lat, lon]) : refs;
    map.geoObjects.add(new ymaps.Polyline(line, {}, { strokeColor: color, strokeWidth: 5, strokeOpacity: 0.9 }));
  }
  if (props.start) {
    map.geoObjects.add(
      new ymaps.Placemark([props.start.lat, props.start.lon], { hintContent: 'Старт' }, { preset: 'islands#blackCircleDotIcon' }),
    );
  }
  for (const stop of props.stops) {
    const placemark = new ymaps.Placemark(
      [stop.lat, stop.lon],
      { iconContent: String(stop.number), hintContent: stop.hint },
      { preset: 'islands#icon', iconColor: color },
    );
    const id = stop.id;
    if (id && props.onStopClick) placemark.events.add('click', () => onStopClick(id));
    map.geoObjects.add(placemark);
  }
  const bounds = map.geoObjects.getBounds();
  if (bounds && refs.length >= 2) map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 40 });
  else if (refs.length === 1) map.setCenter(refs[0], 15);
}

export function YandexRouteMap(props: YandexRouteMapProps) {
  const { element, handle, failed } = useYandexMap({ controls: ['zoomControl'] });
  const latest = useRef(props);
  latest.current = props;
  // маршрут Яндекс не построил — та же карта, но со своей линией маршрута
  const [routingFails, routingFailed] = useReducer((n: number) => n + 1, 0);
  const onRoutingFail = useRef(() => {
    markYandexRoutingUnavailable();
    routingFailed();
  });
  const onStopClick = useRef((id: string) => latest.current.onStopClick?.(id));

  // перерисовываем, только когда меняется набор точек — опрос не сбивает ручной масштаб
  const signature = [
    props.start ? `${props.start.lat},${props.start.lon}` : '-',
    ...props.stops.map((s) => `${s.number}:${s.lat},${s.lon}`),
    props.transport,
    props.line?.length ?? 0,
  ].join('|');
  useEffect(() => {
    if (handle && element.current) {
      draw(handle, element.current, latest.current, onRoutingFail.current, onStopClick.current);
    }
  }, [handle, element, signature, routingFails]);

  if (failed) return <>{props.fallback}</>;
  return (
    <div className={cx(styles.wrap, props.className)}>
      <div ref={element} className={styles.map} />
      {!handle && (
        <div className={styles.loading}>
          <Spinner size={24} label="Загрузка Яндекс Карт" />
        </div>
      )}
    </div>
  );
}
