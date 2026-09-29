/**
 * Карта дня (DS-03): маршруты бригад, точки с номерами, аварии, неназначенные, офис (FRONTEND_SPEC §6.6).
 * Основная — Яндекс Карта; не загрузилась (нет ключа, лимит, сеть) — та же карта на OpenStreetMap.
 * Клик по маркеру — заявка в диалоге (`onOpenRequest`).
 */
import {
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Layers,
  MapPin,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { GeoJsonCollection } from '@/api/types';
import type { DayFilters, DayModel } from '@/adapters/dayModel';
import { hasNonCarRoutes } from '@/adapters/geo';
import { countOf, PL_REQUEST } from '@/lib/format';
import { isTransport } from '@/lib/statuses';
import { yandexRouteUrl } from '@/lib/yandexMaps';
import { YANDEX_MAPS_KEY } from '@/lib/yandexMapsApi';
import { buttonClassName, cx, Spinner } from '@/ui';
import { buildDayMapData, type MapHighlight } from './dayMapData';
import { YandexDayMap } from './YandexDayMap';
import styles from './DayMap.module.css';

export type { MapHighlight } from './dayMapData';

// Leaflet — отдельным чанком: грузится, только если Яндекс Карта не открылась.
const LeafletDayMap = lazy(() => import('./LeafletDayMap'));

interface DayMapProps {
  model: DayModel;
  geojson: GeoJsonCollection | null;
  filters: DayFilters;
  brigade: string | null;
  selectedRequest: string | null;
  highlight?: MapHighlight | null;
  onOpenRequest: (id: string) => void;
}

export function DayMap({
  model,
  geojson,
  filters,
  brigade,
  selectedRequest,
  highlight,
  onOpenRequest,
}: DayMapProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const hasPlan = Boolean(model.plan);
  const data = useMemo(
    () => buildDayMapData({ model, geojson, filters, brigade, selectedRequest, highlight }),
    [model, geojson, filters, brigade, selectedRequest, highlight],
  );

  const requestCount = model.requests.length;
  const nonCar = hasPlan && hasNonCarRoutes(model);

  // маршрут выбранной бригады в Яндекс Картах: на синтетике координаты условные — ссылки нет (§6.8)
  const brigadeRoute =
    hasPlan && brigade && !model.coordsApprox ? model.routeByEngineer.get(brigade) : undefined;
  const brigadeEngineer = brigade ? model.engineerById.get(brigade) : undefined;
  const brigadeStops = (brigadeRoute?.visits ?? [])
    .filter((v) => v.point)
    .map((v) => ({ lat: v.point![0], lon: v.point![1] }));
  const brigadeStart = brigadeRoute?.start
    ? { lat: brigadeRoute.start[0], lon: brigadeRoute.start[1] }
    : null;
  const brigadeUrl =
    brigadeEngineer && brigadeStops.length > 0
      ? yandexRouteUrl(
          brigadeStart ?? brigadeStops[0],
          brigadeStart ? brigadeStops : brigadeStops.slice(1),
          isTransport(brigadeEngineer.transport) ? brigadeEngineer.transport : 'car',
        )
      : null;

  const osm = (
    <Suspense
      fallback={
        <div className={styles.yloading}>
          <Spinner size={28} label="Загрузка карты" />
        </div>
      }
    >
      <LeafletDayMap data={data} onMarkerClick={onOpenRequest} />
    </Suspense>
  );

  return (
    <div className={styles.wrap}>
      {YANDEX_MAPS_KEY ? (
        <YandexDayMap data={data} onMarkerClick={onOpenRequest} fallback={osm} />
      ) : (
        osm
      )}

      {brigadeUrl && (
        <div className={styles.yandexBar}>
          <a
            href={brigadeUrl}
            target="_blank"
            rel="noopener"
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          >
            <ExternalLink size={16} aria-hidden />
            Маршрут в Яндекс Картах
          </a>
        </div>
      )}
      {!hasPlan && (
        <div className={styles.topPill}>
          <MapPin size={16} aria-hidden />
          {countOf(requestCount, PL_REQUEST)}{' '}
          {model.source === 'csv' ? 'загружены из CSV' : 'на день'} · план ещё не построен
        </div>
      )}
      {model.coordsApprox && (
        <div className={cx(styles.topPill, hasPlan ? undefined : styles.topPillSecond)}>
          <TriangleAlert size={16} aria-hidden />
          Координаты условные
        </div>
      )}

      <div className={cx(styles.legend, legendOpen && styles.legendOpen)}>
        {legendOpen && (
          <ul className={styles.legendList}>
            <li>
              <span className={cx(styles.legendLine)} aria-hidden /> линия — маршрут бригады, цвет —
              бригада
            </li>
            <li>
              <span className={cx(styles.stop, styles.legendIcon)} aria-hidden>
                3
              </span>
              порядок визита в маршруте
            </li>
            <li>
              <span
                className={cx(styles.stop, styles.done, styles.c12, styles.legendIcon)}
                aria-hidden
              >
                <Check size={12} strokeWidth={2.5} />
              </span>
              заявка выполнена
            </li>
            <li>
              <span className={cx(styles.urgent, styles.legendIcon)} aria-hidden>
                <Zap size={12} strokeWidth={2.25} />
              </span>
              аварийные работы
            </li>
            <li>
              <span className={cx(styles.unassigned, styles.legendIcon)} aria-hidden>
                !
              </span>
              не назначена
            </li>
            <li>
              <span className={cx(styles.office, styles.legendIcon)} aria-hidden>
                <Building2 size={12} strokeWidth={2.25} />
              </span>
              офис
            </li>
            <li className={styles.legendNote}>нажмите на точку — откроется заявка</li>
            {nonCar && (
              <li className={styles.legendNote}>линия — по дорогам, время — по типу транспорта</li>
            )}
            {model.coordsApprox && (
              <li className={styles.legendNote}>координаты условные: прямые отрезки</li>
            )}
          </ul>
        )}
        <button
          type="button"
          className={styles.legendToggle}
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
        >
          <Layers size={16} aria-hidden />
          Легенда · линия = маршрут бригады
          {legendOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
