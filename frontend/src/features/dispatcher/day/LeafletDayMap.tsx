/**
 * Запасная карта дня на OpenStreetMap — когда Яндекс Карта не загрузилась (нет ключа, лимит, сеть).
 * Рисует те же маркеры и линии, что и Яндекс (`dayMapData.ts`). Цвет линии — CSS-класс на <path>:
 * Leaflet пишет цвет в атрибут, где var() не работает.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Minus, Plus } from 'lucide-react';
import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { MOSCOW_CENTER, OSM_TILES, type LatLng } from '@/lib/map';
import mapStyles from '@/lib/map.module.css';
import { IconButton, cx } from '@/ui';
import type { DayMapData } from './dayMapData';
import styles from './DayMap.module.css';

function FitBounds({ points, fitKey }: { points: LatLng[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2)
      map.fitBounds(L.latLngBounds(points), { padding: [56, 56], maxZoom: 14 });
    else if (points.length === 1) map.setView(points[0], 13);
    // только при смене дня / региона: иначе опрос каждые 10 с сбрасывал бы масштаб
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

function ZoomButtons() {
  const map = useMap();
  return (
    <div className={styles.zoom}>
      <IconButton icon={Plus} label="Приблизить" variant="secondary" onClick={() => map.zoomIn()} />
      <IconButton icon={Minus} label="Отдалить" variant="secondary" onClick={() => map.zoomOut()} />
    </div>
  );
}

export default function LeafletDayMap({
  data,
  onMarkerClick,
}: {
  data: DayMapData;
  onMarkerClick: (id: string) => void;
}) {
  const { office } = data;
  return (
    <MapContainer
      className={cx(mapStyles.muted, styles.map)}
      center={data.bounds[0] ?? MOSCOW_CENTER}
      zoom={11}
      zoomControl={false}
      attributionControl
    >
      <TileLayer
        url={OSM_TILES.url}
        attribution={OSM_TILES.attribution}
        maxZoom={OSM_TILES.maxZoom}
      />
      <FitBounds points={data.bounds} fitKey={data.fitKey} />
      {data.lines.map((line) => (
        <Polyline
          key={line.key}
          positions={line.points}
          pathOptions={
            line.ghost
              ? { className: line.className, weight: 3, dashArray: '6 6', opacity: 1 }
              : {
                  className: line.className,
                  weight: 4,
                  opacity: line.dim ? 0.25 : 0.9,
                  dashArray: line.dashed ? '10 6' : undefined,
                }
          }
        />
      ))}
      {office && (
        <Marker
          position={office.point}
          icon={L.divIcon({
            className: styles.marker,
            html: office.html,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          })}
          zIndexOffset={400}
        >
          <Tooltip direction="top" offset={[0, -18]} className={styles.tooltip} opacity={1}>
            <div className={styles.tipTitle}>{office.title}</div>
            {office.sub && <div className={styles.tipSub}>{office.sub}</div>}
          </Tooltip>
        </Marker>
      )}
      {data.markers.map((marker) => (
        <Marker
          key={marker.key}
          position={marker.point}
          icon={L.divIcon({
            className: cx(styles.marker, marker.dim && styles.dim),
            html: marker.html,
            iconSize: [marker.size, marker.size],
            iconAnchor: [marker.size / 2, marker.size / 2],
          })}
          zIndexOffset={marker.z}
          eventHandlers={{ click: () => onMarkerClick(marker.id) }}
        >
          <Tooltip
            direction="top"
            offset={[0, -marker.size / 2 - 4]}
            className={styles.tooltip}
            opacity={1}
          >
            <div className={styles.tipTitle}>{marker.title}</div>
            <div className={styles.tipSub}>{marker.sub}</div>
          </Tooltip>
        </Marker>
      ))}
      <ZoomButtons />
    </MapContainer>
  );
}
