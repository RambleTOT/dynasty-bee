import { Navigation, Route } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { currentVisit, type EngineerDayModel } from '@/adapters/engineerDay';
import {
  dayRouteUrl,
  linkTransport,
  nextLegUrl,
  type EngineerRouteModel,
} from '@/adapters/engineerRoute';
import { requestNo } from '@/lib/engineerLabels';
import { YANDEX_MAPS_KEY } from '@/lib/yandexMapsApi';
import { buttonClassName, cx, Spinner } from '@/ui';
import { YandexRouteMap } from '../shared/YandexRouteMap';
import { AddressText } from './VisitBits';
import list from './VisitList.module.css';
import styles from './MapScreen.module.css';

// Leaflet — отдельным чанком: пока инженер не открыл карту, телефон его не грузит.
const EngineerMap = lazy(() => import('./EngineerMap'));

const linkClass = buttonClassName({ variant: 'tertiary', size: 'lg', fullWidth: true });

/** «ТЕКУЩАЯ · В ПУТИ» / «ТЕКУЩАЯ · В РАБОТЕ», иначе «СЛЕДУЮЩАЯ · К {arrival}» (§9.2 E-04). */
function sheetLabel(visit: NonNullable<ReturnType<typeof currentVisit>>): string {
  if (visit.status === 'en_route') return 'ТЕКУЩАЯ · В ПУТИ';
  if (visit.status === 'in_progress') return 'ТЕКУЩАЯ · В РАБОТЕ';
  return visit.arrival ? `СЛЕДУЮЩАЯ · К ${visit.arrival}` : 'СЛЕДУЮЩАЯ';
}

/** Шторка карты: текущая заявка и ссылки «До следующей» / «Маршрут на день» в Яндекс Карты. */
function MapSheet({ day, route }: { day: EngineerDayModel; route: EngineerRouteModel }) {
  const visit = currentVisit(day);
  if (!visit) return null;
  const transport = linkTransport(day.engineer, route);
  const next = nextLegUrl(route, transport);
  const all = dayRouteUrl(route, transport);
  return (
    <section className={styles.sheet} aria-label="Текущая заявка">
      <span className={styles.handle} aria-hidden />
      <div className={list.eyebrow}>{sheetLabel(visit)}</div>
      <div className={styles.title}>
        {requestNo(visit.id)} · <AddressText address={visit.address} />
      </div>
      <div className={styles.sub}>
        {visit.title}
        {visit.windowShort && ` · окно ${visit.windowShort}`}
      </div>
      {(next || all) && (
        <>
          <div className={styles.actions}>
            {next && (
              <a href={next} target="_blank" rel="noopener" className={linkClass}>
                <Navigation size={20} aria-hidden />
                До следующей
              </a>
            )}
            {all && (
              <a href={all} target="_blank" rel="noopener" className={linkClass}>
                <Route size={20} aria-hidden />
                Маршрут на день
              </a>
            )}
          </div>
          <div className={styles.hint}>Откроется в Яндекс Картах</div>
        </>
      )}
    </section>
  );
}

/**
 * E-04 «Карта» (и просмотр маршрута в E-01): карта на всю высоту, сверху переключатель
 * «Список / Карта», снизу — шторка с текущей заявкой (`withSheet`). Нажали на точку — `onOpenPoint`
 * (заявка в шторке).
 */
export function MapScreen({
  day,
  route,
  viewSwitch,
  withSheet,
  onOpenPoint,
}: {
  day: EngineerDayModel;
  route: EngineerRouteModel;
  viewSwitch: ReactNode;
  withSheet: boolean;
  onOpenPoint: (requestId: string) => void;
}) {
  const sheet = withSheet && currentVisit(day) !== null;
  return (
    <div className={cx(styles.screen, sheet && styles.withSheet)}>
      <div className={styles.area}>
        <Suspense
          fallback={
            <div className={styles.loading}>
              <Spinner size={24} label="Загрузка карты" />
            </div>
          }
        >
          {YANDEX_MAPS_KEY ? (
            // маршрут строит Яндекс по оставшимся точкам, иначе — линия с бэка; нет ключа или тайлов — OSM
            <YandexRouteMap
              className={styles.yandex}
              start={route.start}
              stops={route.points.map((point) => ({
                lat: point.lat,
                lon: point.lon,
                number: point.sequence,
                hint: requestNo(point.requestId),
                id: point.requestId,
              }))}
              line={route.line}
              transport={linkTransport(day.engineer, route)}
              colorVar="--engineer-route"
              fallback={<EngineerMap route={route} onPointClick={onOpenPoint} />}
              onStopClick={onOpenPoint}
            />
          ) : (
            <EngineerMap route={route} onPointClick={onOpenPoint} />
          )}
        </Suspense>
        <div className={styles.controls}>{viewSwitch}</div>
      </div>
      {sheet && <MapSheet day={day} route={route} />}
    </div>
  );
}
