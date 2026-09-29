import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import type { EngineerRouteModel } from '@/adapters/engineerRoute';
import { MOSCOW_CENTER, OSM_TILES, type LatLng } from '@/lib/map';
import mapStyles from '@/lib/map.module.css';
import { cx } from '@/ui';
import styles from './EngineerMap.module.css';

/** Отступы при подгонке маршрута: сверху — переключатель «Список / Карта». */
const FIT_PADDING = {
  paddingTopLeft: [24, 72] as L.PointTuple,
  paddingBottomRight: [24, 48] as L.PointTuple,
};

/**
 * Подгоняет карту под маршрут, когда меняется набор точек (опрос не сбивает ручное перемещение),
 * и пересчитывает размер, когда меняется высота экрана (баннер, шторка).
 */
function FitRoute({ bounds, signature }: { bounds: LatLng[]; signature: string }) {
  const map = useMap();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    const fit = () => {
      const size = map.getSize();
      const points = boundsRef.current;
      if (size.x === 0 || size.y === 0 || points.length === 0) return;
      if (points.length === 1) map.setView(points[0], 15);
      else map.fitBounds(points, { ...FIT_PADDING, maxZoom: 16 });
      fitted.current = signature;
    };
    if (fitted.current !== signature) fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      if (fitted.current !== signature) fit();
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, signature]);

  return null;
}

/** Маркер-номер визита (DESIGN_SPEC §2.5). Номер — `sequence`, как в кружках списка. */
function markerIcon(sequence: number): L.DivIcon {
  return L.divIcon({
    className: styles.marker,
    html: String(sequence),
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/**
 * E-04 «Карта»: маршрут по оставшимся точкам — линия `geometry` (или прямые по точкам) и
 * маркеры-номера. Цвет — `--engineer-route` страницы (§10.2). Подложка OSM приглушена.
 * Нажали на маркер — `onPointClick` (заявка в шторке).
 */
export default function EngineerMap({
  route,
  onPointClick,
}: {
  route: EngineerRouteModel;
  onPointClick?: (requestId: string) => void;
}) {
  const line = useMemo<LatLng[]>(() => {
    if (route.line.length > 1) return route.line;
    const points = [...(route.start ? [route.start] : []), ...route.points];
    return points.map((point): LatLng => [point.lat, point.lon]);
  }, [route]);

  const bounds = useMemo<LatLng[]>(
    () => [...line, ...route.points.map((point): LatLng => [point.lat, point.lon])],
    [line, route.points],
  );
  const signature = route.points.map((point) => point.requestId).join(',');
  const markers = useMemo(
    () => route.points.map((point) => ({ ...point, icon: markerIcon(point.sequence) })),
    [route.points],
  );

  return (
    <MapContainer
      center={MOSCOW_CENTER}
      zoom={12}
      zoomControl={false}
      className={cx(styles.map, mapStyles.muted)}
    >
      <TileLayer
        url={OSM_TILES.url}
        attribution={OSM_TILES.attribution}
        maxZoom={OSM_TILES.maxZoom}
      />
      {line.length > 1 && (
        <>
          <Polyline positions={line} className={styles.casing} interactive={false} />
          <Polyline positions={line} className={styles.line} interactive={false} />
        </>
      )}
      {markers.map((point) => (
        <Marker
          key={point.requestId}
          position={[point.lat, point.lon]}
          icon={point.icon}
          title={`№${point.requestId}`}
          keyboard={false}
          eventHandlers={onPointClick ? { click: () => onPointClick(point.requestId) } : undefined}
        />
      ))}
      <FitRoute bounds={bounds} signature={signature} />
    </MapContainer>
  );
}
